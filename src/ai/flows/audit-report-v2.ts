import { z } from 'zod';

import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
import {
  ReportV2SectionKeySchema,
  type ClaimV2,
  type ReportV2SectionKey,
  type SectionV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { stripInternalIdsForReportPrompt } from './write-report-v2-section';

export const AUDIT_REPORT_V2_PROMPT_VERSION = 'report-v2/p7-audit/1';

export const AuditIssueTypeV2Schema = z.enum([
  'duplication',
  'truncated',
  'technical_noise',
  'literal_copy',
  'invalid_citation',
  'jurisdiction',
  'hard_hypothesis',
  'generic',
]);

export const AuditIssueV2Schema = z.object({
  section: ReportV2SectionKeySchema,
  paragraphIndex: z.number().int().nonnegative().nullable(),
  type: AuditIssueTypeV2Schema,
  fragment: z.string().trim().min(1).max(1_000),
  severity: z.enum(['block', 'warn']),
}).strict();

export const AuditOutputV2Schema = z.object({
  issues: z.array(AuditIssueV2Schema).max(200),
}).strict();

export type AuditIssueV2 = z.infer<typeof AuditIssueV2Schema>;

export const AUDIT_REPORT_V2_SYSTEM_PROMPT = 'Eres el auditor de calidad del reporte. No escribes ni corriges: detectas defectos y los reportas.';

export function buildAuditReportV2Prompt(input: {
  sections: SectionV2[];
  claimIds: string[];
  contactCountry: string;
}) {
  return `Secciones a auditar: ${JSON.stringify(stripInternalIdsForReportPrompt(input.sections))}
Claims validos: ${JSON.stringify(input.claimIds)}
Jurisdiccion del contacto: ${input.contactCountry}

Revisa cada parrafo y reporta todo defecto con su ubicacion exacta:

1. DUPLICACION: frases repetidas o solapadas dentro del mismo parrafo.
2. TRUNCADO: el parrafo termina a mitad de palabra o frase.
3. RUIDO TECNICO: HTML, clases CSS, rutas de archivo o URLs de assets.
4. COPIA LITERAL: reproduce el titulo, snippet o slogan de una fuente.
5. CITA INVALIDA: claimIds inexistentes o parrafos sin citas.
6. JURISDICCION: aplica otro pais a ${input.contactCountry} sin marcar contexto de casa matriz.
7. HIPOTESIS DURA: una conjetura aparece como hecho confirmado.
8. VACUIDAD: no contiene ningun dato especifico de la cuenta.

Por defecto devuelve seccion, indice, tipo, fragmento y severidad block o warn. Block obliga a regenerar la seccion. No propongas correcciones.`;
}

function normalized(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(left: string, right: string) {
  const leftTerms = new Set(normalized(left).split(' ').filter(Boolean));
  const rightTerms = new Set(normalized(right).split(' ').filter(Boolean));
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return intersection / Math.max(leftTerms.size, rightTerms.size);
}

function duplicatedFragment(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = Math.min(12, Math.floor(words.length / 2)); size >= 3; size -= 1) {
    const seen = new Set<string>();
    for (let index = 0; index <= words.length - size; index += 1) {
      const fragment = normalized(words.slice(index, index + size).join(' '));
      if (fragment.length <= 20) continue;
      if (seen.has(fragment)) return words.slice(index, index + size).join(' ');
      seen.add(fragment);
    }
  }
  return null;
}

export function deterministicAuditReportV2(input: {
  sections: SectionV2[];
  claims: ClaimV2[];
  sources: SourceV2[];
  sourceSnippets?: string[];
  contactCountry: string;
}): AuditIssueV2[] {
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const literalCandidates = [
    ...input.sources.map((source) => source.title),
    ...(input.sourceSnippets || []),
  ];
  const issues: AuditIssueV2[] = [];
  input.sections.forEach((section) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      const add = (type: AuditIssueV2['type'], fragment: string, severity: AuditIssueV2['severity']) => {
        issues.push({ section: section.key, paragraphIndex, type, fragment: fragment.slice(0, 1_000), severity });
      };
      const duplicate = duplicatedFragment(paragraph.text);
      if (duplicate) add('duplication', duplicate, 'block');
      if (!/[.!?:;)]$/.test(paragraph.text.trim())) add('truncated', paragraph.text.slice(-120), 'block');
      const noise = paragraph.text.match(/<[^>]*>|wp-content\S*|elementor\S*|hummingbird\S*|\/assets\/\S*|https?:\/\/\S+/i)?.[0];
      if (noise) add('technical_noise', noise, 'block');
      const copied = literalCandidates.find((candidate) => candidate.length >= 20 && similarity(paragraph.text, candidate) > 0.8);
      if (copied) add('literal_copy', copied, 'block');
      if (paragraph.claimIds.length === 0) add('invalid_citation', paragraph.text.slice(0, 160), 'block');
      paragraph.claimIds.forEach((claimId) => {
        const claim = claimsById.get(claimId);
        if (!claim) {
          add('invalid_citation', claimId, 'block');
          return;
        }
        if (
          section.key === 'fit'
          && paragraph.context !== 'headquarters'
          && claim.jurisdiction
          && claim.jurisdiction !== 'GLOBAL'
          && claim.jurisdiction !== input.contactCountry
        ) add('jurisdiction', claimId, 'block');
        if (
          claim.type === 'hypothesis'
          && !/\b(?:podria|puede|posible|hipotesis|por validar|conviene validar|habria que validar)\b|\?/i.test(normalized(paragraph.text))
        ) add('hard_hypothesis', paragraph.text.slice(0, 200), 'block');
      });
    });
  });
  return issues;
}

