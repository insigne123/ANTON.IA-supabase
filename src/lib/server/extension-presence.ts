import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readTeamLocks } from '@/lib/server/team-locks';
import { normalizeLockEmail, normalizeLockLinkedin } from '@/lib/team-lock';
import { profilePresence, type ProfilePresence } from '@/lib/extension-presence';

/** At most this many profiles per call: the people visible in one page of LinkedIn results. */
export const PRESENCE_LIMIT = 50;
const literal = (value: string) => value.replace(/[%,()*\\]/g, '');
const newest = (current: string | null | undefined, next: string | null | undefined) =>
  !next || !Number.isFinite(Date.parse(next)) ? current ?? null : !current || Date.parse(next) > Date.parse(current) ? next : current;

type Deps = { readTeamLocks: typeof readTeamLocks; admin: () => ReturnType<typeof getSupabaseAdminClient> };

/**
 * presence (plan 8, phase 4, PR-4b): for each LinkedIn profile, what the organization knows: someone else working it (the team
 * locks, with collaboration on), its reply, its last contact by LinkedIn or email, and whether it is saved. Read with the person's
 * own client, like the team locks; the LinkedIn sends table has no member grants, so it is read with the service client, scoped to
 * the active organization. Keys come back as they were sent; people the organization does not know are left out.
 */
export async function readExtensionPresence(auth: Pick<AuthContext, 'supabase' | 'organizationId' | 'user'>, urls: string[],
  now = Date.now(), deps: Deps = { readTeamLocks, admin: getSupabaseAdminClient }): Promise<Record<string, ProfilePresence>> {
  const asked = new Map<string, string>();
  for (const url of urls.slice(0, PRESENCE_LIMIT)) {
    const key = normalizeLockLinkedin(url);
    if (key && !asked.has(url)) asked.set(url, key);
  }
  const keys = [...new Set(asked.values())];
  if (!keys.length) return {};
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const filter = keys.map(key => `linkedin_url.ilike.%linkedin.com/in/${literal(key.replace('linkedin.com/in/', ''))}%`).join(',');
  const own = (table: 'leads' | 'enriched_leads') => auth.supabase.from(table).select('user_id,email,linkedin_url')
    .eq('organization_id', scope.organizationId).or(filter).limit(PRESENCE_LIMIT * 4);
  const [locks, leads, enriched, sends] = await Promise.all([
    deps.readTeamLocks(auth.supabase, scope, { linkedinUrls: keys }),
    own('leads'), own('enriched_leads'),
    deps.admin().from('extension_linkedin_sends').select('profile_url,updated_at').eq('organization_id', scope.organizationId)
      .eq('status', 'confirmed').or(keys.map(key => `profile_url.ilike.%${literal(key)}%`).join(',')).limit(PRESENCE_LIMIT * 4),
  ]);
  for (const read of [leads, enriched, sends]) if (read.error) throw read.error;

  // Saved and its email, by the exact profile (an «ilike» on the handle can also bring a longer handle).
  const saved = new Map<string, { mine: boolean; emails: Set<string> }>();
  for (const row of [...(leads.data || []), ...(enriched.data || [])] as Array<{ user_id: string | null; email: string | null; linkedin_url: string | null }>) {
    const key = normalizeLockLinkedin(row.linkedin_url);
    if (!keys.includes(key)) continue;
    const entry = saved.get(key) ?? { mine: false, emails: new Set<string>() };
    entry.mine ||= row.user_id === scope.userId;
    const email = normalizeLockEmail(row.email);
    if (email.includes('@')) entry.emails.add(email);
    saved.set(key, entry);
  }
  const linkedinAt = new Map<string, string | null>();
  for (const row of (sends.data || []) as Array<{ profile_url: string; updated_at: string }>) {
    const key = normalizeLockLinkedin(row.profile_url);
    if (keys.includes(key)) linkedinAt.set(key, newest(linkedinAt.get(key), row.updated_at));
  }
  const emails = [...new Set([...saved.values()].flatMap(entry => [...entry.emails]))];
  const byEmail = new Map<string, { sentAt: string | null; repliedAt: string | null }>();
  if (emails.length) {
    const contacted = await auth.supabase.from('contacted_leads').select('email,sent_at,replied_at')
      .eq('organization_id', scope.organizationId).in('email', emails).limit(1000);
    if (contacted.error) throw contacted.error;
    for (const row of (contacted.data || []) as Array<{ email: string | null; sent_at: string | null; replied_at: string | null }>) {
      const email = normalizeLockEmail(row.email);
      const entry = byEmail.get(email) ?? { sentAt: null, repliedAt: null };
      byEmail.set(email, { sentAt: newest(entry.sentAt, row.sent_at), repliedAt: newest(entry.repliedAt, row.replied_at) });
    }
  }

  const result: Record<string, ProfilePresence> = {};
  for (const [url, key] of asked) {
    const entry = saved.get(key);
    let lastEmailAt: string | null = null;
    let repliedAt: string | null = null;
    for (const email of entry?.emails ?? []) {
      lastEmailAt = newest(lastEmailAt, byEmail.get(email)?.sentAt);
      repliedAt = newest(repliedAt, byEmail.get(email)?.repliedAt);
    }
    const presence = profilePresence({ lock: locks.byLinkedin[key] ?? null, saved: entry ? { mine: entry.mine } : null,
      lastLinkedinAt: linkedinAt.get(key) ?? null, lastEmailAt, repliedAt }, now);
    if (presence) result[url] = presence;
  }
  return result;
}
