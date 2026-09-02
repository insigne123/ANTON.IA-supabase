import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const ENRICHMENT_SEARCH_ALLOWED_EMAIL = 'laramirez@grupoexpro.com';
export const ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE = 'ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE';

export function normalizeEnrichmentSearchEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function hasEnrichmentSearchCreditAccess(email: unknown) {
  return normalizeEnrichmentSearchEmail(email) === ENRICHMENT_SEARCH_ALLOWED_EMAIL;
}

export async function hasUserEnrichmentSearchCreditAccess(userId: unknown) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;

  try {
    const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(normalizedUserId);
    return !error && hasEnrichmentSearchCreditAccess(data?.user?.email);
  } catch {
    return false;
  }
}

export function enrichmentSearchCreditsUnavailablePayload() {
  return {
    error: ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE,
    message: 'Esta cuenta no tiene créditos disponibles para enriquecimiento.',
    count: 0,
    limit: 0,
  };
}
