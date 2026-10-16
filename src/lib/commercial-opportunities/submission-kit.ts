// «Cómo postular»: what the bases ask to hand in and how, read by the AI from the extracted facts, plus the checks a person
// does by hand before sending (the numbers, the dates). Pure and isomorphic: the research job, the page and the exports share it.
//
// What makes applying hard, from real bases (Dalcahue 4481-22-LP25, Academia Judicial 03/2026, «Seguridad y Monitoreo de
// Cámaras»): the documents are spread across the text and the annexes, some in folders the bases name inconsistently; a
// missing signature or annex leaves the offer out; minimums (a net salary, a bonus, a budget cap) are written in a scoring
// table; the value typed in the portal must match the annex once VAT is added; certificates must be recent and never issued
// after the closing; some bases ask to send the annexes by email; the guarantee is due at signing, days after the award.
import { z } from 'zod';
import { citationSchema, validOpportunityCitation, type DocumentChunk } from './expedient';
import { reportItemKey } from './report-marks';

const s = (max: number) => z.string().max(max);
export const KIT_SOURCES = ['annex', 'company', 'certificate', 'third_party'] as const;
export const KIT_SOURCE_LABELS: Record<typeof KIT_SOURCES[number], string> = {
  annex: 'Formulario de las bases', company: 'Documento de tu empresa', certificate: 'Certificado', third_party: 'Lo emite un tercero',
};
export const RULE_KINDS = ['minimum', 'budget', 'format', 'deadline', 'consistency', 'other'] as const;

// The limits are generous on purpose: a model that writes a long «howTo» must not lose the whole guide. The page shows
// them clamped (clampSubmissionKit).
export const submissionKitSchema = z.object({
  /** Where the offer goes: the Mercado Público portal, an email, on paper, or a mix. */
  channel: z.enum(['portal', 'email', 'physical', 'mixed', 'unknown']),
  channelDetail: s(1500),
  folders: z.array(z.object({
    name: s(300),
    documents: z.array(z.object({
      title: s(600),
      source: z.enum(KIT_SOURCES),
      signed: z.boolean(),
      validity: s(600),
      excludesIfMissing: z.boolean(),
      howTo: s(1500),
      evidence: z.array(citationSchema).max(5),
    })).max(60),
  })).max(8),
  /** What leaves the offer out besides a missing document: a minimum, a budget cap, a format, a time. */
  rules: z.array(z.object({ text: s(1500), kind: z.enum(RULE_KINDS), evidence: z.array(citationSchema).max(5) })).max(30),
  numbers: z.object({
    budget: z.number().nonnegative().nullable(), budgetLabel: s(600), currency: s(40),
    budgetIncludesTax: z.boolean().nullable(), portalValue: z.enum(['net', 'total', 'unknown']), notes: z.array(s(1000)).max(10),
  }),
  guarantees: z.array(z.object({ kind: s(400), amount: s(600), validity: s(600), when: s(600), payableTo: s(600) })).max(6),
  afterSubmit: z.array(s(1000)).max(12),
  /** Where the bases contradict themselves, with the question to ask in the forum before it closes. */
  inconsistencies: z.array(z.object({ text: s(1500), question: s(1500) })).max(12),
});
export type SubmissionKit = z.infer<typeof submissionKitSchema>;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
/** The guide as the page shows it: short texts and bounded lists, whatever length the model wrote. */
// Words of the pipeline, not of the bases («los hechos no precisan…»): a clause that says them is about the guide, not about applying.
const PIPELINE_WORDS = /\b(?:los|estos|dichos) hechos\b|\bel expediente\b/i;
const withoutPipelineWords = (text: string) => text.split(/(?<=[.;])\s+/).filter(part => !PIPELINE_WORDS.test(part)).join(' ').replace(/;$/, '.').trim();
// The closing date restated as a rule: the page shows it once, in the portal's time (a guide read it as «18:00» next to «15:00»).
const RESTATES_CLOSING = /\b(?:fecha|hora|plazo) (?:l[íi]mite|de cierre)\b|\bcierre de (?:la )?(?:recepci[óo]n|ofertas)\b|\bno se reciben ofertas\b/i;

