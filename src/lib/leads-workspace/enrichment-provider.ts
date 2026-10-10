/** App credits and upstream provider credits are separate. The current quota RPC
 * charges one internal credit per processed contact, not one per selected field. */
export const ANTONIA_ENRICHMENT_CREDITS_PER_CONTACT = 1;
type Origin = { id: string; sourceProvider?: string; sourceProviderId?: string };
const finderId = /^lf_[0-9a-f]{24}$/;

export function isLeadsFinderOrigin(lead: Origin) {
  return lead.sourceProvider === 'leads_finder' || (lead.sourceProviderId || '').startsWith('lf_') || lead.id.startsWith('lf_');
}

/** An incomplete LF identity must never silently fall through to paid Apollo. */
export function partitionEnrichmentLeads<T extends Origin>(leads: T[]) {
  const leadsFinder: T[] = [], apollo: T[] = [];
  for (const lead of leads) {
    if (!isLeadsFinderOrigin(lead)) { apollo.push(lead); continue; }
    if (!finderId.test(lead.sourceProviderId || '')) {
      throw Error('No pudimos confirmar el origen de este contacto. Vuelve a guardarlo desde Buscar prospectos antes de completar sus datos.');
    }
    leadsFinder.push(lead);
  }
  return { leadsFinder, apollo };
}

export function enrichmentCreditReceipt(consumed: number) {
  return consumed > 0 ? `Se ${consumed === 1 ? 'descontó' : 'descontaron'} ${consumed} ${consumed === 1 ? 'crédito' : 'créditos'} de ANTON.IA.` : '';
}
