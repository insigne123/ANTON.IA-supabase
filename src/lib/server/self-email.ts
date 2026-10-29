import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeHeaderRFC2047 } from '@/lib/email-header-utils';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { tokenService } from '@/lib/services/token-service';
import { signalProviderOutage } from '@/lib/server/provider-outage';

/**
 * The app's own emails to a person: the Monday «Informe semanal», the morning «Avisos» and «Contacto del día». With
 * RESEND_API_KEY they go out from a Yago address through Resend (REPORTS_FROM_EMAIL); without it, from the person's own
 * connected mailbox or the reports mailbox (sendReportEmail). They are not prospecting: no unsubscribe link, no tracking
 * and no do-not-contact header. WEEKLY_REPORTS_EMAIL=off stops every send, and test addresses never get one.
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

/** The Yago address the app's emails go out from through Resend, when RESEND_API_KEY is set. */
export function resendSender(env: Record<string, string | undefined> = process.env) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  return { apiKey, from: String(env.REPORTS_FROM_EMAIL || '').trim() || 'ANTON.IA <avisos@yago.cl>', replyTo: String(env.REPORTS_REPLY_TO || '').trim() || null };
}

/** Whether the app's emails reach people without a mailbox of their own: through Resend or the reports mailbox. */
export const canEmailEveryone = (env: Record<string, string | undefined> = process.env) => Boolean(resendSender(env) || reportSender(env));

/** Reserved test domains (example.com, *.test, …): automated emails there would only bounce and hurt the sender. */
export function isTestAddress(email: string | null | undefined) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return /^example\.(com|net|org)$/.test(domain) || /\.(test|example|invalid|localhost|local)$/.test(domain) || domain === 'localhost';
}

type Resend = NonNullable<ReturnType<typeof resendSender>>;
/** One email through Resend; a 429 (two per second) waits and tries again, twice at most. */
async function sendWithResend(input: SelfEmail, resend: Resend, request: Fetch, wait: (ms: number) => Promise<void>) {
  const body = JSON.stringify({
    from: resend.from, to: [input.to.trim()], subject: input.subject, html: input.html, text: input.text,
    ...(resend.replyTo ? { reply_to: resend.replyTo } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments.map(file => ({ filename: file.filename, content: file.content.toString('base64') })) } : {}),
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resend.apiKey}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return { ok: true as const };
      if (response.status === 401 || response.status === 403) signalProviderOutage('resend', 'refused', `HTTP ${response.status}`);
      // Its daily or monthly quota (daily_quota_exceeded, monthly_quota_exceeded) does not clear in a second, unlike two per second.
      const quota = response.status === 429 && /quota/i.test(JSON.stringify(await response.json().catch(() => null)));
      if (quota) signalProviderOutage('resend', 'empty', 'cupo de envíos del plan');
      if (response.status !== 429 || quota || attempt >= 2) return { ok: false as const, error: `Resend no aceptó el correo (${response.status}).` };
    } catch {
      return { ok: false as const, error: 'No pudimos conectar con Resend.' };
    }
    await wait(1000 * (attempt + 1));
  }
}

/**
 * The app's emails for everyone: through Resend from the Yago address when it is set up; otherwise from the person's own
 * Gmail or Outlook when they connected one, and else from the reports mailbox, always to the person's own address. A
 * mailbox that fails is not replaced: its error is the answer.
 */
export async function sendReportEmail(client: SupabaseClient, input: SelfEmail, deps: { fetch?: Fetch; env?: Record<string, string | undefined>; wait?: (ms: number) => Promise<void> } = {}) {
  const env = deps.env ?? process.env;
  if (env.WEEKLY_REPORTS_EMAIL === 'off') return { ok: false as const, error: 'El envío de informes está apagado.' };
  if (!EMAIL.test(input.to.trim())) return { ok: false as const, error: 'Tu cuenta no tiene un correo válido.' };
  if (isTestAddress(input.to)) return { ok: false as const, error: 'Es una dirección de prueba: no recibe correos automáticos.' };
  const resend = resendSender(env);
  if (resend) return sendWithResend(input, resend, deps.fetch ?? fetch, deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))));
  const own = await sendSelfEmail(client, input, deps);
  const sender = reportSender(env);
  if (own.ok || !('noMailbox' in own) || !sender || sender === input.userId) return own;
  return sendSelfEmail(client, { ...input, userId: sender }, deps);
}
