import { buildReportV2Committee } from '@/ai/flows/build-report-v2-committee';
import { buildStableReportV2Id } from './report-v2-ids';
import { ClaimV2Schema } from './report-v2-contracts';
import type { ReportV2SnapshotProjection } from './report-v2-snapshot-adapter';
import { ResearchClaimV1Schema, ResearchEvidenceV1Schema, ResearchSourceV1Schema, type ResearchClaimKindV1 } from './research-contracts';
import { type PublicCompanyGraph, type PublicCompanyReference } from './public-company-research-contracts';
import { validatePublicCompanyGraph } from './server/public-company-research-validation';

export function publicCompanyToNative(graph: PublicCompanyGraph, reference: PublicCompanyReference, now = Date.now()) {
  validatePublicCompanyGraph(graph, reference.identity, now);
  if (Date.parse(reference.expiresAt) <= now) throw new Error('PUBLIC_COMPANY_EXPIRED');
  const provenance = `public-company:${reference.artifactId}:${reference.revision}`;
  const sourceIds = new Map(graph.sources.map((source) => [source.id, `${provenance}:${source.id}`]));
  const factIds = new Map(graph.facts.map((fact) => [fact.id, `${provenance}:${fact.id}`]));
  const sources = graph.sources.map((source) => ResearchSourceV1Schema.parse({
    id: sourceIds.get(source.id), type: source.ownDomain ? 'official_site' : 'other', url: source.url, canonicalUrl: source.canonicalUrl,
    title: source.title, provider: 'public-company', retrievedAt: source.retrievedAt,
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}), contentHash: `sha256:${source.contentHash}`, reliability: 0.8,
  }));
  const evidence = graph.facts.map((fact) => ResearchEvidenceV1Schema.parse({
    id: factIds.get(fact.id), sourceId: sourceIds.get(fact.sourceId), subjectScope: 'company', kind: 'quote',
    path: provenance, statement: fact.text, locator: { kind: 'page_section', value: fact.locator! },
    ...(fact.observedAt ? { observedAt: fact.observedAt } : {}),
    extractedAt: graph.sources.find((source) => source.id === fact.sourceId)!.retrievedAt,
    confidence: 0.8, extraction: { method: 'rule', provider: 'public-company', version: provenance },
  }));
  const kinds: Record<string, ResearchClaimKindV1> = {
    company_overview: 'company_overview', company_industry: 'company_industry', company_service: 'company_service',
    company_size: 'company_size', company_geography: 'company_identity', company_legal_form: 'company_identity',
    company_tech: 'technology_signal', signal: 'news_signal', regulatory: 'site_signal',
  };
  // V1 cannot encode group/country scopes. Keep their raw evidence, not a company-level assertion.
  const claims = graph.claims.filter((claim) => claim.scope !== 'group'
    && (!claim.jurisdiction || claim.jurisdiction === 'GLOBAL' || claim.jurisdiction === reference.identity.country))
    .map((claim) => ResearchClaimV1Schema.parse({
    id: `${provenance}:${claim.id}`, kind: kinds[claim.dimension] || 'company_overview', subjectScope: 'company',
    classification: 'fact', statement: claim.statement, supportingEvidenceIds: claim.evidenceIds.map((id) => factIds.get(id)),
    contradictingEvidenceIds: [], confidence: claim.confidence,
    freshness: { asOf: claim.observedAt || graph.sources.find((source) => source.id === graph.facts.find((fact) => fact.id === claim.evidenceIds[0])!.sourceId)!.retrievedAt,
      validUntil: reference.expiresAt, policyVersion: 'research-freshness/v1' },
    derivation: { method: 'model', promptVersion: provenance },
  }));
  return { sources, evidence, claims };
}

export function mergePublicCompanyProjection(projection: ReportV2SnapshotProjection, graph: PublicCompanyGraph, reference: PublicCompanyReference, now = Date.now()): ReportV2SnapshotProjection {
  validatePublicCompanyGraph(graph, reference.identity, now);
  if (Date.parse(reference.expiresAt) <= now || projection.entity.companyDomain.replace(/^www\./, '') !== reference.identity.domain
    || projection.entity.contactCountry !== 'OTHER' && projection.entity.contactCountry !== reference.identity.country) throw new Error('PUBLIC_COMPANY_MERGE_INVALID');
  // Namespace both graphs: identical URLs can represent different captures/content.
  // Never discard uncited facts; the auditor needs the complete public evidence.
  const combined = { sources: [] as ReportV2SnapshotProjection['sources'], facts: [] as ReportV2SnapshotProjection['facts'], claims: [] as ReportV2SnapshotProjection['claims'] };
  for (const [namespace, part] of [[`public:${reference.artifactId}:${reference.revision}`, graph], ['private', projection]] as const) {
    const sources = new Map(part.sources.map((source) => [source.id, buildStableReportV2Id('src', { namespace, source })]));
    const facts = new Map(part.facts.map((fact) => [fact.id, buildStableReportV2Id('f', { namespace, fact })]));
    const claims = new Map(part.claims.map((claim, index) => [claim.id, `c${String(combined.claims.length + index + 1).padStart(2, '0')}`]));
    combined.sources.push(...part.sources.map((source) => ({ ...source, id: sources.get(source.id)! })));
    combined.facts.push(...part.facts.map((fact) => ({ ...fact, id: facts.get(fact.id)!, sourceId: sources.get(fact.sourceId)! })));
    combined.claims.push(...part.claims.map((claim) => ClaimV2Schema.parse({ ...claim,
      id: claims.get(claim.id), internalId: namespace === 'private' ? claim.internalId : `${namespace}:${claim.internalId || claim.id}`,
      evidenceIds: claim.evidenceIds.map((id) => facts.get(id)),
      freshnessDays: claim.observedAt ? Math.max(0, Math.floor((now - Date.parse(claim.observedAt)) / 86_400_000)) : null,
      ...(claim.type === 'derived' ? { inputs: claim.inputs.map((id) => claims.get(id)) } : {}),
    })));
  }
  if (combined.facts.some((fact) => !fact.sourceId)) throw new Error('PUBLIC_COMPANY_MERGE_DANGLING');
  return { ...projection, ...combined, shortIdMap: Object.fromEntries(combined.claims.map((claim) => [claim.id, claim.internalId])),
    committee: buildReportV2Committee({ entity: projection.entity, qualification: projection.qualification, claims: combined.claims }) };
}
