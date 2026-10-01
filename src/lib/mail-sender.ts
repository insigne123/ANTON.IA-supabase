/**
 * Which connected mailbox sends the person's emails (Plan 5, PR-6b): the one chosen in Conexiones while it is still
 * connected, otherwise the only connected one. Pure: Conexiones, Cowork and the campaigns share it
 * (docs/remitente-y-oferta.md).
 */
export type MailProvider = 'google' | 'outlook';
export type MailConnections = Record<MailProvider, boolean>;

export const MAIL_PROVIDER_LABEL: Record<MailProvider, string> = { google: 'Gmail', outlook: 'Outlook' };

export function isMailProvider(value: unknown): value is MailProvider {
  return value === 'google' || value === 'outlook';
}

/** The mailbox that sends; null when none is connected, or two are and none was chosen. */
export function resolveMailProvider(connected: MailConnections, preferred: unknown): MailProvider | null {
  if (isMailProvider(preferred) && connected[preferred]) return preferred;
  if (connected.google !== connected.outlook) return connected.google ? 'google' : 'outlook';
  return null;
}

/** The mailbox a mail provider names in the person's own words («desde Outlook», «por Gmail»), if any. */
export function mailProviderNamedIn(message: string): MailProvider | null {
  if (/(?<!\p{L})outlook(?!\p{L})/iu.test(message)) return 'outlook';
  if (/(?<!\p{L})(?:gmail|google)(?!\p{L})/iu.test(message)) return 'google';
  return null;
}

/**
 * The mailbox of a campaign Cowork proposes: the one the person named in their message when it is connected; else
 * the one that sends by default; else what the model chose. Cowork no longer asks Gmail or Outlook each time.
 */
export function coworkCampaignProvider(input: { message: string; connected: MailConnections; preferred: unknown; proposed: MailProvider }): MailProvider {
  const asked = mailProviderNamedIn(input.message);
  if (asked && input.connected[asked]) return asked;
  return resolveMailProvider(input.connected, input.preferred) ?? input.proposed;
}
