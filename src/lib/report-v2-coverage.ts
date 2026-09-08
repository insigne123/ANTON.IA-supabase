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
}) {
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
