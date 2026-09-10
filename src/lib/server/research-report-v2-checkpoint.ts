import { z } from 'zod';

import { buildReportV2Committee } from '@/ai/flows/build-report-v2-committee';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { EntityResolutionV2Schema, FactClaimV2Schema, FactV2Schema, QualificationV2Schema, SourceV2Schema } from '@/lib/report-v2-contracts';
import { canonicalResearchUrl } from '@/lib/report-v2-extraction';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import {
  buildCompanyResearchArtifactIdentity,
  claimCompanyResearchArtifact,
  completeCompanyResearchArtifact,
  isFreshReusableCompanyResearchArtifact,
  matchesCompanyResearchArtifactIdentity,
  releaseCompanyResearchArtifactClaim,
} from './company-research-artifacts';
import { gatherReportV2Research, REPORT_V2_RESEARCH_VERSION } from './research-report-v2-research';

const PROVIDER_VERSION = 'report-v2/public-research/v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const PublicGraphSchema = z.object({
  sources: z.array(SourceV2Schema).min(1).max(200),
  facts: z.array(FactV2Schema).min(1).max(1_000),
  // Gather emits web-backed facts, never profile declarations or seller hypotheses.
  claims: z.array(FactClaimV2Schema.extend({ internalId: z.string().regex(/^f_[a-f0-9]{10}$/) })).min(1).max(1_000),
  shortIdMap: z.record(z.string().regex(/^c\d{2,4}$/), z.string().regex(/^f_[a-f0-9]{10}$/)),
}).strict();

function parsePublicGraph(value: unknown) {
  const parsed = PublicGraphSchema.safeParse(value);
  if (!parsed.success) throw new Error('REPORT_V2_RESEARCH_GRAPH_INVALID');
  const graph = parsed.data;
  const sources = new Set(graph.sources.map((source) => source.id));
  const facts = new Set(graph.facts.map((fact) => fact.id));
  const claims = new Set(graph.claims.map((claim) => claim.id));
  if (sources.size !== graph.sources.length || facts.size !== graph.facts.length || claims.size !== graph.claims.length
    || new Set(graph.claims.map((claim) => claim.internalId)).size !== graph.claims.length
    || Object.keys(graph.shortIdMap).length !== claims.size) throw new Error('REPORT_V2_RESEARCH_GRAPH_INVALID');
  for (const source of graph.sources) {
    const url = new URL(source.canonicalUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || source.url !== source.canonicalUrl || canonicalResearchUrl(source.canonicalUrl) !== source.canonicalUrl
      || source.id !== buildStableReportV2Id('src', source.canonicalUrl)) throw new Error('REPORT_V2_RESEARCH_GRAPH_INVALID');
  }
  for (const fact of graph.facts) {
    const block = fact.locator?.match(/^block:([1-9]\d*)$/);
    // Only facts produced from freshly fetched web blocks have this content ID.
    if (!sources.has(fact.sourceId) || !block
      || fact.id !== buildStableReportV2Id('f', { sourceId: fact.sourceId, index: Number(block[1]) - 1, block: fact.text })) {
      throw new Error('REPORT_V2_RESEARCH_GRAPH_INVALID');
    }
  }
  for (const claim of graph.claims) {
    if (!claim.evidenceIds.every((id) => facts.has(id)) || graph.shortIdMap[claim.id] !== claim.internalId) {
      throw new Error('REPORT_V2_RESEARCH_GRAPH_INVALID');
    }
  }
  return graph;
}

/**
 * Checkpoints only public web evidence in the organization-readable artifact table.
 * A hit keeps the caller's baseline entity/qualification and rebuilds its committee;
 * richer entity resolution (including country paths) from the first run is not restored.
 * Raw gather remains available to CLI callers without enabling database access.
 */
