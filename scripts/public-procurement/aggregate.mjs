// «Mercado público»: reads one monthly file of ChileCompra's open data (one row per line of a tender and per offer) and
// keeps what the app needs, by tender and by supplier. Pure and without dependencies, so the loader runs in a fresh
// clone; the app folds names the same way (src/lib/public-procurement/market.ts).

/** Lower case, without accents or punctuation, single spaces: «I. Municipalidad de Peñalolén» → «i municipalidad de penalolen». */
export function foldName(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** «76.020.266-5» → «76020266-5»; null when it is not a RUT. */
export function normalizeRut(value) {
  const clean = String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
  if (clean.length < 2 || clean.length > 14) return null;
  const body = clean.slice(0, -1).replace(/^0+/, '');
  const verifier = clean.slice(-1);
  if (!/^[0-9]{1,9}$/.test(body)) return null;
  return `${body}-${verifier}`;
}

// No public purchase in Chile comes near 10^14 pesos: a bigger number is a typo of the file («2e+86», mar 2026).
const MAX_AMOUNT = 1e14;
/** A number of the file («611330260», «2520.5»), or null. */
export function parseAmount(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'NA') return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) && number >= 0 && number < MAX_AMOUNT ? number : null;
}
/** A sum written as a whole number, or null when it is zero or out of reason. */
const total = (value) => value > 0 && value < MAX_AMOUNT * 10 ? Math.round(value) : null;

const UNIT_MONTHS = { 4: 1, 2: 1 / 30.4375, 3: 7 / 30.4375 };
/**
 * The contract's length in months. The unit codes of the file, read from their values (sep 2026): 4 months (12, 24, 36),
 * 2 days (30, 90, 180), 3 weeks; 1 and 0 carry no length.
 */
export function durationMonths(value, unit) {
  const amount = parseAmount(value);
  const factor = UNIT_MONTHS[String(unit ?? '').trim()];
  if (!amount || !factor) return null;
  const months = Math.round(amount * factor * 10) / 10;
  return months > 0 && months <= 240 ? months : null;
}

export function currencyCode(value) {
  const text = foldName(value);
  if (text.startsWith('peso')) return 'CLP';
  if (text.startsWith('unidad de fomento')) return 'UF';
  if (text.startsWith('dolar')) return 'USD';
  if (text.startsWith('euro')) return 'EUR';
  return null;
}

export function tenderStatus(value) {
  const text = foldName(value);
  for (const status of ['adjudicada', 'cerrada', 'desierta', 'revocada', 'suspendida', 'publicada']) if (text.startsWith(status)) return status;
  return 'otra';
}

const WELL_FORMED = /^[0-9]+-[0-9]+-[A-Z0-9]+$/;
const day = (value) => /^\d{4}-\d{2}-\d{2}/.test(String(value ?? '')) ? String(value).slice(0, 10) : null;
const clip = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text && text !== 'NA' ? text.slice(0, max) : null; };

/**
 * Rows of a «;» CSV with quotes, from text chunks: quoted fields may hold «;», line breaks and doubled quotes.
 * A generator, so a 235 MB file never sits in memory.
 */
export async function* csvRows(chunks) {
  let row = []; let field = ''; let quoted = false; let afterQuote = false;
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (quoted) {
        if (char === '"') { quoted = false; afterQuote = true; }
        else field += char;
        continue;
      }
      if (char === '"') {
        // «""» inside a quoted field is one quote.
        if (afterQuote) { field += '"'; quoted = true; afterQuote = false; }
        else if (!field) quoted = true;
        else field += char;
        continue;
      }
      afterQuote = false;
      if (char === ';') { row.push(field); field = ''; }
      else if (char === '\n') { row.push(field.endsWith('\r') ? field.slice(0, -1) : field); field = ''; yield row; row = []; }
      else field += char;
    }
  }
  if (field || row.length) { row.push(field); yield row; }
}

/** Everything one month says, by tender, supplier and bid. */
export class MonthAggregate {
  constructor(month) {
    this.month = month;
    this.tenders = new Map();
    this.bids = new Map();
    this.suppliers = new Map();
    this.agencies = new Map();
    this.rows = 0;
  }

