import { z } from 'zod';

/**
 * The line under each opportunity's name in the pipeline: what it is about, in one or two sentences the model writes from
 * what the opportunity says (the official tender file when there is one, the job ads, the post or the invitation). Kept
 * in the opportunity's data with the model that wrote it; the card shows it, nothing else depends on it.
 */
export type OpportunitySummary = { text: string; model: string; basis: 'ficha' | 'texto' | 'nombre'; at: string };

export const SUMMARY_BATCH = 12;
const MAX_CHARS = 220;

const KIND_LABELS: Record<string, string> = {
  tender: 'Licitación pública', compra_agil: 'Compra Ágil', hiring: 'Avisos de trabajo en LinkedIn', linkedin_post: 'Publicación en LinkedIn',
  private_tender: 'Licitación privada', proposal: 'Solicitud de propuesta', quote: 'Solicitud de cotización', commercial: 'Oportunidad comercial',
};

type SummaryRow = { id: string; kind: string; title: string; company_name?: string | null; buyer_name?: string | null; amount?: number | string | null;
  currency?: string | null; deadline_at?: string | null; data?: Record<string, any> | null };

const clip = (value: unknown, length: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const same = (a: string, b: string) => clip(a, 4000).toLowerCase() === clip(b, 4000).toLowerCase();

/** The summary saved on the opportunity, when there is one. */
export function opportunitySummary(data: unknown): string | null {
  const summary = (data as { summary?: Partial<OpportunitySummary> } | null)?.summary;
  return typeof summary?.text === 'string' && summary.text.trim() ? summary.text.trim() : null;
}

/** A public tender listed by name only: its official file says the buyer, the description and the lines. */
export function needsTenderDetail(row: SummaryRow) {
  const code = row.data?.observed?.code;
  if (row.kind !== 'tender' || typeof code !== 'string' || !code.trim() || row.data?.detail) return false;
  return !row.buyer_name || !clip(row.data?.description, 10) || same(String(row.data?.description), row.title);
}

/** What the model reads of one opportunity: only what it says, short. */
export function summaryCase(row: SummaryRow) {
  const data = row.data || {};
  const description = clip(data.description, 1500);
  const items = Array.isArray(data.observed?.items) ? data.observed.items.map((item: any) => clip(item?.name, 120)).filter(Boolean).slice(0, 8) : [];
  return {
    id: row.id,
    tipo: KIND_LABELS[row.kind] ?? 'Oportunidad',
    nombre: clip(row.title, 300),
    organismoOEmpresa: clip(row.buyer_name || row.company_name, 200) || null,
    unidad: clip(data.buyerUnit, 200) || null,
    descripcion: description && !same(description, row.title) ? description : null,
    lineas: items.length ? items : null,
    region: clip(data.observed?.region, 80) || null,
    monto: row.amount === null || row.amount === undefined || row.amount === '' ? null : `${row.amount} ${row.currency || ''}`.trim(),
    avisos: typeof data.observed?.ads === 'number' ? data.observed.ads : null,
  };
}

/** Whether the model had more than the name to go on: the card says nothing about it, the data keeps it. */
export function summaryBasis(row: SummaryRow): OpportunitySummary['basis'] {
  const read = summaryCase(row);
  if (row.data?.detail) return 'ficha';
  return read.descripcion || read.lineas ? 'texto' : 'nombre';
}

export const summaryAnswerSchema = z.object({
  summaries: z.array(z.object({ id: z.string().max(60), summary: z.string().max(400) })).max(SUMMARY_BATCH * 2),
});

export function summaryPrompt(cases: ReturnType<typeof summaryCase>[]) {
  return `Escribe un resumen breve de cada oportunidad para la tarjeta de un embudo comercial: alguien lo lee en dos segundos para saber de qué se trata antes de abrirla.

Reglas:
- Una o dos frases, máximo 200 caracteres en total. Español de Chile, tono neutro.
- Di qué se compra o se necesita y para quién o dónde, con lo que dicen los datos: nombre, organismo o empresa, descripción, líneas, región, avisos.
- Empieza por lo que se compra o se necesita, sin repetir el tipo («Licitación de…», «Esta oportunidad…») ni copiar el nombre tal cual.
- Nunca inventes montos, plazos, cantidades ni lugares que no estén en los datos. No expandas siglas si no estás seguro de qué significan.
- No opines si conviene postular: solo de qué se trata.
- Si solo tienes el nombre, di en palabras simples qué se pide según ese nombre, sin agregar detalles.
- En avisos de trabajo, di qué cargos busca la empresa y dónde, y qué necesidad revela (por ejemplo, reforzar dotación).

Devuelve un resumen por id, con el mismo id.

Oportunidades:
${JSON.stringify(cases)}`;
}

/** One line, without quotes or a trailing list, cut at a word when it runs long. */
export function cleanSummary(text: string) {
  let line = text.replace(/\s+/g, ' ').replace(/^["«“']+|["»”']+$/g, '').trim();
  if (line.length > MAX_CHARS) {
    const cut = line.slice(0, MAX_CHARS - 1);
    line = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_CHARS - 40)).replace(/[,;:.\s]+$/, '')}…`;
  }
  return line && !/[.!?…]$/.test(line) ? `${line}.` : line;
}
