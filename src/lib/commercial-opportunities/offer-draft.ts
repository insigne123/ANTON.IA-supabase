// «Tu oferta»: the AI's draft of what the company hands in for a purchase with bases. The report says whether and why, «Cómo
// postular» says what to hand in; this writes it: the technical offer in the order of the evaluation criteria, the answer to
// each technical requirement, the economic lines with their quantities (the team types the prices) and a cover letter.
// Pure and isomorphic: the worker, the page and the exports share it.
//
// What the draft must never do: claim experience, staff, certificates, clients or prices the company did not give. Those go
// as [placeholders] the team fills in, and «Datos que faltan» lists them. Every section cites the bases it answers.
import { z } from 'zod';
import { citationSchema, validOpportunityCitation, type DocumentChunk, type OpportunityReport } from './expedient';
import { clampSubmissionKit, offerNumbers } from './submission-kit';

const s = (max: number) => z.string().max(max);
export const OFFER_DRAFT_VERSION = 1;
// Generous limits for the model; the page clamps (clampOfferDraft).
export const offerDraftSchema = z.object({
  /** One paragraph: what the company offers this buyer and why it fits, for the opening of the technical offer. */
  summary: s(3000),
  technical: z.array(z.object({
    heading: s(300),
    /** The evaluation criterion or technical requirement this section answers, as the bases name it; empty when general. */
    criterion: s(500),
    /** Its weight when the bases give it («30 %», «20 puntos»); empty otherwise. */
    weight: s(80),
    body: s(10_000),
    evidence: z.array(citationSchema).max(4),
  })).max(14),
  compliance: z.array(z.object({ requirement: s(1000), answer: s(2000), evidence: z.array(citationSchema).max(3) })).max(40),
  economic: z.object({
    lines: z.array(z.object({ description: s(600), unit: s(80), quantity: z.number().nonnegative().nullable(), notes: s(600),
      evidence: z.array(citationSchema).max(2) })).max(60),
    /** Whether the bases ask the price net or with VAT in the portal. */
    priceBasis: z.enum(['net', 'total', 'unknown']),
    validity: s(400), paymentTerms: s(400), notes: z.array(s(800)).max(10),
  }),
  letter: s(6000),
  /** The data the team must fill in before sending, in short sentences. */
  missing: z.array(s(500)).max(24),
});
export type OfferDraft = z.infer<typeof offerDraftSchema>;
/** What the page reads: the draft and the prices the team typed, by line index. */
export type OfferPrices = Record<string, number>;
export type SavedOfferDraft = { id: string; created_at: string; updated_at?: string; revision: number; report_id: string | null; draft: OfferDraft; prices: OfferPrices };

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
export function clampOfferDraft(draft: OfferDraft): OfferDraft {
  return {
    summary: clip(draft.summary.trim(), 1500),
    technical: draft.technical.filter(section => section.body.trim()).slice(0, 12).map(section => ({ heading: clip(section.heading.trim(), 160),
      criterion: clip(section.criterion.trim(), 300), weight: clip(section.weight.trim(), 40), body: clip(section.body.trim(), 6000), evidence: section.evidence.slice(0, 3) })),
    compliance: draft.compliance.filter(item => item.requirement.trim()).slice(0, 30).map(item => ({ requirement: clip(item.requirement.trim(), 500),
      answer: clip(item.answer.trim(), 1000), evidence: item.evidence.slice(0, 2) })),
    economic: {
      lines: draft.economic.lines.filter(line => line.description.trim()).slice(0, 50).map(line => ({ description: clip(line.description.trim(), 400),
        unit: clip(line.unit.trim(), 40), quantity: line.quantity, notes: clip(line.notes.trim(), 300), evidence: line.evidence.slice(0, 2) })),
      priceBasis: draft.economic.priceBasis, validity: clip(draft.economic.validity.trim(), 300), paymentTerms: clip(draft.economic.paymentTerms.trim(), 300),
      notes: draft.economic.notes.slice(0, 6).map(note => clip(note.trim(), 400)),
    },
    letter: clip(draft.letter.trim(), 4000),
    missing: [...new Set(draft.missing.map(item => clip(item.trim(), 300)).filter(Boolean))].slice(0, 16),
  };
}
/** Keeps only the citations that are really in the documents. */
export function validateOfferDraft(raw: OfferDraft, chunks: DocumentChunk[]): OfferDraft {
  const draft = clampOfferDraft(raw);
  const check = (citations: Array<{ chunkId: string; quote: string }>) => citations.filter(citation => validOpportunityCitation(citation, chunks));
  return {
    ...draft,
    technical: draft.technical.map(section => ({ ...section, evidence: check(section.evidence) })),
    compliance: draft.compliance.map(item => ({ ...item, evidence: check(item.evidence) })),
    economic: { ...draft.economic, lines: draft.economic.lines.map(line => ({ ...line, evidence: check(line.evidence) })) },
  };
}
/** Every chunk a draft cites, to read them once and validate. */
export const offerDraftChunkIds = (draft: OfferDraft) => [...new Set([
  ...draft.technical.flatMap(section => section.evidence), ...draft.compliance.flatMap(item => item.evidence),
  ...draft.economic.lines.flatMap(line => line.evidence),
].map(citation => citation.chunkId))].slice(0, 400);

