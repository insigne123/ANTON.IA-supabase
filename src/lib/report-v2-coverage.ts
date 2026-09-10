import {
  ClaimDimensionV2Schema,
  type ClaimV2,
  type CommitteeMemberV2,
  type FactV2,
  type GapV2,
  type ReportV2,
  type ReportV2SectionKey,
  type SectionV2,
  type SignalV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';

export type RequiredReportV2Field = {
  key: string;
  section: ReportV2SectionKey;
  dimensions: ClaimV2['dimension'][];
  statementPattern?: RegExp;
  ordinal?: number;
  howToFind: string;
  source: string;
};

export type ReportV2ModelTelemetry = {
  phase: 'analysis' | 'section' | 'audit';
  section: ReportV2SectionKey | null;
  attempt: number;
  model: string;
  durationMs: number;
  usage: Record<string, unknown> | null;
};

export type ReportV2OperationalMetrics = {
  sectionAcceptRate: number;
  claimsPerSource: Record<string, number>;
  ownDomainSourceRatio: number;
  signalsWithDateCount: number;
  committeeMembersFound: number;
  modelTelemetry?: ReportV2ModelTelemetry[];
  research?: { queries: number; pages: number; elapsedMs: number };
};

export const REPORT_V2_REQUIRED_FIELDS: RequiredReportV2Field[] = [
  { key: 'verdict.conclusion', section: 'verdict', dimensions: ['company_overview', 'contact_authority', 'risk'], howToFind: 'Revisar la evidencia principal y recalcular el veredicto.', source: 'Claims verificados de cuenta y contacto.' },
  { key: 'snapshot.industry', section: 'snapshot', dimensions: ['company_industry'], howToFind: 'Buscar la industria declarada en una fuente corporativa o registro.', source: 'Sitio corporativo o registro oficial.' },
  { key: 'snapshot.services', section: 'snapshot', dimensions: ['company_service'], howToFind: 'Revisar las paginas de servicios del sitio corporativo.', source: 'Sitio corporativo.' },
  { key: 'snapshot.headcount', section: 'snapshot', dimensions: ['company_size'], statementPattern: /\b(?:colaboradores|empleados|trabajadores|dotacion|headcount)\b/i, howToFind: 'Buscar cifras de colaboradores o dotacion.', source: 'Pagina corporativa, registro o prensa.' },
  { key: 'snapshot.clients', section: 'snapshot', dimensions: ['company_size'], statementPattern: /\bclientes\b/i, howToFind: 'Buscar una cifra publica de clientes.', source: 'Pagina corporativa o entrevista ejecutiva.' },
  { key: 'snapshot.geography', section: 'snapshot', dimensions: ['company_geography'], statementPattern: /\b(?:opera|operaciones|paises|chile|peru|colombia)\b/i, howToFind: 'Revisar sedes y operaciones por pais.', source: 'Sitio corporativo por jurisdiccion.' },
  { key: 'snapshot.headquarters', section: 'snapshot', dimensions: ['company_geography'], statementPattern: /\b(?:sede|domicilio|oficina central)\b/i, howToFind: 'Buscar el domicilio o sede publica.', source: 'Registro o pagina de contacto.' },
  { key: 'snapshot.legal_form', section: 'snapshot', dimensions: ['company_legal_form'], howToFind: 'Consultar el registro o marco legal aplicable.', source: 'Registro oficial.' },
  { key: 'contact.role', section: 'contact', dimensions: ['contact_role'], howToFind: 'Confirmar el cargo actual del contacto.', source: 'Perfil profesional publico.' },
  { key: 'contact.authority', section: 'contact', dimensions: ['contact_authority'], howToFind: 'Validar alcance y autoridad en discovery.', source: 'Perfil publico o conversacion.' },
  { key: 'committee.primary', section: 'committee', dimensions: ['buying_committee'], howToFind: 'Buscar al responsable primario por cargo objetivo.', source: 'Prensa, TheOrg, LinkedIn o contexto persistido.' },
  { key: 'company.business_model', section: 'company', dimensions: ['company_overview', 'company_service'], howToFind: 'Extraer como opera y a quien sirve la empresa.', source: 'Sitio corporativo y prensa.' },
  { key: 'regulatory.context', section: 'regulatory', dimensions: ['regulatory', 'company_legal_form'], howToFind: 'Consultar normativa de la jurisdiccion del contacto.', source: 'Regulador o fuente oficial.' },
  { key: 'signals.first', section: 'signals', dimensions: ['signal'], ordinal: 1, howToFind: 'Buscar una senal fechada del ultimo ano.', source: 'Prensa, empleos o registro.' },
  { key: 'signals.second', section: 'signals', dimensions: ['signal'], ordinal: 2, howToFind: 'Buscar otra senal independiente y fechada.', source: 'Prensa, empleos o registro.' },
  { key: 'signals.third', section: 'signals', dimensions: ['signal'], ordinal: 3, howToFind: 'Buscar una tercera senal independiente y fechada.', source: 'Prensa, empleos o registro.' },
  { key: 'fit.product', section: 'fit', dimensions: ['company_size', 'company_service', 'company_industry', 'regulatory'], howToFind: 'Contrastar claims de la cuenta con las reglas del producto.', source: 'Claims citados y perfil del tenant.' },
  { key: 'angle.anchor', section: 'angle', dimensions: ['signal', 'company_size', 'company_overview'], howToFind: 'Elegir un ancla factual especifica para el contacto.', source: 'Claims recientes y verificados.' },
  { key: 'discovery.validation', section: 'discovery', dimensions: ['risk', 'contact_authority', 'company_size'], howToFind: 'Convertir una hipotesis o hueco en pregunta.', source: 'Analisis de claims y gaps.' },
  { key: 'risks.disqualifier', section: 'risks', dimensions: ['risk', 'contact_authority', 'regulatory'], howToFind: 'Identificar riesgos o descalificadores citados.', source: 'Claims y compuerta ICP.' },
  { key: 'gaps.recovery', section: 'gaps', dimensions: ['company_overview', 'company_size', 'contact_authority', 'risk'], howToFind: 'Convertir cada campo ausente en una tarea de recuperacion.', source: 'Registro declarativo de cobertura.' },
  { key: 'sources.cited', section: 'sources', dimensions: [...ClaimDimensionV2Schema.options], howToFind: 'Vincular una fuente que produzca al menos un claim.', source: 'Grafo de evidencia.' },
];

function citedClaimsForSection(section: SectionV2 | undefined, claimsById: Map<string, ClaimV2>) {
  const ids = [
    ...(section?.paragraphs.flatMap((paragraph) => paragraph.claimIds) || []),
    ...(section?.blocks.flatMap((block) => block.claimIds) || []),
  ];
  return [...new Set(ids)].flatMap((id) => {
    const claim = claimsById.get(id);
    return claim ? [claim] : [];
  });
}

function fillsField(field: RequiredReportV2Field, claims: ClaimV2[]) {
  const matching = claims.filter((claim) => (
    field.dimensions.includes(claim.dimension)
    && (!field.statementPattern || field.statementPattern.test(claim.statement))
  ));
  return matching.length >= (field.ordinal || 1);
}

export function computeReportV2Coverage(input: {
  sections: SectionV2[];
  claims: ClaimV2[];
  requiredFields?: RequiredReportV2Field[];
  commercial?: boolean;
}) {
  if (input.commercial) {
    const fields = ['verdict.conclusion', 'company.business_model', 'contact.role', 'fit.product', 'angle.anchor', 'discovery.validation'];
    const filled = fields.filter((field) => input.sections.some((section) => section.key === field.split('.')[0] && section.paragraphs.some((paragraph) => paragraph.text.trim().length >= 30)));
    return { ratio: filled.length / fields.length, filled, missing: fields.filter((field) => !filled.includes(field)) };
  }
  const requiredFields = input.requiredFields || REPORT_V2_REQUIRED_FIELDS;
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const sectionsByKey = new Map(input.sections.map((section) => [section.key, section]));
  const filled = requiredFields.filter((field) => fillsField(
    field,
    citedClaimsForSection(sectionsByKey.get(field.section), claimsById),
  )).map((field) => field.key);
  const missing = requiredFields.map((field) => field.key).filter((field) => !filled.includes(field));
  const hasScaleFigure = input.claims.some((claim) => (
    claim.type === 'fact'
    && claim.dimension === 'company_size'
    && /\d/.test(claim.statement)
  ));
  const rawRatio = requiredFields.length === 0 ? 1 : filled.length / requiredFields.length;
  return {
    ratio: hasScaleFigure ? rawRatio : Math.min(0.4, rawRatio),
    filled,
    missing,
  };
}

export function gapsFromMissingReportV2Fields(missing: string[], requiredFields = REPORT_V2_REQUIRED_FIELDS): GapV2[] {
  const byKey = new Map(requiredFields.map((field) => [field.key, field]));
  return missing.flatMap((key) => {
    const field = byKey.get(key);
    if (!field) return [];
    return [{
      id: buildStableReportV2Id('gap', { requiredField: field.key }),
      section: field.section,
      requiredField: field.key,
      unknown: `Falta evidencia citada para ${field.key}.`,
      howToFind: field.howToFind,
      source: field.source,
    }];
  });
}

export function validateReportV2CoverageGapConsistency(report: Pick<ReportV2, 'coverage' | 'evidenceGraph'>) {
  const missing = [...report.coverage.missing].sort();
  const gaps = [...new Set(report.evidenceGraph.gaps.map((gap) => gap.requiredField))].sort();
  if (missing.length !== gaps.length || missing.some((field, index) => field !== gaps[index])) {
    throw new Error('REPORT_V2_COVERAGE_GAPS_MISMATCH');
  }
}

export function reportV2OperationalMetrics(input: {
  sectionsAttempted: number;
  sectionsAccepted: number;
  sections: SectionV2[];
  claims: ClaimV2[];
  facts: FactV2[];
  sources: SourceV2[];
  signals: SignalV2[];
  committee: CommitteeMemberV2[];
  modelTelemetry?: ReportV2ModelTelemetry[];
}): ReportV2OperationalMetrics {
  const claimsPerSource = new Map<string, Set<string>>();
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  input.claims.forEach((claim) => claim.evidenceIds.forEach((factId) => {
    const sourceId = factsById.get(factId)?.sourceId;
    if (!sourceId) return;
    const claimIds = claimsPerSource.get(sourceId) || new Set<string>();
    claimIds.add(claim.id);
    claimsPerSource.set(sourceId, claimIds);
  }));
  const citedSourceIds = [...claimsPerSource.keys()];
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const ownDomainCount = citedSourceIds.filter((id) => sourcesById.get(id)?.ownDomain).length;
  return {
    sectionAcceptRate: input.sectionsAttempted === 0 ? 0 : input.sectionsAccepted / input.sectionsAttempted,
    claimsPerSource: Object.fromEntries([...claimsPerSource.entries()].map(([id, claims]) => [id, claims.size])),
    ownDomainSourceRatio: citedSourceIds.length === 0 ? 0 : ownDomainCount / citedSourceIds.length,
    signalsWithDateCount: input.signals.filter((signal) => Boolean(signal.observedAt)).length,
    committeeMembersFound: input.committee.filter((member) => Boolean(member.name)).length,
    ...(input.modelTelemetry ? { modelTelemetry: input.modelTelemetry.slice(0, 100) } : {}),
  };
}

const REPORT_V2_EVIDENCE_STOPWORDS = new Set([
  'para', 'como', 'esta', 'este', 'esto', 'entre', 'desde', 'donde', 'cuando', 'porque',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'una', 'unos', 'unas', 'los', 'las',
]);

/** Deterministic, dependency-free text normalization for evidence dedup. */
export function normalizeReportV2EvidenceText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function reportV2EvidenceTokens(value: unknown): string[] {
  return normalizeReportV2EvidenceText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !REPORT_V2_EVIDENCE_STOPWORDS.has(token));
}

