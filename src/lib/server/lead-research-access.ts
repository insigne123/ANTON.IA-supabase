import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type LeadResearchAccessContext = {
  userId: string;
  organizationId: string | null;
  scopeKey: string;
  trustedInternal: boolean;
};

export type LeadResearchAccessInput = {
  sessionUserId?: string | null;
  trustedInternal: boolean;
  internalUserId?: string | null;
  internalOrganizationId?: string | null;
};

export type LeadResearchAccessDependencies = {
  resolveOrganizationId: (userId: string, trustedOrganizationId?: string | null) => Promise<string | null>;
  userExists: (userId: string) => Promise<boolean>;
};

function normalizeId(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

const CALLER_ACCESS_KEYS = new Set([
  'user_id',
  'userId',
  'organization_id',
  'organizationId',
  'scope_key',
  'scopeKey',
]);

function stripCallerAccessValues(value: any): any {
  if (Array.isArray(value)) return value.map(stripCallerAccessValues);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CALLER_ACCESS_KEYS.has(key))
      .map(([key, item]) => [key, stripCallerAccessValues(item)]),
  );
}

export function buildLeadResearchScopeKey(userId: string, organizationId?: string | null) {
  const normalizedOrganizationId = normalizeId(organizationId);
  return normalizedOrganizationId || `user:${String(userId || '').trim()}`;
}

export function getLeadResearchIdentity(body: any) {
  return {
    leadRef: String(
      body?.lead_ref ||
      body?.leadRef ||
      body?.lead?.id ||
      body?.lead?.email ||
      body?.lead?.linkedin_url ||
      body?.lead?.linkedinUrl ||
      body?.id ||
      body?.email ||
      body?.linkedinUrl ||
      body?.linkedin_url ||
      ''
    ).trim(),
    leadId: body?.lead?.id || body?.id || null,
    email: body?.lead?.email || body?.email || null,
    companyName: body?.company?.name || body?.companyName || null,
    companyDomain: body?.company?.domain || body?.companyDomain || null,
  };
}

export async function resolveLeadResearchOrganizationId(
  userId: string,
  trustedOrganizationId?: string | null,
): Promise<string | null> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return null;

  const { data, error } = await getSupabaseAdminClient()
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', normalizedUserId)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw error;

  const organizationIds = (Array.isArray(data) ? data : [])
    .map((row: any) => normalizeId(row?.organization_id))
    .filter((value): value is string => Boolean(value));
  const trustedHint = normalizeId(trustedOrganizationId);

  if (trustedHint && organizationIds.includes(trustedHint)) return trustedHint;
  return organizationIds[0] || null;
}

async function leadResearchUserExists(userId: string) {
  const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(userId);
  if (error) throw error;
  return Boolean(data?.user?.id);
}

export async function deriveLeadResearchAccess(
  input: LeadResearchAccessInput,
  dependencies: Partial<LeadResearchAccessDependencies> = {},
): Promise<LeadResearchAccessContext | null> {
  const sessionUserId = normalizeId(input.sessionUserId);
  const internalUserId = input.trustedInternal ? normalizeId(input.internalUserId) : null;
  const userId = sessionUserId || internalUserId;
  if (!userId) return null;
  const isInternalOnly = Boolean(input.trustedInternal && !sessionUserId);
  if (isInternalOnly) {
    const userExists = dependencies.userExists || leadResearchUserExists;
    if (!await userExists(userId)) return null;
  }

  const resolveOrganizationId = dependencies.resolveOrganizationId || resolveLeadResearchOrganizationId;
  const organizationId = normalizeId(await resolveOrganizationId(
    userId,
    isInternalOnly ? input.internalOrganizationId : null,
  ));

  return {
    userId,
    organizationId,
    scopeKey: buildLeadResearchScopeKey(userId, organizationId),
    trustedInternal: isInternalOnly,
  };
}

export function applyLeadResearchAccessToPayload(
  body: unknown,
  access: LeadResearchAccessContext,
): Record<string, any> {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, any> : {};
  const safeSource = stripCallerAccessValues(source);
  const sourceUserContext = safeSource.user_context && typeof safeSource.user_context === 'object'
    ? safeSource.user_context
    : null;
  const sourceUserContextAlias = safeSource.userContext && typeof safeSource.userContext === 'object'
    ? safeSource.userContext
    : null;

  return {
    ...safeSource,
    ...(sourceUserContext ? { user_context: { ...sourceUserContext, id: access.userId } } : {}),
    ...(sourceUserContextAlias ? { userContext: { ...sourceUserContextAlias, id: access.userId } } : {}),
    user_id: access.userId,
    organization_id: access.organizationId,
    scope_key: access.scopeKey,
  };
}
