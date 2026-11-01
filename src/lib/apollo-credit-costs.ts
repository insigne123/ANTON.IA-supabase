export const APOLLO_EMAIL_ENRICHMENT_CREDITS = 1;
/** Email and mobile together: Apollo's direct-dial lookup brings the email too and charges 8 for both (audit T5, 1 Nov 2026). */
export const APOLLO_PHONE_ENRICHMENT_CREDITS = 8;
export const APOLLO_DISPLAY_TOTAL_CREDITS = 2_500;

export function apolloEnrichmentCreditCost(options: { revealEmail: boolean; revealPhone: boolean }) {
  if (options.revealPhone) return APOLLO_PHONE_ENRICHMENT_CREDITS;
  return options.revealEmail ? APOLLO_EMAIL_ENRICHMENT_CREDITS : 0;
}
