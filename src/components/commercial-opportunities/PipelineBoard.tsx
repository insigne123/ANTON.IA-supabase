'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Award, Inbox, Loader2, Send, Sparkles, Star, UserPlus, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InitialsAvatar } from '@/components/initials-avatar';
import { cn } from '@/lib/utils';
import type { WorkItem, WorkRecord } from '@/lib/commercial-opportunities/workspace';
import { PIPELINE_STAGES, WORK_STATE_LABELS, daysToClose, pipelineStage } from '@/lib/commercial-opportunities/pipeline';
import { PipelineRoute, type PipelineStop } from './PipelineRoute';

export type PipelineSuggestion = { id: string; move: WorkRecord['state'] | null; reason: string; nextAction: string };
const ICONS = { found: <Inbox />, recommended: <Star />, assigned: <UserPlus />, working: <Wrench />, submitted: <Send />, won: <Award /> };
const MOVES: Record<string, WorkRecord['state'][]> = {
  assigned: ['working', 'blocked', 'archived'], working: ['submitted', 'blocked', 'archived'], submitted: ['won', 'lost'], won: [], blocked: ['working', 'archived'],
};

/**
 * The admin's pipeline: the stages as a road (PipelineRoute), the opportunities of the stage in view below it, and what the
 * AI suggests for each one. Moves the work shows happen on their own (pipeline.ts); here a person applies the rest.
 */
