import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';
import { buildPipelineFlow, flowStage } from '@/lib/pipeline-flow';
import type { UnifiedKind, UnifiedRow } from '@/lib/unified-sheet-types';

/**
 * The pipeline as a CRM panel (Plan 11, PR 4a), like the reference the user shared: figures that compare with the
 * previous period, the open pipeline by stage, how far each stage gets, contacts per month against their own recent
 * average and the new leads of the last 13 months, plus a few sentences that read it for the person. Pure: the panel and
 * its tests share it. Only what the data supports is compared: dates exist for new leads, sends and replies; the stage
 * of a lead is a photo of today until the stage history (PR 4b) is in.
 */
export type DashboardPeriod = '7d' | '30d' | '90d' | '365d';
export const DASHBOARD_PERIODS: Array<{ id: DashboardPeriod; label: string; days: number; previous: string; short: string }> = [
  { id: '7d', label: 'Últimos 7 días', days: 7, previous: 'los 7 días anteriores', short: '7 días antes' },
  { id: '30d', label: 'Últimos 30 días', days: 30, previous: 'los 30 días anteriores', short: '30 días antes' },
  { id: '90d', label: 'Últimos 90 días', days: 90, previous: 'los 90 días anteriores', short: '90 días antes' },
  { id: '365d', label: 'Último año', days: 365, previous: 'el año anterior', short: 'el año anterior' },
];
export type DashboardOrigin = 'all' | UnifiedKind;
export const DASHBOARD_ORIGINS: Array<{ id: DashboardOrigin; label: string }> = [
  { id: 'all', label: 'Todos los orígenes' },
  { id: 'lead_saved', label: 'Guardados' },
  { id: 'lead_enriched', label: 'Enriquecidos' },
  { id: 'contacted', label: 'Contactados' },
  { id: 'opportunity', label: 'Oportunidades' },
];
/** The open stages, in order: the donut shows these (six at most, as a part-to-whole should). */
export const OPEN_STAGES: PipelineStage[] = ['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation'];
const LATE_STAGES: PipelineStage[] = ['contacted', 'engaged', 'meeting', 'negotiation'];
const STALE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type Trend = { value: number; previous: number; delta: number; direction: 'up' | 'down' | 'flat' };
export type RateTrend = { value: number | null; previous: number | null; deltaPoints: number | null };
export type MonthPoint = { key: string; label: string; contacted: number; replied: number; newLeads: number; responseRate: number | null };
export type DashboardInsight = { id: 'contacts' | 'replies' | 'stalled' | 'empty'; text: string; stage?: PipelineStage };
export type PipelineDashboard = {
  period: (typeof DASHBOARD_PERIODS)[number];
  total: number;
  open: number;
  newLeads: Trend;
  contacted: Trend;
  responseRate: RateTrend;
  meetings: number;
  won: number;
  lost: number;
  winRate: number | null;
  stages: Array<{ stage: PipelineStage; label: string; count: number; share: number }>;
  funnel: Array<{ stage: PipelineStage; label: string; reached: number; conversionToNext: number | null }>;
  months: MonthPoint[];
  /** Average contacts per month over the three months before the current one; null without history. */
  contactedThreshold: number | null;
  insights: DashboardInsight[];
};

const time = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const sentAt = (row: UnifiedRow) => time(row.sentAt) || time(row.createdAt);
const replied = (row: UnifiedRow) => row.status === 'replied' || Boolean(time(row.repliedAt));
const label = (stage: PipelineStage) => PIPELINE_STAGES.find(item => item.id === stage)?.label || stage;

/** Rows of one owner and origin; «all» keeps everyone. An owner name is matched without case or accents. */
export function filterPipelineRows(rows: UnifiedRow[], filters: { owner?: string; origin?: DashboardOrigin }) {
  const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const owner = filters.owner && filters.owner !== 'all' ? fold(filters.owner) : '';
  return rows.filter(row => (!owner || fold(row.owner) === owner) && (!filters.origin || filters.origin === 'all' || row.kind === filters.origin));
}