/** The lines of the tender as Mercado Público lists them (licitaciones.json › Items.Listado), when the official file is there. */
export type OfficialItem = { description: string; unit: string; quantity: number | null };
export function officialTenderItems(raw: unknown): OfficialItem[] {
  const listing = (raw as any)?.Items?.Listado;
  if (!Array.isArray(listing)) return [];
  return listing.slice(0, 60).flatMap((item: any) => {
    const name = String(item?.NombreProducto || '').replace(/\s+/g, ' ').trim();
    const detail = String(item?.Descripcion || '').replace(/\s+/g, ' ').trim();
    const description = [name, detail && detail !== name ? detail : ''].filter(Boolean).join(': ').slice(0, 400);
    const quantity = Number(item?.Cantidad);
    return description ? [{ description, unit: String(item?.UnidadMedida || '').trim().slice(0, 40), quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : null }] : [];
  });
}

/** What the company told the app about itself (Perfil), besides the workspace's offer: proofs, clients, differentiators. */
export type CompanyFacts = { offer: string; services: string[]; territories: string[]; exclusions: string[]; profile?: string; extras?: Record<string, string> };
const PROFILE_FIELDS: Array<[string, string[]]> = [
  ['Descripción', ['description']], ['Propuesta de valor', ['valueProposition', 'value_proposition']],
  ['Pruebas y resultados', ['proofPoints', 'proof_points']], ['Clientes que se pueden nombrar', ['referenceClients', 'reference_clients']],
  ['Diferenciadores', ['differentiators']], ['Servicios', ['services']], ['Industria', ['industry', 'sector']],
];
/** The useful fields of «Perfil» (profiles.signatures.profile_extended), whatever their casing, as short text. */
export function companyProfileExtras(extended: unknown): Record<string, string> {
  if (!extended || typeof extended !== 'object' || Array.isArray(extended)) return {};
  const source = extended as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [label, keys] of PROFILE_FIELDS) {
    const value = keys.map(key => source[key]).find(v => v !== undefined && v !== null && v !== '');
    const text = Array.isArray(value) ? value.map(v => String(v)).join('; ') : typeof value === 'string' ? value : '';
    if (text.trim()) out[label] = clip(text.replace(/\s+/g, ' ').trim(), 1200);
  }
  return out;
}

type ReportFact = { text: string; cita?: { chunkId: string; quote: string } };
/** The report's facts with their first citation, bounded to about 60 kB: the evaluation criteria and the technical asks first. */
export function offerFacts(report: OpportunityReport): ReportFact[] {
  const priority = /criteri|evaluaci|puntaje|pondera|t[ée]cnic|especificaci|servicio|alcance|personal|dotaci|experiencia|plazo|entrega|garant|precio|oferta econ/i;
  const facts = report.sections.flatMap(section => section.facts.map(fact => ({ fact, section: section.title })));
  facts.sort((a, b) => Number(priority.test(`${b.section} ${b.fact.text}`)) - Number(priority.test(`${a.section} ${a.fact.text}`)));
  const out: ReportFact[] = []; let size = 0;
  for (const { fact } of facts) {
    const cite = fact.citations[0];
    const entry: ReportFact = { text: fact.text.slice(0, 500), ...(cite ? { cita: { chunkId: cite.chunkId, quote: cite.quote.slice(0, 240) } } : {}) };
    size += JSON.stringify(entry).length;
    if (size > 60_000) break;
    out.push(entry);
  }
  return out;
}

