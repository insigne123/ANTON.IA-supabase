import { buildAdoption, classifyReplies, compareResults, needsHelp, replyRate, type MemberSignals, type ResultsSnapshot } from '@/lib/admin/value';
import { dayStartInZone, previousRange, shiftDay } from '@/lib/admin/chile-time';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { loadMemberIdentities } from '@/lib/server/admin-member-identities';

const MAX_ROWS = 20_000;

type Range = { from: string; to: string };
export type AdminValueQuery = Range & { groupId?: string | null; userId?: string | null };

function text(value: unknown) {
  return String(value ?? '').trim();
}

function displayName(user: any, fallback: string) {
  const metadata = user?.user_metadata || {};
  return text(metadata.full_name || metadata.name || metadata.display_name || user?.email?.split('@')[0]) || fallback;
}

function rowsOrThrow<T = any>(result: { data: T[] | null; error: unknown }, label: string): T[] {
  if (result.error) {
    console.error(`[admin-value-data] ${label} query failed:`, result.error);
    throw new Error('No pudimos cargar el resumen de adopción. Inténtalo de nuevo.');
  }
  return Array.isArray(result.data) ? result.data : [];
}

function countOrThrow(result: { count: number | null; error: unknown }, label: string) {
  if (result.error) {
    console.error(`[admin-value-data] ${label} count failed:`, result.error);
    throw new Error('No pudimos cargar los resultados del período. Inténtalo de nuevo.');
  }
  return result.count || 0;
}

/** People in scope: the whole organization, one team (current assignments) or one person. */
async function scopeMembers(supabase: any, organizationId: string, query: AdminValueQuery) {
  const members = rowsOrThrow(await supabase
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true }), 'organization_members');
  let scoped = members;
  if (query.groupId) {
    const assignments = rowsOrThrow(await supabase
      .from('organization_reporting_group_members')
      .select('user_id, unassigned_at')
      .eq('organization_id', organizationId)
      .eq('group_id', query.groupId), 'organization_reporting_group_members');
    const inGroup = new Set(assignments.filter((row: any) => !row.unassigned_at).map((row: any) => text(row.user_id)));
    scoped = scoped.filter((member: any) => inGroup.has(text(member.user_id)));
  }
  if (query.userId) scoped = scoped.filter((member: any) => text(member.user_id) === query.userId);
  return { members: scoped, filtered: Boolean(query.groupId || query.userId) };
}

async function loadResults(supabase: any, organizationId: string, range: Range, userIds: string[] | null): Promise<ResultsSnapshot> {
  const start = dayStartInZone(range.from).toISOString();
  const end = dayStartInZone(shiftDay(range.to, 1)).toISOString();
  const scoped = <T extends { in: (column: string, values: string[]) => T }>(builder: T, column = 'user_id') => (userIds ? builder.in(column, userIds) : builder);
  const head = { count: 'exact' as const, head: true };

  const [sent, replies, saved, researched, meetings] = await Promise.all([
    scoped(supabase.from('contacted_leads').select('id', head).eq('organization_id', organizationId).gte('sent_at', start).lt('sent_at', end)),
    scoped(supabase.from('contacted_leads').select('reply_intent').eq('organization_id', organizationId).gte('replied_at', start).lt('replied_at', end)).limit(MAX_ROWS),
    scoped(supabase.from('leads').select('id', head).eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end)),
    scoped(supabase.from('lead_research_jobs').select('id', head).eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end)),
    // The pipeline has no owner per person, so meetings are only counted for the whole organization.
    userIds
      ? Promise.resolve({ count: null, error: null })
      : supabase.from('unified_crm_data').select('id', head).eq('organization_id', organizationId).eq('stage', 'meeting').gte('updated_at', start).lt('updated_at', end),
  ]);

  const breakdown = classifyReplies(rowsOrThrow(replies, 'contacted_leads.replies'));
  return {
    sent: countOrThrow(sent, 'contacted_leads.sent'),
    replies: breakdown,
    interested: breakdown.meeting + breakdown.positive,
    pipelineMeetings: countOrThrow(meetings, 'unified_crm_data'),
    savedContacts: countOrThrow(saved, 'leads'),
    researched: countOrThrow(researched, 'lead_research_jobs'),
  };
}

