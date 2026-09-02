import {
  normalizeDraftSellerProfileV2,
  type DraftSellerProfileV2,
} from '@/lib/server/draft-context-v2';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function list(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;\n|•]+/g)
      : [];
  return [...new Set(values.map(text).filter(Boolean))].slice(0, 50);
}

export function normalizeSellerProfile(value: unknown): DraftSellerProfileV2 {
  const profile = object(value);
  const extended = object(object(profile.signatures).profile_extended);
  return normalizeDraftSellerProfileV2({
    name: profile.name || profile.full_name || null,
    jobTitle: profile.jobTitle || profile.job_title || extended.role || null,
    companyName: profile.companyName || profile.company_name || 'Mi empresa',
    companyDomain: profile.companyDomain || profile.company_domain || null,
    sector: profile.sector || extended.sector || extended.industry || null,
    description: profile.description || extended.description || null,
    services: list(profile.services ?? extended.services),
    valueProposition: profile.valueProposition
      || profile.value_proposition
      || extended.valueProposition
      || extended.value_proposition
      || null,
    proofPoints: list(profile.proofPoints ?? profile.proof_points ?? extended.proofPoints ?? extended.proof_points),
  });
}

export async function loadSellerProfile(userId: string): Promise<DraftSellerProfileV2> {
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from('profiles')
      .select('full_name,job_title,company_name,company_domain,signatures')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return normalizeSellerProfile(data || {});
  } catch (error) {
    console.warn('[seller-profile] profile unavailable; using a neutral profile:', error);
    return normalizeSellerProfile({});
  }
}

export const sellerProfileInternals = { list, normalizeSellerProfile };
