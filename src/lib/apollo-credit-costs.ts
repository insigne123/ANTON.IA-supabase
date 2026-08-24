export const APOLLO_EMAIL_ENRICHMENT_CREDITS = 1;
export const APOLLO_PHONE_ENRICHMENT_CREDITS = 10;

export function apolloEnrichmentCreditCost(options: { revealEmail: boolean; revealPhone: boolean }) {
  return (options.revealEmail ? APOLLO_EMAIL_ENRICHMENT_CREDITS : 0)
    + (options.revealPhone ? APOLLO_PHONE_ENRICHMENT_CREDITS : 0);
}