  /**
   * One row of the file, by column name. Tenders are grouped by ChileCompra's numeric id: the file sometimes writes the
   * external code of one tender in two ways («2446-68-LE26» and «2446;68-LE26»), and the well-formed one is kept.
   */
  add(row) {
    this.rows++;
    const code = clip(row.CodigoExterno, 40);
    const id = Number(row.Codigo);
    if (!code || !Number.isSafeInteger(id) || id <= 0) return;
    const agencyId = Number(row.CodigoOrganismo);
    if (Number.isSafeInteger(agencyId) && agencyId > 0 && !this.agencies.has(agencyId)) {
      const name = clip(row.NombreOrganismo, 300);
      if (name) this.agencies.set(agencyId, { id: agencyId, name, name_key: foldName(name), sector: clip(row.sector, 80) });
    }
    let tender = this.tenders.get(id);
    if (tender && !WELL_FORMED.test(tender.code) && WELL_FORMED.test(code)) tender.code = code;
    if (!tender) {
      const currency = currencyCode(row['Moneda Adquisicion']);
      // An estimate the buyer chose to hide (VisibilidadMonto 0) is not shown here either.
      const estimate = row.VisibilidadMonto === '0' ? null : parseAmount(row.MontoEstimado);
      tender = {
        id, code, name: clip(row.Nombre, 300) || code,
        agency_id: Number.isSafeInteger(agencyId) && agencyId > 0 ? agencyId : null,
        region: clip(row.RegionUnidad, 80), kind: clip(row.Tipo, 4),
        status: tenderStatus(row.Estado), currency,
        estimated_amount: estimate && estimate > 0 ? Math.round(estimate) : null,
        awarded_amount: 0, bidders: Number.isFinite(Number(row.NumeroOferentes)) ? Number(row.NumeroOferentes) : null,
        published_on: day(row.FechaPublicacion), closes_on: day(row.FechaCierre), awarded_on: day(row.FechaAdjudicacion),
        duration_months: durationMonths(row.TiempoDuracionContrato, row.UnidadTiempoDuracionContrato),
        criteria: clip(row.CriteriosEvaluacion, 300), categories: new Map(), source_month: this.month,
      };
      this.tenders.set(id, tender);
    }
    const category = clip(row.Rubro2 || row.Rubro1, 160);
    if (category) tender.categories.set(category, (tender.categories.get(category) || 0) + 1);

    const rut = normalizeRut(row.RutProveedor);
    if (!rut) return;
    if (!this.suppliers.has(rut)) this.suppliers.set(rut, { rut, name: clip(row.RazonSocialProveedor || row.NombreProveedor, 300) || rut });
    const key = `${id}|${rut}`;
    let bid = this.bids.get(key);
    if (!bid) { bid = { tenderId: id, rut, offered: 0, awarded: 0, selected: false }; this.bids.set(key, bid); }
    bid.offered += parseAmount(row['Valor Total Ofertado']) || 0;
    const awarded = parseAmount(row.MontoLineaAdjudica) || 0;
    if (/^seleccionada$/i.test(String(row['Oferta seleccionada'] || '').trim())) {
      bid.selected = true;
      bid.awarded += awarded;
      tender.awarded_amount += awarded;
    }
  }

  /** The rows to write for a scope: «all», «winners» (awarded, winning bids) or «long» (awarded, 18 months or more). */
  forScope(scope) {
    const keep = (tender) => scope === 'all' || (tender.status === 'adjudicada' && (scope === 'winners' || (tender.duration_months ?? 0) >= 18));
    const tenders = [...this.tenders.values()].filter(keep).map(({ categories, ...tender }) => ({
      ...tender,
      category: [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      awarded_amount: total(tender.awarded_amount),
      // The criteria help read the last year; older months keep what was bought, from whom and for how much.
      criteria: scope === 'all' ? tender.criteria : null,
      bids_scope: scope === 'all' ? 'all' : 'winners',
    }));
    const kept = new Set(tenders.map(tender => tender.id));
    const bids = [...this.bids.values()].filter(bid => kept.has(bid.tenderId) && (scope === 'all' || bid.selected));
    const ruts = new Set(bids.map(bid => bid.rut));
    const agencyIds = new Set(tenders.map(tender => tender.agency_id).filter(Boolean));
    return {
      tenders, bids: bids.map(bid => ({ ...bid, offered: total(bid.offered), awarded: total(bid.awarded) })),
      suppliers: [...this.suppliers.values()].filter(supplier => ruts.has(supplier.rut)),
      agencies: [...this.agencies.values()].filter(agency => agencyIds.has(agency.id)),
    };
  }
}

/** Reads a whole file (header first) into a MonthAggregate. */
export async function aggregateMonth(month, chunks) {
  const aggregate = new MonthAggregate(month);
  let header = null;
  for await (const values of csvRows(chunks)) {
    if (!header) { header = values.map(name => name.replace(/^﻿/, '').trim()); continue; }
    if (values.length !== header.length) continue;
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i];
    aggregate.add(row);
  }
  return aggregate;
}

/**
 * Which months to keep and how, counting back from the current one (index 0): 0–11 everything, 12–23 winners, 24–47 long
 * contracts. Older months are deleted.
 */
export function monthPlan(now = new Date(), months = 48) {
  const plan = [];
  for (let index = 0; index < months; index++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    plan.push({ index, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, sourceMonth: date.toISOString().slice(0, 10),
      scope: index < 12 ? 'all' : index < 24 ? 'winners' : 'long' });
  }
  return plan;
}