export function PipelineBoard({ items, work, totals, members, busy, suggestions, reviewing, onReview, onMove, onOpen }: {
  items: WorkItem[]; work: WorkRecord[]; members: Array<{ user_id: string; name: string }>; busy: boolean;
  /** Exact counts of what nobody works yet; the page lists only the best scored of them. */
  totals?: { found: number; recommended: number };
  suggestions: PipelineSuggestion[] | null; reviewing: boolean; onReview: () => void;
  onMove: (id: string, state: WorkRecord['state'], revision: number) => void; onOpen: (id: string) => void;
}) {
  const now = Date.now();
  const placed = useMemo(() => items.map(item => {
    const record = work.find(w => w.opportunity_id === item.id) ?? null;
    return { item, record, stage: pipelineStage(item, record), days: daysToClose(item.deadline_at, now) };
  }), [items, work, now]);
  const firstBusy = PIPELINE_STAGES.find(stage => placed.some(p => p.stage === stage.id))?.id ?? 'recommended';
  const [selected, setSelected] = useState<string>(firstBusy);
  const stops: PipelineStop[] = PIPELINE_STAGES.map(stage => {
    const inStage = placed.filter(p => p.stage === stage.id);
    const count = stage.id === 'found' || stage.id === 'recommended' ? Math.max(totals?.[stage.id] ?? 0, inStage.length) : inStage.length;
    return { id: stage.id, label: stage.label, hint: stage.hint, count, icon: ICONS[stage.id],
      urgent: stage.id === 'won' || stage.id === 'submitted' ? 0 : inStage.filter(p => p.days !== null && p.days >= 0 && p.days < 7).length };
  });
  const closed = { lost: placed.filter(p => p.stage === 'lost').length, archived: placed.filter(p => p.stage === 'archived').length, excluded: placed.filter(p => p.stage === 'excluded').length };
  const stage = PIPELINE_STAGES.find(s => s.id === selected) ?? PIPELINE_STAGES[0];
  const shown = placed.filter(p => p.stage === selected).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
  const advice = new Map((suggestions || []).map(s => [s.id, s]));
  const moves = suggestions?.filter(s => s.move).length ?? 0;

  return (
    <section aria-labelledby="pipeline-title" className="space-y-5 rounded-3xl border bg-gradient-to-b from-muted/40 to-background p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pipeline-title" className="text-lg font-semibold">Embudo de oportunidades</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Las oportunidades avanzan solas cuando el trabajo lo muestra: al asignar un equipo, al quedar listo el informe o al marcar que se presentó. La IA te sugiere el resto.</p>
        </div>
        <Button type="button" variant="outline" onClick={onReview} disabled={reviewing || busy}>
          {reviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
          {reviewing ? 'Revisando…' : 'Revisar con IA'}
        </Button>
      </div>
      {suggestions && <p role="status" className="rounded-xl bg-primary/5 px-3 py-2 text-sm">
        {suggestions.length ? `La IA revisó ${suggestions.length} ${suggestions.length === 1 ? 'oportunidad' : 'oportunidades'} en curso: ${moves ? `sugiere mover ${moves}` : 'ninguna necesita cambiar de etapa'} y deja una próxima acción para cada una.` : 'No hay oportunidades en curso para revisar.'}
      </p>}
      <PipelineRoute stops={stops} selected={selected} onSelect={setSelected} />
      {(closed.lost || closed.archived || closed.excluded) ? <p className="text-center text-xs text-muted-foreground">
        {[closed.lost && `${closed.lost} perdidas`, closed.archived && `${closed.archived} archivadas`, closed.excluded && `${closed.excluded} no recomendadas`].filter(Boolean).join(' · ')}
      </p> : null}

      <div className="space-y-3" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">{stage.label} <span className="text-sm font-normal tabular-nums text-muted-foreground">{stops.find(s => s.id === stage.id)?.count ?? shown.length}</span></h3>
          <p className="text-xs text-muted-foreground">{stage.hint}{(stops.find(s => s.id === stage.id)?.count ?? 0) > shown.length ? (shown.length === 1 ? ' Se muestra la de más puntaje.' : ` Se muestran las ${shown.length} con más puntaje.`) : ''}</p>
        </div>
        {!shown.length ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No hay oportunidades en esta etapa.</p> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map(({ item, record, days }, index) => {
              const owner = members.find(m => m.user_id === record?.responsible_id);
              const tip = advice.get(item.id);
              const options = record ? MOVES[record.state] ?? [] : [];
              return (
                <li key={item.id} className="flex flex-col gap-3 rounded-2xl border bg-background p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(index, 8) * 50}ms`, animationFillMode: 'both' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-medium leading-6">{item.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{item.buyer_name || item.company_name || '—'}</p>
                    </div>
                    {owner ? <span title={`Responsable: ${owner.name}`}><InitialsAvatar name={owner.name} size="sm" /></span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {days !== null ? <span className={cn('rounded-full px-2 py-0.5 font-medium', days < 0 ? 'bg-muted text-muted-foreground' : days < 7 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground/80')}>
                      {days < 0 ? 'Cerrada' : days === 0 ? 'Cierra hoy' : `Cierra en ${days} ${days === 1 ? 'día' : 'días'}`}</span> : null}
                    {record?.state === 'blocked' ? <span className="rounded-full bg-cw-warning-soft px-2 py-0.5 font-medium text-cw-warning">Bloqueada</span> : null}
                  </div>
                  {tip ? <div className="rounded-xl bg-primary/5 px-3 py-2 text-sm">
                    <p className="flex items-start gap-1.5"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /><span><span className="font-medium">{tip.nextAction}</span>{tip.reason ? <span className="text-muted-foreground"> · {tip.reason}</span> : null}</span></p>
                    {tip.move && record ? <Button type="button" size="sm" variant="secondary" className="mt-2 h-7 text-xs" disabled={busy} onClick={() => onMove(item.id, tip.move!, record.revision)}>
                      Mover a {WORK_STATE_LABELS[tip.move]}<ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Button> : null}
                  </div> : null}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                    {options.length && record ? <label className="flex items-center gap-2 text-xs text-muted-foreground">Mover a
                      <select value="" disabled={busy} onChange={event => { const to = event.target.value as WorkRecord['state']; if (to) onMove(item.id, to, record.revision); }}
                        className="h-8 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <option value="">Elegir…</option>
                        {options.map(state => <option key={state} value={state}>{WORK_STATE_LABELS[state]}</option>)}
                      </select></label> : <span className="text-xs text-muted-foreground">{record ? '' : 'Asígnale un equipo para empezar'}</span>}
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpen(item.id)}>Abrir</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