export function reportV2TokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let intersection = 0;
  new Set(left).forEach((token) => {
    if (rightSet.has(token)) intersection += 1;
  });
  return intersection / Math.max(new Set(left).size, rightSet.size);
}

/** Exact-match fact dedup. Keeps the first occurrence; input order defines winners. */
export function dedupeReportV2Facts(facts: FactV2[]): FactV2[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = normalizeReportV2EvidenceText(fact.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ReportV2ClaimProjectionBudget = {
  maxTotal?: number;
  maxPerDimension?: number;
};

/**
 * Semantic-ish deterministic claim dedup: same type + dimension with identical
 * normalized statements or token overlap >= 0.8 merge into one claim.
 * Provenance is preserved by unioning evidence ids; the stable id of the
 * first occurrence wins so existing short-id maps keep working.
 */
export function dedupeReportV2Claims(claims: ClaimV2[]): ClaimV2[] {
  const kept: ClaimV2[] = [];
  const normalizedStatements: string[] = [];
  const tokenSets: string[][] = [];
  claims.forEach((candidate) => {
    const normalizedStatement = normalizeReportV2EvidenceText(candidate.statement);
    const tokens = reportV2EvidenceTokens(candidate.statement);
    const duplicateIndex = kept.findIndex((existing, index) => (
      existing.type === candidate.type
      && existing.dimension === candidate.dimension
      && (
        normalizedStatements[index] === normalizedStatement
        || reportV2TokenOverlap(tokenSets[index], tokens) >= 0.8
      )
    ));
    if (duplicateIndex === -1) {
      kept.push(candidate);
      normalizedStatements.push(normalizedStatement);
      tokenSets.push(tokens);
      return;
    }
    const existing = kept[duplicateIndex];
    const winner = candidate.confidence > existing.confidence ? candidate : existing;
    kept[duplicateIndex] = {
      ...winner,
      id: existing.id,
      internalId: existing.internalId,
      evidenceIds: [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])].sort(),
      confidence: Math.max(existing.confidence, candidate.confidence),
    } as ClaimV2;
  });
  return kept;
}

