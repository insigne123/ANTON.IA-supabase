import type {
  ResearchClaimV1,
  ResearchEvidenceV1,
  ResearchSnapshotV1,
  ResearchSourceV1,
} from '@/lib/research-contracts';

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function researchTextKey(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isGenericResearchText(value: unknown) {
  const normalized = researchTextKey(value);
  if (!normalized) return true;
  const hasBoilerplateOnly = [
    /\b(?:selecciona|elige|escoge) (?:tu |el |un )?(?:pais|region|idioma|ubicacion)\b/,
    /\b(?:select|choose) (?:(?:a|your) )?(?:country|region|language|location)\b/,
    /\b(?:aceptar|configurar|administrar|gestionar) (?:las )?cookies\b/,
    /\b(?:accept|manage|customize) (?:all )?cookies\b/,
    /\b(?:saltar al contenido|skip to (?:main )?content|menu principal|main menu)\b/,
    /\b(?:habilita|activa|enable) javascript\b/,
    /\b(?:pagina no encontrada|page not found|acceso denegado|access denied)\b/,
    /\b(?:todos los derechos reservados|all rights reserved)\b/,
  ].some((pattern) => pattern.test(normalized));

  // Navigation can coexist with useful text on an otherwise substantive page.
  return hasBoilerplateOnly && normalized.length < 320;
}

export function safeResearchUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostFor(value: unknown) {
  const url = safeResearchUrl(value);
  return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '';
}

export function normalizeResearchCompanyDomain(value: unknown) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`)
      .hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
  }
}

export function isSameResearchCompanyDomain(url: unknown, companyDomain: unknown) {
  const host = hostFor(url);
  const domain = normalizeResearchCompanyDomain(companyDomain);
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}

function companyTerms(value: unknown) {
  return researchTextKey(value).split(' ').filter((term) => term.length >= 3);
}

export function mentionsResearchCompany(value: unknown, input: { companyName?: unknown; companyDomain?: unknown }) {
  const candidate = researchTextKey(value);
  if (!candidate) return false;

  const domain = normalizeResearchCompanyDomain(input.companyDomain);
  const domainName = researchTextKey(domain.replace(/\.[a-z]{2,}$/i, ''));
  if (domainName && candidate.replace(/ /g, '').includes(domainName.replace(/ /g, ''))) return true;

  const name = researchTextKey(input.companyName);
  if (name && candidate.replace(/ /g, '').includes(name.replace(/ /g, ''))) return true;

  const terms = companyTerms(input.companyName);
  return terms.length > 1 && terms.every((term) => candidate.includes(term));
}

function sourceDescribesCompany(source: ResearchSourceV1, input: { companyName?: unknown; companyDomain?: unknown }) {
  return mentionsResearchCompany(
    [source.title, source.publisher, source.url].filter(Boolean).join(' '),
    input,
  );
}

function personTerms(value: unknown) {
  return researchTextKey(value).split(' ').filter((term) => term.length >= 2);
}

export function mentionsResearchPerson(value: unknown, personName?: unknown) {
  const candidate = researchTextKey(value);
  const name = researchTextKey(personName);
  if (!candidate || !name) return false;
  if (candidate.includes(name)) return true;
  const terms = personTerms(personName);
  return terms.length >= 2 && terms.every((term) => candidate.includes(term));
}

function sourceDescribesPerson(source: ResearchSourceV1, personName?: unknown) {
  return mentionsResearchPerson(
    [source.title, source.publisher, source.url].filter(Boolean).join(' '),
    personName,
  );
}

export function isQualifiedResearchFactEvidence(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  companyName?: unknown;
  companyDomain?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || !safeResearchUrl(source.url)) return false;
  if (
    !['fact', 'quote'].includes(evidence.kind)
    || evidence.extraction.method === 'model'
    || isGenericResearchText(evidence.statement)
  ) return false;

  const sourceOnCompanyDomain = isSameResearchCompanyDomain(source.url, input.companyDomain);
  if (source.type === 'official_site') {
    return sourceOnCompanyDomain || sourceDescribesCompany(source, input);
  }
  if (source.provider === 'brand.dev') {
    return mentionsResearchCompany(evidence.statement, input) && evidence.statement.length >= 40;
  }
  if (source.type === 'registry') return false;

  return sourceOnCompanyDomain
    || (sourceDescribesCompany(source, input) && mentionsResearchCompany(evidence.statement, input));
}

/** A public, directly sourced person fact. Imported lead fields are intentionally excluded. */
export function isQualifiedResearchPersonFactEvidence(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  personName?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || !safeResearchUrl(source.url) || source.provider === 'lead-input') return false;
  if (
    evidence.subjectScope !== 'person'
    || !['fact', 'quote', 'profile_field'].includes(evidence.kind)
    || evidence.extraction.method === 'model'
    || isGenericResearchText(evidence.statement)
  ) return false;

  const sourceMatchesPerson = sourceDescribesPerson(source, input.personName);
  const statementMatchesPerson = mentionsResearchPerson(evidence.statement, input.personName);
  if (source.type === 'linkedin') return sourceMatchesPerson || statementMatchesPerson;
  if (source.type === 'registry') return false;
  return sourceMatchesPerson || statementMatchesPerson;
}

export function isRelevantResearchSignal(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  companyName?: unknown;
  companyDomain?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || evidence.kind !== 'event' || !safeResearchUrl(source.url) || isGenericResearchText(evidence.statement)) {
    return false;
  }

  return isSameResearchCompanyDomain(source.url, input.companyDomain)
    || mentionsResearchCompany(`${source.title || ''} ${evidence.statement}`, input);
}

export function hasUnresolvedResearchContradiction(snapshot: ResearchSnapshotV1, claim: ResearchClaimV1) {
  const supporting = new Set(claim.supportingEvidenceIds);
  return snapshot.contradictions.some((contradiction) => (
    contradiction.status === 'unresolved'
    && (contradiction.claimIds.includes(claim.id)
      || contradiction.evidenceIds.some((evidenceId) => supporting.has(evidenceId)))
  ));
}

export function isFreshResearchClaim(claim: ResearchClaimV1, nowMs: number) {
  const validUntil = Date.parse(claim.freshness.validUntil);
  return Number.isFinite(validUntil) && validUntil > nowMs;
}

export function isDraftableCompanyFactClaim(input: {
  snapshot: ResearchSnapshotV1;
  claim: ResearchClaimV1;
  nowMs: number;
}) {
  const { snapshot, claim } = input;
  if (
    claim.classification !== 'fact'
    || claim.subjectScope !== 'company'
    || !['direct', 'rule'].includes(claim.derivation.method)
    || !isFreshResearchClaim(claim, input.nowMs)
    || hasUnresolvedResearchContradiction(snapshot, claim)
  ) {
    return false;
  }

  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  return claim.supportingEvidenceIds.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return Boolean(evidence && isQualifiedResearchFactEvidence({
      evidence,
      source: sourceById.get(evidence.sourceId),
      companyName: snapshot.subject.company.name,
      companyDomain: snapshot.subject.company.domain,
    }));
  });
}

export function isDraftablePersonFactClaim(input: {
  snapshot: ResearchSnapshotV1;
  claim: ResearchClaimV1;
  nowMs: number;
}) {
  const { snapshot, claim } = input;
  if (
    claim.classification !== 'fact'
    || claim.subjectScope !== 'person'
    || !['direct', 'rule'].includes(claim.derivation.method)
    || !isFreshResearchClaim(claim, input.nowMs)
    || hasUnresolvedResearchContradiction(snapshot, claim)
  ) {
    return false;
  }

  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  return claim.supportingEvidenceIds.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return Boolean(evidence && isQualifiedResearchPersonFactEvidence({
      evidence,
      source: sourceById.get(evidence.sourceId),
      personName: snapshot.subject.person.fullName,
    }));
  });
}
