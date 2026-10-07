/**
 * Who sees «Oportunidades» (plan 8, phase 3): the confirmed accounts listed in OPPORTUNITIES_ALLOWED_EMAILS, comma separated,
 * and since Plan 15 the members an owner or admin let in from «Administración › Personas» (server/commercial-opportunities/
 * access.ts). The server checks it on the page, on every route and before any read; the menu only shows what the server
 * answered.
 */
export type OpportunitiesIdentity = { email?: string | null; email_confirmed_at?: string | null };

export function opportunitiesAllowedEmails(configured: string | undefined) {
  return new Set(String(configured || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
}

/** An account whose email was confirmed: the only ones that ever see «Oportunidades». */
export function hasConfirmedEmail(user: OpportunitiesIdentity | null | undefined) {
  return Boolean(user?.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
}

export function isOpportunitiesUserAllowed(user: OpportunitiesIdentity | null | undefined, configured: string | undefined) {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && hasConfirmedEmail(user) && opportunitiesAllowedEmails(configured).has(email));
}
