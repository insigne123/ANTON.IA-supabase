/** Only an explicitly requested, recent phone lookup should look active. A
 * generic pending enrichment does not mean a phone search is running. */
export function hasActivePhoneLookup(lead: {
  enrichmentStatus?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}, now = Date.now()) {
  if (String(lead.enrichmentStatus || '').trim().toLowerCase() !== 'pending_phone') return false;
  const started = Date.parse(lead.updatedAt || lead.createdAt || '');
  return Number.isFinite(started) && started <= now && now - started < 48 * 60 * 60 * 1000;
}
