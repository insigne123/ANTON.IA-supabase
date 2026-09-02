import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type LeadProvider = 'apollo';
type RequestedLeadProvider = 'fullenrich' | 'apollo' | 'pdl';

export type ProviderDecision = {
  provider: LeadProvider;
  requestedProvider: RequestedLeadProvider | null;
  defaultProvider: LeadProvider;
  forcedProviderReason?: 'apollo_only';
};

function normalizeRequestedProvider(value: unknown): RequestedLeadProvider | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'fullenrich') return 'fullenrich';
  if (normalized === 'apollo') return 'apollo';
  if (normalized === 'pdl') return 'pdl';
  return null;
}

export function resolveLeadProvider(params: {
  requestedProvider?: unknown;
  organizationId?: string | null;
  defaultProviderEnv?: string;
  fallbackDefaultProvider?: string;
}): ProviderDecision {
  const requestedProvider = normalizeRequestedProvider(params.requestedProvider);

  return {
    provider: 'apollo',
    requestedProvider,
    defaultProvider: 'apollo',
    // Retired provider names remain observable for callers, but can never run.
    forcedProviderReason: requestedProvider && requestedProvider !== 'apollo'
      ? 'apollo_only'
      : undefined,
  };
}

export async function resolveOrganizationIdForUser(userId: string): Promise<string | null> {
  const normalized = String(userId || '').trim();
  if (!normalized) return null;

  try {
    const supabase = getSupabaseAdminClient();
      const { data } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', normalized)
        .order('created_at', { ascending: true })
        .limit(50);

    const memberships = Array.isArray(data)
      ? data.map((r: any) => String(r?.organization_id || '').trim()).filter(Boolean)
      : [];

    if (memberships.length === 0) return null;

    return memberships[0] || null;
  } catch {
    return null;
  }
}