function deduplicateIssues(issues: AuditIssueV2[]) {
  return [...new Map(issues.map((issue) => [
    `${issue.section}:${issue.paragraphIndex}:${issue.type}:${normalized(issue.fragment)}`,
    issue,
  ])).values()];
}

export async function auditReportV2(input: {
  sections: SectionV2[];
  claims: ClaimV2[];
  sources: SourceV2[];
  sourceSnippets?: string[];
  contactCountry: string;
  writerModels: string[];
}, dependencies: {
  generate?: typeof generateStructuredWithTelemetry;
} = {}) {
  const models = [...new Set([
    ...getOpenAiModelsForTier('critical'),
    ...getOpenAiModelsForTier('reasoning'),
  ])].filter((model) => !input.writerModels.includes(model));
  if (models.length === 0) throw new Error('REPORT_V2_DISTINCT_AUDITOR_MODEL_REQUIRED');
  const deterministicIssues = deterministicAuditReportV2(input);
  const generated = await (dependencies.generate || generateStructuredWithTelemetry)({
    provider: 'openai',
    openAiModels: models,
    systemPrompt: AUDIT_REPORT_V2_SYSTEM_PROMPT,
    prompt: buildAuditReportV2Prompt({
      sections: input.sections,
      claimIds: input.claims.map((claim) => claim.id),
      contactCountry: input.contactCountry,
    }),
    schema: AuditOutputV2Schema,
    temperature: 0,
  });
  if (input.writerModels.includes(generated.telemetry.modelName)) throw new Error('REPORT_V2_AUDITOR_MODEL_COLLISION');
  const issues = deduplicateIssues([...deterministicIssues, ...generated.data.issues]);
  return {
    model: generated.telemetry.modelName,
    issues,
    blockingSections: [...new Set(issues.filter((issue) => issue.severity === 'block').map((issue) => issue.section))],
    telemetry: generated.telemetry,
  };
}

export async function rewriteBlockingReportV2SectionsOnce(input: {
  sections: SectionV2[];
  blockingSections: ReportV2SectionKey[];
  rewrite: (section: SectionV2) => Promise<SectionV2 | null>;
}) {
  const blocked = new Set(input.blockingSections);
  const rewritten: ReportV2SectionKey[] = [];
  const sections = await Promise.all(input.sections.map(async (section) => {
    if (!blocked.has(section.key)) return section;
    rewritten.push(section.key);
    return await input.rewrite(section) || section;
  }));
  return { sections, rewritten };
}
