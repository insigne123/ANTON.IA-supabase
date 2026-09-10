import { buildReportV2Committee } from '@/ai/flows/build-report-v2-committee';
import { type SellerProfileContextV2 } from '@/ai/flows/reason-about-report-v2-account';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  ClaimV2Schema,
  FactV2Schema,
  SourceV2Schema,
  assignShortClaimIds,
  type ClaimV2,
  type CommitteeMemberV2,
  type EntityResolutionV2,
  type FactV2,
  type GapV2,
  type QualificationV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import { canonicalResearchUrl, resolveEntityFromExistingContextV2, truncateAtWord } from '@/lib/report-v2-extraction';
import { ResearchSnapshotV1Schema, type ResearchClaimKindV1, type ResearchSnapshotV1 } from '@/lib/research-contracts';
import { qualifyEntityV2, type IcpRulesV2 } from '@/qualification/icp-gate';

export const REPORT_V2_SNAPSHOT_ADAPTER_VERSION = 'report-v2/snapshot-adapter/2';

export type ReportV2SnapshotProjection = {
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  sources: SourceV2[];
  facts: FactV2[];
  claims: ClaimV2[];
  shortIdMap: Record<string, string | null>;
  committee: CommitteeMemberV2[];
  initialGaps: GapV2[];
};

const DIMENSION_BY_V1_KIND: Partial<Record<ResearchClaimKindV1, ClaimV2['dimension']>> = {
  company_identity: 'company_overview',
  company_overview: 'company_overview',
  company_industry: 'company_industry',
  company_service: 'company_service',
  company_size: 'company_size',
  lead_role: 'contact_role',
  news_signal: 'signal',
  hiring_signal: 'signal',
  technology_signal: 'signal',
  site_signal: 'signal',
  pain_hypothesis: 'risk',
  risk_hypothesis: 'risk',
};

const SOURCE_TYPE_BY_V1: Record<ResearchSnapshotV1['sources'][number]['type'], SourceV2['sourceType']> = {
  official_site: 'corporate',
  linkedin: 'social',
  news: 'press',
  jobs: 'search',
  technology: 'other',
  search_result: 'search',
  registry: 'registry',
  other: 'other',
};

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function instant(value: unknown) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sourceJurisdiction(url: string): SourceV2['jurisdiction'] {
  const parsed = new URL(url);
  const hostCountry = parsed.hostname.toLowerCase().split('.')[0];
  if (hostCountry === 'cl' || hostCountry === 'pe' || hostCountry === 'co') return hostCountry.toUpperCase() as 'CL' | 'PE' | 'CO';
  const paths = parsed.pathname.toLowerCase().split('/').filter(Boolean);
  if (paths.some((part) => part === 'cl' || part === 'chile')) return 'CL';
  if (paths.some((part) => part === 'pe' || part === 'peru')) return 'PE';
  if (paths.some((part) => part === 'co' || part === 'colombia')) return 'CO';
  return 'GLOBAL';
}

function isOwnDomain(url: string, domain: string) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const target = domain.toLowerCase().replace(/^www\./, '');
  return host === target || host.endsWith(`.${target}`);
}

function mappedJurisdiction(facts: FactV2[]): ClaimV2['jurisdiction'] {
  const jurisdictions = [...new Set(facts.map((fact) => fact.jurisdiction).filter(Boolean))];
  if (jurisdictions.length === 1) return jurisdictions[0] || null;
  return jurisdictions.length > 1 ? 'GLOBAL' : null;
}

function newestObservedAt(facts: FactV2[]) {
  return facts.map((fact) => fact.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
}

function freshnessDays(observedAt: string | null, generatedAt: string) {
  if (!observedAt) return null;
  return Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(observedAt)) / 86_400_000));
}

function headcountFromClaims(claims: ClaimV2[], country: EntityResolutionV2['contactCountry']) {
  const values = claims.flatMap((claim) => {
    if (claim.type !== 'fact' || claim.dimension !== 'company_size') return [];
    if (claim.scope === 'group' || claim.scope === 'sector' || claim.jurisdiction !== country) return [];
    const match = claim.statement.match(/\b(\d+(?:[.,]\d{3})*)\s+(?:colaboradores|empleados|trabajadores|employees|workers|people)\b/i);
    return match ? [Number(match[1].replace(/[.,]/g, ''))] : [];
  });
  return values.length > 0 ? Math.max(...values) : null;
}

function validationQuestion(statement: string) {
  return truncateAtWord(`¿Que evidencia confirmaria esta hipotesis: ${statement.replace(/[?!.]+$/, '')}?`, 500)
    .replace(/\.{3}$/, '?');
}

