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
  const savedBy = await readSavedBy(client, scope, { emails: allEmails, providerIds, linkedins });
  if (!allEmails.length && !savedBy.users.size) return result;
  const nothing = Promise.resolve({ data: [], error: null });
  const [threads, members, replies] = await Promise.all([
    allEmails.length ? client.from('organization_contact_threads').select('recipient_key,status,opened_by_user_id,last_sent_by_user_id,first_contacted_at,last_contacted_at,reopened_at')
      .eq('organization_id', scope.organizationId).eq('channel', 'email').in('recipient_key', allEmails).in('status', LOCKED) : nothing,
    client.from('organization_members').select('user_id,profiles:user_id(full_name,email)').eq('organization_id', scope.organizationId),
    allEmails.length ? client.from('contacted_leads').select('email,replied_at').eq('organization_id', scope.organizationId).in('email', allEmails).not('replied_at', 'is', null).limit(1000) : nothing,
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

  // «Guardado por Ana» (Plan 6, PR-E): whoever saved the person first, where there is no thread yet. A notice, never a lock.
  const savedLock = (saved: Saved): TeamLock => ({ status: 'saved', ownerName: names.get(saved.userId) || 'Miembro del equipo',
    mine: saved.userId === scope.userId, replied: false, lastContactedAt: null });
  for (const [email, saved] of savedBy.byEmail) if (!result.byEmail[email]) result.byEmail[email] = savedLock(saved);
  for (const [id, saved] of savedBy.byProviderId) if (!result.byProviderId[id]) result.byProviderId[id] = savedLock(saved);
  for (const [url, saved] of savedBy.byLinkedin) if (!result.byLinkedin[url]) result.byLinkedin[url] = savedLock(saved);
  return result;
}

type Saved = { userId: string; at: number };

/** Keeps, for each key, the member who saved the person first. */
function keepFirst(map: Map<string, Saved>, key: string, row: { user_id?: unknown; created_at?: unknown }) {
  const userId = typeof row.user_id === 'string' ? row.user_id : '';
  if (!key || !userId) return;
  const at = Date.parse(String(row.created_at || '')) || Number.MAX_SAFE_INTEGER;
  const current = map.get(key);
  if (!current || at < current.at) map.set(key, { userId, at });
}

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
/** An email or a LinkedIn handle inside a PostgREST «ilike» list: no wildcard or grammar characters. */
const literal = (value: string) => value.replace(/[%,()*\\]/g, '');

/**
 * Who in the organization saved each person (Plan 6, PR-E): a saved contact or one of «Por escribir», by email (any case), provider
 * id or LinkedIn. Read with the person's own client, like the rest: members can read their organization's contacts.
 */
async function readSavedBy(client: Client, scope: Scope, input: { emails: string[]; providerIds: string[]; linkedins: string[] }) {
  const byEmail = new Map<string, Saved>();
  const byProviderId = new Map<string, Saved>();
  const byLinkedin = new Map<string, Saved>();
  const own = (table: string, fields: string) => client.from(table).select(fields).eq('organization_id', scope.organizationId);
  const reads: Array<Promise<void>> = [];
  const collect = (query: any, use: (row: any) => void) => reads.push((async () => {
    const read = await query.limit(LIMIT * 2);
    if (read.error) throw read.error;
    for (const row of read.data || []) use(row);
  })());
  for (const group of chunks(input.emails, 50)) {
    const filter = group.map(email => `email.ilike.${literal(email)}`).join(',');
    for (const table of ['leads', 'enriched_leads']) {
      collect(own(table, 'user_id,email,created_at').or(filter), row => keepFirst(byEmail, normalizeLockEmail(row.email), row));
    }
  }
  if (input.providerIds.length) {
    collect(own('leads', 'user_id,apollo_id,created_at').in('apollo_id', input.providerIds), row => keepFirst(byProviderId, String(row.apollo_id || ''), row));
    collect(own('leads', 'user_id,source_provider_id,created_at').in('source_provider_id', input.providerIds), row => keepFirst(byProviderId, String(row.source_provider_id || ''), row));
    collect(own('enriched_leads', 'user_id,source_provider_id,created_at').in('source_provider_id', input.providerIds), row => keepFirst(byProviderId, String(row.source_provider_id || ''), row));
  }
  if (input.linkedins.length) {
    const filter = input.linkedins.map(url => `linkedin_url.ilike.%linkedin.com/in/${literal(url.replace('linkedin.com/in/', ''))}%`).join(',');
    for (const table of ['leads', 'enriched_leads']) {
      collect(own(table, 'user_id,linkedin_url,created_at').or(filter), row => keepFirst(byLinkedin, normalizeLockLinkedin(row.linkedin_url), row));
    }
  }
  await Promise.all(reads);
  const users = new Set([...byEmail.values(), ...byProviderId.values(), ...byLinkedin.values()].map(saved => saved.userId));
  return { byEmail, byProviderId, byLinkedin, users };
}
