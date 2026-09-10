import { PublicCompanyReferenceSchema } from '@/lib/public-company-research-contracts';
import type { ResearchClaimV1, ResearchSnapshotV1 } from '@/lib/research-contracts';
import {
  hasUnresolvedResearchContradiction,
  isDraftableCompanyFactClaim,
  isFreshResearchClaim,
  isQualifiedResearchFactEvidence,
  isSameResearchCompanyDomain,
  normalizeResearchCompanyDomain,
  researchTextKey,
} from '@/lib/research-fact-eligibility';

export function isDraftableCompanyFactWithPublicEvidence(input: {
  snapshot: ResearchSnapshotV1;
  claim: ResearchClaimV1;
  nowMs: number;
}) {
  if (isDraftableCompanyFactClaim(input)) return true;
  const { snapshot, claim, nowMs } = input;
  const parsed = PublicCompanyReferenceSchema.safeParse(snapshot.publicCompanyResearch);
  if (!parsed.success) return false;
  const reference = parsed.data;
  const countries: Record<string, string> = { chile: 'CL', peru: 'PE', colombia: 'CO' };
  const country = (value: unknown) => countries[researchTextKey(value)] || researchTextKey(value).toUpperCase();
  const namespace = `public-company:${reference.artifactId}:${reference.revision}`;
  if (
    claim.derivation.method !== 'model'
    || claim.classification !== 'fact' || claim.subjectScope !== 'company'
    || claim.derivation.promptVersion !== namespace
    || !claim.id.startsWith(`${namespace}:`) || !/^c\d{2,4}$/.test(claim.id.slice(namespace.length + 1))
    || normalizeResearchCompanyDomain(snapshot.subject.company.domain) !== reference.identity.domain
    || country(snapshot.subject.company.country) !== reference.identity.country
    || (snapshot.subject.person.country && country(snapshot.subject.person.country) !== reference.identity.country)
    || !(Date.parse(reference.expiresAt) > nowMs)
    || !isFreshResearchClaim(claim, nowMs)
    || claim.contradictingEvidenceIds.length > 0
    || hasUnresolvedResearchContradiction(snapshot, claim)
    || claim.supportingEvidenceIds.length === 0
  ) return false;

  // Every support must belong to the pinned artifact: the draft mapper links all supports.
  return claim.supportingEvidenceIds.every((id) => {
    const evidence = snapshot.evidence.find((item) => item.id === id);
    const source = snapshot.sources.find((item) => item.id === evidence?.sourceId);
    return Boolean(evidence && source
      && id.startsWith(`${namespace}:`) && /^f_[a-f0-9]{10}$/.test(id.slice(namespace.length + 1))
      && source.id.startsWith(`${namespace}:`) && /^src_[a-f0-9]{10}$/.test(source.id.slice(namespace.length + 1))
      && evidence.subjectScope === 'company' && evidence.kind === 'quote'
      && evidence.path === namespace
      && evidence.extraction.method === 'rule' && evidence.extraction.provider === 'public-company'
      && evidence.extraction.version === namespace
      && source.provider === 'public-company' && source.type === 'official_site'
      && isSameResearchCompanyDomain(source.url, reference.identity.domain)
      && isQualifiedResearchFactEvidence({
        evidence, source, companyName: snapshot.subject.company.name, companyDomain: reference.identity.domain,
      }));
  });
}