export function projectResearchSnapshotV1ToReportV2(input: {
  snapshot: ResearchSnapshotV1;
  sellerProfile: SellerProfileContextV2;
  icpRules: IcpRulesV2 | null;
  generatedAt: string;
}): ReportV2SnapshotProjection {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  if (!snapshot.scope.organizationId) throw new Error('REPORT_V2_ORGANIZATION_REQUIRED');
  const companyDomain = text(snapshot.subject.company.domain);
  if (!companyDomain) throw new Error('REPORT_V2_COMPANY_DOMAIN_REQUIRED');
  const generatedAt = new Date(input.generatedAt).toISOString();
  const entity = resolveEntityFromExistingContextV2({
    contact: {
      fullName: snapshot.subject.person.fullName,
      title: snapshot.subject.person.title,
      normalizedTitle: snapshot.subject.person.title,
      company: snapshot.subject.company.name,
      country: snapshot.subject.person.country,
      department: snapshot.subject.person.departments?.[0],
      seniorityFromProvider: snapshot.subject.person.seniority,
      linkedin: snapshot.subject.person.linkedinUrl,
    },
    domain: companyDomain,
    sources: [],
  });

  const evidenceBySource = new Map<string, ResearchSnapshotV1['evidence']>();
  snapshot.evidence.forEach((evidence) => {
    evidenceBySource.set(evidence.sourceId, [...(evidenceBySource.get(evidence.sourceId) || []), evidence]);
  });
  const sourceIdMap = new Map<string, string>();
  const sourcesById = new Map<string, SourceV2>();
  snapshot.sources.forEach((source) => {
    // V2 reloads the original shared graph, including scope and uncited facts.
    if (snapshot.publicCompanyResearch && source.provider === 'public-company') return;
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalResearchUrl(source.canonicalUrl || source.url);
    } catch {
      return;
    }
    const id = buildStableReportV2Id('src', canonicalUrl);
    sourceIdMap.set(source.id, id);
    if (sourcesById.has(id)) return;
    const sourceEvidence = evidenceBySource.get(source.id) || [];
    const storedHash = text(source.contentHash).replace(/^sha256:/, '');
    const contentHash = /^[a-f0-9]{64}$/.test(storedHash)
      ? storedHash
      : canonicalSha256(sourceEvidence.map((item) => ({ path: item.path, statement: item.statement, locator: item.locator || null })));
    sourcesById.set(id, SourceV2Schema.parse({
      id,
      url: canonicalUrl,
      canonicalUrl,
      title: text(source.title) || new URL(canonicalUrl).hostname,
      sourceType: SOURCE_TYPE_BY_V1[source.type],
      jurisdiction: sourceJurisdiction(canonicalUrl),
      publishedAt: instant(source.publishedAt),
      modifiedAt: null,
      retrievedAt: new Date(source.retrievedAt).toISOString(),
      ownDomain: isOwnDomain(canonicalUrl, companyDomain),
      contentHash,
    }));
  });
  const sources = [...sourcesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const factIdMap = new Map<string, string>();
  const facts = snapshot.evidence.flatMap((evidence) => {
    const sourceId = sourceIdMap.get(evidence.sourceId);
    const source = sourceId ? sourceById.get(sourceId) : null;
    if (!source) return [];
    const id = buildStableReportV2Id('f', { sourceId, evidenceId: evidence.id, statement: evidence.statement, locator: evidence.locator || null });
    factIdMap.set(evidence.id, id);
    return [FactV2Schema.parse({
      id,
      sourceId,
      text: truncateAtWord(evidence.statement, 2_000),
      observedAt: instant(evidence.observedAt),
      jurisdiction: source.jurisdiction,
      locator: evidence.locator ? truncateAtWord(`${evidence.locator.kind}:${evidence.locator.value}`, 500) : null,
    })];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));

  const claimCandidates = snapshot.claims.slice().sort((left, right) => left.id.localeCompare(right.id)).flatMap((claim) => {
    if (Date.parse(claim.freshness.validUntil) <= Date.parse(generatedAt)) return [];
    const dimension = DIMENSION_BY_V1_KIND[claim.kind];
    if (!dimension) return [];
    const evidenceIds = [...new Set(claim.supportingEvidenceIds.map((id) => factIdMap.get(id)).filter((id): id is string => Boolean(id)))];
    const supportingFacts = evidenceIds.map((id) => factsById.get(id)).filter((fact): fact is FactV2 => Boolean(fact));
    const observedAt = newestObservedAt(supportingFacts);
    const statement = truncateAtWord(claim.statement, 220);
    const base = {
      id: 'c00',
      internalId: claim.id,
      dimension,
      statement,
      freshnessDays: freshnessDays(observedAt, generatedAt),
      jurisdiction: mappedJurisdiction(supportingFacts),
      confidence: claim.confidence,
    };
    if (claim.classification === 'fact') {
      if (evidenceIds.length === 0 || dimension === 'signal' && !observedAt) return [];
      const parsed = ClaimV2Schema.safeParse({ ...base, type: 'fact', evidenceIds, observedAt });
      return parsed.success ? [parsed.data] : [];
    }
    if (Date.parse(claim.freshness.validUntil) < Date.parse(generatedAt)) return [];
    const parsed = ClaimV2Schema.safeParse({
      ...base,
      type: 'hypothesis',
      evidenceIds,
      observedAt,
      validationQuestion: validationQuestion(statement),
    });
    return parsed.success ? [parsed.data] : [];
  });
  const assigned = assignShortClaimIds(claimCandidates);
  const claims = assigned.claims.map((claim) => ClaimV2Schema.parse(claim));
  const qualification = qualifyEntityV2({
    entity,
    rules: input.icpRules,
    headcount: headcountFromClaims(claims, entity.contactCountry),
    productKeys: input.sellerProfile.products.map((product) => product.key),
  });
  const committee = buildReportV2Committee({ entity, qualification, claims });
  return {
    entity,
    qualification,
    sources,
    facts,
    claims,
    shortIdMap: assigned.shortIdMap,
    committee,
    initialGaps: [],
  };
}
