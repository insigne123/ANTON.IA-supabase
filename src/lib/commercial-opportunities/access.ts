/**
 * Who sees «Oportunidades» (plan 8, phase 3): the confirmed accounts listed in OPPORTUNITIES_ALLOWED_EMAILS, comma separated.
 * The server checks it on the page, on every route and before any read; the menu only shows what the server answered.
 * Opening the section to more people is changing the list, without a migration.
 */
export type OpportunitiesIdentity = { email?: string | null; email_confirmed_at?: string | null };

export function opportunitiesAllowedEmails(configured: string | undefined) {
  return new Set(String(configured || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
}

export function isOpportunitiesUserAllowed(user: OpportunitiesIdentity | null | undefined, configured: string | undefined) {
  const email = user?.email?.trim().toLowerCase();
  const confirmed = Boolean(user?.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
  return Boolean(email && confirmed && opportunitiesAllowedEmails(configured).has(email));
}
