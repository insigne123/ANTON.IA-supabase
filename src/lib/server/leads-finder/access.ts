/**
 * Who can try the Leads Finder search (Plan 11, PR 6c): it is a test next to Apollo, so it is off unless
 * LEADS_FINDER_ENABLED=true, and even then only for the emails listed in LEADS_FINDER_ALLOWED_EMAILS (comma or space
 * separated). An empty list lets nobody in: the test opens person by person, starting with whoever runs it.
 */
export function leadsFinderAllowedEmails(env: Record<string, string | undefined> = process.env) {
  return new Set(String(env.LEADS_FINDER_ALLOWED_EMAILS || '')
    .split(/[\s,;]+/)
    .map(email => email.trim().toLowerCase())
    .filter(email => email.includes('@')));
}

export function leadsFinderEnabled(env: Record<string, string | undefined> = process.env) {
  return String(env.LEADS_FINDER_ENABLED || '').trim().toLowerCase() === 'true';
}

export function hasLeadsFinderAccess(email: unknown, env: Record<string, string | undefined> = process.env) {
  const normalized = String(email || '').trim().toLowerCase();
  return Boolean(normalized) && leadsFinderEnabled(env) && leadsFinderAllowedEmails(env).has(normalized);
}
