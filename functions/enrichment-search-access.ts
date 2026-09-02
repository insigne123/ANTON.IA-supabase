import type { SupabaseClient } from '@supabase/supabase-js';

export const ENRICHMENT_SEARCH_ALLOWED_EMAIL = 'laramirez@grupoexpro.com';

export function normalizeEnrichmentSearchEmail(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

export function hasEnrichmentSearchCreditAccess(email: unknown) {
    return normalizeEnrichmentSearchEmail(email) === ENRICHMENT_SEARCH_ALLOWED_EMAIL;
}

export async function hasUserEnrichmentSearchCreditAccess(supabase: SupabaseClient, userId: unknown) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return false;

    try {
        const { data, error } = await supabase.auth.admin.getUserById(normalizedUserId);
        return !error && hasEnrichmentSearchCreditAccess(data?.user?.email);
    } catch {
        return false;
    }
}
