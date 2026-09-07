import type {
  AdminCreditMode,
  AdminCreditOverview,
  AdminCreditPolicy,
} from '@/lib/admin-dashboard-types';

type PolicyRow = {
  id: string;
  subject_type: 'organization' | 'user' | 'team';
  user_id: string | null;
  reporting_group_id: string | null;
  mode: AdminCreditMode | null;
  user_daily_limit: number | null;
  team_daily_limit: number | null;
  effective_from: string;
  effective_to: string | null;
  cancelled_at: string | null;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function userName(user: any) {
  const metadata = user?.user_metadata || {};
  return normalize(metadata.full_name || metadata.name || metadata.display_name)
    || normalize(user?.email).split('@')[0]
    || 'Usuario';
}

function isActiveAt(policy: PolicyRow, day: string) {
  return !policy.cancelled_at
    && policy.effective_from <= day
    && (!policy.effective_to || policy.effective_to >= day);
}

function latestAt(policies: PolicyRow[], day: string) {
  return policies
    .filter((policy) => isActiveAt(policy, day))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] || null;
}

function nextPolicy(policies: PolicyRow[], day: string) {
  return policies
    .filter((policy) => !policy.cancelled_at && policy.effective_from > day)
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from))[0] || null;
}

function mapPolicy(policy: PolicyRow | null, day: string, fallback?: {
  mode: AdminCreditMode;
  userDailyLimit: number;
  teamDailyLimit: number;
}): AdminCreditPolicy {
  return {
    id: policy?.id || 'legacy-default',
    mode: policy?.mode ?? fallback?.mode ?? 'user',
    userDailyLimit: policy?.user_daily_limit ?? fallback?.userDailyLimit ?? 50,
    teamDailyLimit: policy?.team_daily_limit ?? fallback?.teamDailyLimit ?? 50,
    effectiveFrom: policy?.effective_from || day,
    effectiveTo: policy?.effective_to || null,
    pending: Boolean(policy && policy.effective_from > day),
  };
}