/** The people responsible that appear in the rows, for the owner filter. */
export function pipelineOwners(rows: UnifiedRow[]) {
  return [...new Set(rows.map(row => String(row.owner || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function trend(value: number, previous: number): Trend {
  return { value, previous, delta: value - previous, direction: value > previous ? 'up' : value < previous ? 'down' : 'flat' };
}

const monthFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' });
const monthLabelFormat = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', month: 'short', year: '2-digit' });
/** «2026-10», in Chilean time. */
export const monthKey = (at: number) => monthFormat.format(new Date(at)).slice(0, 7);
function lastMonths(now: number, count: number) {
  const [year, month] = monthKey(now).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 15));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return { key, label: monthLabelFormat.format(date).replace('.', '').replace(' ', ' ’') };
  });
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const percent = (value: number) => `${Math.round(value * 100)} %`;

export function buildPipelineDashboard(rows: UnifiedRow[], options: { now?: number; period?: DashboardPeriod } = {}): PipelineDashboard {
  const now = options.now ?? Date.now();
  const period = DASHBOARD_PERIODS.find(item => item.id === options.period) || DASHBOARD_PERIODS[1];
  const start = now - period.days * DAY;
  const previousStart = start - period.days * DAY;
  const inWindow = (at: number, from: number, to: number) => at > from && at <= to;

  const flow = buildPipelineFlow(rows, { now });
  const countOf = (stage: PipelineStage) => flow.nodes.find(node => node.stage === stage)?.count ?? 0;
  const openTotal = OPEN_STAGES.reduce((sum, stage) => sum + countOf(stage), 0);
  const won = countOf('closed_won');
  const lost = flow.lost.count;

  // People added to the pipeline (a conversation is not a new lead), and the sends of the period with how many replied.
  const people = rows.filter(row => row.kind !== 'contacted');
  const sends = rows.filter(row => row.kind === 'contacted' && sentAt(row));
  const newLeads = trend(
    people.filter(row => inWindow(time(row.createdAt), start, now)).length,
    people.filter(row => inWindow(time(row.createdAt), previousStart, start)).length,
  );
  const sentNow = sends.filter(row => inWindow(sentAt(row), start, now));
  const sentBefore = sends.filter(row => inWindow(sentAt(row), previousStart, start));
  const contacted = trend(sentNow.length, sentBefore.length);
  const rate = (list: UnifiedRow[]) => (list.length ? list.filter(replied).length / list.length : null);
  const responseNow = rate(sentNow);
  const responseBefore = rate(sentBefore);
  const responseRate: RateTrend = {
    value: responseNow, previous: responseBefore,
    deltaPoints: responseNow === null || responseBefore === null ? null : Math.round((responseNow - responseBefore) * 100),
  };

  const months = lastMonths(now, 13).map(month => ({ ...month, contacted: 0, replied: 0, newLeads: 0, responseRate: null as number | null }));
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));
  for (const row of sends) {
    const index = monthIndex.get(monthKey(sentAt(row)));
    if (index === undefined) continue;
    months[index].contacted++;
    if (replied(row)) months[index].replied++;
  }
  for (const row of people) {
    const created = time(row.createdAt);
    const index = created ? monthIndex.get(monthKey(created)) : undefined;
    if (index !== undefined) months[index].newLeads++;
  }
  for (const month of months) month.responseRate = month.contacted ? month.replied / month.contacted : null;
  const before = months.slice(-4, -1);
  const contactedThreshold = before.some(month => month.contacted) ? Math.round((before.reduce((sum, month) => sum + month.contacted, 0) / before.length) * 10) / 10 : null;

  const insights: DashboardInsight[] = [];
  if (!rows.length) insights.push({ id: 'empty', text: 'Aún no hay leads: cuando guardes o contactes personas, el panel se arma solo.' });
  if (contacted.value || contacted.previous) {
    const change = contacted.delta === 0 ? 'lo mismo que en'
      : `${Math.abs(contacted.delta)} ${contacted.delta > 0 ? 'más' : 'menos'} que en`;
    insights.push({ id: 'contacts', text: `En ${period.label.toLowerCase()} contactaste a ${plural(contacted.value, 'persona', 'personas')}, ${change} ${period.previous}.` });
  }
  if (responseNow !== null && sentNow.length >= 3) {
    const comparison = responseBefore === null ? '' : responseNow > responseBefore ? `, más que en ${period.previous} (${percent(responseBefore)})`
      : responseNow < responseBefore ? `, menos que en ${period.previous} (${percent(responseBefore)})` : `, igual que en ${period.previous}`;
    insights.push({ id: 'replies', text: `Respondió el ${percent(responseNow)} de quienes contactaste${comparison}.` });
  }
  const stalled = LATE_STAGES.map(stage => ({
    stage, count: rows.filter(row => flowStage(row) === stage && (time(row.updatedAt) || time(row.createdAt) || now) < now - STALE_DAYS * DAY).length,
  })).sort((a, b) => b.count - a.count)[0];
  if (stalled && stalled.count >= 3) {
    insights.push({ id: 'stalled', stage: stalled.stage,
      text: `«${label(stalled.stage)}» tiene ${plural(stalled.count, 'lead', 'leads')} sin movimiento hace más de ${STALE_DAYS} días: revisa a quién darle seguimiento.` });
  }

  return {
    period, total: rows.length, open: openTotal, newLeads, contacted, responseRate,
    meetings: flow.kpis.meetings, won, lost, winRate: won + lost ? won / (won + lost) : null,
    stages: OPEN_STAGES.map(stage => ({ stage, label: label(stage), count: countOf(stage), share: openTotal ? countOf(stage) / openTotal : 0 })),
    funnel: flow.nodes.map(node => ({ stage: node.stage, label: node.label, reached: node.reached, conversionToNext: node.conversionToNext })),
    months, contactedThreshold, insights: insights.slice(0, 3),
  };
}

/** «+4 vs los 30 días anteriores», with the sign spelled out so it never depends on color. */
export function trendText(delta: number, previousLabel: string) {
  if (delta === 0) return `igual que ${previousLabel}`;
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs ${previousLabel}`;
}
