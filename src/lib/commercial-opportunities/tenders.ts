import { chileanRegion } from './hiring';

/**
 * Public tenders (plan 8, phase 3, PR-3d): Mercado Público tenders (API v1) and Compra Ágil quotes (API v2) in one shape,
 * matched against the keywords and UNSPSC codes of the search profile and scored. Pure: the clients bring the data.
 * About the buyer only the public body and its unit are kept, never the official who published it.
 */
export type TenderSource = 'mercado_publico' | 'compra_agil';
export type Tender = {
  source: TenderSource;
  code: string;
  name: string;
  description: string | null;
  buyer: string | null;
  buyerUnit: string | null;
  region: string | null;
  amount: number | null;
  currency: string | null;
  publishedAt: string | null;
  closesAt: string | null;
  status: string | null;
  items: Array<{ code: string | null; name: string }>;
};
export type TenderProfile = { keywords: string[]; unspscCodes: string[]; regions: string[] };

const text = (value: unknown, max = 500) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
/** Mercado Público dates come without a zone and are Chilean time; ISO dates with a zone are kept as they are. */
const iso = (value: unknown) => {
  const raw = text(value, 40);
  if (!raw) return null;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}-03:00`;
  const time = Date.parse(withZone);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** Compra Ágil region codes (1 to 16) to the names of the rest of the app. */
const COMPRA_AGIL_REGIONS: Record<number, string> = {
  1: 'Tarapacá', 2: 'Antofagasta', 3: 'Atacama', 4: 'Coquimbo', 5: 'Valparaíso', 6: "O'Higgins", 7: 'Maule', 8: 'Biobío',
  9: 'La Araucanía', 10: 'Los Lagos', 11: 'Aysén', 12: 'Magallanes', 13: 'Metropolitana', 14: 'Los Ríos', 15: 'Arica y Parinacota', 16: 'Ñuble',
};

/** One item of the Compra Ágil listing (GET /v2/compra-agil, payload.items[]) or its detail. */
export function tenderFromCompraAgil(raw: Record<string, any>): Tender | null {
  const code = text(raw.codigo, 60), name = text(raw.nombre, 500);
  if (!code || !name) return null;
  const regionCode = Number(raw.institucion?.region);
  const products = Array.isArray(raw.productos_solicitados) ? raw.productos_solicitados : [];
  return {
    source: 'compra_agil', code, name, description: text(raw.descripcion, 2000) || null,
    buyer: text(raw.institucion?.organismo_comprador, 300) || null, buyerUnit: text(raw.institucion?.unidad_compra, 300) || null,
    region: COMPRA_AGIL_REGIONS[regionCode] ?? chileanRegion(text(raw.institucion?.nombre_region, 80)),
    amount: number(raw.montos?.monto_disponible_clp ?? raw.presupuesto?.monto_disponible_clp ?? raw.montos?.monto_disponible ?? raw.presupuesto?.monto_disponible),
    currency: 'CLP',
    publishedAt: iso(raw.fechas?.fecha_publicacion), closesAt: iso(raw.fechas?.fecha_cierre),
    status: text(raw.estado?.codigo, 40) || null,
    items: products.slice(0, 20).flatMap((item: Record<string, unknown>) => {
      const itemName = text(item.nombre, 200);
      return itemName ? [{ code: item.codigo_producto === undefined || item.codigo_producto === null ? null : String(item.codigo_producto).slice(0, 20), name: itemName }] : [];
    }),
  };
}

const LICITACION_STATES: Record<number, string> = { 5: 'publicada', 6: 'cerrada', 7: 'desierta', 8: 'adjudicada', 18: 'revocada', 19: 'suspendida' };
/** One tender of the Mercado Público API v1 (licitaciones.json, Listado[]), from the listing or the detail. */
export function tenderFromLicitacion(raw: Record<string, any>): Tender | null {
  const code = text(raw.CodigoExterno, 60), name = text(raw.Nombre, 500);
  if (!code || !name) return null;
  const items = Array.isArray(raw.Items?.Listado) ? raw.Items.Listado : [];
  return {
    source: 'mercado_publico', code, name, description: text(raw.Descripcion, 2000) || null,
    buyer: text(raw.Comprador?.NombreOrganismo, 300) || null, buyerUnit: text(raw.Comprador?.NombreUnidad, 300) || null,
    region: chileanRegion(text(raw.Comprador?.RegionUnidad, 120) || text(raw.Comprador?.ComunaUnidad, 120)),
    amount: number(raw.MontoEstimado), currency: text(raw.Moneda, 8) || null,
    publishedAt: iso(raw.Fechas?.FechaPublicacion), closesAt: iso(raw.Fechas?.FechaCierre ?? raw.FechaCierre),
    status: LICITACION_STATES[Number(raw.CodigoEstado)] ?? (text(raw.Estado, 40).toLowerCase() || null),
    items: items.slice(0, 20).flatMap((item: Record<string, unknown>) => {
      const itemName = text(item.NombreProducto, 200) || text(item.Descripcion, 200);
      return itemName ? [{ code: item.CodigoProducto === undefined || item.CodigoProducto === null ? null : String(item.CodigoProducto).slice(0, 20), name: itemName }] : [];
    }),
  };
}

/** The public page of a tender. Compra Ágil has no stable public link to cite: the page shows its code instead. */
export function tenderUrl(tender: Pick<Tender, 'source' | 'code'>) {
  return tender.source === 'mercado_publico'
    ? `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(tender.code)}`
    : null;
}

const phrase = (haystack: string, needle: string) => {
  const term = fold(needle).trim();
  return term.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(fold(haystack));
};
const DAY = 86_400_000;

/**
 * Whether a tender fits the offer, and how well (0 to 100, with reasons). It fits when a keyword is in its name,
 * description or items, or an item has one of the profile's UNSPSC codes (a code of 8 digits, or a family prefix). Closed
 * or past-deadline tenders never fit.
 */
export function matchTender(tender: Tender, profile: TenderProfile, now: string) {
  const closes = tender.closesAt ? Date.parse(tender.closesAt) : NaN;
  if (Number.isFinite(closes) && closes < Date.parse(now)) return null;
  if (tender.status && !['publicada', 'publicado', 'activa'].includes(tender.status)) return null;
  const inName = profile.keywords.filter(keyword => phrase(tender.name, keyword));
  const inText = profile.keywords.filter(keyword => !inName.includes(keyword)
    && (phrase(tender.description || '', keyword) || tender.items.some(item => phrase(item.name, keyword))));
  const codes = profile.unspscCodes.map(code => code.replace(/\D/g, '')).filter(Boolean);
  const codeHits = tender.items.filter(item => item.code && codes.some(code => item.code!.replace(/\D/g, '').startsWith(code)));
  if (!inName.length && !inText.length && !codeHits.length) return null;
  const reasons: string[] = [];
  let score = 0;
  if (inName.length) { score += 45; reasons.push(`el nombre dice «${inName[0]}»`); }
  else if (inText.length) { score += 30; reasons.push(`la descripción dice «${inText[0]}»`); }
  if (codeHits.length) { score += 20; reasons.push(`pide ${codeHits[0].name.toLowerCase()} (código ${codeHits[0].code})`); }
  if (tender.amount !== null) {
    if (tender.amount >= 50_000_000) score += 15; else if (tender.amount >= 10_000_000) score += 10; else if (tender.amount > 0) score += 5;
  }
  if (Number.isFinite(closes)) {
    const days = Math.floor((closes - Date.parse(now)) / DAY);
    if (days >= 5) score += 10; else if (days >= 2) score += 5;
    reasons.push(days <= 0 ? 'cierra hoy' : days === 1 ? 'cierra mañana' : `cierra en ${days} días`);
  }
  if (tender.region && profile.regions.some(region => fold(region) === fold(tender.region!))) { score += 10; reasons.push(`en ${tender.region}`); }
  return { score: Math.min(100, score), reasons, keywords: [...inName, ...inText] };
}