/** Everything the «¿Les está sirviendo?» section shows, for the organization the admin manages. */
export async function loadAdminValue(supabase: any, organizationId: string, query: AdminValueQuery, now = new Date()) {
  const { members, filtered } = await scopeMembers(supabase, organizationId, query);
  const userIds = members.map((member: any) => text(member.user_id)).filter(Boolean);
  const activitySince = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const empty = { data: [], error: null };
  const [identities, tokens, profiles, sentRows, activityRows] = userIds.length === 0
    ? [{ data: { users: [] }, error: null }, empty, empty, empty, empty]
    : await Promise.all([
      loadMemberIdentities(supabase, userIds),
      // Tokens are service-only; only which providers are connected leaves the server.
      supabase.from('provider_tokens').select('user_id, provider').in('user_id', userIds),
      supabase.from('profiles').select('id, company_name, company_domain, full_name, job_title, signatures').in('id', userIds),
      supabase.from('contacted_leads').select('user_id').eq('organization_id', organizationId).not('sent_at', 'is', null).in('user_id', userIds).limit(MAX_ROWS),
      supabase.from('antonia_event_ledger').select('actor_user_id, occurred_at').eq('organization_id', organizationId)
        .gte('occurred_at', activitySince).neq('source_confidence', 'diagnostic_test').in('actor_user_id', userIds)
        .order('occurred_at', { ascending: false }).limit(MAX_ROWS),
    ]);

  if (identities.error) {
    console.error('[admin-value-data] identities failed:', identities.error);
    throw new Error('No pudimos cargar las personas de la organización. Inténtalo de nuevo.');
  }
  const userById = new Map((identities.data?.users || []).map((user: any) => [text(user.id), user]));
  const mailUsers = new Set(rowsOrThrow(tokens, 'provider_tokens').filter((row: any) => text(row.provider)).map((row: any) => text(row.user_id)));
  const profileById = new Map(rowsOrThrow(profiles, 'profiles').map((row: any) => [text(row.id), row]));
  const senders = new Set(rowsOrThrow(sentRows, 'contacted_leads.senders').map((row: any) => text(row.user_id)));
  const lastActivity = new Map<string, string>();
  for (const row of rowsOrThrow(activityRows, 'antonia_event_ledger')) {
    const userId = text((row as any).actor_user_id);
    if (userId && !lastActivity.has(userId)) lastActivity.set(userId, text((row as any).occurred_at));
  }

  const signals: MemberSignals[] = members.map((member: any) => {
    const userId = text(member.user_id);
    const user = userById.get(userId);
    const form = mapProfileToForm(profileById.get(userId) || null);
    const hasOffer = [form.valueProposition, form.description, form.services].some((value) => text(value).length > 0);
    return {
      userId,
      name: displayName(user, `${userId.slice(0, 8)}…`),
      email: text(user?.email),
      role: text(member.role),
      invitedAt: text(member.created_at) || null,
      lastSignInAt: text(user?.last_sign_in_at) || null,
      lastActivityAt: lastActivity.get(userId) || null,
      mailConnected: mailUsers.has(userId),
      profileReady: Boolean(text(form.companyName) && hasOffer),
      hasSent: senders.has(userId),
    };
  });

  const scopeIds = filtered ? userIds : null;
  const previous = previousRange(query);
  const [currentResults, previousResults] = userIds.length === 0 && filtered
    ? [emptyResults(), emptyResults()]
    : await Promise.all([
      loadResults(supabase, organizationId, query, scopeIds),
      loadResults(supabase, organizationId, previous, scopeIds),
    ]);

  return {
    range: { from: query.from, to: query.to },
    previousRange: previous,
    scope: filtered ? 'filtered' as const : 'organization' as const,
    generatedAt: now.toISOString(),
    adoption: buildAdoption(signals, now),
    needsHelp: needsHelp(signals, now),
    results: {
      current: currentResults,
      previous: previousResults,
      comparison: compareResults(currentResults, previousResults),
      replyRate: replyRate(currentResults),
      previousReplyRate: replyRate(previousResults),
      partial: currentResults.replies.real + currentResults.replies.automatic + currentResults.replies.bounced >= MAX_ROWS,
    },
    people: signals,
  };
}

function emptyResults(): ResultsSnapshot {
  return { sent: 0, replies: classifyReplies([]), interested: 0, pipelineMeetings: 0, savedContacts: 0, researched: 0 };
}

export type AdminValue = Awaited<ReturnType<typeof loadAdminValue>>;
