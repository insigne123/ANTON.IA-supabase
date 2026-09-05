export const ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE = 'ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE';

export function normalizeEnrichmentSearchEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function hasEnrichmentSearchCreditAccess(email: unknown) {
  return Boolean(normalizeEnrichmentSearchEmail(email));
}

export async function hasUserEnrichmentSearchCreditAccess(userId: unknown) {
  return Boolean(String(userId || '').trim());
}

export function enrichmentSearchCreditsUnavailablePayload() {
  return {
    error: ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE,
    message: 'Esta cuenta no tiene créditos disponibles para enriquecimiento.',
    count: 0,
    limit: 0,
  };
}
