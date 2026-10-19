/**
 * «Mercado público» (propuestas 9, 10 y 11): reading ChileCompra's history the way a bid manager would. Which past tenders
 * of a buyer look like this one, who won them and at what price against the estimate, how many bid, how often they were
 * declared deserted, and when a contract in force ends. Pure: the server reads the tables
 * (20261019120000_public_procurement.sql), this decides. Names fold exactly as the loader folds them
 * (scripts/public-procurement/aggregate.mjs).
 */

export type MarketWinner = { rut: string; name: string; amount: number | null };
export type MarketTender = {
  id: number;
  code: string;
  name: string;
  agency: string | null;
  status: 'adjudicada' | 'cerrada' | 'desierta' | 'revocada' | 'suspendida' | 'publicada' | 'otra';
  kind: string | null;
  currency: string | null;
  estimatedAmount: number | null;
  awardedAmount: number | null;
  bidders: number | null;
  publishedOn: string | null;
  awardedOn: string | null;
  durationMonths: number | null;
  category: string | null;
  /** The names of the evaluation criteria, for the last 12 months («Precio ; Experiencia ; Plazo de entrega»). */
  criteria?: string | null;
  winners: MarketWinner[];
  /** Bids known for this tender: all of them in the last 12 months, the winners before. */
  bids: Array<{ rut: string; name: string; offered: number | null; selected: boolean }>;
};

