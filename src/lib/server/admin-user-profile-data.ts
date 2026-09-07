import type {
  AdminUserCreditBucket,
  AdminUserCreditStatus,
  AdminUserProfile,
  AdminUserProfileRole,
  AdminUserTimelineItem,
  AdminUserTimelineSource,
} from '@/lib/admin-user-profile-types';

const HISTORY_DAYS = 90 as const;
const MAX_SOURCE_ROWS = 500;
const MAX_TIMELINE_ITEMS = 160;

type OptionalRows = {
  rows: any[];
  count: number | null;
  sampled: boolean;
};

const ACTIVITY_TITLES: Record<string, string> = {
  create_lead: 'Lead creado',
  update_lead: 'Lead actualizado',
  delete_lead: 'Lead eliminado',
  create_campaign: 'Campaña creada',
  update_campaign: 'Campaña actualizada',
  delete_campaign: 'Campaña eliminada',
  invite_member: 'Miembro invitado',
  update_member: 'Miembro actualizado',
  remove_member: 'Miembro eliminado',
  join_organization: 'Se unió a la organización',
  leave_organization: 'Dejó la organización',
  create_organization: 'Organización creada',
  update_organization: 'Organización actualizada',
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function finiteNumber(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roleOf(value: unknown): AdminUserProfileRole {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

function safeAvatarUrl(value: unknown) {
  const candidate = normalize(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function humanize(value: unknown) {
  const text = normalize(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : 'Actividad registrada';
}

function humanizeOptional(value: unknown) {
  return normalize(value) ? humanize(value) : '';
}

function compactDetail(...values: unknown[]) {
  const parts = values.map(normalize).filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function withinPeriod(value: unknown, from: Date, to: Date) {
  const date = new Date(normalize(value));
  return Number.isFinite(date.getTime()) && date >= from && date <= to;
}

function bucket(countValue: unknown, limitValue: unknown): AdminUserCreditBucket | null {
  const used = finiteNumber(countValue);
  const limit = finiteNumber(limitValue);
  if (used == null || limit == null) return null;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

function parseCreditStatus(value: unknown, dayKey: string, resetAt: string): AdminUserCreditStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid admin user credit status response');
  }

  const status = value as Record<string, unknown>;
  const mode = normalize(status.mode || 'user');
  const binding = normalize(status.binding || 'user');
  const used = finiteNumber(status.count);
  const limit = finiteNumber(status.limit);
  if (
    typeof status.allowed !== 'boolean'
    || !['user', 'team', 'hybrid'].includes(mode)
    || !['user', 'team'].includes(binding)
    || used == null
    || limit == null
  ) {
    throw new Error('Invalid admin user credit status response');
  }

  return {
    allowed: status.allowed,
    mode: mode as AdminUserCreditStatus['mode'],
    binding: binding as AdminUserCreditStatus['binding'],
    dayKey: normalize(status.day_key) || dayKey,
    resetAt,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    legacy: Boolean(status.legacy),
    groupId: normalize(status.group_id) || null,
    groupName: null,
    user: bucket(status.user_count, status.user_limit),
    team: bucket(status.team_count, status.team_limit),
  };
}

async function readOptionalRows(
  source: AdminUserTimelineSource,
  query: PromiseLike<{ data?: any[] | null; error?: any; count?: number | null }>,
  unavailableSources: Set<AdminUserTimelineSource>,
): Promise<OptionalRows> {
  try {
    const result = await query;
    if (result.error) {
      unavailableSources.add(source);
      console.error(`[admin-user-profile-data] ${source} query failed:`, result.error);
      return { rows: [], count: null, sampled: false };
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    const count = typeof result.count === 'number' ? result.count : null;
    return { rows, count, sampled: count != null && count > rows.length };
  } catch (error) {
    unavailableSources.add(source);
    console.error(`[admin-user-profile-data] ${source} query failed:`, error);
    return { rows: [], count: null, sampled: false };
  }
}

function ledgerPresentation(eventType: unknown): Pick<AdminUserTimelineItem, 'category' | 'title'> {
  const type = normalize(eventType).toLowerCase();
  if (type.includes('reply') || type.includes('replied')) return { category: 'reply', title: 'Respuesta registrada' };
  if (type.includes('research') || type.includes('investigat')) return { category: 'research', title: 'Investigación actualizada' };
  if (type.includes('email.sent') || type.includes('outbound.sent') || type.includes('dispatch.sent')) {
    return { category: 'outreach', title: 'Contacto enviado' };
  }
  if (type.includes('lead') && (type.includes('created') || type.includes('captur'))) {
    return { category: 'lead', title: 'Lead capturado' };
  }
  if (type.includes('quota.denied')) return { category: 'system', title: 'Operación detenida por créditos' };
  if (type.includes('quota')) return { category: 'system', title: 'Uso de créditos registrado' };
  return { category: 'system', title: humanize(eventType) };
}

function timelineFromLedger(rows: any[], from: Date, to: Date): AdminUserTimelineItem[] {
  return rows.flatMap((row) => {
    if (!withinPeriod(row.occurred_at, from, to)) return [];
    const presentation = ledgerPresentation(row.event_type);
    return [{
      id: `antonia_event_ledger:${normalize(row.id)}`,
      source: 'antonia_event_ledger' as const,
      category: presentation.category,
      occurredAt: String(row.occurred_at),
      title: presentation.title,
      detail: compactDetail(humanizeOptional(row.entity_type), humanizeOptional(row.provider)),
      status: normalize(row.outcome || row.status) || null,
    }];
  });
}

function timelineFromActivities(rows: any[], from: Date, to: Date): AdminUserTimelineItem[] {
  return rows.flatMap((row) => {
    if (!withinPeriod(row.created_at, from, to)) return [];
    const action = normalize(row.action);
    return [{
      id: `activity_logs:${normalize(row.id)}`,
      source: 'activity_logs' as const,
      category: action.includes('lead') ? 'lead' as const : 'account' as const,
      occurredAt: String(row.created_at),
      title: ACTIVITY_TITLES[action] || humanize(action),
      detail: normalize(row.entity_type) ? humanize(row.entity_type) : null,
      status: null,
    }];
  });
}

function timelineFromLeads(rows: any[], from: Date, to: Date): AdminUserTimelineItem[] {
  return rows.flatMap((row) => {
    if (!withinPeriod(row.created_at, from, to)) return [];
    return [{
      id: `leads:${normalize(row.id)}`,
      source: 'leads' as const,
      category: 'lead' as const,
      occurredAt: String(row.created_at),
      title: 'Lead creado',
      detail: compactDetail(row.name, row.company, row.title),
      status: normalize(row.status) || null,
    }];
  });
}

function timelineFromContacts(
  sentRows: any[],
  repliedRows: any[],
  bouncedRows: any[],
  from: Date,
  to: Date,
): AdminUserTimelineItem[] {
  const sent = sentRows.flatMap((row) => withinPeriod(row.sent_at, from, to) ? [{
    id: `contacted_leads:${normalize(row.id)}:sent`,
    source: 'contacted_leads' as const,
    category: 'outreach' as const,
    occurredAt: String(row.sent_at),
    title: 'Contacto enviado',
    detail: compactDetail(row.name, row.company, row.subject),
    status: normalize(row.delivery_status || row.status) || null,
  }] : []);
  const replies = repliedRows.flatMap((row) => withinPeriod(row.replied_at, from, to) ? [{
    id: `contacted_leads:${normalize(row.id)}:reply`,
    source: 'contacted_leads' as const,
    category: 'reply' as const,
    occurredAt: String(row.replied_at),
    title: 'Respuesta recibida',
    detail: compactDetail(row.name, row.company, row.reply_summary || row.reply_subject),
    status: normalize(row.reply_intent || row.reply_sentiment) || null,
  }] : []);
  const bounced = bouncedRows.flatMap((row) => withinPeriod(row.bounced_at, from, to) ? [{
    id: `contacted_leads:${normalize(row.id)}:bounce`,
    source: 'contacted_leads' as const,
    category: 'outreach' as const,
    occurredAt: String(row.bounced_at),
    title: 'Entrega rechazada',
    detail: compactDetail(row.name, row.company, row.bounce_category),
    status: 'bounced',
  }] : []);
  return [...sent, ...replies, ...bounced];
}

function timelineFromResearch(rows: any[], from: Date, to: Date): AdminUserTimelineItem[] {
  return rows.flatMap((row) => {
    const items: AdminUserTimelineItem[] = [];
    if (withinPeriod(row.created_at, from, to)) {
      items.push({
        id: `lead_research_jobs:${normalize(row.id)}:created`,
        source: 'lead_research_jobs',
        category: 'research',
        occurredAt: String(row.created_at),
        title: 'Investigación iniciada',
        detail: compactDetail(row.company_name, humanize(row.provider)),
        status: normalize(row.status) || null,
      });
    }
    if (withinPeriod(row.completed_at, from, to)) {
      items.push({
        id: `lead_research_jobs:${normalize(row.id)}:completed`,
        source: 'lead_research_jobs',
        category: 'research',
        occurredAt: String(row.completed_at),
        title: row.status === 'failed' ? 'Investigación no completada' : 'Investigación completada',
        detail: compactDetail(row.company_name, humanize(row.provider)),
        status: normalize(row.status) || null,
      });
    }
    return items;
  });
}

export async function loadAdminUserProfile(
  supabase: any,
  organizationId: string,
  organizationName: string,
  userId: string,
): Promise<AdminUserProfile | null> {
  // Membership is checked before auth identity or history is read. This is the
  // security boundary that prevents the service-role client from crossing orgs.
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) return null;

  const generatedAt = new Date();
  const toIso = generatedAt.toISOString();
  const dayKey = toIso.slice(0, 10);
  const periodFrom = new Date(`${dayKey}T00:00:00.000Z`);
  periodFrom.setUTCDate(periodFrom.getUTCDate() - (HISTORY_DAYS - 1));
  const fromIso = periodFrom.toISOString();
  const nextReset = new Date(`${dayKey}T00:00:00.000Z`);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const unavailableSources = new Set<AdminUserTimelineSource>();
  const contactFields = 'id, name, company, subject, status, delivery_status, sent_at, replied_at, bounced_at, bounce_category, reply_summary, reply_subject, reply_intent, reply_sentiment';

  const [
    authUserResult,
    profileResult,
    groupMembershipsResult,
    activeGroupsResult,
    creditResult,
    ledgerResult,
    activityResult,
    leadsResult,
    sentResult,
    repliesResult,
    bouncedResult,
    researchResult,
  ] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    supabase.from('profiles').select('full_name, email, avatar_url').eq('id', userId).maybeSingle(),
    supabase.from('organization_reporting_group_members')
      .select('group_id, is_primary, assigned_at')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .is('unassigned_at', null),
    supabase.from('organization_reporting_groups')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('is_active', true),
    supabase.rpc('get_antonia_credit_status_v2', {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_day: dayKey,
    }),
    readOptionalRows(
      'antonia_event_ledger',
      supabase.from('antonia_event_ledger')
        .select('id, event_type, occurred_at, entity_type, provider, status, outcome', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('actor_user_id', userId)
        .gte('occurred_at', fromIso)
        .lte('occurred_at', toIso)
        .neq('source_confidence', 'diagnostic_test')
        .order('occurred_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'activity_logs',
      supabase.from('activity_logs')
        .select('id, action, entity_type, entity_id, created_at', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'leads',
      supabase.from('leads')
        .select('id, name, company, title, status, created_at', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'contacted_leads',
      supabase.from('contacted_leads')
        .select(contactFields, { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .gte('sent_at', fromIso)
        .lte('sent_at', toIso)
        .order('sent_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'contacted_leads',
      supabase.from('contacted_leads')
        .select(contactFields, { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .gte('replied_at', fromIso)
        .lte('replied_at', toIso)
        .order('replied_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'contacted_leads',
      supabase.from('contacted_leads')
        .select(contactFields, { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .gte('bounced_at', fromIso)
        .lte('bounced_at', toIso)
        .order('bounced_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
    readOptionalRows(
      'lead_research_jobs',
      supabase.from('lead_research_jobs')
        .select('id, company_name, provider, status, created_at, completed_at', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .or([
          `and(created_at.gte.${fromIso},created_at.lte.${toIso})`,
          `and(completed_at.gte.${fromIso},completed_at.lte.${toIso})`,
        ].join(','))
        .order('created_at', { ascending: false })
        .limit(MAX_SOURCE_ROWS),
      unavailableSources,
    ),
  ]);

  if (authUserResult.error || !authUserResult.data?.user) throw authUserResult.error || new Error('Admin user identity not found');
  if (groupMembershipsResult.error) throw groupMembershipsResult.error;
  if (activeGroupsResult.error) throw activeGroupsResult.error;
  if (creditResult.error) throw creditResult.error;
  if (profileResult.error) console.error('[admin-user-profile-data] Optional profile lookup failed:', profileResult.error);

  const authUser = authUserResult.data.user;
  const profile = profileResult.error ? null : profileResult.data;
  const metadata = authUser.user_metadata && typeof authUser.user_metadata === 'object' ? authUser.user_metadata : {};
  const activeGroupById = new Map<string, any>((activeGroupsResult.data || []).map((group: any) => [String(group.id), group]));
  const groups = (groupMembershipsResult.data || [])
    .filter((groupMembership: any) => activeGroupById.has(String(groupMembership.group_id)))
    .map((groupMembership: any) => ({
      id: String(groupMembership.group_id),
      name: normalize(activeGroupById.get(String(groupMembership.group_id))?.name) || 'Grupo',
      primary: Boolean(groupMembership.is_primary),
      assignedAt: String(groupMembership.assigned_at),
    }))
    .sort((left: any, right: any) => Number(right.primary) - Number(left.primary) || left.name.localeCompare(right.name));

  const credit = parseCreditStatus(creditResult.data, dayKey, nextReset.toISOString());
  credit.groupName = credit.groupId
    ? normalize(activeGroupById.get(credit.groupId)?.name) || null
    : null;

  const completeTimeline = [
    ...timelineFromLedger(ledgerResult.rows, periodFrom, generatedAt),
    ...timelineFromActivities(activityResult.rows, periodFrom, generatedAt),
    ...timelineFromLeads(leadsResult.rows, periodFrom, generatedAt),
    ...timelineFromContacts(sentResult.rows, repliesResult.rows, bouncedResult.rows, periodFrom, generatedAt),
    ...timelineFromResearch(researchResult.rows, periodFrom, generatedAt),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));

  const sampled = [ledgerResult, activityResult, leadsResult, sentResult, repliesResult, bouncedResult, researchResult]
    .some((result) => result.sampled);
  const name = normalize(
    metadata.full_name
    || metadata.name
    || metadata.display_name
    || profile?.full_name
    || authUser.email?.split('@')[0],
  ) || 'Usuario';

  return {
    organization: { id: organizationId, name: organizationName },
    user: {
      id: userId,
      name,
      email: normalize(authUser.email || profile?.email) || userId,
      avatarUrl: safeAvatarUrl(metadata.avatar_url || metadata.picture || profile?.avatar_url),
      role: roleOf(membership.role),
      memberSince: String(membership.created_at),
      accountCreatedAt: normalize(authUser.created_at) || null,
      lastSignInAt: normalize(authUser.last_sign_in_at) || null,
      emailConfirmed: Boolean(authUser.email_confirmed_at || authUser.confirmed_at),
    },
    groups,
    credit,
    period: { from: fromIso, to: toIso, days: HISTORY_DAYS },
    metrics: {
      leadsCreated: leadsResult.count ?? leadsResult.rows.length,
      contactsSent: sentResult.count ?? sentResult.rows.length,
      repliesReceived: repliesResult.count ?? repliesResult.rows.length,
      researchJobs: researchResult.count ?? researchResult.rows.length,
      activeDays: new Set(completeTimeline.map((item) => item.occurredAt.slice(0, 10))).size,
    },
    timeline: completeTimeline.slice(0, MAX_TIMELINE_ITEMS),
    coverage: {
      unavailableSources: Array.from(unavailableSources).sort(),
      timelineLimited: sampled || completeTimeline.length > MAX_TIMELINE_ITEMS,
    },
    generatedAt: toIso,
  };
}
