import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type LeadProvider = 'apollo' | 'pdl';
type DefaultProvider = LeadProvider | 'auto';

export type ProviderDecision = {
  provider: LeadProvider;
  requestedProvider: LeadProvider | null;
  defaultProvider: DefaultProvider;
  pdlEligible: boolean;
  forcedApolloReason?: string;
};

function parseBool(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeProvider(value: unknown): LeadProvider | DefaultProvider | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'apollo') return 'apollo';
  if (normalized === 'pdl') return 'pdl';
  if (normalized === 'auto') return 'auto';
  return null;
}

function parseOrgAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const item of raw.split(',')) {
    const id = item.trim();
    if (id) out.add(id);
  }
  return out;
}

export function isPdlTrialEnabled() {
  return parseBool(process.env.PDL_TRIAL_ENABLED, false);
}

export function isPdlFallbackEnabled() {
  return parseBool(process.env.PDL_FALLBACK_TO_APOLLO, true);
}

export function isOrganizationAllowedForPdl(organizationId?: string | null) {
  const orgId = String(organizationId || '').trim();
  if (!orgId) return false;
  const allowlist = parseOrgAllowlist(process.env.PDL_ALLOWED_ORG_IDS);
  if (allowlist.size === 0) return false;
  return allowlist.has(orgId);
}

function resolveDefaultProvider(defaultProviderEnv: string, fallback: DefaultProvider): DefaultProvider {
  const parsed = normalizeProvider(process.env[defaultProviderEnv]);
  if (!parsed) return fallback;
  return parsed;
}

export function resolveLeadProvider(params: {
  requestedProvider?: unknown;
  organizationId?: string | null;
  defaultProviderEnv?: string;
  fallbackDefaultProvider?: DefaultProvider;
}): ProviderDecision {
  const {
    requestedProvider,
    organizationId,
    defaultProviderEnv = 'LEADS_PROVIDER_DEFAULT',
    fallbackDefaultProvider = 'apollo',
  } = params;

  const requested = normalizeProvider(requestedProvider);
  const requestedLeadProvider = requested === 'apollo' || requested === 'pdl' ? requested : null;
  const defaultProvider = resolveDefaultProvider(defaultProviderEnv, fallbackDefaultProvider);

  let desired: DefaultProvider | LeadProvider = requestedLeadProvider || defaultProvider;
  if (desired === 'auto') {
    desired = isOrganizationAllowedForPdl(organizationId) ? 'pdl' : 'apollo';
  }

  const apiKeyConfigured = String(process.env.PDL_API_KEY || '').trim().length > 0;
  const pdlEligible = isPdlTrialEnabled() && apiKeyConfigured && isOrganizationAllowedForPdl(organizationId);

  if (desired === 'pdl' && pdlEligible) {
    return {
      provider: 'pdl',
      requestedProvider: requestedLeadProvider,
      defaultProvider,
      pdlEligible,
    };
  }

  let reason = '';
  if (desired === 'pdl') {
    if (!isPdlTrialEnabled()) reason = 'pdl_trial_disabled';
    else if (!apiKeyConfigured) reason = 'pdl_api_key_missing';
    else if (!isOrganizationAllowedForPdl(organizationId)) reason = 'org_not_allowed_for_pdl';
    else reason = 'pdl_not_eligible';
  }

  return {
    provider: 'apollo',
    requestedProvider: requestedLeadProvider,
    defaultProvider,
    pdlEligible,
    forcedApolloReason: reason || undefined,
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
      .limit(50);

    const memberships = Array.isArray(data)
      ? data.map((r: any) => String(r?.organization_id || '').trim()).filter(Boolean)
      : [];

    if (memberships.length === 0) return null;

    const preferredOrg = String(process.env.OPENCLAW_ORG_ID || '').trim();
    if (preferredOrg && memberships.includes(preferredOrg)) {
      return preferredOrg;
    }

    const allowed = parseOrgAllowlist(process.env.PDL_ALLOWED_ORG_IDS);
    if (allowed.size > 0) {
      for (const orgId of memberships) {
        if (allowed.has(orgId)) return orgId;
      }
    }

    return memberships[0] || null;
  } catch {
    return null;
  }
}
