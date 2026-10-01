/**
 * Context for the web searches of one research job. Those searches are paid by the job itself: the daily research quota
 * is consumed before the job runs (consumeLeadResearchRequestQuota in native-research.ts), so they do not reserve a
 * second, Cowork-style credit. Without this hook every search failed with RESEARCH_CREDIT_RESERVATION_REQUIRED and the
 * report ended «partial», without company profile, news or hiring signals (docs/ia-medida.md).
 */
export function nativeResearchSearchContext(organizationId: string, leadId: string | null | undefined, supabase: unknown) {
  return {
    auth: {
      user: { id: leadId || 'native-research' },
      organizationId,
      supabase,
    },
    conversationId: 'native-research',
    consumeResearchCredit: async () => {},
  } as any;
}
