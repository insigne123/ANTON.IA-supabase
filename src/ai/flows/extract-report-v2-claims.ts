import { z } from 'zod';

import { generateStructured } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
import {
  ClaimV2Schema,
  assignShortClaimIds,
  type ClaimV2,
  type FactV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import { truncateAtWord, type ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';

export const EXTRACT_REPORT_V2_CLAIMS_PROMPT_VERSION = 'report-v2/p3-claims/1';
export const REPORT_V2_TARGET_FIELDS = [
  'years_operating',
  'headcount_managed',
  'client_count',
  'countries',
  'headquarters',
  'legal_form',
  'industry',
  'services',
  'sectors_served',
  'tech_stack',
  'executives',
  'certifications',
  'recent_events',
] as const;

const TargetFieldV2Schema = z.enum(REPORT_V2_TARGET_FIELDS);

export type ExtractedClaimDraftV2 = {
  internalId: string;
  type: 'fact';
  dimension: z.infer<typeof ClaimV2Schema>['dimension'];
  statement: string;
  evidenceIds: string[];
  observedAt: string;
  freshnessDays: number | null;
  jurisdiction: 'CL' | 'PE' | 'CO' | 'GLOBAL' | null;
  confidence: number;
  targetField: z.infer<typeof TargetFieldV2Schema>;
};

export type SourceClaimExtractionV2 = {
  source: SourceV2;
  facts: FactV2[];
  claims: ExtractedClaimDraftV2[];
  notFoundFields: Array<z.infer<typeof TargetFieldV2Schema>>;
  errorCode: string | null;
};

export const EXTRACT_REPORT_V2_CLAIMS_SYSTEM_PROMPT = `Eres un analista de investigacion empresarial. Conviertes evidencia web en afirmaciones verificables y
autonomas. Devuelves unicamente afirmaciones que la evidencia sostiene de forma explicita.`;

function factsFromSource(source: ParsedWebEvidenceV2): FactV2[] {
  const observedAt = source.source.publishedAt || source.source.modifiedAt;
  return source.blocks.map((block, index) => ({
    id: buildStableReportV2Id('f', { sourceId: source.source.id, index, block }),
    sourceId: source.source.id,
    text: block,
    observedAt,
    jurisdiction: source.source.jurisdiction,
    locator: `block:${index + 1}`,
  }));
}

function outputSchema(factIds: string[]) {
  const factId = z.enum(factIds as [string, ...string[]]);
  return z.object({
    claims: z.array(z.object({
      targetField: TargetFieldV2Schema,
      statement: z.string().trim().min(1).max(220),
      dimension: z.enum([
        'contact_role', 'contact_tenure', 'contact_authority', 'company_overview', 'company_industry',
        'company_service', 'company_size', 'company_geography', 'company_legal_form', 'company_tech',
        'buying_committee', 'signal', 'regulatory', 'volume_estimate', 'competitor', 'risk',
      ]),
      evidenceIds: z.array(factId).min(1),
      observedAt: z.string().datetime({ offset: true }).nullable(),
      jurisdiction: z.enum(['CL', 'PE', 'CO', 'GLOBAL']).nullable(),
      confidence: z.number().finite().min(0).max(1),
    }).strict()).max(100),
    notFoundFields: z.array(TargetFieldV2Schema),
  }).strict();
}

export function buildExtractReportV2ClaimsPrompt(input: {
  companyName: string;
  companyDomain: string;
  sourceJurisdiction: SourceV2['jurisdiction'];
  providerContext: unknown;
  existingClaims: unknown;
  evidence: unknown;
}) {
  return `Empresa: ${input.companyName}
Dominio: ${input.companyDomain}
Jurisdiccion de esta fuente: ${input.sourceJurisdiction || 'GLOBAL'}
Contexto de proveedor, NO probatorio: ${JSON.stringify(input.providerContext)}
Claims ya existentes (no los dupliques): ${JSON.stringify(input.existingClaims)}
Evidencia: ${JSON.stringify(input.evidence)}

CAMPOS OBJETIVO. Intenta llenar cada uno. Si la evidencia no lo sostiene, devuelvelo explicitamente como not_found, no lo omitas en silencio:

  years_operating | headcount_managed | client_count | countries | headquarters
  legal_form | industry | services | sectors_served | tech_stack
  executives (nombre + cargo) | certifications | recent_events (con fecha)

Para cada afirmacion produce:
- statement: autonoma, natural, comprensible fuera de contexto, maximo 220 caracteres.
- dimension: una de las dimensiones del esquema.
- evidenceIds: los IDs exactos que la respaldan. Sin esto, la afirmacion no existe.
- observedAt: la fecha del HECHO, no la del scraping. Obligatoria para cualquier evento o declaracion.
- jurisdiction: el pais al que aplica esta afirmacion, o GLOBAL.
- confidence: 0 a 1. Baja el valor si la fuente es un agregador, contenido promocional propio o la unica fuente.

REGLAS ESTRICTAS:
- Usa exclusivamente hechos explicitos en la evidencia incluida.
- Extrae los NUMEROS: anos de operacion, colaboradores, clientes, sedes, montos y porcentajes.
- Extrae los NOMBRES PROPIOS de personas junto con su cargo.
- No completes cifras, clientes, sedes ni ingresos por conocimiento previo o suposicion.
- No conviertas anuncios, opiniones ni planes futuros en hechos actuales.
- No copies titulos, snippets, slogans, etiquetas de autor ni navegacion.
- El contexto de proveedor sirve solo para identidad y desambiguacion. Nunca respalda un claim ni sustituye un evidenceId.
- Ignora marcado HTML, rutas de archivo y URLs de assets.`;
}

function normalized(value: string) {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function draft(input: Omit<ExtractedClaimDraftV2, 'internalId'>): ExtractedClaimDraftV2 {
  return {
    ...input,
    internalId: buildStableReportV2Id('f', {
      statement: normalized(input.statement),
      evidenceIds: [...input.evidenceIds].sort(),
    }),
  };
}

function extractExplicitClaims(input: {
  companyName: string;
  source: ParsedWebEvidenceV2;
  facts: FactV2[];
  capturedAt: string;
}) {
  const claims: ExtractedClaimDraftV2[] = [];
  const escapedCompany = input.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  input.facts.forEach((fact) => {
    const plain = normalized(fact.text);
    const observedAt = fact.observedAt;
    if (!observedAt) return;
    const numberFor = (pattern: RegExp) => {
      const match = plain.match(pattern);
      if (!match) return null;
      const value = Number(match[1].replace(/[.,]/g, ''));
      return Number.isFinite(value) ? value : null;
    };
    const collaborators = numberFor(/([\d.,]+)\s+colaboradores/);
    if (collaborators != null) claims.push(draft({
      type: 'fact', dimension: 'company_size', targetField: 'headcount_managed',
      statement: `${input.companyName} gestiona ${/mas de\s+[\d.,]+\s+colaboradores/.test(plain) ? 'mas de ' : ''}${collaborators} colaboradores.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: fact.jurisdiction, confidence: 0.82,
    }));
    const clients = numberFor(/([\d.,]+)\s+clientes/);
    if (clients != null) claims.push(draft({
      type: 'fact', dimension: 'company_size', targetField: 'client_count',
      statement: `${input.companyName} declara trabajar con ${/mas de\s+[\d.,]+\s+clientes/.test(plain) ? 'mas de ' : ''}${clients} clientes${plain.includes('chile') ? ' en Chile' : ''}.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: plain.includes('chile') ? 'CL' : fact.jurisdiction, confidence: 0.8,
    }));
    const years = numberFor(/([\d.,]+)\s+anos de operacion/);
    if (years != null) claims.push(draft({
      type: 'fact', dimension: 'company_overview', targetField: 'years_operating',
      statement: `${input.companyName} declara ${/mas de\s+[\d.,]+\s+anos de operacion/.test(plain) ? 'mas de ' : ''}${years} anos de operacion.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: fact.jurisdiction, confidence: 0.8,
    }));
    if (/operaciones en chile, peru y colombia/.test(plain)) claims.push(draft({
      type: 'fact', dimension: 'company_geography', targetField: 'countries',
      statement: `${input.companyName} declara operaciones en Chile, Peru y Colombia.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: 'GLOBAL', confidence: 0.8,
    }));
    const headquarters = fact.text.match(/sede en ([^.]+)/i);
    if (headquarters) claims.push(draft({
      type: 'fact', dimension: 'company_geography', targetField: 'headquarters',
      statement: `${input.companyName} declara su sede en ${headquarters[1].trim()}.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: fact.jurisdiction, confidence: 0.8,
    }));
    const executive = fact.text.match(new RegExp(`^([A-Z][\\p{L}-]+(?:\\s+[A-Z][\\p{L}-]+){1,4}),\\s+([^,]+?)\\s+de\\s+${escapedCompany}`, 'iu'));
    if (executive) claims.push(draft({
      type: 'fact', dimension: 'buying_committee', targetField: 'executives',
      statement: `${executive[1]} es ${executive[2]} de ${input.companyName}.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: fact.jurisdiction, confidence: 0.86,
    }));
    if (/\b(?:est|empresa de servicios transitorios)\b/.test(plain) && /ley\s+20[.]?123/.test(plain)) claims.push(draft({
      type: 'fact', dimension: 'company_legal_form', targetField: 'legal_form',
      statement: `${input.companyName} opera como empresa de servicios transitorios bajo la Ley 20.123 en Chile.`, evidenceIds: [fact.id], observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt), jurisdiction: 'CL', confidence: 0.85,
    }));
  });
  const signalDate = input.source.source.publishedAt;
  if (signalDate && (
    input.source.source.sourceType === 'press'
    || /vacante|reconoc|registro|expansi|contratacion/i.test(`${input.source.source.title} ${input.source.text}`)
  )) {
    const signalFact = input.facts.find((fact) => normalized(fact.text) !== normalized(input.source.source.title)) || input.facts[0];
    if (signalFact) claims.push(draft({
      type: 'fact', dimension: 'signal', targetField: 'recent_events',
      statement: truncateAtWord(
        signalFact.text.replace(input.source.source.title, '').trim() || `La fuente reporta una senal fechada para ${input.companyName}.`,
        220,
      ),
      evidenceIds: [signalFact.id], observedAt: signalDate,
      freshnessDays: freshnessDays(signalDate, input.capturedAt), jurisdiction: input.source.source.jurisdiction, confidence: input.source.source.ownDomain ? 0.7 : 0.82,
    }));
  }
  return claims;
}

function freshnessDays(observedAt: string, capturedAt: string) {
  const value = Math.floor((Date.parse(capturedAt) - Date.parse(observedAt)) / 86_400_000);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function normalizeModelClaims(value: unknown, input: {
  source: ParsedWebEvidenceV2;
  facts: FactV2[];
  capturedAt: string;
}) {
  const factIds = new Set(input.facts.map((fact) => fact.id));
  const claims = (Array.isArray((value as any)?.claims) ? (value as any).claims : []).flatMap((claim: any) => {
    const evidenceIds: string[] = [...new Set<string>((Array.isArray(claim?.evidenceIds) ? claim.evidenceIds : [])
      .map((id: unknown) => String(id || '').trim()).filter((id: string) => factIds.has(id)))];
    const sourceDate = input.source.source.publishedAt || input.source.source.modifiedAt;
    const observedAt = claim?.observedAt || sourceDate;
    if (!observedAt || evidenceIds.length === 0) return [];
    const parsed = z.object({
      targetField: TargetFieldV2Schema,
      statement: z.string().trim().min(1).max(220),
      dimension: z.enum([
        'contact_role', 'contact_tenure', 'contact_authority', 'company_overview', 'company_industry',
        'company_service', 'company_size', 'company_geography', 'company_legal_form', 'company_tech',
        'buying_committee', 'signal', 'regulatory', 'volume_estimate', 'competitor', 'risk',
      ]),
      jurisdiction: z.enum(['CL', 'PE', 'CO', 'GLOBAL']).nullable(),
      confidence: z.number().finite().min(0).max(1),
    }).safeParse(claim);
    if (!parsed.success) return [];
    const candidate = draft({
      ...parsed.data,
      type: 'fact',
      evidenceIds,
      observedAt: new Date(observedAt).toISOString(),
      freshnessDays: freshnessDays(observedAt, input.capturedAt),
    });
    const valid = ClaimV2Schema.safeParse({ ...candidate, id: 'c00' });
    return valid.success ? [candidate] : [];
  });
  return claims;
}

export async function extractClaimsFromSourceV2(input: {
  companyName: string;
  companyDomain: string;
  source: ParsedWebEvidenceV2;
  providerContext: unknown;
  existingClaims: unknown;
  capturedAt: string;
}, dependencies: {
  generate?: typeof generateStructured;
} = {}): Promise<SourceClaimExtractionV2> {
  const facts = factsFromSource(input.source);
  if (facts.length === 0) {
    return { source: input.source.source, facts, claims: [], notFoundFields: [...REPORT_V2_TARGET_FIELDS], errorCode: 'empty_source' };
  }
  let generated: unknown = null;
  let errorCode: string | null = null;
  try {
    generated = await (dependencies.generate || generateStructured)({
      provider: 'openai',
      openAiModels: getOpenAiModelsForTier('balanced'),
      systemPrompt: EXTRACT_REPORT_V2_CLAIMS_SYSTEM_PROMPT,
      prompt: buildExtractReportV2ClaimsPrompt({
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        sourceJurisdiction: input.source.source.jurisdiction,
        providerContext: input.providerContext,
        existingClaims: input.existingClaims,
        evidence: facts,
      }),
      schema: outputSchema(facts.map((fact) => fact.id)),
      temperature: 0,
    });
  } catch {
    errorCode = 'claim_extraction_failed';
  }
  const claims = [
    ...normalizeModelClaims(generated, { source: input.source, facts, capturedAt: input.capturedAt }),
    ...extractExplicitClaims({ companyName: input.companyName, source: input.source, facts, capturedAt: input.capturedAt }),
  ];
  const deduplicated = [...new Map(claims.map((claim) => [normalized(claim.statement), claim])).values()];
  const found = new Set(deduplicated.map((claim) => claim.targetField));
  return {
    source: input.source.source,
    facts,
    claims: deduplicated,
    notFoundFields: REPORT_V2_TARGET_FIELDS.filter((field) => !found.has(field)),
    errorCode,
  };
}

export async function extractClaimsFromSourcesV2(input: {
  companyName: string;
  companyDomain: string;
  sources: ParsedWebEvidenceV2[];
  providerContext: unknown;
  capturedAt: string;
}, dependencies: {
  generate?: typeof generateStructured;
} = {}) {
  const results = await Promise.all(input.sources.map((source) => extractClaimsFromSourceV2({
    ...input,
    source,
    existingClaims: [],
  }, dependencies).catch(() => ({
    source: source.source,
    facts: factsFromSource(source),
    claims: [],
    notFoundFields: [...REPORT_V2_TARGET_FIELDS],
    errorCode: 'source_processing_failed',
  } satisfies SourceClaimExtractionV2))));
  return {
    results,
    sources: results.map((result) => result.source),
    facts: results.flatMap((result) => result.facts),
    claimDrafts: results.flatMap((result) => result.claims),
    failedSourceIds: results.filter((result) => result.errorCode).map((result) => result.source.id),
  };
}

export type ClaimConflictV2 = {
  dimension: ClaimV2['dimension'];
  claimInternalIds: string[];
  reason: string;
};

function numericValues(statement: string) {
  return (statement.match(/\b\d+(?:[.,]\d+)?\b/g) || []).map((value) => value.replace(/[.,]/g, ''));
}

export function consolidateReportV2Claims(input: {
  drafts: ExtractedClaimDraftV2[];
  facts: FactV2[];
}) {
  const factIds = new Set(input.facts.map((fact) => fact.id));
  const byStatement = new Map<string, ExtractedClaimDraftV2>();
  input.drafts.forEach((candidate) => {
    if (!candidate.evidenceIds.every((id) => factIds.has(id))) return;
    const key = `${candidate.type}:${candidate.dimension}:${normalized(candidate.statement)}`;
    const existing = byStatement.get(key);
    if (!existing) {
      byStatement.set(key, candidate);
      return;
    }
    byStatement.set(key, {
      ...(candidate.confidence > existing.confidence ? candidate : existing),
      evidenceIds: [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])],
      confidence: Math.max(existing.confidence, candidate.confidence),
    });
  });
  const stableDrafts = [...byStatement.values()].sort((left, right) => (
    left.dimension.localeCompare(right.dimension)
    || left.statement.localeCompare(right.statement)
    || left.internalId.localeCompare(right.internalId)
  ));
  const assigned = assignShortClaimIds(stableDrafts);
  const claims = assigned.claims.flatMap(({ targetField: _targetField, ...claim }) => {
    const parsed = ClaimV2Schema.safeParse(claim);
    return parsed.success ? [parsed.data] : [];
  });
  const acceptedClaimIds = new Set(claims.map((claim) => claim.id));
  const shortIdMap = Object.fromEntries(Object.entries(assigned.shortIdMap).filter(([id]) => acceptedClaimIds.has(id)));
  const conflicts: ClaimConflictV2[] = [];
  for (let leftIndex = 0; leftIndex < stableDrafts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stableDrafts.length; rightIndex += 1) {
      const left = stableDrafts[leftIndex];
      const right = stableDrafts[rightIndex];
      if (left.dimension !== right.dimension || left.targetField !== right.targetField) continue;
      const leftNumbers = numericValues(left.statement);
      const rightNumbers = numericValues(right.statement);
      if (leftNumbers.length > 0 && rightNumbers.length > 0 && leftNumbers.join('|') !== rightNumbers.join('|')) {
        conflicts.push({
          dimension: left.dimension,
          claimInternalIds: [left.internalId, right.internalId],
          reason: `conflicting_numeric_values:${left.targetField}`,
        });
      }
    }
  }
  return { claims, shortIdMap, conflicts };
}