/**
 * Deterministic ranking for the model-facing projection: confidence first,
 * then stable id. Caps per dimension and in total. The full payload passed
 * in is never mutated; pruning only affects this projection.
 */
export function pruneReportV2ClaimsForProjection(
  claims: ClaimV2[],
  budget: ReportV2ClaimProjectionBudget = {},
): ClaimV2[] {
  const maxTotal = Math.max(1, Math.trunc(Number(budget.maxTotal) || 60));
  const maxPerDimension = Math.max(1, Math.trunc(Number(budget.maxPerDimension) || 8));
  const ranked = [...dedupeReportV2Claims(claims)].sort((left, right) => (
    right.confidence - left.confidence || left.id.localeCompare(right.id)
  ));
  const perDimension = new Map<string, number>();
  const kept: ClaimV2[] = [];
  ranked.forEach((claim) => {
    const count = perDimension.get(claim.dimension) || 0;
    if (count >= maxPerDimension || kept.length >= maxTotal) return;
    perDimension.set(claim.dimension, count + 1);
    kept.push(claim);
  });
  return kept;
}

export type ReportV2ModelEvidenceProjection = {
  sources: SourceV2[];
  facts: FactV2[];
  claims: ClaimV2[];
  totals: { sources: number; facts: number; claims: number };
  pruned: { sources: number; facts: number; claims: number };
};

