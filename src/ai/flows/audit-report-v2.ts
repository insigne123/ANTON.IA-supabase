import { z } from 'zod';

import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { reportGenerationOptions } from '@/ai/report-models';
import {
  ReportV2SectionKeySchema,
  type ClaimV2,
  type ReportV2SectionKey,
  type SectionV2,
  type SourceV2,
  type FactV2,
  type EntityResolutionV2,
} from '@/lib/report-v2-contracts';
import { serializeReportV2Context } from './write-report-v2-section';
import type { SellerProfileContextV2 } from './reason-about-report-v2-account';

export const AUDIT_REPORT_V2_PROMPT_VERSION = 'report-v2/p7-audit/7';

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
  type: AuditIssueTypeV2Schema.describe('hard_hypothesis incluye experiencia, traccion, clientes, conversaciones o resultados del vendedor no respaldados, incluso en aperturas sugeridas. generic incluye falta de metrica por piloto o falta de personalizacion por cargo.'),
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
  claims?: ClaimV2[];
  facts?: FactV2[];
  entity?: EntityResolutionV2;
  companyContext?: string | null;
  sellerProfile?: SellerProfileContextV2;
}) {
  return `Secciones a auditar: ${serializeReportV2Context(input.sections)}
Claims validos: ${JSON.stringify(input.claimIds)}
Jurisdiccion del contacto: ${input.contactCountry}
Afirmaciones y alcance real: ${serializeReportV2Context(input.claims || [])}
Pasajes de respaldo: ${serializeReportV2Context(input.facts || [])}
Perfil disponible (contexto importado utilizable): ${serializeReportV2Context(input.entity || null)}
Descripcion corporativa importada (utilizable como perfil, sin cita web): ${input.companyContext || 'No disponible'}
Oferta del vendedor (contexto declarado, utilizable para recomendar): ${serializeReportV2Context(input.sellerProfile || null)}

Revisa cada parrafo y reporta todo defecto con su ubicacion exacta:

1. DUPLICACION: frases repetidas o solapadas dentro del mismo parrafo. En discovery es normal repetir una idea dentro de la pregunta que la valida; no marques esa pareja contexto/pregunta como defecto.
2. TRUNCADO: el parrafo termina a mitad de palabra o frase.
3. RUIDO TECNICO: HTML, clases CSS, rutas de archivo o URLs de assets.
4. COPIA LITERAL: reproduce el titulo, snippet o slogan de una fuente.
5. CITA INVALIDA: claimIds inexistentes o citas que no respaldan lo afirmado. Las preguntas, recomendaciones, hipotesis y datos del perfil no requieren citas.
6. JURISDICCION: aplica otro pais a ${input.contactCountry} sin marcar contexto de casa matriz.
7. HIPOTESIS DURA: una conjetura aparece como hecho confirmado. Incluye afirmaciones sobre el vendedor, no solo sobre la empresa objetivo.
8. VACUIDAD: recomendaciones que no consideran el rol ni la oferta, o pilotos sin metrica observable propia (que medir y unidad/comparacion); generic con warn por cada oportunidad afectada. Para Finanzas, revisa si el caso aborda facturacion, cobranza, cierre o excepciones financieras compatibles con la oferta/contexto, en vez de sustituirlo por tareas de RRHH. No exijas que la empresa tenga un problema confirmado para explorar una hipotesis.

POLITICA DE REVISION:
- basis=source debe estar respaldado semanticamente. basis=profile usa datos del perfil, no necesita otra fuente. basis=analysis admite conocimiento general del rol/sector y posibilidades comerciales. basis=recommendation admite acciones y preguntas sin citas.
- Falta de noticias, dimensionamiento, forma legal o comite nominal NO invalida un reporte. Las secciones opcionales vacias no son defectos.
- Escenarios ilustrativos con rango, formula y supuestos explicitos y valoraciones cualitativas etiquetadas como heuristicas no calibradas son analisis permitido sin fuente web. No los confundas con hechos observados. Bloquea porcentajes de respuesta/conversion presentados como calibrados sin datos, eventos recientes inventados y clientes/casos de exito ficticios. Una pregunta que presupone trabajo manual no confirmado merece warn; debe preguntar si existe. El cargo original exacto no es copia literal indebida.
- No bloquees por ausencia de cita en el contacto importado del comite. No confundas rol con presupuesto confirmado.
- Una pregunta terminada en comillas o un parentesis esta completa. La duplicacion, estilo o longitud se marcan warn, no block.
- Bloquea solo errores materiales: identidad equivocada, cifras o hechos inventados, citas falsas, datos de grupo presentados como locales, hipotesis presentadas como problemas confirmados, HTML/assets visibles.
- No marques ausencia de informacion como error factual. Revisa solo lo que el texto realmente afirma. Cada fragmento debe aparecer literalmente en la seccion indicada.
- Usa TODO el contexto anterior, no solo claims: una descripcion de negocio presente en la descripcion corporativa con basis=profile NO necesita cita web. No marques como inventada la oferta explicita del vendedor.
- RESPALDO DEL VENDEDOR: comprueba toda afirmacion de experiencia, traccion, clientes, conversaciones en curso, casos de exito o resultados contra el perfil del vendedor. 'Estamos conversando con equipos', 'ya ayudamos a empresas', 'nuestros clientes' o un ahorro logrado son hechos, incluso entre comillas en angle y con basis=recommendation. Si no tienen respaldo explicito, reporta hard_hypothesis con severity=block y el fragmento literal. Una capacidad de automatizacion NO prueba clientes ni experiencia; la evidencia sobre el objetivo tampoco. No lo rebajes a generic/estilo. Una capacidad explicitamente ofrecida, una pregunta exploratoria o una metrica propuesta SIN promesa no son traccion inventada y no requieren citas artificiales.
- Referenciar servicios generales de la empresa para proponer un piloto local NO equivale a afirmar que sus sistemas ya estan instalados en ese pais. jurisdiction=null significa alcance no precisado, no pais incorrecto. Marca jurisdiccion solo cuando el texto atribuya explicitamente una cifra, sistema instalado o norma de otro pais a la operacion local. No exijas otra fuente para recomendar explorar un proceso.

Por defecto devuelve seccion, indice, tipo, fragmento y severidad block o warn. El fragmento de una duplicacion debe aparecer literalmente al menos dos veces en el parrafo. Block obliga a regenerar la seccion. No propongas correcciones.`;
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

function questionRanges(words: string[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = -1;
  let sentenceStart = 0;
  words.forEach((word, index) => {
    if (word.includes('¿')) start = index;
    if (start < 0 && word.includes('?')) start = sentenceStart;
    if (start >= 0 && word.includes('?')) {
      ranges.push({ start, end: index });
      start = -1;
    }
    if (/[.!?]$/.test(word)) sentenceStart = index + 1;
  });
  return ranges;
}

function occurrenceInQuestion(ranges: Array<{ start: number; end: number }>, start: number, end: number) {
  return ranges.some((range) => range.start <= start && end <= range.end);
}

function sentenceIds(words: string[]) {
  let sentence = 0;
  return words.map((word) => {
    const current = sentence;
    if (/[.!?]$/.test(word)) sentence += 1;
    return current;
  });
}

function isMeaningfulDuplication(
  left: { sentence: number; inQuestion: boolean },
  right: { sentence: number; inQuestion: boolean },
  wordCount: number,
  ignoreQuestionEcho: boolean,
) {
  if (ignoreQuestionEcho && left.inQuestion !== right.inQuestion) return false;
  return left.sentence === right.sentence || wordCount >= 8;
}

function repeatedFragment(text: string, fragment: string, ignoreQuestionEcho = false) {
  const words = text.split(/\s+/).filter(Boolean);
  const targetWords = normalized(fragment).split(' ').filter(Boolean);
  if (targetWords.length < 3 || normalized(fragment).length <= 20) return false;
  const ranges = questionRanges(words);
  const sentences = sentenceIds(words);
  const occurrences: Array<{ start: number; end: number; inQuestion: boolean }> = [];
  for (let index = 0; index <= words.length - targetWords.length; index += 1) {
    if (normalized(words.slice(index, index + targetWords.length).join(' ')) !== targetWords.join(' ')) continue;
    occurrences.push({
      start: index,
      end: index + targetWords.length - 1,
      inQuestion: occurrenceInQuestion(ranges, index, index + targetWords.length - 1),
    });
  }
  return occurrences.some((occurrence, index) => occurrences.slice(index + 1).some((other) => isMeaningfulDuplication(
    { sentence: sentences[occurrence.start], inQuestion: occurrence.inQuestion },
    { sentence: sentences[other.start], inQuestion: other.inQuestion },
    targetWords.length,
    ignoreQuestionEcho,
  )));
}

function duplicatedFragment(text: string, ignoreQuestionEcho = false) {
  const words = text.split(/\s+/).filter(Boolean);
  const ranges = questionRanges(words);
  const sentences = sentenceIds(words);
  for (let size = Math.min(12, Math.floor(words.length / 2)); size >= 3; size -= 1) {
    const seen = new Map<string, Array<{ start: number; inQuestion: boolean }>>();
    for (let index = 0; index <= words.length - size; index += 1) {
      const fragment = normalized(words.slice(index, index + size).join(' '));
      if (fragment.length <= 20) continue;
      const inQuestion = occurrenceInQuestion(ranges, index, index + size - 1);
      const previous = seen.get(fragment) || [];
      if (previous.some((item) => isMeaningfulDuplication(
        { sentence: sentences[item.start], inQuestion: item.inQuestion },
        { sentence: sentences[index], inQuestion },
        size,
        ignoreQuestionEcho,
      ))) return words.slice(index, index + size).join(' ');
      previous.push({ start: index, inQuestion });
      seen.set(fragment, previous);
    }
  }
  return null;
}

function retainGroundedDuplicationIssues(issues: AuditIssueV2[], sections: SectionV2[]) {
  const sectionsByKey = new Map(sections.map((section) => [section.key, section]));
  return issues.filter((issue) => {
    if (issue.type !== 'duplication' || issue.paragraphIndex === null) return issue.type !== 'duplication';
    const paragraph = sectionsByKey.get(issue.section)?.paragraphs[issue.paragraphIndex];
    return Boolean(paragraph && repeatedFragment(paragraph.text, issue.fragment, issue.section === 'discovery'));
  });
}

function deduplicateIssues(issues: AuditIssueV2[]) {
  return [...new Map(issues.map((issue) => [
    `${issue.section}:${issue.paragraphIndex}:${issue.type}:${normalized(issue.fragment)}`,
    issue,
  ])).values()];
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
      const duplicate = duplicatedFragment(paragraph.text, section.key === 'discovery');
       if (duplicate) add('duplication', duplicate, 'warn');
       if (!/[.!?:;)][\s"'\u00bb\u2019\u201d)]*$/.test(paragraph.text.trim())) add('truncated', paragraph.text.slice(-120), 'warn');
       const noise = paragraph.text.match(/<[^>]*>|wp-content\S*|elementor\S*|hummingbird\S*|\/assets\/\S*/i)?.[0];
      if (noise) add('technical_noise', noise, 'block');
      const copied = literalCandidates.find((candidate) => candidate.length >= 20 && similarity(paragraph.text, candidate) > 0.8);
      if (copied) add('literal_copy', copied, 'warn');
      if ((!paragraph.basis || paragraph.basis === 'source') && paragraph.claimIds.length === 0) add('invalid_citation', paragraph.text.slice(0, 160), 'block');
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

export async function auditReportV2(input: {
  sections: SectionV2[];
  claims: ClaimV2[];
  sources: SourceV2[];
  sourceSnippets?: string[];
  contactCountry: string;
  writerModels: string[];
  facts?: FactV2[];
  entity?: EntityResolutionV2;
  signal?: AbortSignal;
  companyContext?: string | null;
  sellerProfile?: SellerProfileContextV2;
}, dependencies: {
  generate?: typeof generateStructuredWithTelemetry;
} = {}) {
  const deterministicIssues = deterministicAuditReportV2(input);
  const generated = await (dependencies.generate || generateStructuredWithTelemetry)({
    ...reportGenerationOptions('reasoning'),
    signal: input.signal,
    systemPrompt: AUDIT_REPORT_V2_SYSTEM_PROMPT,
    prompt: buildAuditReportV2Prompt({
      sections: input.sections,
      claimIds: input.claims.map((claim) => claim.id),
      contactCountry: input.contactCountry,
      claims: input.claims,
      facts: input.facts,
      entity: input.entity,
      companyContext: input.companyContext,
      sellerProfile: input.sellerProfile,
    }),
    schema: AuditOutputV2Schema,
    temperature: 0,
  });
  const groundedModelIssues = retainGroundedDuplicationIssues(generated.data.issues, input.sections).filter((issue) => {
    const section = input.sections.find((section) => section.key === issue.section);
    if (!section?.paragraphs.length) return false;
    const paragraphs = issue.paragraphIndex === null ? section.paragraphs : section.paragraphs.slice(issue.paragraphIndex, issue.paragraphIndex + 1);
    return paragraphs.some((paragraph) => normalized(paragraph.text).includes(normalized(issue.fragment)));
  }).map((issue) => ['duplication', 'truncated', 'literal_copy', 'generic'].includes(issue.type)
    ? { ...issue, severity: 'warn' as const } : issue);
  const issues = deduplicateIssues([...deterministicIssues, ...groundedModelIssues]);
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
