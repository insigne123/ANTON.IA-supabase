import { DEFAULT_CREDIT_PRICES, creditCost, type CreditPrices } from '@/lib/credit-prices';

/** The default prices, for an organization without its own (src/lib/credit-prices.ts). */
export const APOLLO_EMAIL_ENRICHMENT_CREDITS = DEFAULT_CREDIT_PRICES.email;
export const APOLLO_PHONE_ENRICHMENT_CREDITS = DEFAULT_CREDIT_PRICES.phone;
export const APOLLO_DISPLAY_TOTAL_CREDITS = 2_500;

/** What a lookup costs at the organization's prices: the email, the phone, or both together. */
export function apolloEnrichmentCreditCost(options: { revealEmail: boolean; revealPhone: boolean }, prices: CreditPrices = DEFAULT_CREDIT_PRICES) {
  return creditCost(options, prices);
}
