import { normalizeLockEmail, normalizeLockLinkedin, type TeamLock, type TeamLockStatus } from '@/lib/team-lock';

type Client = { from: (table: string) => any };
type Scope = { userId: string; organizationId: string };
export type TeamLockQuery = { emails?: string[]; providerIds?: string[]; linkedinUrls?: string[] };
export type TeamLocks = {
  enabled: boolean;
  byEmail: Record<string, TeamLock>;
  byProviderId: Record<string, TeamLock>;
  byLinkedin: Record<string, TeamLock>;
};

const LIMIT = 200;
const LOCKED: TeamLockStatus[] = ['reserved', 'active', 'closed', 'suppressed'];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].slice(0, LIMIT);

/**
 * The team locks for a set of people (Plan 5, PR-9b), read with the person's own client: members can read their
 * organization's contacts, conversations and threads. People are matched by email; search results without one are
 * matched through a contact another member saved, by provider id or LinkedIn. Without collaboration nothing is locked.
 */
export async function readTeamLocks(client: Client, scope: Scope, input: TeamLockQuery): Promise<TeamLocks> {
  const empty: TeamLocks = { enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} };
  const org = await client.from('organizations').select('collaboration_v1_enabled').eq('id', scope.organizationId).maybeSingle();
  if (org.error) throw org.error;
  if (!org.data?.collaboration_v1_enabled) return empty;
  const result: TeamLocks = { ...empty, enabled: true };

  const emails = unique((input.emails || []).map(normalizeLockEmail).filter(email => email.includes('@')));
  const providerIds = unique((input.providerIds || []).map(value => String(value || '').trim()));
  const linkedins = unique((input.linkedinUrls || []).map(normalizeLockLinkedin));

  // Search results reach their email through a contact saved in the organization.
  const providerEmail = new Map<string, string>();
  const linkedinEmail = new Map<string, string>();
  if (providerIds.length) {
    const saved = await client.from('leads').select('apollo_id,email').eq('organization_id', scope.organizationId).in('apollo_id', providerIds).not('email', 'is', null).limit(LIMIT);
    if (saved.error) throw saved.error;
    for (const row of saved.data || []) if (row.apollo_id && normalizeLockEmail(row.email)) providerEmail.set(String(row.apollo_id), normalizeLockEmail(row.email));
  }
  if (linkedins.length) {
    const handles = linkedins.map(url => url.replace('linkedin.com/in/', ''));
    const saved = await client.from('leads').select('linkedin_url,email').eq('organization_id', scope.organizationId)
      .or(handles.map(handle => `linkedin_url.ilike.%linkedin.com/in/${handle.replace(/[%,()*]/g, '')}%`).join(',')).not('email', 'is', null).limit(LIMIT);
    if (saved.error) throw saved.error;
    for (const row of saved.data || []) {
      const key = normalizeLockLinkedin(row.linkedin_url);
      if (key && normalizeLockEmail(row.email)) linkedinEmail.set(key, normalizeLockEmail(row.email));
    }
  }

  const allEmails = unique([...emails, ...providerEmail.values(), ...linkedinEmail.values()]);
  if (!allEmails.length) return result;
  const [threads, members, replies] = await Promise.all([
    client.from('organization_contact_threads').select('recipient_key,status,opened_by_user_id,last_sent_by_user_id,first_contacted_at,last_contacted_at,reopened_at')
      .eq('organization_id', scope.organizationId).eq('channel', 'email').in('recipient_key', allEmails).in('status', LOCKED),
    client.from('organization_members').select('user_id,profiles:user_id(full_name,email)').eq('organization_id', scope.organizationId),
    client.from('contacted_leads').select('email,replied_at').eq('organization_id', scope.organizationId).in('email', allEmails).not('replied_at', 'is', null).limit(1000),
  ]);
  for (const read of [threads, members, replies]) if (read.error) throw read.error;

  const names = new Map<string, string>();
  for (const member of members.data || []) {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
    names.set(member.user_id, profile?.full_name?.trim() || profile?.email?.trim() || 'Miembro del equipo');
  }
  const lastReply = new Map<string, number>();
  for (const row of replies.data || []) {
    const key = normalizeLockEmail(row.email);
    const at = Date.parse(row.replied_at || '');
    if (key && Number.isFinite(at)) lastReply.set(key, Math.max(lastReply.get(key) || 0, at));
  }
  for (const thread of threads.data || []) {
    const owner = thread.opened_by_user_id || thread.last_sent_by_user_id || null;
    const cycleStart = Date.parse(thread.reopened_at || thread.first_contacted_at || '') || 0;
    result.byEmail[thread.recipient_key] = {
      status: thread.status,
      ownerName: owner ? names.get(owner) || 'Miembro del equipo' : null,
      mine: Boolean(owner && owner === scope.userId),
      replied: (lastReply.get(thread.recipient_key) || 0) >= cycleStart && lastReply.has(thread.recipient_key),
      lastContactedAt: thread.last_contacted_at || null,
    };
  }
  for (const [id, email] of providerEmail) if (result.byEmail[email]) result.byProviderId[id] = result.byEmail[email];
  for (const [url, email] of linkedinEmail) if (result.byEmail[email]) result.byLinkedin[url] = result.byEmail[email];
  return result;
}