export function foldName(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function normalizeRut(value: unknown) {
  const clean = String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
  if (clean.length < 2 || clean.length > 14) return null;
  const body = clean.slice(0, -1).replace(/^0+/, '');
  if (!/^[0-9]{1,9}$/.test(body)) return null;
  return `${body}-${clean.slice(-1)}`;
}

// Words that do not tell one buyer from another.
const AGENCY_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i', 'en', 'ilustre']);
/** The words of a buyer's name that tell it apart: «Municipalidad de Maipú» → municipalidad, maipu. */
export function agencyTokens(name: unknown) {
  return [...new Set(foldName(name).split(' ').filter(word => word.length >= 3 && !AGENCY_STOP.has(word)))];
}
/**
 * The ways ChileCompra may write the same buyer: the opportunity says «Municipalidad de Maipú» and the file
 * «I MUNICIPALIDAD DE MAIPU» or «ILUSTRE MUNICIPALIDAD DE MAIPU».
 */
export function agencyKeyVariants(name: unknown) {
  const key = foldName(name);
  if (key.length < 4) return [];
  const core = key.replace(/^(ilustre|i) /, '');
  return [...new Set([key, core, `i ${core}`, `ilustre ${core}`])];
}
/**
 * Of the agencies whose names hold every word of the buyer's, the one with the fewest other words: «Hospital de Talca» is
 * «Servicio de Salud del Maule Hospital de Talca», never «… Talcahuano». One word alone («Hospital») says too little.
 */
export function bestAgencyMatch<T extends { name_key: string }>(buyer: unknown, rows: T[]) {
  const wanted = agencyTokens(buyer);
  if (wanted.length < 2) return null;
  let best: { row: T; extra: number } | null = null;
  for (const row of rows) {
    const tokens = new Set(agencyTokens(row.name_key));
    if (!wanted.every(word => tokens.has(word))) continue;
    const extra = tokens.size - wanted.length;
    if (!best || extra < best.extra || (extra === best.extra && row.name_key.length < best.row.name_key.length)) best = { row, extra };
  }
  return best?.row ?? null;
}

/** «76020266-5» → «76.020.266-5». */
export function formatRut(rut: string) {
  const [body, verifier] = rut.split('-');
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${verifier}`;
}

export function tenderUrl(code: string) {
  return `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(code)}`;
}

// Words every tender says: they make two tenders look alike without being so.
const STOP = new Set(('para por con del los las una uno unos unas sus que segun entre desde hasta sobre como mas menos este esta estos estas otros otras '
  + 'servicio servicios adquisicion adquisiciones contratacion contrato contratos compra compras suministro suministros licitacion licitaciones '
  + 'publica publico privada anual anuales mensual diversos diversas varios varias general generales programa proyecto proyectos region regional '
  + 'comuna comunal municipal municipalidad ilustre hospital servicio salud gobierno nacional dependencias propuesta llamado convenio marco trato '
  + 'directo nuevo nueva etapa '
  + 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre').split(/\s+/));

// The same purchase said in other words (stems, as topicTokens leaves them): the first one stands for the group.
const SYNONYMS = [
  ['vigilancia', 'guardia', 'guardias'], ['aseo', 'limpieza'], ['mantencion', 'mantenimiento', 'conservacion'],
  ['vehiculo', 'camioneta', 'automovil', 'furgon'], ['computador', 'notebook', 'computacional'], ['alimentacion', 'alimento', 'colacion', 'racion'],
  ['capacitacion', 'curso', 'formacion'], ['arriendo', 'arrendamiento', 'alquiler'], ['traslado', 'transporte'], ['camara', 'cctv', 'televigilancia', 'videovigilancia'],
  ['impresion', 'imprenta'], ['fumigacion', 'desratizacion', 'sanitizacion', 'control plaga'],
];
const CANON = new Map(SYNONYMS.flatMap(group => group.map(word => [word, group[0]] as const)));
const stem = (word: string) => word.length > 5 && word.endsWith('es') ? word.slice(0, -2) : word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;

/** The words that say what is bought: folded, four letters or more, without the words every tender says, synonyms as one. */
export function topicTokens(text: unknown) {
  const tokens = new Set<string>();
  for (const word of foldName(text).split(' ')) {
    if (word.length < 4 || STOP.has(word) || /^\d+$/.test(word)) continue;
    // «guardias» and «guardia», «camaras» and «camara» are the same thing; «guardia» and «vigilancia» too.
    const stemmed = stem(word);
    tokens.add(CANON.get(stemmed) ?? stemmed);
  }
  return [...tokens];
}

/** The words to search the history with: each topic word and the other ways of saying it. */
export function searchWords(tokens: string[], max = 10) {
  const out = new Set<string>();
  for (const token of tokens) {
    for (const word of SYNONYMS.find(group => group[0] === token) ?? [token]) { if (out.size < max) out.add(word); }
  }
  return [...out];
}

/** How alike two tenders' names are: the shared topic words, against the size of both (0 to 1). */
export function similarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const shared = a.filter(token => set.has(token)).length;
  return shared / Math.sqrt(a.length * b.length);
}

/**
 * How alike a past tender is to the one in hand. The name decides: the category is ChileCompra's family of the main line,
 * and «Insumos óptica comunal» can carry «Seguridad, vigilancia y detección». It only adds to a name that shares a word,
 * or stands in for a name that says nothing («Propuesta pública N° 486-2023»).
 */
export function tenderSimilarity(target: string[], tender: { name: string; category: string | null }) {
  const name = topicTokens(tender.name);
  const category = topicTokens(tender.category || '');
  const byName = similarity(target, name);
  if (byName > 0) return Math.min(1, byName + 0.25 * similarity(target, category));
  return name.length ? 0 : 0.6 * similarity(target, category);
}

const DECIDED = new Set(['adjudicada', 'desierta', 'revocada']);
/**
 * The past tenders most like the one in hand, alike enough to compare. Among those about as alike, the ones already decided
 * first: a tender still in evaluation does not say who won nor at what price.
 */
export function pickSimilar<T extends Pick<MarketTender, 'name' | 'category'> & { status?: string }>(title: string, tenders: T[], limit = 8, minimum = 0.3) {
  const target = topicTokens(title);
  return tenders
    .map(tender => ({ tender, score: tenderSimilarity(target, tender) }))
    .filter(item => item.score >= minimum)
    .sort((a, b) => (b.score + (DECIDED.has(b.tender.status || '') ? 0.1 : 0)) - (a.score + (DECIDED.has(a.tender.status || '') ? 0.1 : 0)))
    .slice(0, limit);
}

/** The median, to a thousandth (a ratio of 0.85, not 0.8500000000000001). */
export function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 1000) / 1000;
}

/** The value below which a share of the values falls (0.25 → first quartile), to a thousandth; null without values. */
export function quantile(values: number[], q: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const low = Math.floor(position); const high = Math.ceil(position);
  return Math.round((sorted[low] + (sorted[high] - sorted[low]) * (position - low)) * 1000) / 1000;
}

/** What a contract costs per month, in pesos: its award over its length; null without either. */
export function monthlyAmount(tender: Pick<MarketTender, 'currency' | 'awardedAmount' | 'durationMonths' | 'status'>) {
  if (tender.status !== 'adjudicada' || tender.currency !== 'CLP' || !tender.awardedAmount || !tender.durationMonths || tender.durationMonths < 1) return null;
  return Math.round(tender.awardedAmount / tender.durationMonths);
}

/** Awarded against estimated, in pesos and within reason (a ratio outside 0.2–2 is usually a different unit or currency). */
export function awardRatio(tender: Pick<MarketTender, 'currency' | 'estimatedAmount' | 'awardedAmount' | 'status'>) {
  if (tender.status !== 'adjudicada' || tender.currency !== 'CLP' || !tender.estimatedAmount || !tender.awardedAmount) return null;
  const ratio = tender.awardedAmount / tender.estimatedAmount;
  return ratio >= 0.2 && ratio <= 2 ? ratio : null;
}

export type MarketStats = {
  tenders: number;
  awarded: number;
  deserted: number;
  revoked: number;
  /** Median bidders of the tenders that closed. */
  medianBidders: number | null;
  /** Median awarded / estimated, in pesos. */
  medianAwardRatio: number | null;
  winners: Array<{ rut: string; name: string; wins: number; amount: number }>;
};

export function marketStats(tenders: MarketTender[]): MarketStats {
  const winners = new Map<string, { rut: string; name: string; wins: number; amount: number }>();
  for (const tender of tenders) {
    for (const winner of tender.winners) {
      const entry = winners.get(winner.rut) || { rut: winner.rut, name: winner.name, wins: 0, amount: 0 };
      entry.wins++; entry.amount += tender.currency === 'CLP' ? winner.amount || 0 : 0;
      winners.set(winner.rut, entry);
    }
  }
  return {
    tenders: tenders.length,
    awarded: tenders.filter(tender => tender.status === 'adjudicada').length,
    deserted: tenders.filter(tender => tender.status === 'desierta').length,
    revoked: tenders.filter(tender => tender.status === 'revocada').length,
    medianBidders: median(tenders.filter(tender => tender.status !== 'publicada' && tender.bidders !== null).map(tender => tender.bidders as number)),
    medianAwardRatio: median(tenders.map(awardRatio).filter((ratio): ratio is number => ratio !== null)),
    winners: [...winners.values()].sort((a, b) => b.wins - a.wins || b.amount - a.amount).slice(0, 5),
  };
}

/**
 * When a contract in force ends: the award plus its length, in calendar months (a day that does not exist in the last
 * month is its last day, as Postgres adds intervals in public_procurement_expiring); null without either.
 */
export function contractEndsOn(awardedOn: string | null | undefined, durationMonths: number | null | undefined) {
  if (!awardedOn || !durationMonths || !/^\d{4}-\d{2}-\d{2}/.test(awardedOn)) return null;
  const [year, month, day] = awardedOn.slice(0, 10).split('-').map(Number);
  const whole = Math.floor(durationMonths);
  const target = new Date(Date.UTC(year, month - 1 + whole, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  target.setUTCDate(target.getUTCDate() + Math.round((durationMonths - whole) * 30.4375));
  return Number.isFinite(target.getTime()) ? target.toISOString().slice(0, 10) : null;
}

/** Lowercase and without accents, keeping the rest as written: how the SQL functions compare (public_procurement_fold). */
export function foldForSearch(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Little words a phrase keeps between its content words.
const LINKS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'para', 'por', 'con', 'a', 'al']);

/**
 * The LIKE patterns of the workspace's words for the SQL functions, folded as they fold the text: «%aseo%». Short and
 * generic words are left out. A long phrase also searches by its first two content words, as tenders seldom write a
 * phrase whole: «verificación de antecedentes judiciales» also finds «Servicios de verificación de antecedentes y
 * evaluación psicológica».
 */
export function likePatterns(words: string[], max = 25) {
  const out = new Set<string>();
  const add = (text: string) => { if (out.size < max && text.length >= 4 && !STOP.has(foldName(text))) out.add(`%${text}%`); };
  for (const word of words) {
    const text = foldForSearch(word).replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
    add(text);
    const parts = text.split(' ');
    const content = parts.map((part, index) => ({ part, index })).filter(item => !LINKS.has(item.part) && item.part.length >= 3);
    if (content.length >= 3) add(parts.slice(content[0].index, content[1].index + 1).join(' '));
    if (out.size >= max) break;
  }
  return [...out];
}

const PESOS = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
/** «$1.234 millones», «$12,5 mil millones», «UF 3.400». */
export function moneyLabel(amount: number | null | undefined, currency: string | null = 'CLP') {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  if (currency && currency !== 'CLP') return `${currency} ${PESOS.format(amount)}`;
  if (amount >= 1e9) return `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(amount / 1e9)} mil millones`;
  if (amount >= 1e6) return `$${PESOS.format(amount / 1e6)} millones`;
  return `$${PESOS.format(amount)}`;
}

/** «82 %» of the estimate, or null. */
export function percentLabel(ratio: number | null | undefined) {
  return ratio === null || ratio === undefined ? null : `${Math.round(ratio * 100)} %`;
}
