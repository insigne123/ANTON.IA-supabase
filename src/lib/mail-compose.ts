// A new e-mail opened in the person's own mail, already written (OPP-22): in Gmail or in Outlook on the web when that is the account
// connected to ANTON.IA, otherwise in the computer's mail program. Nothing is sent from here: the person reads it, adds who it goes to
// and sends it. Pure: the page and the tests share it.
import type { MailProvider } from './mail-sender';

export type ComposeInput = { to?: string | null; subject: string; body: string };
/** The longest address a mail program opens without cutting it (mailto); a longer e-mail is copied instead. */
export const MAILTO_MAX = 1900;
const query = (params: Record<string, string>) => Object.entries(params).filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

/** Where the e-mail opens written, or null when it is too long for the computer's mail program. */
export function composeUrl(provider: MailProvider | null, input: ComposeInput): string | null {
  const to = (input.to || '').trim();
  if (provider === 'google') return `https://mail.google.com/mail/?${query({ view: 'cm', fs: '1', tf: '1', to, su: input.subject, body: input.body })}`;
  if (provider === 'outlook') return `https://outlook.office.com/mail/deeplink/compose?${query({ to, subject: input.subject, body: input.body })}`;
  const href = `mailto:${encodeURIComponent(to)}?${query({ subject: input.subject, body: input.body })}`;
  return href.length <= MAILTO_MAX ? href : null;
}