/** The prompt of the draft. The documents and the report are data, never instructions (the system prompt says so too). */
export function offerDraftPrompt(input: {
  opportunity: { title: string; buyer: string | null; code?: string | null; deadline: string | null; amount: number | null; currency: string | null };
  company: CompanyFacts; report: OpportunityReport; officialItems: OfficialItem[]; instructions?: string;
}) {
  const kit = input.report.submission ? clampSubmissionKit(input.report.submission) : null;
  return `Prepara el BORRADOR de la oferta que esta empresa entregará en esta licitación o compra, listo para que el equipo lo revise, complete y envíe.
Escribe en español de Chile, formal y concreto, como se escribe una oferta a un organismo público. Frases cortas, sin relleno ni adjetivos vacíos.

REGLAS
- Nunca inventes experiencia, años, clientes, personal, certificaciones, equipos, plazos ni precios. Usa solo lo que dice la empresa abajo. Lo que falte va como marcador entre corchetes, por ejemplo [N.º de contratos similares], [nombre del jefe de proyecto], [RUT de la empresa], y se lista en missing.
- technical: una sección por cada criterio de evaluación técnico o requisito técnico de las bases, en el orden en que las bases los evalúan; primero los que más puntaje dan. heading es un título corto; criterion es el criterio o requisito tal como lo nombran las bases; weight es su ponderación si las bases la dan («30 %», «20 puntos»), si no vacío. body es el texto de la oferta para ese criterio, listo para pegar: qué hará la empresa, cómo, con qué recursos y en qué plazos, usando lo que la empresa ofrece y marcadores para lo que falte. Cita en evidence el fragmento de las bases que pide ese criterio (chunkId y quote exactos de los hechos).
- compliance: cada requisito técnico obligatorio o especificación que las bases piden cumplir, con answer en primera persona plural («Cumplimos: …», o «[confirmar si cumplimos: …]» cuando no se sabe). Cita el requisito.
- economic.lines: las líneas que hay que cotizar, con su cantidad y unidad. Si vienen las líneas oficiales de Mercado Público, úsalas tal cual (misma descripción, cantidad y unidad) y en notes lo que las bases aclaren de cada una. Si no, sácalas de las bases. Nunca pongas precios: los escribe el equipo. priceBasis dice si en el portal va el valor neto o total con IVA (unknown si no se sabe). validity es la vigencia de la oferta que piden las bases; paymentTerms, la forma de pago; notes, lo que afecta el precio (reajustes, costos incluidos, multas, garantías).
- letter: carta de presentación al organismo, breve, con el nombre y el ID de la licitación, qué ofrece la empresa y la declaración de aceptar las bases; con marcadores para nombre, RUT, representante legal, firma y fecha.
- summary: un párrafo que abre la oferta técnica: qué ofrece la empresa a este organismo y por qué calza.
- missing: hasta 16 datos concretos que el equipo debe completar o confirmar antes de enviar.
- Las bases mandan: si algo de la empresa contradice las bases, dilo en missing. No repitas la guía de postulación (carpetas, plazos del portal).
${input.instructions ? `- Indicaciones del equipo para esta versión: ${input.instructions.slice(0, 1500)}\n` : ''}
OPORTUNIDAD: ${JSON.stringify({ titulo: input.opportunity.title, organismo: input.opportunity.buyer, id: input.opportunity.code || null, cierre: input.opportunity.deadline, monto: input.opportunity.amount, moneda: input.opportunity.currency })}
EMPRESA: ${JSON.stringify({ oferta: input.company.offer.slice(0, 3000), servicios: input.company.services.slice(0, 30), territorios: input.company.territories, noOfrece: input.company.exclusions,
  perfil: input.company.profile ? input.company.profile.slice(0, 2000) : undefined, ...(input.company.extras || {}) })}
INFORME: ${JSON.stringify({ resumen: input.report.executive.slice(0, 2500), requisitos: input.report.requirements.slice(0, 60).map(r => ({ titulo: r.title, estado: r.status, accion: r.action.slice(0, 300) })),
  escenarios: input.report.scenarios.slice(0, 3).map(s => ({ nombre: s.name, meses: s.months, supuestos: s.assumptions.slice(0, 4) })) })}
GUIA: ${JSON.stringify(kit ? { documentos: kit.folders.flatMap(f => f.documents.map(d => ({ carpeta: f.name, titulo: d.title, origen: d.source }))), reglas: kit.rules.map(r => r.text), numeros: kit.numbers, garantias: kit.guarantees } : null)}
LINEAS OFICIALES: ${JSON.stringify(input.officialItems)}
HECHOS DE LAS BASES (con su cita): ${JSON.stringify(offerFacts(input.report))}`;
}

/** A price typed the Chilean way, or null; zero is a price too (an item included at no cost). */
export function offerPrice(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? '').replace(/[^\d.,]/g, '');
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
/** Only the prices of lines that exist, as numbers. */
export function cleanOfferPrices(prices: Record<string, unknown>, lines: number): OfferPrices {
  const out: OfferPrices = {};
  for (const [key, value] of Object.entries(prices || {})) {
    const index = Number(key);
    const price = offerPrice(value);
    if (Number.isInteger(index) && index >= 0 && index < lines && price !== null) out[String(index)] = Math.round(price * 100) / 100;
  }
  return out;
}

