import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeHeaderRFC2047 } from '@/lib/email-header-utils';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { tokenService } from '@/lib/services/token-service';

/**
 * An email the person sends to themselves from their own connected mailbox (the Monday «Informe semanal»). It is not
 * prospecting: no unsubscribe link, no tracking and no do-not-contact header, which would list the person's own address.
 * WEEKLY_REPORTS_EMAIL=off stops every send. Whoever has no mailbox connected gets it from the reports mailbox
 * (sendReportEmail).
 */
type Fetch = typeof fetch;
export type SelfAttachment = { filename: string; contentType: string; content: Buffer };
export type SelfEmail = { userId: string; to: string; subject: string; html: string; text: string; attachments?: SelfAttachment[] };

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
const base64Lines = (text: string) => Buffer.from(text, 'utf8').toString('base64').replace(/.{1,76}/g, line => `${line}\r\n`).trimEnd();

const base64Bytes = (content: Buffer) => content.toString('base64').replace(/.{1,76}/g, line => `${line}\r\n`).trimEnd();
/** A file name for a MIME header: plain ASCII, without quotes or line breaks. */
const mimeName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]/g, '').trim().slice(0, 120) || 'adjunto';

/** The message as Gmail's API takes it: multipart/alternative, UTF-8, the subject encoded; inside multipart/mixed when it carries files. */
export function selfMime(input: Pick<SelfEmail, 'to' | 'subject' | 'html' | 'text' | 'attachments'>, boundary = `anton-${randomUUID()}`) {
  const alternative = [
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64Lines(input.text),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64Lines(input.html),
    `--${boundary}--`,
  ];
  const head = [`To: ${input.to}`, `Subject: ${encodeHeaderRFC2047(input.subject)}`, 'MIME-Version: 1.0'];
  if (!input.attachments?.length) return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...alternative, ''].join('\r\n');
  const mixed = `${boundary}-mixed`;
  return [
    ...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '',
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...alternative,
    ...input.attachments.flatMap(file => [
      `--${mixed}`, `Content-Type: ${file.contentType}; name="${mimeName(file.filename)}"`, `Content-Disposition: attachment; filename="${mimeName(file.filename)}"`,
      'Content-Transfer-Encoding: base64', '', base64Bytes(file.content),
    ]),
    `--${mixed}--`, '',
  ].join('\r\n');
}

export async function sendSelfEmail(client: SupabaseClient, input: SelfEmail, deps: { fetch?: Fetch; env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env;
  const request = deps.fetch ?? fetch;
  if (env.WEEKLY_REPORTS_EMAIL === 'off') return { ok: false as const, error: 'El envío de informes está apagado.' };
  const to = input.to.trim();
  if (!EMAIL.test(to)) return { ok: false as const, error: 'Tu cuenta no tiene un correo válido.' };
  const { resolved } = await readMailSenderPreference(client, input.userId);
  if (!resolved) return { ok: false as const, noMailbox: true as const, error: 'Conecta Gmail u Outlook en «Conexiones» para recibirlo por correo.' };
  try {
    const token = await tokenService.getToken(client, input.userId, resolved);
    if (!token?.refresh_token) return { ok: false as const, error: 'Reconecta tu correo en «Conexiones».' };
    if (resolved === 'google') {
      const { access_token } = await refreshGoogleToken(token.refresh_token, env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!);
      const raw = Buffer.from(selfMime({ ...input, to })).toString('base64url');
      const response = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(30_000),
      });
      return response.ok ? { ok: true as const } : { ok: false as const, error: `Gmail no aceptó el correo (${response.status}).` };
    }
    const { access_token } = await refreshMicrosoftToken(token.refresh_token, env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, env.AZURE_AD_CLIENT_SECRET!, env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
    const response = await request('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ message: { subject: input.subject, body: { contentType: 'HTML', content: input.html }, toRecipients: [{ emailAddress: { address: to } }],
        ...(input.attachments?.length ? { attachments: input.attachments.map(file => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: file.filename,
          contentType: file.contentType, contentBytes: file.content.toString('base64') })) } : {}) }, saveToSentItems: false }),
    });
    return response.ok ? { ok: true as const } : { ok: false as const, error: `Outlook no aceptó el correo (${response.status}).` };
  } catch {
    return { ok: false as const, error: 'Reconecta tu correo en «Conexiones».' };
  }
}

/** The account whose connected mailbox sends the report to whoever has none (WEEKLY_REPORTS_SENDER_USER_ID). */
export const reportSender = (env: Record<string, string | undefined> = process.env) => String(env.WEEKLY_REPORTS_SENDER_USER_ID || '').trim() || null;

/**
 * The «Informe semanal» for everyone: from the person's own Gmail or Outlook when they connected one, and otherwise from
 * the reports mailbox, still to the person's own address. A mailbox that fails is not replaced: its error is the answer.
 */
export async function sendReportEmail(client: SupabaseClient, input: SelfEmail, deps: { fetch?: Fetch; env?: Record<string, string | undefined> } = {}) {
  const own = await sendSelfEmail(client, input, deps);
  const sender = reportSender(deps.env ?? process.env);
  if (own.ok || !('noMailbox' in own) || !sender || sender === input.userId) return own;
  return sendSelfEmail(client, { ...input, userId: sender }, deps);
}
