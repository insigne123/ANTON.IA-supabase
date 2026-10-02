/**
 * What the «Oportunidades» page shows, computed apart so it can be tested: the counts per status, the filtered list, the last
 * search in one line, money and dates in Chilean Spanish.
 */
export type OpportunityFilter = 'new' | 'interested' | 'dismissed' | 'all';
export type OpportunityListItem = { id: string; company: string; status: 'new' | 'interested' | 'dismissed' | 'converted'; score: number };
export type RunListItem = { source: string; status: string; startedAt: string; finishedAt: string | null; fetched: number; created: number; costUsd: number; error: string | null };

export const FILTER_LABELS: Record<OpportunityFilter, string> = { new: 'Nuevas', interested: 'Me interesan', dismissed: 'Descartadas', all: 'Todas' };
const SOURCE_LABELS: Record<string, string> = { jsearch: 'Google for Jobs', linkedin: 'LinkedIn', jooble: 'Jooble' };
export const sourceLabel = (source: string) => SOURCE_LABELS[source] || source;

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** «Todas» leaves out the discarded ones: they have their own tab. «Me interesan» includes the ones already converted. */
const inFilter = (status: OpportunityListItem['status'], filter: OpportunityFilter) => filter === 'all' ? status !== 'dismissed'
  : filter === 'interested' ? status === 'interested' || status === 'converted' : status === filter;

export function statusCounts(items: OpportunityListItem[]) {
  return Object.fromEntries((Object.keys(FILTER_LABELS) as OpportunityFilter[]).map(filter => [filter, items.filter(item => inFilter(item.status, filter)).length])) as Record<OpportunityFilter, number>;
}

export function filterOpportunities<T extends OpportunityListItem>(items: T[], filter: OpportunityFilter, query: string) {
  const wanted = fold(query);
  return items.filter(item => inFilter(item.status, filter) && (!wanted || fold(item.company).includes(wanted)));
}

/**
 * The last search, from its runs (one per source, started together). `running` while a source has not finished; `partial`
 * when one source failed and another brought ads.
 */
export function lastSearch(runs: RunListItem[]) {
  if (!runs.length) return null;
  const latest = Date.parse(runs[0].startedAt);
  const group = runs.filter(run => latest - Date.parse(run.startedAt) <= 5 * 60_000);
  const failed = group.filter(run => run.status === 'failed');
  const status = group.some(run => run.status === 'running') ? 'running'
    : group.every(run => run.status === 'skipped') ? 'skipped'
      : failed.length === group.length ? 'failed' : failed.length ? 'partial' : 'done';
  return {
    status, at: runs[0].startedAt,
    fetched: group.reduce((sum, run) => sum + run.fetched, 0),
    costUsd: Math.round(group.reduce((sum, run) => sum + run.costUsd, 0) * 10_000) / 10_000,
    errors: group.filter(run => run.error).map(run => `${sourceLabel(run.source)}: ${run.error}`),
  };
}

const usdFormat = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatUsd = (value: number) => usdFormat.format(value).replace(/\s/g, '').replace(/^US\$|^\$/, 'US$');

const dayFormat = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' });
export const formatDay = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? dayFormat.format(new Date(value)).replace('.', '') : 'sin fecha');

export function relativeTime(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

/** Roles typed one per line or separated by commas, without repeats. */
export function parseList(value: string) {
  const items = value.split(/[,;\n]/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Map(items.map(item => [fold(item), item])).values()];
}