export function clampSubmissionKit(kit: SubmissionKit): SubmissionKit {
  return {
    channel: kit.channel, channelDetail: clip(withoutPipelineWords(kit.channelDetail), 400),
    folders: kit.folders.slice(0, 5).map(folder => ({ name: clip(folder.name, 80), documents: folder.documents.slice(0, 30).map(doc => ({
      ...doc, title: clip(doc.title, 200), validity: clip(doc.validity, 200), howTo: clip(doc.howTo, 400), evidence: doc.evidence.slice(0, 3) })) })),
    rules: kit.rules.filter(rule => !(rule.kind === 'deadline' && RESTATES_CLOSING.test(rule.text))).slice(0, 15)
      .map(rule => ({ ...rule, text: clip(rule.text, 400), evidence: rule.evidence.slice(0, 3) })),
    numbers: { ...kit.numbers, budgetLabel: clip(kit.numbers.budgetLabel, 200), currency: clip(kit.numbers.currency, 12), notes: kit.numbers.notes.slice(0, 5).map(note => clip(note, 300)) },
    guarantees: kit.guarantees.slice(0, 3).map(g => ({ kind: clip(g.kind, 120), amount: clip(g.amount, 200), validity: clip(g.validity, 200), when: clip(g.when, 200), payableTo: clip(g.payableTo, 200) })),
    afterSubmit: kit.afterSubmit.slice(0, 6).map(line => clip(line, 300)),
    inconsistencies: kit.inconsistencies.slice(0, 6).map(item => ({ text: clip(item.text, 400), question: clip(item.question, 500) })),
  };
}

export const SUBMISSION_KIT_PROMPT = `Arma la guía para postular a esta oportunidad a partir de los hechos: qué entregar, cómo y qué deja la oferta fuera.
channel: portal (Mercado Público u otro portal), email, physical, mixed o unknown; channelDetail: una frase con el canal exacto (la dirección de correo si la hay) y cómo se separan los archivos.
folders: las carpetas o secciones en que se entregan los documentos, con el nombre que les dan las bases (por ejemplo «Administrativos», «Técnicos», «Económicos»); si las bases no las nombran, una sola carpeta «Documentos de la oferta». En cada documento: title (el nombre como lo dicen las bases, con su número de anexo), source (annex si es un formulario de las bases, company si es un documento propio como un programa de trabajo o un CV, certificate si es un certificado como el F30, la vigencia o la deuda fiscal, third_party si lo emite otro como un banco o un cliente), signed (true si debe ir firmado), validity (la antigüedad máxima o la vigencia exigida; vacía si no hay), excludesIfMissing (true solo si las bases dicen que su falta, su firma o su forma deja la oferta fuera, rechazada o inadmisible), howTo (una frase práctica: dónde se obtiene o qué debe contener) y evidence (cita exacta: chunkId y quote).
rules: lo que deja la oferta fuera además de un documento faltante: montos mínimos (sueldos, aguinaldos), tope de presupuesto, formato del precio, coherencia entre montos; cada una con su cita.
numbers: budget es el presupuesto disponible o máximo como número (sin puntos) o null; budgetLabel lo describe como lo dicen las bases; currency (CLP, UF, USD); budgetIncludesTax; portalValue dice si en el portal va el valor neto o el total; notes con las reglas de los montos (por ejemplo que el anexo económico y el detalle deben coincidir).
guarantees: cada garantía exigida (seriedad, fiel cumplimiento, anticipo) con monto o porcentaje, vigencia, cuándo se entrega y a nombre de quién.
afterSubmit: hasta 6 hitos después de enviar que exigen algo de la empresa (salvar errores formales en un plazo, firmar el contrato, entregar la garantía, documentos para cada pago).
inconsistencies: contradicciones entre partes de las bases (número de carpetas, nombres de anexos, fechas, montos) con la pregunta concreta para el foro.
Escribe en español de Chile, frases cortas, para quien postula: nunca menciones «los hechos», «el expediente» ni lo que no se sabe (si algo no está, deja el campo vacío). No repitas la fecha de cierre como regla: la página ya la muestra. Las horas van en hora de Chile; una fecha ISO con Z o +00:00 está en UTC. Usa solo los hechos; no inventes documentos, montos, plazos ni direcciones. Las citas deben copiarse tal cual de los hechos.`;

type Fact = { text: string; state: string; citations?: Array<{ chunkId: string; quote: string }> };
/** The facts with their first citation, so the kit can cite them, bounded to a small call (about 70 kB). */
export function kitFacts(facts: Fact[]) {
  const out: Array<{ text: string; cita?: { chunkId: string; quote: string } }> = []; let size = 0;
  for (const fact of facts) {
    const cite = fact.citations?.[0];
    const entry = { text: fact.text.slice(0, 500), ...(cite ? { cita: { chunkId: cite.chunkId, quote: cite.quote.slice(0, 240) } } : {}) };
    size += JSON.stringify(entry).length;
    if (size > 70_000) break;
    out.push(entry);
  }
  return out;
}

