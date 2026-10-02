'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PipelineStage } from '@/lib/crm-types';
import { buildPipelineFlow, formatPercent, type PipelineFlowNode } from '@/lib/pipeline-flow';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

/**
 * The pipeline as a graph (Plan 5, PR-10b): the figures that matter, one node per stage with its count and the share
 * that moved on, the five most recent leads on hover or focus, and the weekly trend. A click opens the whole stage.
 * Each node also marks the stage changes into it that wait for the person's confirmation (PR-10a).
 */
export function PipelineFlowView({ rows, onOpenStage, now, pending }: {
  rows: UnifiedRow[];
  onOpenStage: (stage: PipelineStage) => void;
  now?: number;
  /** Suggested stage changes waiting for confirmation, by the stage they propose. */
  pending?: Partial<Record<PipelineStage, number>>;
}) {
  const flow = useMemo(() => buildPipelineFlow(rows, { now }), [rows, now]);
  const [peek, setPeek] = useState<PipelineStage | null>(null);
  const maxCount = Math.max(1, ...flow.nodes.map(node => node.count), flow.lost.count);
  const contacted = flow.nodes.find(node => node.stage === 'contacted')?.reached || 0;

  const kpis = [
    { label: 'Activos', value: String(flow.kpis.active), caption: `de ${flow.total} en el pipeline` },
    { label: 'Tasa de respuesta', value: formatPercent(flow.kpis.responseRate), caption: contacted ? `de ${contacted} contactados` : 'Aún no contactas a nadie' },
    { label: 'Llegaron a reunión', value: String(flow.kpis.meetings), caption: 'reunión, negociación o ganado' },
    { label: 'Ganados', value: String(flow.kpis.won), caption: flow.lost.count ? `${flow.lost.count} perdidos` : 'Sin perdidos' },
  ];

  const peekNode = peek === 'closed_lost'
    ? { label: 'Perdido', recent: flow.lost.recent }
    : flow.nodes.find(node => node.stage === peek) || null;
  const stageNode = (node: Pick<PipelineFlowNode, 'stage' | 'label' | 'count' | 'recent'>, muted = false) => {
    const waiting = pending?.[node.stage] || 0;
    return <div onMouseEnter={() => setPeek(node.stage)} onMouseLeave={() => setPeek(current => current === node.stage ? null : current)}>
      <button type="button" onClick={() => onOpenStage(node.stage)} onFocus={() => setPeek(node.stage)} onBlur={() => setPeek(current => current === node.stage ? null : current)}
        aria-label={`${node.label}: ${node.count} ${node.count === 1 ? 'lead' : 'leads'}${waiting ? `, ${waiting} ${waiting === 1 ? 'cambio' : 'cambios'} por confirmar` : ''}. Ver la etapa completa.`}
        className={cn('flex w-[7.25rem] flex-col gap-1.5 rounded-2xl border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          muted && 'bg-muted/30')}>
        <span className="truncate text-xs font-medium text-muted-foreground">{node.label}</span>
        <span className="text-2xl font-semibold tabular-nums">{node.count}</span>
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className={cn('block h-full rounded-full', muted ? 'bg-muted-foreground/50' : 'bg-primary')} style={{ width: `${Math.max(node.count ? 6 : 0, (node.count / maxCount) * 100)}%` }} />
        </span>
        {waiting > 0 && <span className="text-[11px] font-medium text-primary" aria-hidden="true">+{waiting} por confirmar</span>}
      </button>
    </div>;
  };

  return <div className="space-y-6 p-4 sm:p-6">
    <section aria-label="Cifras del pipeline" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map(kpi => <div key={kpi.label} className="rounded-2xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{kpi.value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{kpi.caption}</p>
      </div>)}
    </section>

    <section aria-labelledby="pipeline-flow-title" className="space-y-3">
      <div>
        <h2 id="pipeline-flow-title" className="text-sm font-semibold">Avance por etapa</h2>
        <p className="text-xs text-muted-foreground">El porcentaje es la parte de quienes llegaron a una etapa que siguió a la siguiente. Toca una etapa para ver a todos.</p>
      </div>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {flow.nodes.map((node, index) => <Fragment key={node.stage}>
          <li>{stageNode(node)}</li>
          {index < flow.nodes.length - 1 && <li aria-hidden="true" className="flex w-10 shrink-0 flex-col items-center justify-center gap-0.5 text-muted-foreground"
            title={node.conversionToNext === null ? undefined : `${formatPercent(node.conversionToNext)} de quienes llegaron a ${node.label} siguieron a ${flow.nodes[index + 1].label}`}>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[11px] tabular-nums">{formatPercent(node.conversionToNext)}</span>
          </li>}
        </Fragment>)}
        <li aria-hidden="true" className="mx-2 w-px shrink-0 self-stretch bg-border" />
        <li>{stageNode({ stage: 'closed_lost', label: 'Perdido', count: flow.lost.count, recent: flow.lost.recent }, true)}</li>
      </ol>
      <div aria-live="polite" className="min-h-[3.5rem] rounded-2xl border border-dashed p-3">
        {peekNode && peekNode.recent.length > 0 ? <>
          <p className="pb-1 text-xs font-medium text-muted-foreground">Más recientes en {peekNode.label}</p>
          <table className="w-full max-w-xl text-left text-xs">
            <thead className="sr-only"><tr><th scope="col">Lead</th><th scope="col">Empresa</th></tr></thead>
            <tbody>
              {peekNode.recent.map(lead => <tr key={lead.gid} className="border-t border-border/60 first:border-0">
                <td className="max-w-[12rem] truncate py-1 pr-3 font-medium">{lead.name || lead.email || 'Sin nombre'}</td>
                <td className="max-w-[12rem] truncate py-1 text-muted-foreground">{lead.company || '—'}</td>
              </tr>)}
            </tbody>
          </table>
        </> : <p className="text-xs text-muted-foreground">{peekNode ? `Aún no hay leads en ${peekNode.label}.` : 'Pasa el mouse o el foco por una etapa para ver sus 5 leads más recientes.'}</p>}
      </div>
    </section>

    <WeeklyTrend weekly={flow.weekly} />
  </div>;
}

function WeeklyTrend({ weekly }: { weekly: Array<{ weekStart: string; label: string; count: number }> }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...weekly.map(week => week.count));
  const total = weekly.reduce((sum, week) => sum + week.count, 0);

  return <section aria-labelledby="pipeline-trend-title" className="space-y-3 rounded-2xl border bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="pipeline-trend-title" className="text-sm font-semibold">Contactos nuevos por semana</h2>
      <p className="text-xs text-muted-foreground">{total} en las últimas {weekly.length} semanas</p>
    </div>
    <div>
      <div className="flex h-40 items-end gap-2 border-b border-border pt-8" aria-hidden="true">
        {weekly.map((week, index) => <div key={week.weekStart} className="relative flex h-full flex-1 items-end justify-center"
          onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(current => current === index ? null : current)}>
          {week.count > 0 && <div className={cn('w-full max-w-12 rounded-t-[4px] transition-colors', active === index ? 'bg-primary' : 'bg-primary/80')}
            style={{ height: `${Math.max(3, (week.count / max) * 100)}%` }} />}
          {active === index && <div role="status" className="pointer-events-none absolute -top-8 z-10 whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-xs text-popover-foreground shadow">
            Semana del {week.label}: <span className="font-semibold tabular-nums">{week.count}</span>
          </div>}
        </div>)}
      </div>
      <div className="mt-1.5 flex gap-2" aria-hidden="true">
        {weekly.map((week, index) => <span key={week.weekStart} className={cn('min-w-0 flex-1 whitespace-nowrap text-center text-[11px] text-muted-foreground', index % 2 === 0 && 'invisible sm:visible', index === weekly.length - 1 && 'max-sm:text-right')}>{week.label}</span>)}
      </div>
    </div>
    <table className="sr-only">
      <caption>Contactos nuevos por semana</caption>
      <thead><tr><th scope="col">Semana</th><th scope="col">Contactos nuevos</th></tr></thead>
      <tbody>{weekly.map(week => <tr key={week.weekStart}><td>{week.label}</td><td>{week.count}</td></tr>)}</tbody>
    </table>
  </section>;
}
