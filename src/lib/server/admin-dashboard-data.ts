import type {
  AdminDashboardOverview,
  AdminDimension,
  AdminReportingGroup,
  AdminReportingUser,
} from '@/lib/admin-dashboard-types';

const MAX_ROWS = 20_000;

type QueryResult = {
  data: any[] | null;
  error: { message?: string } | null;
};

type DashboardQuery = {
  from: string;
  to: string;
  groupId?: string | null;
  userId?: string | null;
};

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase();
}

function asData(row: any) {
  return row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
}

function rowUserId(row: any) {
  return normalize(row?.user_id || row?.actor_user_id || row?.userId);
}

function rowDate(row: any, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date;
    }
  }
  return null;
}

function isWithinRange(row: any, keys: string[], from: Date, to: Date) {
  const date = rowDate(row, keys);
  return Boolean(date && date >= from && date < to);
}

function increment(map: Map<string, number>, key: unknown) {
  const normalized = normalize(key);
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function topDimensions(map: Map<string, number>, limit = 8): AdminDimension[] {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function eventMatches(eventType: unknown, patterns: string[]) {
  const value = normalizeKey(eventType);
  return patterns.some((pattern) => value === pattern || value.includes(pattern));
}

function countUnique(rows: any[], key: (row: any) => unknown) {
  return new Set(rows.map(key).map(normalize).filter(Boolean)).size;
}

function channelOf(row: any) {
  const data = asData(row);
  return normalize(row?.channel || row?.canal || data.channel || data.canal || row?.provider).toLowerCase();
}

function hasPhone(row: any) {
  const data = asData(row);
  const phones = data.phone_numbers || data.phoneNumbers || row?.phone_numbers || row?.phoneNumbers;
  return Boolean(
    normalize(data.primary_phone || data.primaryPhone || row?.primary_phone || row?.primaryPhone)
    || (Array.isArray(phones) && phones.length > 0),
  );
}

function hasReply(row: any) {
  return Boolean(
    row?.replied_at
    || normalizeKey(row?.status) === 'replied'
    || row?.reply_intent
    || row?.last_reply_text,
  );
}

function formatUserName(user: any) {
  const metadata = user?.user_metadata || {};
  return normalize(
    metadata.full_name
    || metadata.name
    || metadata.display_name
    || user?.email?.split('@')[0]
    || 'Usuario',
  );
}

async function readRows(query: any, label: string, errors: string[]): Promise<any[]> {
  const result = await query.limit(MAX_ROWS) as QueryResult;
  if (result.error) {
    errors.push(label);
    console.error(`[admin-dashboard-data] ${label} query failed:`, result.error);
    return [];
  }
  return Array.isArray(result.data) ? result.data : [];
}

export async function loadAdminDashboardOverview(
  supabase: any,
  organizationId: string,
  organizationName: string,
  query: DashboardQuery,
): Promise<AdminDashboardOverview> {
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = new Date(addDays(query.to, 1));
  const errors: string[] = [];

  const [organizationResult, groupsResult, groupMembersResult, organizationMembersResult, usersResult] = await Promise.all([
    supabase.from('organizations').select('id, name').eq('id', organizationId).maybeSingle(),
    supabase
      .from('organization_reporting_groups')
      .select('id, name, slug, country_code, color, is_active')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    supabase
      .from('organization_reporting_group_members')
      .select('group_id, user_id, is_primary, assigned_at, unassigned_at')
      .eq('organization_id', organizationId),
    supabase
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true }),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (organizationResult.error) errors.push('organizations');
  if (groupsResult.error) errors.push('organization_reporting_groups');
  if (groupMembersResult.error) errors.push('organization_reporting_group_members');
  if (organizationMembersResult.error) errors.push('organization_members');
  if (usersResult.error) errors.push('auth.users');

  const groups = (groupsResult.data || []) as any[];
  const groupMembers = (groupMembersResult.data || []) as any[];
  const organizationMembers = (organizationMembersResult.data || []) as any[];
  const authUsers = (usersResult.data?.users || []) as any[];
  const userById = new Map(authUsers.map((user) => [String(user.id), user]));
  const groupById = new Map(groups.map((group) => [String(group.id), group]));
  const membershipsByUser = new Map<string, any[]>();

  for (const membership of groupMembers) {
    if (membership.unassigned_at) continue;
    const userId = normalize(membership.user_id);
    if (!userId || !groupById.has(String(membership.group_id))) continue;
    const current = membershipsByUser.get(userId) || [];
    current.push(membership);
    membershipsByUser.set(userId, current);
  }

  const primaryGroupByUser = new Map<string, string>();
  for (const [userId, memberships] of membershipsByUser.entries()) {
    const primary = memberships.find((membership) => membership.is_primary) || memberships[0];
    if (primary?.group_id) primaryGroupByUser.set(userId, String(primary.group_id));
  }

  const rangeQueries = [
    readRows(
      supabase.from('leads')
        .select('id, user_id, created_at, title, company, country')
        .eq('organization_id', organizationId)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      'leads',
      errors,
    ),
    readRows(
      supabase.from('enriched_leads')
        .select('id, user_id, created_at, email, company_name, title, seniority, organization_industry, country, data')
        .eq('organization_id', organizationId)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      'enriched_leads',
      errors,
    ),
    readRows(
      supabase.from('contacted_leads')
        .select('id, user_id, lead_id, sent_at, created_at, replied_at, provider, status, company, role, country, data, reply_intent, last_reply_text')
        .eq('organization_id', organizationId)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      'contacted_leads',
      errors,
    ),
    readRows(
      supabase.from('email_events')
        .select('id, organization_id, contacted_id, lead_id, provider, event_type, event_at, created_at')
        .eq('organization_id', organizationId)
        .gte('event_at', from.toISOString())
        .lt('event_at', to.toISOString()),
      'email_events',
      errors,
    ),
    readRows(
      supabase.from('antonia_event_ledger')
        .select('id, actor_user_id, event_type, occurred_at, status, outcome, provider, entity_id, lead_id, metrics')
        .eq('organization_id', organizationId)
        .gte('occurred_at', from.toISOString())
        .lt('occurred_at', to.toISOString())
        .neq('source_confidence', 'diagnostic_test'),
      'antonia_event_ledger',
      errors,
    ),
    readRows(
      supabase.from('lead_research_reports')
        .select('id, user_id, lead_id, created_at, updated_at, provider, company_name')
        .eq('organization_id', organizationId)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      'lead_research_reports',
      errors,
    ),
  ];

  const [leads, enrichedLeads, contactedLeads, emailEvents, ledgerEvents, researchReports] = await Promise.all(rangeQueries);
  const groupFilter = normalize(query.groupId);
  const userFilter = normalize(query.userId);
  const userIds = new Set(organizationMembers.map((member) => normalize(member.user_id)).filter(Boolean));

  const userMatches = (userId: string) => {
    if (userFilter && userId !== userFilter) return false;
    if (!groupFilter) return true;
    return (membershipsByUser.get(userId) || []).some((membership) => String(membership.group_id) === groupFilter);
  };

  const attributedToGroup = (userId: string, groupId: string) => primaryGroupByUser.get(userId) === groupId;
  const filtered = <T extends any[]>(rows: T, getUser: (row: any) => string) => rows.filter((row) => {
    const rowUser = getUser(row);
    return rowUser ? userMatches(rowUser) : !groupFilter && !userFilter;
  });

  const filteredLeads = filtered(leads, rowUserId);
  const filteredEnriched = filtered(enrichedLeads, rowUserId);
  const filteredContacted = filtered(contactedLeads, rowUserId);
  const filteredResearch = filtered(researchReports, rowUserId);
  const contactedById = new Map(filteredContacted.map((row) => [normalize(row.id), row]));
  const filteredEmailEvents = emailEvents.filter((event) => {
    const contacted = contactedById.get(normalize(event.contacted_id));
    const userId = rowUserId(contacted);
    return userId ? userMatches(userId) : !groupFilter && !userFilter;
  });
  const filteredLedger = filtered(ledgerEvents, rowUserId);

  const repliedContacted = filteredContacted.filter(hasReply);
  const sentContacted = filteredContacted.filter((row) => Boolean(row.sent_at || row.created_at));
  const replyEvents = filteredEmailEvents.filter((event) => eventMatches(event.event_type, ['reply', 'replied', 'received']));
  const replies = Math.max(
    countUnique(repliedContacted, (row) => row.lead_id || row.id),
    countUnique(replyEvents, (row) => row.lead_id || row.contacted_id || row.id),
    filteredLedger.filter((event) => eventMatches(event.event_type, ['reply.received', 'reply.received', 'contact.replied'])).length,
  );
  const emailsSent = sentContacted.filter((row) => {
    const channel = channelOf(row);
    return !channel || channel.includes('mail') || channel.includes('gmail') || channel.includes('outlook') || channel.includes('email');
  }).length;
  const linkedinConnections = sentContacted.filter((row) => channelOf(row).includes('linkedin')).length
    + filteredLedger.filter((event) => eventMatches(event.event_type, ['linkedin.connection', 'linkedin.connected'])).length;
  const investigations = filteredResearch.length
    + filteredLedger.filter((event) => eventMatches(event.event_type, ['research.completed', 'research.requested', 'lead.researched'])).length;
  const phonesSearched = filteredLedger.filter((event) => eventMatches(event.event_type, ['phone.search', 'phone.enrichment', 'enrichment.phone'])).length
    || filteredEnriched.filter(hasPhone).length;
  const leadsContacted = countUnique(filteredContacted, (row) => row.lead_id || row.id);
  const leadsCaptured = countUnique(filteredLeads, (row) => row.id) || filteredLeads.length;
  const responseRate = emailsSent > 0 ? Math.round((replies / emailsSent) * 1000) / 10 : 0;
  const elapsedDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const daysInMonth = new Date(to.getUTCFullYear(), to.getUTCMonth() + 1, 0).getUTCDate();
  const totalUsage = leadsCaptured + investigations + emailsSent;
  const monthlyProjection = Math.round((totalUsage / elapsedDays) * daysInMonth);

  const trend = Array.from({ length: elapsedDays }, (_, index) => {
    const date = new Date(from);
    date.setUTCDate(date.getUTCDate() + index);
    const key = isoDate(date);
    const dayFrom = new Date(`${key}T00:00:00.000Z`);
    const dayTo = new Date(addDays(key, 1));
    const dayLeads = filteredLeads.filter((row) => isWithinRange(row, ['created_at'], dayFrom, dayTo)).length;
    const dayContacted = filteredContacted.filter((row) => isWithinRange(row, ['sent_at', 'created_at'], dayFrom, dayTo)).length;
    const dayResearch = filteredResearch.filter((row) => isWithinRange(row, ['created_at', 'updated_at'], dayFrom, dayTo)).length
      + filteredLedger.filter((event) => eventMatches(event.event_type, ['research.completed', 'research.requested']) && isWithinRange(event, ['occurred_at'], dayFrom, dayTo)).length;
    const dayReplies = filteredContacted.filter((row) => isWithinRange(row, ['replied_at'], dayFrom, dayTo) && hasReply(row)).length
      + replyEvents.filter((event) => isWithinRange(event, ['event_at', 'created_at'], dayFrom, dayTo)).length;
    return { date: key, leads: dayLeads, contacted: dayContacted, researched: dayResearch, replies: dayReplies };
  });

  const metricsForUser = (userId: string) => {
    const userLeads = filteredLeads.filter((row) => rowUserId(row) === userId);
    const userContacted = filteredContacted.filter((row) => rowUserId(row) === userId);
    const userResearch = filteredResearch.filter((row) => rowUserId(row) === userId);
    const userReplies = userContacted.filter(hasReply);
    return {
      leads: userLeads.length,
      contacted: countUnique(userContacted, (row) => row.lead_id || row.id),
      researched: userResearch.length + filteredLedger.filter((event) => rowUserId(event) === userId && eventMatches(event.event_type, ['research.completed'])).length,
      replies: countUnique(userReplies, (row) => row.lead_id || row.id),
    };
  };

  const users: AdminReportingUser[] = organizationMembers
    .filter((member) => userMatches(normalize(member.user_id)))
    .map((member) => {
      const userId = normalize(member.user_id);
      const authUser = userById.get(userId);
      return {
        id: userId,
        email: normalize(authUser?.email) || `${userId.slice(0, 8)}…`,
        name: formatUserName(authUser),
        role: member.role,
        groups: (membershipsByUser.get(userId) || []).map((membership) => ({
          id: String(membership.group_id),
          name: normalize(groupById.get(String(membership.group_id))?.name) || 'Sin grupo',
          primary: Boolean(membership.is_primary),
        })),
        metrics: metricsForUser(userId),
      };
    })
    .sort((left, right) => (right.metrics.contacted + right.metrics.leads) - (left.metrics.contacted + left.metrics.leads));

  const groupMetrics = groups
    .filter((group) => !groupFilter || String(group.id) === groupFilter)
    .map((group) => {
      const groupLeads = filteredLeads.filter((row) => attributedToGroup(rowUserId(row), String(group.id)));
      const groupContacted = filteredContacted.filter((row) => attributedToGroup(rowUserId(row), String(group.id)));
      const groupResearch = filteredResearch.filter((row) => attributedToGroup(rowUserId(row), String(group.id)));
      const groupReplies = groupContacted.filter(hasReply);
      const groupEmails = groupContacted.filter((row) => {
        const channel = channelOf(row);
        return !channel || channel.includes('mail') || channel.includes('email');
      }).length;
      return {
        id: String(group.id),
        name: normalize(group.name),
        slug: normalize(group.slug),
        countryCode: normalize(group.country_code) || null,
        color: normalize(group.color) || null,
        memberCount: groupMembers.filter((membership) => String(membership.group_id) === String(group.id) && !membership.unassigned_at).length,
        active: Boolean(group.is_active),
        metrics: {
          leads: groupLeads.length,
          contacted: countUnique(groupContacted, (row) => row.lead_id || row.id),
          researched: groupResearch.length,
          replies: countUnique(groupReplies, (row) => row.lead_id || row.id),
          responseRate: groupEmails > 0 ? Math.round((groupReplies.length / groupEmails) * 1000) / 10 : 0,
        },
      };
    });

  const companies = new Map<string, number>();
  const titles = new Map<string, number>();
  const seniorities = new Map<string, number>();
  for (const row of filteredContacted) {
    const data = asData(row);
    increment(companies, row.company || row.company_name || data.company || data.company_name);
    increment(titles, row.role || row.title || data.role || data.title);
  }
  for (const row of filteredEnriched) {
    const data = asData(row);
    increment(companies, row.company_name || data.company_name || data.company);
    increment(titles, row.title || data.title);
    increment(seniorities, row.seniority || data.seniority);
  }

  const sampled = [leads, enrichedLeads, contactedLeads, emailEvents, ledgerEvents, researchReports].some((rows) => rows.length >= MAX_ROWS);
  const coverageNote = errors.length > 0
    ? `No se pudieron consultar: ${errors.join(', ')}.`
    : sampled
      ? `Vista limitada a ${MAX_ROWS.toLocaleString('es')} filas por fuente. Usa un rango menor para precisión.`
      : null;

  return {
    organization: {
      id: String(organizationResult.data?.id || organizationId),
      name: normalize(organizationResult.data?.name) || organizationName,
    },
    dateRange: { from: query.from, to: query.to },
    generatedAt: new Date().toISOString(),
    coverage: { eventRows: ledgerEvents.length, sampled, note: coverageNote },
    summary: {
      leadsCaptured,
      leadsContacted,
      phonesSearched,
      investigations,
      emailsSent,
      replies,
      linkedinConnections,
      responseRate,
      monthlyProjection,
    },
    trend,
    groups: groupMetrics,
    users,
    companies: topDimensions(companies),
    seniorities: topDimensions(seniorities),
    titles: topDimensions(titles),
  };
}