/** Keeps only citations that are really in the documents; a document that leaves the offer out must prove it. */
export function validateSubmissionKit(raw: SubmissionKit, chunks: DocumentChunk[]): SubmissionKit {
  const check = (citations: Array<{ chunkId: string; quote: string }>) => citations.filter(c => validOpportunityCitation(c, chunks));
  const kit = clampSubmissionKit(raw);
  return {
    ...kit,
    folders: kit.folders.map(folder => ({ ...folder, documents: folder.documents.map(doc => {
      const evidence = check(doc.evidence);
      return { ...doc, evidence, excludesIfMissing: doc.excludesIfMissing && evidence.length > 0 };
    }) })).filter(folder => folder.documents.length > 0),
    rules: kit.rules.map(rule => ({ ...rule, evidence: check(rule.evidence) })),
  };
}

/** Every document to hand in, each once, with the key its tick is saved under. */
export function kitChecklist(kit: Pick<SubmissionKit, 'folders'> | null | undefined) {
  const items = (kit?.folders || []).flatMap(folder => folder.documents.map(doc => ({ key: reportItemKey('document', doc.title), label: doc.title, folder: folder.name, critical: doc.excludesIfMissing })));
  return [...new Map(items.map(item => [item.key, item])).values()];
}

/** Chile's VAT. Bases name it «IVA» or «impuestos incluidos». */
export const VAT_PERCENT = 19;
const round = (value: number) => Math.round(value);
/**
 * The two numbers a person types and the annex shows, from either one: the net value and the total with VAT. Against the
 * budget, says whether it fits; bases that cap the budget declare an offer over it inadmissible.
 */
export function offerNumbers(input: { net?: number | null; total?: number | null; budget?: number | null; budgetIncludesTax?: boolean | null }) {
  const factor = 1 + VAT_PERCENT / 100;
  const net = input.net != null && input.net > 0 ? round(input.net) : input.total != null && input.total > 0 ? round(input.total / factor) : null;
  if (net === null) return null;
  const total = input.total != null && input.total > 0 && input.net == null ? round(input.total) : round(net * factor);
  const tax = total - net;
  const budget = input.budget != null && input.budget > 0 ? input.budget : null;
  const compared = budget === null ? null : input.budgetIncludesTax === false ? net : total;
  return { net, tax, total, budget, overBudget: budget !== null && compared! > budget, margin: budget === null ? null : budget - compared! };
}

/** A number typed the Chilean way («212.000.000», «1.500.000,50», «$ 620.000»), or null. */
export function parseAmount(text: string) {
  const clean = text.replace(/[^\d.,]/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(clean) ? clean.replace(/\./g, '') : clean;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The general route in Mercado Público, the same for almost every tender. The bases of each tender decide; the page says so.
 * Sources: ChileCompra's guides for suppliers and the Ley 19.886 with its 2024 reform (Ley 21.634, DS 661/2024).
 */
export const PORTAL_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'Ten lista tu cuenta', detail: 'Usuario proveedor en Mercado Público a nombre de la empresa y un representante habilitado para ofertar. La inscripción hábil en el Registro de Proveedores se exige para contratar.' },
  { title: 'Pregunta en el foro a tiempo', detail: 'Las consultas solo se reciben hasta la fecha que fijan las bases, y sus respuestas pasan a ser parte de ellas: léelas antes de cerrar la oferta.' },
  { title: 'Prepara los anexos tal como vienen', detail: 'Usa el formato de las bases, completa cada campo y firma donde lo piden. Los certificados deben estar vigentes y emitidos antes del cierre.' },
  { title: 'Ingresa la oferta con «Ofertar»', detail: 'En la ficha de la licitación, escribe el monto como lo piden las bases (neto o total) y adjunta los archivos en su sección: administrativos, técnicos y económicos.' },
  { title: 'Firma la declaración jurada y envía', detail: 'Al ofertar se firma en línea la Declaración Jurada de Requisitos para Ofertar. Envía con tiempo: después de la hora de cierre el portal no recibe ofertas.' },
  { title: 'Guarda el comprobante', detail: 'Descarga el comprobante de envío y revisa que estén todos los archivos. Mientras la licitación siga abierta puedes editar la oferta.' },
];

/** After sending: what usually comes and what it asks of the company. */
export const AFTER_SUBMIT_DEFAULTS = [
  'En la apertura pueden pedirte salvar errores u omisiones formales en un plazo corto, normalmente de 24 a 48 horas: revisa el foro y tu correo.',
  'Si te adjudican, se firma el contrato en el plazo de las bases y se entrega la garantía de fiel cumplimiento.',
  'Para cada pago suelen pedir factura y el certificado de cumplimiento laboral y previsional (F30-1).',
];
