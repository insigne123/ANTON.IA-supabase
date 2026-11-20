import { DEFAULT_CREDIT_PRICES, creditPricesOf, type CreditPrices } from '@/lib/credit-prices';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

// Before the migration is applied the table does not exist yet: then no organization has prices of its own.
const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST204']);

/** The organization's own prices (its row in organization_credit_prices), or null when it has none. */
export async function loadOwnCreditPrices(organizationId: string, admin: any = getSupabaseAdminClient()): Promise<CreditPrices | null> {
  const { data, error } = await admin.from('organization_credit_prices').select('email_credits,phone_credits,both_credits')
    .eq('organization_id', organizationId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(String(error.code || ''))) return null;
    throw error;
  }
  return data ? creditPricesOf(data) : null;
}

/**
 * What an email, a phone and both cost the organization (src/lib/credit-prices.ts): its own prices, or the default when it has
 * none. A price decides what a button says and what is checked before a lookup; if it cannot be read the error goes up, so
 * nobody is told a cost that is not theirs.
 */
export async function loadCreditPrices(organizationId: string, admin: any = getSupabaseAdminClient()): Promise<CreditPrices> {
  return (await loadOwnCreditPrices(organizationId, admin)) ?? DEFAULT_CREDIT_PRICES;
}
