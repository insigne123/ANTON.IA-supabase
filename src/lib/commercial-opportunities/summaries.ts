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

// The screening's own first reason when it says nothing about the opportunity yet.
const GENERIC_REASON = /^pendiente de evaluaci[oó]n/i;
const LINE_CHARS = 220;
const shorten = (text: string) => {
  if (text.length <= LINE_CHARS) return text;
  const cut = text.slice(0, LINE_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), LINE_CHARS - 40)).replace(/[,;:.\s]+$/, '')}…`;
};

/**
 * What a card of LinkedIn says while its summary is not written (the reading is slow and starts with the tenders closing soon):
 * what the screening already found, so it is never an empty box. A hiring card: why it matters, or else the jobs it posts. A
 * post: why it matters, or else what it says. Anything else has no fallback: its summary is on its way.
 */
export function fallbackLine(row: { kind?: string; title?: string; reasons?: unknown; data?: unknown }): string | null {
  if (row.kind !== 'hiring' && row.kind !== 'linkedin_post') return null;
  const reason = Array.isArray(row.reasons) ? clip(row.reasons[0], 600) : '';
  if (reason && !GENERIC_REASON.test(reason) && !same(reason, String(row.title ?? ''))) return shorten(reason);
  const description = String((row.data as { description?: unknown } | null)?.description ?? '');
  if (row.kind === 'linkedin_post') return clip(description, 20) ? shorten(clip(description, 600)) : null;
  // The postings come one per line, «Cargo · Lugar · enlace»: the jobs are what is left of them.
  const jobs = [...new Set(description.split(/\n+/).map(line => clip(line.split(' · ')[0], 90)).filter(Boolean))];
  if (!jobs.length) return null;
  const shown = jobs.slice(0, 2);
  const rest = jobs.length - shown.length;
  return `Busca ${rest ? `${shown.join(', ')} y ${rest} más` : shown.join(' y ')}.`;
}

/** A public tender listed by name only: its official file says the buyer, the description and the lines. */
export function needsTenderDetail(row: SummaryRow) {
  const code = row.data?.observed?.code;
  if (row.kind !== 'tender' || typeof code !== 'string' || !code.trim() || row.data?.detail) return false;
  return !row.buyer_name || !clip(row.data?.description, 10) || same(String(row.data?.description), row.title);
}

/**
 * A summary written from the name alone, of a tender whose official file was never read (no ticket at the time): it is
 * written again once, with the file if it can be read. The file read, or found missing, ends it.
 */
export function summaryFromNameOnly(row: SummaryRow) {
  return row.data?.summary?.basis === 'nombre' && needsTenderDetail(row);
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
  if (row.data?.detail && row.data.detail.found !== false) return 'ficha';
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
- Empieza directo por lo que se compra o se necesita («Guardias para…», «Aseo diario de…»), sin «Se requiere», «Se busca» ni «Se necesita», sin repetir el tipo («Licitación de…», «Esta oportunidad…») y sin copiar el nombre tal cual.
- Nunca inventes montos, plazos, cantidades ni lugares que no estén en los datos. No expandas siglas si no estás seguro de qué significan: déjalas tal cual («para el FEH»), sin explicarlas.
- No opines si conviene postular: solo de qué se trata.
- Nunca comentes de dónde sale lo que dices ni lo que falta: nada de «según el nombre», «solo consta el nombre», «sin más detalles» o «no se informa el organismo». Si solo tienes el nombre, escribe una frase corta con lo que se pide, en palabras simples.
- En avisos de trabajo, di qué cargos busca la empresa y dónde, y qué necesidad revela (por ejemplo, reforzar dotación).

Devuelve un resumen por id, con el mismo id.

Oportunidades:
${JSON.stringify(cases)}`;
}

// What the model says about its own sources or what is missing: the card has no use for it.
const ABOUT_SOURCES = /seg[uú]n (?:el|su) nombre|s[oó]lo (?:consta|se conoce|aparece|hay|tenemos|se tiene) (?:el|su) nombre|sin m[aá]s (?:detalles|datos|informaci[oó]n)|no (?:hay|entrega|indica|informa|da|aporta|se informan?|se indican?) (?:m[aá]s |otros )?(?:detalles|datos|informaci[oó]n|organismo|regi[oó]n|lugar)|(?:aparece|est[aá]) truncad[oa]/i;

/** One line, without quotes, without remarks about its sources, cut at a word when it runs long. */
export function cleanSummary(text: string) {
  let line = text.replace(/\s+/g, ' ').replace(/^["«“']+|["»”']+$/g, '').trim();
  // Sentences and clauses that only talk about the data go; a clause «según el nombre» goes from the sentence it closes.
  line = line.split(/(?<=[.;])\s+/).map(part => part.replace(/,?\s*seg[uú]n (?:el|su) nombre(?: de la (?:licitaci[oó]n|oportunidad))?/gi, ''))
    .filter(part => !ABOUT_SOURCES.test(part)).join(' ').replace(/[;,:\s]+$/, '').trim();
  if (line.length > MAX_CHARS) {
    const cut = line.slice(0, MAX_CHARS - 1);
    line = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_CHARS - 40)).replace(/[,;:.\s]+$/, '')}…`;
  }
  return line && !/[.!?…]$/.test(line) ? `${line}.` : line;
}
