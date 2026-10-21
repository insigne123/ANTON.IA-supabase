// The forms of the bases (annexes) that go in an offer, filled in as far as the company's data go: the identification of the
// bidder and its sworn declarations, the economic and technical annexes, the lists of experience, the staff by worker. Bases
// ask for them «en el formato del anexo», and a Word to fill in is what the team needs: the page and the Word share this.
// Pure and isomorphic. The AI writes them apart from the offer (a form is long and wants the exact text of the bases).
import { z } from 'zod';

const s = (max: number) => z.string().max(max);

/**
 * One piece of a form, flat on purpose (a union makes the model's output fragile): `text` is a paragraph (a declaration, an
 * instruction), `fields` are «label: value» lines, `table` has columns and rows, `choices` are boxes to tick.
 */
export const annexBlockSchema = z.object({
  kind: z.enum(['text', 'fields', 'table', 'choices']),
  /** The block's own heading in the form («Identificación del representante legal»); empty when it has none. */
  title: s(300),
  text: s(4000),
  fields: z.array(z.object({ label: s(300), value: s(600) })).max(30),
  columns: z.array(s(200)).max(8),
  /** Rows the form already has (the offices, the items to quote), with the cells the company's data can fill. */
  rows: z.array(z.array(s(500)).max(8)).max(60),
  /** Empty rows the bidder adds (its contracts, its workers). */
  blankRows: z.number().int().min(0).max(40),
  options: z.array(s(500)).max(20),
});
export type OfferAnnexBlock = z.infer<typeof annexBlockSchema>;

export const offerAnnexSchema = z.object({
  /** «Anexo N°1», as the bases number it. */
  number: s(80),
  title: s(400),
  /** What the form says before its fields: the name of the tender, an instruction. */
  intro: s(2000),
  blocks: z.array(annexBlockSchema).max(16),
  /** Whether the form closes with the signature of the legal representative or the natural person. */
  signed: z.boolean(),
  /** True when the form is reproduced from its text in the bases; false when it is assembled from what the bases ask for it. */
  faithful: z.boolean(),
});
export type OfferAnnex = z.infer<typeof offerAnnexSchema>;
export const offerAnnexesSchema = z.object({ annexes: z.array(offerAnnexSchema).max(16), missing: z.array(s(500)).max(16) });

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** The forms as the page and the Word read them: bounded, and without the blocks that have nothing in them. */
export function clampOfferAnnexes(annexes: OfferAnnex[]): OfferAnnex[] {
  return annexes.filter(annex => annex.title.trim() || annex.number.trim()).slice(0, 14).map(annex => ({
    number: clip(annex.number.trim(), 60), title: clip(annex.title.trim(), 300), intro: clip(annex.intro.trim(), 1500),
    signed: annex.signed, faithful: annex.faithful,
    blocks: annex.blocks.map(block => ({
      kind: block.kind, title: clip(block.title.trim(), 200), text: clip(block.text.trim(), 3000),
      fields: block.fields.filter(field => field.label.trim()).slice(0, 24).map(field => ({ label: clip(field.label.trim(), 200), value: clip(field.value.trim(), 400) })),
      columns: block.columns.map(column => clip(column.trim(), 120)).slice(0, 8),
      rows: block.rows.slice(0, 50).map(row => row.slice(0, 8).map(cell => clip(cell.trim(), 400))),
      blankRows: Math.max(0, Math.min(30, Math.round(block.blankRows))),
      options: block.options.map(option => clip(option.trim(), 300)).filter(Boolean).slice(0, 16),
    })).filter(block => (block.kind === 'text' && block.text)
      || (block.kind === 'fields' && block.fields.length) || (block.kind === 'table' && block.columns.length) || (block.kind === 'choices' && block.options.length)).slice(0, 14),
  }));
}

