import { z } from 'zod';

import { generateStructuredWithTelemetry, type StructuredTelemetry } from '@/ai/openai-json';
import { reportGenerationOptions } from '@/ai/report-models';
import { truncateAtWord } from '@/lib/report-v2-extraction';
import {
  ReportV2SectionKeySchema,
  type ReportV2SectionKey,
  type SectionV2,
} from '@/lib/report-v2-contracts';

export const WRITE_REPORT_V2_SECTION_PROMPT_VERSION = 'report-v2/p6-section/3';
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export const WRITE_REPORT_V2_SECTION_SYSTEM_PROMPT = `Eres el redactor del reporte. Conviertes un analisis ya hecho en prosa clara para un vendedor. No
investigas, no razonas, no agregas nada: escribes lo que el analisis ya decidio.`;

export type SectionRepairMetricV2 = {
  section: ReportV2SectionKey;
  model: string | null;
  accepted: boolean;
  attempt: number;
  invalidClaimIds: string[];
};

export function stripInternalIdsForReportPrompt(value: unknown, preserveText = false): unknown {
  if (typeof value === 'string') return preserveText ? value : value.replace(UUID_PATTERN, '[internal-id-removed]');
  if (Array.isArray(value)) return value.map((item) => stripInternalIdsForReportPrompt(item, preserveText));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['internalId', 'internal_id', 'uuid'].includes(key))
    .map(([key, item]) => [key, stripInternalIdsForReportPrompt(item, preserveText)]));
}

// Tables remove repeated field names, never evidence text, references or scope.
export function serializeReportV2Context(value: unknown): string {
  function compact(item: unknown): unknown {
    if (!item || typeof item !== 'object') return item;
    if (!Array.isArray(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, compact(child)]));
    const rows = item.map(compact);
    if (rows.length < 2 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) return rows;
    const records = rows as Record<string, unknown>[];
    const columns = Object.keys(records[0]);
    if (!columns.length || !records.every((row) => JSON.stringify(Object.keys(row)) === JSON.stringify(columns))) return rows;
    const table = { columns, rows: records.map((row) => columns.map((key) => row[key])) };
    return JSON.stringify(table).length < JSON.stringify(rows).length ? table : rows;
  }
  // Preserve literal UUIDs in source passages; only named internal metadata is removed.
  const normalized = JSON.parse(JSON.stringify(stripInternalIdsForReportPrompt(value, true)) ?? 'null');
  return JSON.stringify(compact(normalized));
}

export function repairSectionParagraphsV2(input: {
  value: unknown;
  validClaimIds: string[];
  characterLimit: number;
}) {
  const validIds = new Set(input.validClaimIds);
  const rawParagraphs = Array.isArray((input.value as any)?.paragraphs) ? (input.value as any).paragraphs : [];
  const invalidClaimIds = new Set<string>();
  const paragraphs = rawParagraphs.flatMap((paragraph: any) => {
    const claimIds = [...new Set((Array.isArray(paragraph?.claimIds) ? paragraph.claimIds : [])
      .map((id: unknown) => String(id || '').trim())
      .filter((id: string) => {
        if (!validIds.has(id)) invalidClaimIds.add(id);
        return validIds.has(id);
      }))];
    const text = truncateAtWord(String(paragraph?.text || ''), input.characterLimit);
    if (!text || claimIds.length === 0) return [];
    return [{ text, claimIds, context: paragraph?.context === 'headquarters' ? 'headquarters' as const : 'target' as const }];
  });
  return { paragraphs, invalidClaimIds: [...invalidClaimIds].filter(Boolean) };
}

function outputSchema(validClaimIds: string[]) {
  if (validClaimIds.length === 0) return null;
  const idEnum = z.enum(validClaimIds as [string, ...string[]]);
  return z.object({
    paragraphs: z.array(z.object({
      text: z.string().trim().min(1),
      claimIds: z.array(idEnum).min(1),
      context: z.enum(['target', 'headquarters']),
    }).strict()),
  }).strict();
}

