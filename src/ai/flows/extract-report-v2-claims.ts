import { z } from 'zod';

import { generateStructured } from '@/ai/openai-json';
import { reportGenerationOptions } from '@/ai/report-models';
import {
  ClaimDimensionV2Schema,
  ClaimV2Schema,
  assignShortClaimIds,
  type ClaimV2,
  type FactV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import type { ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { serializeReportV2Context } from './write-report-v2-section';

export const EXTRACT_REPORT_V2_CLAIMS_PROMPT_VERSION = 'report-v2/p3-claims/3';
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
const ModelClaimV2Schema = z.object({
  targetField: TargetFieldV2Schema,
  statement: z.string().trim().min(1).max(220),
  dimension: ClaimDimensionV2Schema,
  evidenceIds: z.array(z.string()).min(1),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  jurisdiction: z.enum(['CL', 'PE', 'CO', 'GLOBAL']).nullable(),
  scope: z.enum(['company', 'group', 'country', 'person', 'sector']).nullable(),
  confidence: z.number().finite().min(0).max(1),
}).strict();

export type ExtractedClaimDraftV2 = {
  internalId: string;
  type: 'fact';
  dimension: z.infer<typeof ClaimV2Schema>['dimension'];
  statement: string;
  evidenceIds: string[];
  observedAt: string | null;
  freshnessDays: number | null;
  jurisdiction: 'CL' | 'PE' | 'CO' | 'GLOBAL' | null;
  scope?: ClaimV2['scope'];
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
  return source.blocks.map((block, index) => ({
    id: buildStableReportV2Id('f', { sourceId: source.source.id, index, block }),
    sourceId: source.source.id,
    text: block,
    // Page metadata describes the source, not the date or country of each assertion.
    observedAt: null,
    jurisdiction: null,
    locator: `block:${index + 1}`,
  }));
}

function outputSchema(factIds: string[]) {
  const factId = z.enum(factIds as [string, ...string[]]);
  return z.object({
    claims: z.array(ModelClaimV2Schema.extend({
      evidenceIds: z.array(factId).min(1),
    })).max(100),
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
Jurisdiccion orientativa de la fuente, NO de cada hecho: ${input.sourceJurisdiction || 'desconocida'}
Contexto de proveedor, NO probatorio: ${serializeReportV2Context(input.providerContext)}
Claims ya existentes (no los dupliques): ${serializeReportV2Context(input.existingClaims)}
Evidencia: ${serializeReportV2Context(input.evidence)}

CAMPOS OBJETIVO. Extrae los que la evidencia sostenga y enumera los restantes en notFoundFields:

  years_operating | headcount_managed | client_count | countries | headquarters
  legal_form | industry | services | sectors_served | tech_stack
  executives (nombre + cargo) | certifications | recent_events (con fecha)

Para cada afirmacion produce:
- statement: autonoma, natural, comprensible fuera de contexto, maximo 220 caracteres.
- dimension: una de las dimensiones del esquema.
- evidenceIds: los IDs exactos que la respaldan. Sin esto, la afirmacion no existe.
- observedAt: fecha explicita del HECHO, o null si no consta. Conserva hechos evergreen (servicios, escala, sedes, forma legal, ejecutivos) sin inventarles fecha.
- jurisdiction: pais al que aplica el hecho explicitamente; GLOBAL para un alcance global o multinacional explicito, null si se desconoce.
- scope: company, group, country, person o sector segun lo que mide el hecho; null si se desconoce.
- confidence: 0 a 1. Baja el valor si la fuente es un agregador, contenido promocional propio o la unica fuente.

REGLAS ESTRICTAS:
- Usa exclusivamente hechos explicitos en la evidencia incluida.
- Extrae los NUMEROS: anos de operacion, colaboradores, clientes, sedes, montos y porcentajes.
- Extrae los NOMBRES PROPIOS de personas junto con su cargo.
- No completes cifras, clientes, sedes ni ingresos por conocimiento previo o suposicion.
- No conviertas anuncios, opiniones ni planes futuros en hechos actuales.
- Una cifra del grupo sigue siendo del grupo, aunque aparezca en una ruta /peru/. No atribuyas cifras globales al pais de la fuente o del contacto; tampoco repartas totales entre paises.
- Las fechas de publicacion, modificacion, copyright y scraping son metadatos: NO son fechas del hecho. En noticias usa la fecha del evento descrita en el cuerpo, no la fecha del articulo. Si no consta, observedAt es null.
- recent_events usa dimension signal SOLO para un cambio ocurrido, con fecha real explicita y relevancia comercial concreta: apertura, contrato, nombramiento, implantacion, regulacion o contratacion especifica. Si falta fecha o relevancia, no emitas una senal.
- Un perfil de LinkedIn, sus seguidores o personas asociadas, un titulo corporativo, un catalogo, navegacion o un listado generico de empleos NO son eventos ni senales. Los asociados de LinkedIn tampoco equivalen a colaboradores gestionados.
- No copies titulos, snippets, slogans, etiquetas de autor ni navegacion.
- El contexto de proveedor sirve solo para identidad y desambiguacion. Nunca respalda un claim ni sustituye un evidenceId.
- Ignora marcado HTML, rutas de archivo y URLs de assets.`;
}

function normalized(value: string) {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function claimKey(input: Omit<ExtractedClaimDraftV2, 'internalId'>) {
  return JSON.stringify([
    input.type, input.dimension, input.targetField, normalized(input.statement),
    input.jurisdiction, input.scope ?? null, input.observedAt,
  ]);
}

function draft(input: Omit<ExtractedClaimDraftV2, 'internalId'>): ExtractedClaimDraftV2 {
  return {
    ...input,
    internalId: buildStableReportV2Id('f', {
      claim: claimKey(input),
      evidenceIds: [...input.evidenceIds].sort(),
    }),
  };
}

function freshnessDays(observedAt: string | null, capturedAt: string) {
  if (!observedAt) return null;
  const value = Math.floor((Date.parse(capturedAt) - Date.parse(observedAt)) / 86_400_000);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function normalizeModelClaims(value: unknown, input: {
  source: ParsedWebEvidenceV2;
  facts: FactV2[];
  capturedAt: string;
}) {
  const factIds = new Set(input.facts.map((fact) => fact.id));
  const envelope = z.object({ claims: z.array(z.unknown()) }).safeParse(value);
  if (!envelope.success) return [];
  return envelope.data.claims.slice(0, 100).flatMap((claim) => {
    const parsed = ModelClaimV2Schema.safeParse(claim);
    if (!parsed.success) return [];
    const { targetField, scope, ...data } = parsed.data;
    const evidenceIds = [...new Set(data.evidenceIds)].sort();
    if (!evidenceIds.every((id) => factIds.has(id))) return [];
    if (data.observedAt !== null && !Number.isFinite(Date.parse(data.observedAt))) return [];
    const observedAt = data.observedAt === null ? null : new Date(data.observedAt).toISOString();
    if (data.dimension === 'signal' || targetField === 'recent_events') {
      if (data.dimension !== 'signal' || targetField !== 'recent_events' || !observedAt) return [];
      if (Date.parse(observedAt) > Date.parse(input.capturedAt)) return [];
      const labels = new Set([input.source.source.title, ...input.source.headings, ...input.source.links.map((link) => link.text)].map(normalized));
      if (input.facts.filter((fact) => evidenceIds.includes(fact.id)).every((fact) => labels.has(normalized(fact.text)))) return [];
      if (/\b(?:seguidores|followers|personas asociadas|miembros asociados|employees on linkedin)\b/.test(normalized(data.statement))) return [];
    }
    const candidate = draft({
      ...data,
      type: 'fact',
      targetField,
      ...(scope === null ? {} : { scope }),
      evidenceIds,
      observedAt,
      freshnessDays: freshnessDays(observedAt, input.capturedAt),
    });
    // targetField is extraction metadata, not part of the strict report claim contract.
    const { targetField: _targetField, ...reportClaim } = candidate;
    const valid = ClaimV2Schema.safeParse({ ...reportClaim, id: 'c00' });
    return valid.success ? [candidate] : [];
  });
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
  const schema = outputSchema(facts.map((fact) => fact.id));
  try {
    generated = await (dependencies.generate || generateStructured)({
      ...reportGenerationOptions('balanced'),
      systemPrompt: EXTRACT_REPORT_V2_CLAIMS_SYSTEM_PROMPT,
      prompt: buildExtractReportV2ClaimsPrompt({
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        sourceJurisdiction: input.source.source.jurisdiction,
        providerContext: input.providerContext,
        existingClaims: input.existingClaims,
        evidence: facts,
      }),
      schema,
      temperature: 0,
    });
  } catch {
    errorCode = 'claim_extraction_failed';
  }
  const claims = normalizeModelClaims(generated, { source: input.source, facts, capturedAt: input.capturedAt });
  const validated = schema.safeParse(generated);
  if (!errorCode && (!validated.success || validated.data.claims.length !== claims.length)) {
    errorCode = 'claim_extraction_invalid_output';
  }
  const found = new Set(claims.map((claim) => claim.targetField));
  return {
    source: input.source.source,
    facts,
    claims,
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

export type ClaimDraftProjectionBudget = {
  maxTotal?: number;
  maxPerTargetField?: number;
};

function draftTokens(statement: string): Set<string> {
  return new Set(
    normalized(statement)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  );
}

function draftTokenOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });
  return intersection / Math.max(left.size, right.size);
}

/**
 * Semantic-ish deterministic dedup for claim drafts. Near-duplicates (same
 * dimension + target field with token overlap >= 0.85) merge into the first
 * occurrence, unioning evidence ids and keeping the highest confidence, so
 * full provenance survives while the model-facing projection stays compact.
 */
export function dedupeExtractedClaimDrafts(drafts: ExtractedClaimDraftV2[]): ExtractedClaimDraftV2[] {
  const kept: ExtractedClaimDraftV2[] = [];
  const fingerprints: Array<{ statement: string; tokens: Set<string> }> = [];
  drafts.forEach((candidate) => {
    const statement = normalized(candidate.statement);
    const tokens = draftTokens(candidate.statement);
    const duplicateIndex = kept.findIndex((existing, index) => (
      existing.dimension === candidate.dimension
      && existing.targetField === candidate.targetField
      && (
        fingerprints[index].statement === statement
        || draftTokenOverlap(fingerprints[index].tokens, tokens) >= 0.85
      )
    ));
    if (duplicateIndex === -1) {
      kept.push(candidate);
      fingerprints.push({ statement, tokens });
      return;
    }
    const existing = kept[duplicateIndex];
    const winner = candidate.confidence > existing.confidence ? candidate : existing;
    kept[duplicateIndex] = {
      ...winner,
      internalId: existing.internalId,
      statement: winner.statement,
      evidenceIds: [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])].sort(),
      confidence: Math.max(existing.confidence, candidate.confidence),
    };
  });
  return kept;
}

/**
 * Deterministic cap for the model-facing draft projection: confidence first,
 * then target field and statement. Inputs are never mutated.
 */
export function pruneExtractedClaimDrafts(
  drafts: ExtractedClaimDraftV2[],
  budget: ClaimDraftProjectionBudget = {},
): ExtractedClaimDraftV2[] {
  const maxTotal = Math.max(1, Math.trunc(Number(budget.maxTotal) || 60));
  const maxPerTargetField = Math.max(1, Math.trunc(Number(budget.maxPerTargetField) || 6));
  const ranked = [...dedupeExtractedClaimDrafts(drafts)].sort((left, right) => (
    right.confidence - left.confidence
    || left.targetField.localeCompare(right.targetField)
    || left.statement.localeCompare(right.statement)
  ));
  const perField = new Map<string, number>();
  const kept: ExtractedClaimDraftV2[] = [];
  ranked.forEach((candidate) => {
    const count = perField.get(candidate.targetField) || 0;
    if (count >= maxPerTargetField || kept.length >= maxTotal) return;
    perField.set(candidate.targetField, count + 1);
    kept.push(candidate);
  });
  return kept;
}

/** Model-facing projection over drafts; the persisted draft list stays complete. */
export function projectExtractedClaimDraftsForModel(
  drafts: ExtractedClaimDraftV2[],
  budget: ClaimDraftProjectionBudget = {},
): { drafts: ExtractedClaimDraftV2[]; totals: { total: number }; pruned: number } {
  const projected = pruneExtractedClaimDrafts(drafts, budget);
  return { drafts: projected, totals: { total: drafts.length }, pruned: drafts.length - projected.length };
}

function numericValues(statement: string) {
  const pattern = /\b\d+(?:[.,]\d+)*\b/g;
  return {
    metric: normalized(statement).replace(pattern, '#'),
    values: (statement.match(pattern) || []).map((value) => Number(value.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '').replace(',', '.'))),
  };
}

export function consolidateReportV2Claims(input: {
  drafts: ExtractedClaimDraftV2[];
  facts: FactV2[];
}) {
  const factIds = new Set(input.facts.map((fact) => fact.id));
  const byStatement = new Map<string, ExtractedClaimDraftV2>();
  input.drafts.forEach((candidate) => {
    if (!candidate.evidenceIds.every((id) => factIds.has(id))) return;
    const key = claimKey(candidate);
    const existing = byStatement.get(key);
    if (!existing) {
      byStatement.set(key, candidate);
      return;
    }
    byStatement.set(key, draft({
      ...(candidate.confidence > existing.confidence ? candidate : existing),
      evidenceIds: [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])].sort(),
      confidence: Math.max(existing.confidence, candidate.confidence),
    }));
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
      if (!['years_operating', 'headcount_managed', 'client_count'].includes(left.targetField)) continue;
      if (!left.jurisdiction || left.jurisdiction !== right.jurisdiction || !left.scope || left.scope !== right.scope) continue;
      if (!left.observedAt || !right.observedAt || Date.parse(left.observedAt) !== Date.parse(right.observedAt)) continue;
      const leftNumbers = numericValues(left.statement);
      const rightNumbers = numericValues(right.statement);
      if (leftNumbers.metric === rightNumbers.metric && leftNumbers.values.length > 0 && leftNumbers.values.join('|') !== rightNumbers.values.join('|')) {
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
