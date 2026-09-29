import type { CoworkBlock } from './contracts';

/**
 * Charts of what Cowork read (plan 2, G3). The app draws them from the reads of the turn, so a
 * figure on a chart is one the data holds: the model never writes a chart, and one it writes
 * anyway is dropped. A chart goes under the figures card (metrics) of an answer, with the data
 * that card is about. Without sends there is nothing to draw, and no chart.
 */

type Chart = Extract<CoworkBlock, { type: 'chart' }>;
type Observation = { action: string; input?: string; result?: unknown };

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const all = <T>(values: Array<T | null>): values is T[] => values.every(value => value !== null);

/** Emails sent and what came back, over the last 7 and 30 days (metrics.rates). */
function ratesChart(result: unknown): Chart | null {
  const rates = result as { last_7_days?: Record<string, unknown>; last_30_days?: Record<string, unknown> } | null;
  const fields = [['Enviados', 'sent'], ['Respuestas', 'humanReplies'], ['Positivas', 'positives'], ['Rebotes', 'bounces']] as const;
  const week = fields.map(([, key]) => count(rates?.last_7_days?.[key]));
  const month = fields.map(([, key]) => count(rates?.last_30_days?.[key]));
  if (!all(week) || !all(month) || month[0] === 0) return null;
  return { type: 'chart', title: 'Correos enviados y lo que volvió', kind: 'bar', period: 'Últimos 7 y 30 días', unit: null,
    labels: fields.map(([label]) => label), series: [{ name: 'Últimos 7 días', values: week }, { name: 'Últimos 30 días', values: month }] };
}

/** Email and LinkedIn side by side, over the last 30 days (metrics.channels). */
function channelsChart(result: unknown): Chart | null {
  const channels = result as { email?: Record<string, unknown>; linkedin?: Record<string, unknown> } | null;
  const fields = [['Enviados', 'sent'], ['Respuestas', 'replies']] as const;
  const email = fields.map(([, key]) => count(channels?.email?.[key]));
  const linkedin = fields.map(([, key]) => count(channels?.linkedin?.[key]));
  if (!all(email) || !all(linkedin) || email[0] + linkedin[0] === 0) return null;
  return { type: 'chart', title: 'Correo y LinkedIn', kind: 'bar', period: 'Últimos 30 días', unit: null,
    labels: fields.map(([label]) => label), series: [{ name: 'Correo', values: email }, { name: 'LinkedIn', values: linkedin }] };
}

/** What became of each touch of one campaign (campaigns.batch_report). */
function batchChart(result: unknown): Chart | null {
  const report = result as { campaign?: { name?: unknown }; summary?: Record<string, unknown> } | null;
  const fields = [['Enviados', 'sent'], ['Pendientes', 'deferred'], ['Fallidos', 'failed'], ['Por confirmar', 'uncertain']] as const;
  const values = fields.map(([, key]) => count(report?.summary?.[key]));
  const touches = count(report?.summary?.touches);
  if (!all(values) || !touches) return null;
  const name = typeof report?.campaign?.name === 'string' && report.campaign.name.trim() ? report.campaign.name.trim().slice(0, 60) : 'Campaña';
  return { type: 'chart', title: `Envíos de «${name}»`, kind: 'bar', period: null, unit: null,
    labels: fields.map(([label]) => label), series: [{ name: `${touches} ${touches === 1 ? 'toque' : 'toques'}`, values }] };
}

const BUILDERS: Record<string, (result: unknown) => Chart | null> = {
  'metrics.rates': ratesChart, 'metrics.channels': channelsChart, 'campaigns.batch_report': batchChart,
};

/** The charts the turn's reads allow, one per source (the latest read of each), in the order the reads came. */
export function coworkChartCandidates(observations: Observation[]): Chart[] {
  const latest = new Map<string, Observation>();
  for (const observation of observations) if (BUILDERS[observation.action]) latest.set(observation.action, observation);
  return [...latest.values()].flatMap(observation => {
    const chart = BUILDERS[observation.action](observation.result);
    return chart ? [chart] : [];
  });
}

/** Digits of a figure as text, so «42 %», «1.200» and «42» match the number 42 or 1200. */
const figureNumbers = (text: string) => (text.match(/\d{1,3}(?:\.\d{3})+|\d+/g) || []).map(part => Number(part.replace(/\./g, '')));

/** How many of a chart's values a figures card repeats: which chart the card is about. */
function overlap(chart: Chart, metrics: Array<Extract<CoworkBlock, { type: 'metrics' }>>) {
  const shown = new Set(metrics.flatMap(block => block.items.flatMap(item => figureNumbers(`${item.value} ${item.detail || ''}`))));
  return chart.series.reduce((sum, series) => sum + series.values.filter(value => shown.has(value)).length, 0);
}

/**
 * The answer with its chart: any chart the model wrote is dropped, and when the answer has a figures
 * card and the reads allow a chart, the one the card is about goes right after the last figures card.
 * At most one chart, and never past the card limit.
 */
export function coworkWithCharts<T extends object>(answer: T, observations: Observation[], limit = 4): T {
  const given = (answer as { blocks?: unknown }).blocks;
  const blocks = (Array.isArray(given) ? given : []) as CoworkBlock[];
  const kept: CoworkBlock[] = blocks.filter(block => block.type !== 'chart');
  const metrics = kept.flatMap(block => block.type === 'metrics' ? [block] : []);
  const candidates = metrics.length && kept.length < limit ? coworkChartCandidates(observations) : [];
  if (!candidates.length && kept.length === blocks.length) return answer;
  const chart = candidates.slice().sort((a, b) => overlap(b, metrics) - overlap(a, metrics))[0];
  if (chart) kept.splice(kept.map(block => block.type).lastIndexOf('metrics') + 1, 0, chart);
  return { ...answer, blocks: kept.length ? kept : given === undefined ? undefined : null };
}
