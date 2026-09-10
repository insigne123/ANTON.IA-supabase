import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import { PublicCompanyGraphSchema, PUBLIC_COMPANY_TTL_MS, publicCompanyHost, publicCompanyExternalBlock, type PublicCompanyIdentity } from '@/lib/public-company-research-contracts';

// Keep Node hashing outside the contracts imported by browser components.
export function validatePublicCompanyGraph(value: unknown, identity: PublicCompanyIdentity, now = Date.now()) {
  const graph = PublicCompanyGraphSchema.parse(value);
  const sources = new Map(graph.sources.map((source) => [source.id, source]));
  const facts = new Set(graph.facts.map((fact) => fact.id));
  if (sources.size !== graph.sources.length || facts.size !== graph.facts.length
    || new Set(graph.claims.map((claim) => claim.id)).size !== graph.claims.length) throw new Error('PUBLIC_COMPANY_GRAPH_DUPLICATE');
  for (const source of graph.sources) {
    const host = publicCompanyHost(source.canonicalUrl);
    if (publicCompanyHost(source.url) !== host
      || source.url !== source.canonicalUrl
      || (source.ownDomain ? host !== identity.domain || source.sourceType !== 'corporate'
        : host === identity.domain || host.endsWith(`.${identity.domain}`) || source.sourceType !== 'other')
      || source.id !== buildStableReportV2Id('src', source.canonicalUrl)
      || Date.parse(source.retrievedAt) > now || Date.parse(source.retrievedAt) + PUBLIC_COMPANY_TTL_MS <= now) {
      throw new Error('PUBLIC_COMPANY_SOURCE_INVALID');
    }
  }
  if (!graph.sources.some((source) => source.ownDomain)) throw new Error('PUBLIC_COMPANY_IDENTITY_MISMATCH');
  for (const fact of graph.facts) {
    const block = fact.locator?.match(/^block:([1-9]\d*)$/);
    if (!sources.has(fact.sourceId) || !block || fact.observedAt !== null || fact.jurisdiction !== null
      || !sources.get(fact.sourceId)!.ownDomain && !publicCompanyExternalBlock(fact.text, identity.domain)
      || fact.id !== buildStableReportV2Id('f', { sourceId: fact.sourceId, index: Number(block[1]) - 1, block: fact.text })) {
      throw new Error('PUBLIC_COMPANY_FACT_INVALID');
    }
  }
  for (const claim of graph.claims) {
    if (!claim.evidenceIds.every((id) => facts.has(id)) || !claim.internalId
      || claim.dimension.startsWith('contact_') || ['risk', 'volume_estimate', 'competitor', 'buying_committee'].includes(claim.dimension)
      || claim.scope === 'person' || claim.scope === 'sector'
      || claim.dimension === 'signal' && !claim.observedAt
      || claim.observedAt && Date.parse(claim.observedAt) > Math.min(...claim.evidenceIds.map((id) => {
        const fact = graph.facts.find((fact) => fact.id === id)!;
        return Date.parse(sources.get(fact.sourceId)!.retrievedAt);
      }))) throw new Error('PUBLIC_COMPANY_CLAIM_INVALID');
  }
  return graph;
}