/**
 * The economic sheet: each line's subtotal (a line without a quantity counts once), the net total, VAT and total, against
 * the budget. Prices are what the team types: the net unit price, or with VAT when the bases price the portal with VAT.
 */
export function offerSheet(draft: Pick<OfferDraft, 'economic'>, prices: OfferPrices, budget: { amount: number | null; includesTax: boolean | null }) {
  const withTax = draft.economic.priceBasis === 'total';
  const rows = draft.economic.lines.map((line, index) => {
    const unit = prices[String(index)] ?? null;
    const quantity = line.quantity ?? 1;
    return { ...line, index, unitPrice: unit, subtotal: unit === null ? null : Math.round(unit * quantity * 100) / 100 };
  });
  const priced = rows.filter(row => row.subtotal !== null);
  const sum = priced.reduce((total, row) => total + (row.subtotal ?? 0), 0);
  const numbers = priced.length ? offerNumbers(withTax ? { total: sum, budget: budget.amount, budgetIncludesTax: budget.includesTax }
    : { net: sum, budget: budget.amount, budgetIncludesTax: budget.includesTax }) : null;
  return { rows, priced: priced.length, complete: priced.length === rows.length && rows.length > 0, numbers, withTax };
}

const money = (n: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)}`;
const cell = (value: string) => value.replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ');
/** The draft as Markdown, for Word: letter, technical offer, compliance, economic sheet and what is missing. */
export function offerDraftMarkdown(saved: Pick<SavedOfferDraft, 'draft' | 'prices' | 'created_at'>, opportunity: { title: string; buyer?: string | null; amount?: number | null; budgetIncludesTax?: boolean | null }) {
  const { draft } = saved;
  const sheet = offerSheet(draft, saved.prices, { amount: opportunity.amount ?? null, includesTax: opportunity.budgetIncludesTax ?? null });
  const lines = [`# Borrador de oferta: ${opportunity.title}`,
    `${opportunity.buyer ? `${opportunity.buyer} · ` : ''}Preparado por ANTON.IA. Es un borrador: revísalo, completa lo que está entre corchetes y confirma cada dato con las bases antes de enviarlo.`];
  if (draft.missing.length) lines.push('', '## Datos que faltan', ...draft.missing.map(item => `- ${item}`));
  if (draft.letter) lines.push('', '## Carta de presentación', draft.letter);
  lines.push('', '## Oferta técnica');
  if (draft.summary) lines.push(draft.summary);
  for (const section of draft.technical) {
    lines.push('', `### ${section.heading}`);
    if (section.criterion) lines.push(`*Responde a: ${section.criterion}${section.weight ? ` (${section.weight})` : ''}*`);
    lines.push(section.body);
  }
  if (draft.compliance.length) lines.push('', '## Cumplimiento de requisitos técnicos', '', '| Requisito | Respuesta |', '| --- | --- |',
    ...draft.compliance.map(item => `| ${cell(item.requirement)} | ${cell(item.answer)} |`));
  if (sheet.rows.length) {
    lines.push('', '## Oferta económica', '', `| Línea | Unidad | Cantidad | Precio unitario ${sheet.withTax ? 'con IVA' : 'neto'} | Subtotal |`, '| --- | --- | --- | --- | --- |',
      ...sheet.rows.map(row => `| ${cell(row.description)} | ${cell(row.unit || '—')} | ${row.quantity ?? '—'} | ${row.unitPrice === null ? '[precio]' : money(row.unitPrice)} | ${row.subtotal === null ? '—' : money(row.subtotal)} |`));
    if (sheet.numbers) lines.push('', `**Neto:** ${money(sheet.numbers.net)} · **IVA (19 %):** ${money(sheet.numbers.tax)} · **Total:** ${money(sheet.numbers.total)}`
      + (sheet.numbers.budget !== null ? ` · ${sheet.numbers.overBudget ? '**Supera el presupuesto**' : 'Dentro del presupuesto'}` : '')
      + (sheet.complete ? '' : ` · Faltan precios en ${sheet.rows.length - sheet.priced} línea${sheet.rows.length - sheet.priced === 1 ? '' : 's'}`));
    const terms = [draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : '', draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes];
    if (terms.filter(Boolean).length) lines.push('', ...terms.filter(Boolean).map(term => `- ${term}`));
  }
  return lines.join('\n');
}

/** «[N.º de contratos]» marks what the team must fill in: the page highlights them and counts them. */
export const OFFER_PLACEHOLDER = /\[[^\]\n]{2,120}\]/g;
export const offerPlaceholders = (draft: OfferDraft) => [...new Set([draft.letter, draft.summary, ...draft.technical.map(s => s.body), ...draft.compliance.map(c => c.answer)]
  .flatMap(text => text.match(OFFER_PLACEHOLDER) || []))];