export async function loadOrGatherReportV2Research(input: Parameters<typeof gatherReportV2Research>[0] & {
  researchSnapshotId: string;
  ownerUserId: string;
  synthesisContextHash: string;
}, dependencies: {
  admin?: Parameters<typeof claimCompanyResearchArtifact>[1];
  claim?: typeof claimCompanyResearchArtifact;
  complete?: typeof completeCompanyResearchArtifact;
  release?: typeof releaseCompanyResearchArtifactClaim;
  gather?: typeof gatherReportV2Research;
  now?: () => number;
} = {}): Promise<Awaited<ReturnType<typeof gatherReportV2Research>>> {
  const now = dependencies.now || Date.now;
  const started = now();
  input.signal?.throwIfAborted();
  if (!input.researchSnapshotId.trim() || !input.ownerUserId.trim() || !input.organizationId.trim()
    || !/^[a-f0-9]{64}$/.test(input.synthesisContextHash)
    || !EntityResolutionV2Schema.safeParse(input.projection.entity).success
    || !QualificationV2Schema.safeParse(input.projection.qualification).success) {
    throw new Error('REPORT_V2_RESEARCH_SCOPE_INVALID');
  }
  const { researchSnapshotId, ownerUserId, synthesisContextHash, ...gatherInput } = input;
  // Shared company collection must precede the personalized legacy checkpoint.
  if (input.publicCompanyResearch) return (dependencies.gather || gatherReportV2Research)(gatherInput);
  const entity = input.projection.entity;
  const identity = buildCompanyResearchArtifactIdentity({
    organizationId: input.organizationId,
    companyDomain: entity.companyDomain,
    countryCode: entity.contactCountry,
    researchLanguage: input.language,
    researchDepth: input.depth === 'deep'
      ? 'deep'
      : input.depth === 'standard' ? 'standard' : 'basic',
    profileRevision: PROVIDER_VERSION,
    icpHash: synthesisContextHash,
    promptVersion: PROVIDER_VERSION,
    provider: 'report-v2',
    providerVersion: PROVIDER_VERSION,
    providerContextFingerprint: canonicalSha256({
      researchSnapshotId, ownerUserId, synthesisContextHash,
      researchVersion: REPORT_V2_RESEARCH_VERSION,
      companyName: entity.companyName, companyDomain: entity.companyDomain,
      contactCountry: entity.contactCountry, contact: entity.contact,
      language: input.language,
    }),
  });
  const claim = await (dependencies.claim || claimCompanyResearchArtifact)({ identity, leaseSeconds: 300 }, dependencies.admin);
  if (!matchesCompanyResearchArtifactIdentity(claim.artifact, identity)) throw new Error('REPORT_V2_RESEARCH_CACHE_INVALID');
  if (claim.state === 'busy') {
    throw Object.assign(new Error('REPORT_V2_RESEARCH_BUSY'), { code: 'REPORT_V2_RESEARCH_BUSY', retryable: true });
  }
  if (claim.state === 'cached') {
    if (!isFreshReusableCompanyResearchArtifact(claim.artifact, identity, now())
      || !['completed', 'partial'].includes(claim.artifact.status)
      || Date.parse(claim.artifact.expiresAt) > now() + TTL_MS
      || claim.artifact.errorMetadata.publicGraphHash !== canonicalSha256({ cacheIdentity: identity.cacheIdentity, graph: claim.artifact.payload })) {
      throw new Error('REPORT_V2_RESEARCH_CACHE_INVALID');
    }
    const graph = parsePublicGraph(claim.artifact.payload);
    return {
      ...input.projection,
      ...graph,
      committee: buildReportV2Committee({ entity, qualification: input.projection.qualification, claims: graph.claims }),
      researchWarnings: claim.artifact.status === 'partial' ? ['cached_research_partial'] : [],
      researchMetrics: { queries: 0, pages: graph.sources.length, elapsedMs: Math.max(0, now() - started) },
    };
  }
  if (claim.state !== 'claimed' || !claim.claimToken || claim.artifact.status !== 'running') {
    throw new Error('REPORT_V2_RESEARCH_CACHE_INVALID');
  }
  const release = dependencies.release || releaseCompanyResearchArtifactClaim;
  const lease = { artifact: claim.artifact, identity, claimToken: claim.claimToken };
  let result: Awaited<ReturnType<typeof gatherReportV2Research>>;
  try {
    result = await (dependencies.gather || gatherReportV2Research)(gatherInput);
    const importedClaimIds = new Set(input.projection.claims.map((item) => item.internalId));
    // A no-web/no-claims gather can return the imported graph, even with pages > 0.
    // Do not promote it (or a mixture with imported claims) into shared evidence.
    if (result.researchMetrics.pages > 0 && result.claims.length > 0
      && result.claims.every((item) => !importedClaimIds.has(item.internalId))) {
      const graph = parsePublicGraph({ sources: result.sources, facts: result.facts, claims: result.claims, shortIdMap: result.shortIdMap });
      await (dependencies.complete || completeCompanyResearchArtifact)({
        ...lease,
        status: result.researchWarnings.length ? 'partial' : 'completed',
        payload: graph,
        expiresAt: new Date(now() + TTL_MS).toISOString(),
        errorMetadata: { publicGraphHash: canonicalSha256({ cacheIdentity: identity.cacheIdentity, graph }) },
      }, dependencies.admin);
      return result;
    }
  } catch (error) {
    // Provider errors can contain prompts or contact data; never persist their text.
    await release({ ...lease, errorCode: 'report_v2_research_failed', errorMessage: 'Public research checkpoint failed.' }, dependencies.admin).catch(() => undefined);
    throw error;
  }
  await release({ ...lease, errorCode: 'report_v2_no_public_claims', errorMessage: 'No new public research graph to checkpoint.' }, dependencies.admin);
  return result;
}