export async function loadAdminCreditOverview(
  supabase: any,
  organizationId: string,
  organizationName: string,
): Promise<AdminCreditOverview> {
  const quotaDay = new Date().toISOString().slice(0, 10);
  const nextReset = new Date(`${quotaDay}T00:00:00.000Z`);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const nextDay = nextReset.toISOString().slice(0, 10);

  const [policiesResult, assignmentsResult, groupsResult, groupMembersResult, membersResult, usersResult, bucketsResult] = await Promise.all([
    supabase.from('antonia_credit_policies')
      .select('id, subject_type, user_id, reporting_group_id, mode, user_daily_limit, team_daily_limit, effective_from, effective_to, cancelled_at')
      .eq('organization_id', organizationId),
    supabase.from('antonia_credit_team_assignments')
      .select('id, user_id, reporting_group_id, effective_from, effective_to, cancelled_at')
      .eq('organization_id', organizationId),
    supabase.from('organization_reporting_groups')
      .select('id, name, is_active')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('name'),
    supabase.from('organization_reporting_group_members')
      .select('group_id, user_id, is_primary, unassigned_at')
      .eq('organization_id', organizationId)
      .is('unassigned_at', null),
    supabase.from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from('antonia_daily_credit_buckets')
      .select('bucket_type, user_id, reporting_group_id, usage_count, limit_snapshot')
      .eq('organization_id', organizationId)
      .eq('quota_day', quotaDay),
  ]);

  for (const result of [policiesResult, assignmentsResult, groupsResult, groupMembersResult, membersResult, bucketsResult]) {
    if (result.error) throw result.error;
  }
  if (usersResult.error) throw usersResult.error;

  const policies = (policiesResult.data || []) as PolicyRow[];
  const assignments = (assignmentsResult.data || []) as Array<{
    user_id: string;
    reporting_group_id: string;
    effective_from: string;
    effective_to: string | null;
    cancelled_at: string | null;
  }>;
  const groups = (groupsResult.data || []) as Array<{ id: string; name: string }>;
  const groupMembers = (groupMembersResult.data || []) as Array<{ group_id: string; user_id: string }>;
  const members = (membersResult.data || []) as Array<{ user_id: string; role: 'owner' | 'admin' | 'member' }>;
  const buckets = (bucketsResult.data || []) as Array<{
    bucket_type: 'user' | 'team';
    user_id: string | null;
    reporting_group_id: string | null;
    usage_count: number;
    limit_snapshot: number;
  }>;
  const authUsers = usersResult.data?.users || [];
  const authUserById = new Map<string, any>(authUsers.map((user: any) => [String(user.id), user]));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const organizationPolicies = policies.filter((policy) => policy.subject_type === 'organization');
  const currentOrganizationRow = latestAt(organizationPolicies, quotaDay);
  const pendingOrganizationRow = nextPolicy(organizationPolicies, quotaDay);
  const currentOrganizationPolicy = mapPolicy(currentOrganizationRow, quotaDay);
  const organizationDefaults = {
    mode: currentOrganizationPolicy.mode || 'user',
    userDailyLimit: currentOrganizationPolicy.userDailyLimit ?? 50,
    teamDailyLimit: currentOrganizationPolicy.teamDailyLimit ?? 50,
  };

  const effectiveAssignment = (userId: string, day: string) => assignments
    .filter((assignment) => assignment.user_id === userId
      && !assignment.cancelled_at
      && assignment.effective_from <= day
      && (!assignment.effective_to || assignment.effective_to >= day))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] || null;
  const pendingAssignment = (userId: string) => assignments
    .filter((assignment) => assignment.user_id === userId
      && !assignment.cancelled_at
      && assignment.effective_from > quotaDay)
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from))[0] || null;

  const currentTeamLimit = (groupId: string | null) => {
    if (!groupId) return null;
    const teamPolicy = latestAt(
      policies.filter((policy) => policy.subject_type === 'team' && policy.reporting_group_id === groupId),
      quotaDay,
    );
    return teamPolicy?.team_daily_limit ?? organizationDefaults.teamDailyLimit;
  };

  const users = members.map((member) => {
    const authUser = authUserById.get(member.user_id);
    const userPolicies = policies.filter((policy) => policy.subject_type === 'user' && policy.user_id === member.user_id);
    const userPolicy = latestAt(userPolicies, quotaDay);
    const pendingUserPolicy = nextPolicy(userPolicies, quotaDay);
    const assignment = effectiveAssignment(member.user_id, quotaDay);
    const nextAssignment = pendingAssignment(member.user_id);
    const mode = userPolicy?.mode || organizationDefaults.mode;
    const userLimit = userPolicy?.user_daily_limit ?? organizationDefaults.userDailyLimit;
    const teamLimit = mode === 'user' ? null : currentTeamLimit(assignment?.reporting_group_id || null);
    const userBucket = buckets.find((bucket) => bucket.bucket_type === 'user' && bucket.user_id === member.user_id);
    const teamBucket = assignment
      ? buckets.find((bucket) => bucket.bucket_type === 'team' && bucket.reporting_group_id === assignment.reporting_group_id)
      : null;
    const userUsage = mode === 'team' ? null : Number(userBucket?.usage_count || 0);
    const teamUsage = mode === 'user' ? null : Number(teamBucket?.usage_count || 0);
    const binding: 'user' | 'team' = mode === 'team'
      ? 'team'
      : mode === 'user'
        ? 'user'
        : (userLimit - (userUsage || 0) <= (teamLimit || 0) - (teamUsage || 0) ? 'user' : 'team');
    return {
      id: member.user_id,
      name: userName(authUser),
      email: normalize(authUser?.email) || member.user_id,
      role: member.role,
      primaryTeam: assignment && groupById.has(assignment.reporting_group_id)
        ? { id: assignment.reporting_group_id, name: groupById.get(assignment.reporting_group_id)!.name }
        : null,
      pendingTeam: nextAssignment && groupById.has(nextAssignment.reporting_group_id)
        ? { id: nextAssignment.reporting_group_id, name: groupById.get(nextAssignment.reporting_group_id)!.name }
        : null,
      mode,
      userLimit,
      teamLimit,
      userUsage,
      teamUsage,
      binding,
      pendingPolicy: pendingUserPolicy ? mapPolicy(pendingUserPolicy, quotaDay) : null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return {
    organization: { id: organizationId, name: organizationName },
    quotaDay,
    nextResetAt: nextReset.toISOString(),
    defaultPolicy: {
      current: currentOrganizationPolicy,
      pending: pendingOrganizationRow ? mapPolicy(pendingOrganizationRow, quotaDay) : null,
    },
    teams: groups.map((group) => {
      const teamPolicies = policies.filter((policy) => policy.subject_type === 'team' && policy.reporting_group_id === group.id);
      const active = latestAt(teamPolicies, quotaDay);
      const pending = nextPolicy(teamPolicies, quotaDay);
      const bucket = buckets.find((item) => item.bucket_type === 'team' && item.reporting_group_id === group.id);
      return {
        id: group.id,
        name: group.name,
        memberCount: groupMembers.filter((membership) => membership.group_id === group.id).length,
        currentLimit: active?.team_daily_limit ?? organizationDefaults.teamDailyLimit,
        pendingPolicy: pending ? mapPolicy(pending, quotaDay) : null,
        usage: Number(bucket?.usage_count || 0),
      };
    }),
    users,
  };
}