/** «Anexo N°4-A», «ANEXO 4 A», «Anexo Nº 1»: the key the bases and the guide share, so each document finds its form. */
export function annexKey(title: string) {
  // The letter counts only when it clings to the number or follows a dash («4A», «4-A», «4 A –»), never a word that follows («4 a la oferta»).
  const match = /anexo\s*(?:n\s*[°º.]?\s*|n[úu]mero\s*|num\.?\s*)?(\d{1,3})(?:\s*[-–.]\s*([a-z])(?![a-z])|\s+([a-z])(?=\s*[-–:(]|\s*$)|([a-z])(?![a-z]))?/i.exec(title);
  return match ? `${Number(match[1])}${(match[2] || match[3] || match[4] || '').toLowerCase()}` : null;
}
/** The form that answers a document of the guide («Anexo N°1 (identificación del oferente…)»), by number or by name. */
export function matchAnnex(documentTitle: string, annexes: OfferAnnex[] | undefined): number {
  if (!annexes?.length) return -1;
  const key = annexKey(documentTitle);
  if (key) {
    const exact = annexes.findIndex(annex => annexKey(`${annex.number} ${annex.title}`) === key || annexKey(annex.number) === key);
    if (exact >= 0) return exact;
    // «Anexo N°4» in the guide covers «Anexo 4-A» and «4-B» in the bases: the first of them answers it.
    const family = annexes.findIndex(annex => (annexKey(annex.number) || '').replace(/[a-z]$/, '') === key.replace(/[a-z]$/, ''));
    if (family >= 0) return family;
  }
  const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const wanted = plain(documentTitle.replace(/anexo\s*n?[°º.]?\s*\d+\s*[a-z]?/i, ''));
  if (wanted.length < 8) return -1;
  return annexes.findIndex(annex => { const name = plain(annex.title); return name.length >= 8 && (name.includes(wanted) || wanted.includes(name)); });
}

/** What the form block says it needs, to count the fields to fill in. */
export const annexOpenFields = (annex: OfferAnnex) => annex.blocks.reduce((total, block) => total
  + (block.kind === 'fields' ? block.fields.filter(field => !field.value.trim()).length : 0)
  + (block.kind === 'table' ? block.blankRows : 0) + (block.kind === 'choices' ? 1 : 0), 0);

// ─── What the model reads: the forms of the bases, whole ────────────────────────────────────────────────────────────────────

type Chunk = { id?: string; document_id: string; ordinal: number; content: string };
type Doc = { id: string; name: string };
const FORM_DOCUMENT = /anexo|formulario|formato|declaraci[oó]n|oferta\s+(?:t[eé]cnica|econ[oó]mica|adm)/i;
const FORM_TEXT = /anexo\s*n?\s*[°º.]?\s*\d|formulario|_{4,}|\.{8,}|\(nombre|\bciudad\b.{0,20}\bfecha\b|firma\s+(?:del\s+)?(?:representante|oferente|proponente)/i;

/**
 * The text of the forms in the expedient: every chunk of a document that is a form (an «Anexo» file), and the chunks of the
 * bases that look like one (the annexes pasted at the end of the bases). The forms come first, in reading order, and the
 * whole is bounded so the prompt keeps its price. A document of a form is never cut in the middle of its first lines.
 */
export function offerFormExcerpts(chunks: Chunk[], documents: Doc[], limit = 45_000): Array<{ name: string; text: string }> {
  const byDocument = new Map<string, Chunk[]>();
  for (const chunk of chunks) byDocument.set(chunk.document_id, [...(byDocument.get(chunk.document_id) || []), chunk]);
  const entries = documents.flatMap(doc => {
    const own = (byDocument.get(doc.id) || []).sort((a, b) => a.ordinal - b.ordinal);
    if (!own.length) return [];
    const isForm = FORM_DOCUMENT.test(doc.name);
    const kept = isForm ? own : own.filter(chunk => FORM_TEXT.test(chunk.content));
    return kept.length ? [{ name: doc.name, form: isForm, text: kept.map(chunk => chunk.content.trim()).join('\n') }] : [];
  }).sort((a, b) => Number(b.form) - Number(a.form));
  const out: Array<{ name: string; text: string }> = [];
  let left = limit;
  for (const entry of entries) {
    if (left < 600) break;
    const text = entry.text.length > left ? `${entry.text.slice(0, left)}…` : entry.text;
    out.push({ name: entry.name, text });
    left -= text.length;
  }
  return out;
}
