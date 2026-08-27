import { createHash } from 'node:crypto';

import { z } from 'genkit';

import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import {
  ResearchClaimV1Schema,
  ResearchSnapshotV1Schema,
  type ResearchClaimV1,
  type ResearchSnapshotV1,
} from '@/lib/research-contracts';
import {
  isQualifiedResearchFactEvidence,
  researchTextKey,
} from '@/lib/research-fact-eligibility';

export const COMPANY_RESEARCH_ENRICHMENT_PROMPT_VERSION = 'company-research-enrichment/v1';

const CompanyProfileClaimSchema = z.object({
  kind: z.enum(['company_overview', 'company_industry', 'company_service', 'company_size']),
  statement: z.string().trim().min(12).max(600),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceIds: z.array(z.string().trim().min(1)).min(1).max(4),
}).strict();

const CompanyProfileOutputSchema = z.object({
  claims: z.array(CompanyProfileClaimSchema).max(10),
}).strict();

type CompanyProfileCandidate = z.infer<typeof CompanyProfileClaimSchema>;

function claimId(kind: CompanyProfileCandidate['kind'], statement: string) {
  const digest = createHash('sha256').update(`${kind}:${statement}`).digest('hex').slice(0, 24);
  return `claim:company-ai:${digest}`;
}

function confidenceValue(value: CompanyProfileCandidate['confidence'], sourceCount: number) {
  const requested = value === 'high' ? 0.88 : value === 'medium' ? 0.76 : 0.61;
  return sourceCount > 1 ? requested : Math.min(requested, 0.78);
}

function addDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1_000).toISOString();
}

export function mergeCompanyResearchClaimsV1(input: {
  snapshot: ResearchSnapshotV1;
  candidates: CompanyProfileCandidate[];
  model: string;
}) {
  const sourceById = new Map(input.snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(input.snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  const claims = [...input.snapshot.claims];
  const seen = new Set(claims.map((claim) => `${claim.kind}:${researchTextKey(claim.statement)}`));
  const countByKind = new Map<string, number>();
  claims.forEach((claim) => countByKind.set(claim.kind, (countByKind.get(claim.kind) || 0) + 1));

  for (const candidate of input.candidates) {
    if ((countByKind.get(candidate.kind) || 0) >= 3) continue;
    const key = `${candidate.kind}:${researchTextKey(candidate.statement)}`;
    if (seen.has(key)) continue;

    const supportingEvidence = [...new Set(candidate.evidenceIds)]
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is NonNullable<typeof evidence> => Boolean(
        evidence
        && evidence.subjectScope === 'company'
        && isQualifiedResearchFactEvidence({
          evidence,
          source: sourceById.get(evidence.sourceId),
          companyName: input.snapshot.subject.company.name,
          companyDomain: input.snapshot.subject.company.domain,
        }),
      ));
    if (supportingEvidence.length === 0) continue;

    const sourceCount = new Set(supportingEvidence.map((evidence) => evidence.sourceId)).size;
    const asOf = supportingEvidence
      .map((evidence) => evidence.observedAt || evidence.extractedAt)
      .sort()
      .at(-1) || input.snapshot.updatedAt;
    const claim: ResearchClaimV1 = ResearchClaimV1Schema.parse({
      id: claimId(candidate.kind, candidate.statement),
      kind: candidate.kind,
      subjectScope: 'company',
      classification: 'fact',
      statement: candidate.statement,
      supportingEvidenceIds: supportingEvidence.map((evidence) => evidence.id),
      contradictingEvidenceIds: [],
      confidence: confidenceValue(candidate.confidence, sourceCount),
      freshness: {
        asOf,
        validUntil: addDays(asOf, candidate.kind === 'company_size' ? 30 : 90),
        policyVersion: 'research-freshness/v1',
      },
      derivation: {
        method: 'model',
        model: input.model,
        promptVersion: COMPANY_RESEARCH_ENRICHMENT_PROMPT_VERSION,
      },
    });
    claims.push(claim);
    seen.add(key);
    countByKind.set(candidate.kind, (countByKind.get(candidate.kind) || 0) + 1);
  }

  return ResearchSnapshotV1Schema.parse({
    ...input.snapshot,
    claims,
    updatedAt: new Date().toISOString(),
  });
}

function buildPrompt(snapshot: ResearchSnapshotV1) {
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidence = snapshot.evidence
    .filter((item) => {
      const source = sourceById.get(item.sourceId);
      return item.subjectScope === 'company'
        && Boolean(source)
        && source?.provider !== 'lead-input'
        && ['fact', 'quote'].includes(item.kind);
    })
    .slice(0, 20)
    .map((item) => {
      const source = sourceById.get(item.sourceId)!;
      return {
        evidenceId: item.id,
        statement: item.statement,
        source: {
          title: source.title || null,
          url: source.url,
          type: source.type,
          publisher: source.publisher || null,
        },
      };
    });

  return [
    'Eres un analista de investigación empresarial. Convierte evidencia web en un perfil verificable y conciso.',
    'Devuelve solo JSON válido con la forma {"claims": [...]}.',
    'Cada claim debe usar uno de estos tipos: company_overview, company_industry, company_service, company_size.',
    'company_overview explica qué hace la empresa; company_service identifica ofertas concretas; company_industry describe el mercado; company_size resume escala observable.',
    'Reglas estrictas:',
    '- Usa exclusivamente hechos explícitos en la evidencia incluida.',
    '- No completes cifras, clientes, sedes, ingresos ni productos por conocimiento previo o suposición.',
    '- Cada statement debe ser autónomo, natural y entendible para un usuario comercial.',
    '- Incluye los evidenceIds exactos que respaldan cada afirmación.',
    '- Si una dimensión no está respaldada, no crees un claim para ella.',
    '- No conviertas anuncios, opiniones o planes en hechos actuales.',
    '- Evita duplicar las afirmaciones existentes.',
    '',
    `Empresa: ${snapshot.subject.company.name || 'No identificada'}`,
    `Dominio: ${snapshot.subject.company.domain || 'No disponible'}`,
    `Claims existentes: ${JSON.stringify(snapshot.claims.filter((claim) => claim.subjectScope === 'company').map((claim) => ({ kind: claim.kind, statement: claim.statement })))}`,
    `Evidencia: ${JSON.stringify(evidence)}`,
  ].join('\n');
}

export async function enrichCompanyResearchSnapshotV1(snapshot: ResearchSnapshotV1) {
  const eligibleEvidenceCount = snapshot.evidence.filter((item) => item.subjectScope === 'company' && ['fact', 'quote'].includes(item.kind)).length;
  if (eligibleEvidenceCount === 0 || !String(process.env.OPENAI_API_KEY || '').trim()) return snapshot;

  try {
    const result = await generateStructuredWithTelemetry({
      provider: 'openai',
      openAiModel: process.env.COMPANY_RESEARCH_OPENAI_MODEL
        || process.env.NATIVE_RESEARCH_REPORT_MODEL
        || process.env.SUPLIA_OPENAI_REASONING_MODEL
        || process.env.OPENAI_REASONING_MODEL
        || 'gpt-5.6-terra',
      temperature: 0.1,
      schema: CompanyProfileOutputSchema,
      prompt: buildPrompt(snapshot),
    });
    return mergeCompanyResearchClaimsV1({
      snapshot,
      candidates: result.data.claims,
      model: result.telemetry.modelName,
    });
  } catch (error) {
    console.warn('[company-research-enrichment] model enrichment unavailable:', error);
    return snapshot;
  }
}

export const companyResearchEnrichmentInternals = { buildPrompt, confidenceValue };