/**
 * Builds the model-facing evidence projection. Sources are restricted to the
 * ones backing projected facts; every input array is preserved untouched so
 * persisted payloads and audit provenance keep the full graph.
 */
export function projectReportV2ModelEvidence(input: {
  sources: SourceV2[];
  facts: FactV2[];
  claims: ClaimV2[];
  budget?: ReportV2ClaimProjectionBudget & { maxFacts?: number };
}): ReportV2ModelEvidenceProjection {
  const maxFacts = Math.max(1, Math.trunc(Number(input.budget?.maxFacts) || 80));
  // Keep canonical IDs and statements: text similarity must not move a citation
  // to another source or turn a conflicting figure into the same claim.
  const maxClaims = Math.max(1, Math.trunc(Number(input.budget?.maxTotal) || 60));
  const maxPerDimension = Math.max(1, Math.trunc(Number(input.budget?.maxPerDimension) || 8));
  const sourceIds = new Set(input.sources.map((source) => source.id));
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const candidates = [...input.claims].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  const selectedFactIds = new Set<string>();
  const selected = new Map<string, ClaimV2>();
  candidates.forEach((candidate) => {
    const closure = new Map<string, ClaimV2>();
    const visiting = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (selected.has(id) || closure.has(id)) return true;
      const claim = claimsById.get(id);
      if (!claim || (claim.type === 'fact' && !claim.evidenceIds.length)) return false;
      if (!claim.evidenceIds.every((factId) => {
        const fact = factsById.get(factId);
        return fact && sourceIds.has(fact.sourceId);
      })) return false;
      visiting.add(id);
      if (claim.type === 'derived' && !claim.inputs.every(visit)) return false;
      visiting.delete(id);
      closure.set(id, claim);
      return true;
    };
    if (!visit(candidate.id) || selected.size + closure.size > maxClaims) return;
    const nextFacts = new Set(selectedFactIds);
    const counts = new Map<string, number>();
    for (const claim of [...selected.values(), ...closure.values()]) {
      counts.set(claim.dimension, (counts.get(claim.dimension) || 0) + 1);
      claim.evidenceIds.forEach((id) => nextFacts.add(id));
    }
    if (nextFacts.size > maxFacts || [...counts.values()].some((count) => count > maxPerDimension)) return;
    closure.forEach((claim, id) => selected.set(id, claim));
    nextFacts.forEach((id) => selectedFactIds.add(id));
  });
  const claims = [...selected.values()];
  const projectedFacts = input.facts.filter((fact) => selectedFactIds.has(fact.id));
  const referencedSourceIds = new Set(projectedFacts.map((fact) => fact.sourceId));
  const sources = input.sources.filter((source) => referencedSourceIds.has(source.id));
  return {
    sources,
    facts: projectedFacts,
    claims,
    totals: { sources: input.sources.length, facts: input.facts.length, claims: input.claims.length },
    pruned: {
      sources: input.sources.length - sources.length,
      facts: input.facts.length - projectedFacts.length,
      claims: input.claims.length - claims.length,
    },
  };
}
