import type { SupabaseClient } from '@supabase/supabase-js';

export function normalizeEnrichmentSearchEmail(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

export function hasEnrichmentSearchCreditAccess(email: unknown) {
    return Boolean(normalizeEnrichmentSearchEmail(email));
}

export async function hasUserEnrichmentSearchCreditAccess(_supabase: SupabaseClient, userId: unknown) {
    return Boolean(String(userId || '').trim());
}
