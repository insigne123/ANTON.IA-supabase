import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

/**
 * The pipeline as a flow (Plan 5, PR-10b): how many leads are in each stage, how many of those that reached a stage got
 * to the next one, the figures that matter and the weekly trend. Pure: the graphical view and its tests share it.
 * Unknown or empty stages count as «Nuevos», like the board. «Perdido» stays apart from the flow: it can happen at any
 * stage, so it is not a step of it.
 */
export const FLOW_STAGES: PipelineStage[] = ['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation', 'closed_won'];

export type PipelineFlowNode = {
  stage: PipelineStage;
  label: string;
  count: number;
  /** Leads that reached this stage or a later one (lost leads excluded). */
  reached: number;
  /** Of those that reached this stage, the share that reached the next one; null for the last stage or none reached. */
  conversionToNext: number | null;
  /** The five most recently updated leads in this stage. */
  recent: UnifiedRow[];
};

export type PipelineFlow = {
  nodes: PipelineFlowNode[];
  lost: { count: number; recent: UnifiedRow[] };
  total: number;
  kpis: {
    /** In the pipeline and not closed. */
    active: number;
    /** Reached «Interesado» or later, of those that reached «Contactado» or later; null with nobody contacted. */
    responseRate: number | null;
    /** Reached «Reunión» or later. */
    meetings: number;
    won: number;
  };
  weekly: Array<{ weekStart: string; label: string; count: number }>;
};

const RANK = new Map<PipelineStage, number>(FLOW_STAGES.map((stage, index) => [stage, index]));
const DAY = 24 * 60 * 60 * 1000;

export function flowStage(row: Pick<UnifiedRow, 'stage'>): PipelineStage {
  return PIPELINE_STAGES.some(stage => stage.id === row.stage) ? row.stage as PipelineStage : 'inbox';
}

const time = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const byRecent = (left: UnifiedRow, right: UnifiedRow) =>
  (time(right.updatedAt) || time(right.createdAt)) - (time(left.updatedAt) || time(left.createdAt));

/** Monday 00:00 UTC of the week of a timestamp. */
function weekStart(at: number) {
  const date = new Date(at);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

function shortDate(at: number) {
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(at)).replace(/\.$/, '');
}

export function buildPipelineFlow(rows: UnifiedRow[], options: { now?: number; weeks?: number } = {}): PipelineFlow {
  const now = options.now ?? Date.now();
  const weeks = Math.max(1, Math.min(26, options.weeks ?? 8));
  const byStage = new Map<PipelineStage, UnifiedRow[]>();
  for (const row of rows) {
    const stage = flowStage(row);
    byStage.set(stage, [...(byStage.get(stage) || []), row]);
  }
  const count = (stage: PipelineStage) => byStage.get(stage)?.length || 0;
  const reachedFrom = (index: number) => FLOW_STAGES.slice(index).reduce((sum, stage) => sum + count(stage), 0);

  const nodes: PipelineFlowNode[] = FLOW_STAGES.map((stage, index) => {
    const reached = reachedFrom(index);
    const next = index + 1 < FLOW_STAGES.length ? reachedFrom(index + 1) : null;
    return {
      stage,
      label: PIPELINE_STAGES.find(item => item.id === stage)!.label,
      count: count(stage),
      reached,
      conversionToNext: next === null || reached === 0 ? null : next / reached,
      recent: [...(byStage.get(stage) || [])].sort(byRecent).slice(0, 5),
    };
  });

  const contacted = reachedFrom(RANK.get('contacted')!);
  const firstWeek = weekStart(now) - (weeks - 1) * 7 * DAY;
  const weekly = Array.from({ length: weeks }, (_, index) => {
    const start = firstWeek + index * 7 * DAY;
    return { weekStart: new Date(start).toISOString().slice(0, 10), label: shortDate(start), count: 0 };
  });
  for (const row of rows) {
    const created = time(row.createdAt);
    if (!created || created < firstWeek) continue;
    const index = Math.floor((weekStart(created) - firstWeek) / (7 * DAY));
    if (index >= 0 && index < weeks) weekly[index].count++;
  }

  return {
    nodes,
    lost: { count: count('closed_lost'), recent: [...(byStage.get('closed_lost') || [])].sort(byRecent).slice(0, 5) },
    total: rows.length,
    kpis: {
      active: rows.length - count('closed_won') - count('closed_lost'),
      responseRate: contacted ? reachedFrom(RANK.get('engaged')!) / contacted : null,
      meetings: reachedFrom(RANK.get('meeting')!),
      won: count('closed_won'),
    },
    weekly,
  };
}

export function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}
