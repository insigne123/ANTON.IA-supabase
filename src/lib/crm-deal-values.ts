/**
 * The value of each deal in the pipeline (Plan 11, PR 4c): what the person writes on a lead («Valor del negocio») and
 * what the panel adds up: the open pipeline by stage, and what was won in the period against the one before. It is
 * behind CRM_DEAL_VALUES_ENABLED, which goes on once the migration 20261005150000_crm_deal_values_stage_events is
 * applied (the columns deal_value, deal_currency, won_at…). Pure: the panel, the detail and the tests share it.
 */
import type { PipelineStage } from '@/lib/crm-types';
import { flowStage } from '@/lib/pipeline-flow';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

export const DEAL_CURRENCIES = ['CLP', 'USD', 'UF', 'EUR'] as const;
export type DealCurrency = (typeof DEAL_CURRENCIES)[number];
export const isDealCurrency = (value: unknown): value is DealCurrency => DEAL_CURRENCIES.includes(value as DealCurrency);
/** «pesos (CLP)», «dólares (USD)», «UF», «euros (EUR)». */
export const DEAL_CURRENCY_NAME: Record<DealCurrency, string> = { CLP: 'pesos (CLP)', USD: 'dólares (USD)', UF: 'UF', EUR: 'euros (EUR)' };
/** The choices of the currency field: «Pesos (CLP)», «Dólares (USD)»… */
export const DEAL_CURRENCY_LABEL: Record<DealCurrency, string> = { CLP: 'Pesos (CLP)', USD: 'Dólares (USD)', UF: 'UF', EUR: 'Euros (EUR)' };

/** The same ceiling as the database check (numeric(14, 2), below 10^12). */
const MAX_VALUE = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const OPEN: PipelineStage[] = ['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation'];

/**
 * An amount as people type it in Chile: «1.200.000», «1200000», «$ 1.200.000», «120,5» (UF). Empty is «no value»
 * (null); anything else that is not a positive amount below the ceiling is 'invalid'.
 */
export function parseDealValue(input: string): number | null | 'invalid' {
  const text = String(input || '').replace(/[\s$€]|US|UF/gi, '');
  if (!text) return null;
  // Dots are thousands and a comma the decimals; a lone dot followed by one or two digits is read as decimals too.
  const normalized = /^\d+\.\d{1,2}$/.test(text) ? text : text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 'invalid';
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && value < MAX_VALUE ? value : 'invalid';
}

const withCurrency = (amount: string, currency: DealCurrency) =>
  currency === 'USD' ? `US$${amount}` : currency === 'UF' ? `UF ${amount}` : currency === 'EUR' ? `€${amount}` : `$${amount}`;

/** «$1.200.000», «US$12.000», «UF 120,5», «€9.000». */
export function formatDealValue(value: number, currency: DealCurrency = 'CLP') {
  return withCurrency(new Intl.NumberFormat('es-CL', { maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value), currency);
}

/** Where there is little room (the center of the donut, a tile's comparison): «$12,5 M», «$850 mil», «UF 120,5». */
export function formatDealValueShort(value: number, currency: DealCurrency = 'CLP') {
  const size = Math.abs(value);
  const [scaled, unit] = size >= 1_000_000 ? [value / 1_000_000, ' M'] : size >= 10_000 ? [value / 1_000, ' mil'] : [value, ''];
  const amount = new Intl.NumberFormat('es-CL', { maximumFractionDigits: unit ? 1 : currency === 'CLP' ? 0 : 2 }).format(scaled);
  return withCurrency(`${amount}${unit}`, currency);
}

/** «+$1,2 M vs 30 días antes», with the sign spelled out so it never depends on color. */
export function dealTrendText(delta: number, currency: DealCurrency, previousLabel: string) {
  if (delta === 0) return `igual que ${previousLabel}`;
  return `${delta > 0 ? '+' : '−'}${formatDealValueShort(Math.abs(delta), currency)} vs ${previousLabel}`;
}

const time = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const currencyOf = (row: UnifiedRow): DealCurrency => (isDealCurrency(row.dealCurrency) ? row.dealCurrency : 'CLP');
/** Whether the lead has a deal value to show and add up. */
export const hasDealValue = (row: Pick<UnifiedRow, 'dealValue'>) =>
  typeof row.dealValue === 'number' && Number.isFinite(row.dealValue) && row.dealValue > 0;
const sum = (list: UnifiedRow[]) => Math.round(list.reduce((total, row) => total + Number(row.dealValue), 0) * 100) / 100;

/** The currency most of these deals use (a tie goes to the first in DEAL_CURRENCIES), and how many use each one. */
function mainCurrency(valued: UnifiedRow[]) {
  const counts = new Map<DealCurrency, number>();
  for (const row of valued) counts.set(currencyOf(row), (counts.get(currencyOf(row)) || 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1] || DEAL_CURRENCIES.indexOf(a[0]) - DEAL_CURRENCIES.indexOf(b[0]))[0][0];
  return { currency, counts };
}
/** When a deal was won: its own date, or the last stage change of a won lead saved before the migration. */
const wonTime = (row: UnifiedRow) => time(row.wonAt) || (flowStage(row) === 'closed_won' ? time(row.stageChangedAt) || time(row.updatedAt) : 0);

export type DealTotals = {
  /** The currency most deals use; totals are in it and never mix currencies. */
  currency: DealCurrency;
  deals: number;
  /** Open deals with a value, and what they add up to. */
  openDeals: number;
  open: number;
  openByStage: Array<{ stage: PipelineStage; value: number }>;
  won: number;
  wonPrevious: number;
  /** Deals in other currencies, counted apart. */
  others: Array<{ currency: DealCurrency; deals: number }>;
};

/** What the panel adds up for the period of `days` ending now; null when no lead has a value yet. */
export function dealTotals(rows: UnifiedRow[], options: { days: number; now?: number }): DealTotals | null {
  const valued = rows.filter(hasDealValue);
  if (!valued.length) return null;
  const { currency, counts } = mainCurrency(valued);
  const mine = valued.filter(row => currencyOf(row) === currency);
  const now = options.now ?? Date.now();
  const from = now - options.days * DAY;
  const previousFrom = from - options.days * DAY;
  const openRows = mine.filter(row => OPEN.includes(flowStage(row)));
  const won = mine.filter(row => flowStage(row) === 'closed_won');
  return {
    currency,
    deals: mine.length,
    openDeals: openRows.length,
    open: sum(openRows),
    openByStage: OPEN.map(stage => ({ stage, value: sum(openRows.filter(row => flowStage(row) === stage)) })),
    won: sum(won.filter(row => wonTime(row) > from && wonTime(row) <= now)),
    wonPrevious: sum(won.filter(row => wonTime(row) > previousFrom && wonTime(row) <= from)),
    others: [...counts.entries()].filter(([code]) => code !== currency).map(([code, deals]) => ({ currency: code, deals })),
  };
}

export type DealSum = { currency: DealCurrency; value: number; deals: number; otherCurrencies: number };

/** What a column of the board adds up, in the currency most of its deals use; deals in other currencies are counted apart. */
export function sumDealValues(rows: UnifiedRow[]): DealSum | null {
  const valued = rows.filter(hasDealValue);
  if (!valued.length) return null;
  const { currency } = mainCurrency(valued);
  const mine = valued.filter(row => currencyOf(row) === currency);
  return { currency, value: sum(mine), deals: mine.length, otherCurrencies: valued.length - mine.length };
}