export function buildWriteReportV2SectionPrompt(input: {
  section: ReportV2SectionKey;
  sectionInstruction: string;
  language: string;
  analysisSection: unknown;
  claimsIndex: unknown;
  sectionLimit: number;
  characterLimit: number;
}) {
  return `Seccion: "${input.section}"
Tarea de la seccion: ${input.sectionInstruction}
Idioma: ${input.language}
Analisis de entrada: ${serializeReportV2Context(input.analysisSection)}
Claims citables: ${serializeReportV2Context(input.claimsIndex)}

Reglas de redaccion:
- Escribe para un vendedor que va a usar esto en los proximos diez minutos. Directo, concreto, sin relleno corporativo.
- En espanol, escribe espanol profesional natural. No concatenes frases canonicas ni las pegues literal.
- Maximo ${input.sectionLimit} parrafos, cada uno bajo ${input.characterLimit} caracteres y sobre una sola idea.
- Cada parrafo cita los claimIds que interpreta, y solo esos. Usa unicamente IDs de la lista entregada.
- Nunca copies titulos de pagina, snippets, slogans, etiquetas de autor ni texto de navegacion.
- No agregues ningun hecho, numero, nombre ni conclusion que no este en el analisis de entrada.
- Respeta el tipo de cada afirmacion: lo que el analisis marco como hipotesis se redacta como hipotesis con su pregunta de validacion; lo que marco como derivado se redacta con sus supuestos a la vista.
- Si el analisis de entrada esta vacio, devuelve una lista de parrafos vacia. No rellenes.
- No escribas frases que sirvan para cualquier lead. Si una frase podria aparecer en el reporte de otra empresa sin cambiar una palabra, borrala.`;
}

export async function writeReportV2Section(input: {
  section: ReportV2SectionKey;
  title: string;
  sectionInstruction: string;
  language: string;
  analysisSection: unknown;
  claimsIndex: unknown;
  validClaimIds: string[];
  sectionLimit?: number;
  characterLimit?: number;
  onMetric?: (metric: SectionRepairMetricV2) => void;
}, dependencies: {
  generate?: typeof generateStructuredWithTelemetry;
} = {}): Promise<{ section: SectionV2 | null; acceptedModel: string | null; attempts: number; telemetry: StructuredTelemetry[] }> {
  const section = ReportV2SectionKeySchema.parse(input.section);
  const validClaimIds = [...new Set(input.validClaimIds)].filter((id) => /^c\d{2,4}$/.test(id));
  const schema = outputSchema(validClaimIds);
  if (!schema) return { section: null, acceptedModel: null, attempts: 0, telemetry: [] };
  const generate = dependencies.generate || generateStructuredWithTelemetry;
  const characterLimit = Math.max(80, Math.min(2_000, input.characterLimit || 800));
  const sectionLimit = Math.max(1, Math.min(20, input.sectionLimit || 5));
  const basePrompt = buildWriteReportV2SectionPrompt({ ...input, section, characterLimit, sectionLimit });
  let invalidFromFirst: string[] = [];
  const telemetry: StructuredTelemetry[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const feedback = attempt === 2
      ? `\n\nCorreccion obligatoria: Los siguientes IDs no existen: ${JSON.stringify(invalidFromFirst)}. Usa unicamente: ${JSON.stringify(validClaimIds)}.`
      : '';
    const result = await generate({
      ...reportGenerationOptions('balanced'),
      systemPrompt: WRITE_REPORT_V2_SECTION_SYSTEM_PROMPT,
      prompt: `${basePrompt}${feedback}`,
      schema,
      temperature: 0.2,
    });
    telemetry.push(result.telemetry);
    const repaired = repairSectionParagraphsV2({ value: result.data, validClaimIds, characterLimit });
    input.onMetric?.({
      section,
      model: result.telemetry.modelName,
      accepted: repaired.paragraphs.length > 0,
      attempt,
      invalidClaimIds: repaired.invalidClaimIds,
    });
    if (repaired.paragraphs.length > 0) {
      return {
        section: { key: section, title: input.title, paragraphs: repaired.paragraphs.slice(0, sectionLimit), blocks: [] },
        acceptedModel: result.telemetry.modelName,
        attempts: attempt,
        telemetry,
      };
    }
    invalidFromFirst = repaired.invalidClaimIds;
  }
  return { section: null, acceptedModel: null, attempts: 2, telemetry };
}
