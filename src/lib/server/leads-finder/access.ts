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

/** The pilot is the application owner's, not every tenant owner/admin or every allowlisted address. */
export function hasLeadsFinderUserAccess(user:{id?:string;email?:string|null;email_confirmed_at?:string|null},env:Record<string,string|undefined>=process.env){
  return user.id==='de3a3194-29b1-449a-828a-53608a7ebe47'&&user.email?.trim().toLowerCase()==='nicolas.yarur.g@yago.cl'
    &&Boolean(user.email_confirmed_at)&&hasLeadsFinderAccess(user.email,env);
}
