'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, Inbox, Loader2, Send, Sparkles, Star, UserPlus, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InitialsAvatar } from '@/components/initials-avatar';
import { cn } from '@/lib/utils';
import type { WorkItem, WorkRecord } from '@/lib/commercial-opportunities/workspace';
import { PIPELINE_STAGES, WORK_STATE_LABELS, daysToClose, pipelineStage } from '@/lib/commercial-opportunities/pipeline';
import { PRIORITY_SORTS, comparePriority, type PrioritySort } from '@/lib/commercial-opportunities/priority';
import { progressChips, type CardProgress } from '@/lib/commercial-opportunities/progress';
import { fallbackLine, opportunitySummary } from '@/lib/commercial-opportunities/summaries';
import { PipelineRoute, type PipelineStop } from './PipelineRoute';
import { PriorityStars } from './PriorityStars';
import { ProgressMarks } from './ProgressMarks';

export type PipelineSuggestion = { id: string; move: WorkRecord['state'] | null; reason: string; nextAction: string };
/** Where each card came from, now that a stage can mix them (and the filter can narrow them). */
const SOURCE_LABELS: Record<string, string> = { tender: 'Licitación', compra_agil: 'Compra Ágil', hiring: 'Avisos en LinkedIn', linkedin_post: 'Publicación en LinkedIn', private: 'Recibida', project: 'Proyecto' };
const ICONS = { found: <Inbox />, recommended: <Star />, assigned: <UserPlus />, working: <Wrench />, submitted: <Send />, won: <Award /> };
/** Out of the road, under it: what was lost, put aside or left out by the AI, each one a click away. */
const CLOSED_STAGES = [
  { id: 'lost', label: 'Perdidas', hint: 'Se presentaron y no se ganaron.' },
  { id: 'archived', label: 'Archivadas', hint: 'Se dejaron de trabajar o cerraron sin presentarse.' },
  { id: 'excluded', label: 'No recomendadas', hint: 'La IA las dejó fuera porque no calzan con tu oferta. Ábrelas para ver por qué o reconsiderarlas.' },
] as const;
/** The stages the page loads by pages (readOpportunityPipeline): what nobody works yet. */
export type PagedStage = 'found' | 'recommended' | 'excluded';
const PAGED: string[] = ['found', 'recommended', 'excluded'];
/** How many job ads a hiring card stands for, when the search counted them. */
const adsOf = (item: WorkItem) => { const ads = (item.data as { observed?: { ads?: unknown } } | null)?.observed?.ads; return typeof ads === 'number' && ads > 0 ? ads : 0; };
const MOVES: Record<string, WorkRecord['state'][]> = {
  assigned: ['working', 'blocked', 'archived'], working: ['submitted', 'blocked', 'archived'], submitted: ['won', 'lost'], won: [], blocked: ['working', 'archived'],
};

/**
 * The admin's pipeline: the stages as a road (PipelineRoute), the opportunities of the stage in view below it, and what the
 * AI suggests for each one. Moves the work shows happen on their own (pipeline.ts); here a person applies the rest. Each
 * card says what the opportunity is about in a line the AI writes (summaries.ts), a faint line while it is on its way.
 */
export function PipelineBoard({ items, work, totals, limits, members, busy, suggestions, reviewing, summariesWaiting = false, filtered = false, loadingMore = null, refreshing = false,
  sort = 'priority', onSort, progress, opened, onReview, onMove, onOpen, onAssign, onMore, onClearFilters }: {
  items: WorkItem[]; work: WorkRecord[]; members: Array<{ user_id: string; name: string }>; busy: boolean;
  /** Exact counts of what nobody works yet; the page lists only the best scored of them. */
  totals?: { found: number; recommended: number; excluded?: number };
  /** How many of each of those the page asked for: «Cargar más» asks for more until the most the server gives. */
  limits?: Partial<Record<PagedStage, number>>;
  /** A search or a source is on: an empty stage says so. */
  filtered?: boolean; loadingMore?: string | null; refreshing?: boolean;
  onMore?: (stage: PagedStage) => void; onClearFilters?: () => void;
  /** How the cards of a stage are read: by priority (the stars) or by how soon they close. The server picks the same ones (workspace-pipeline.ts). */
  sort?: PrioritySort; onSort?: (sort: PrioritySort) => void;
  /** What each card says of its own work: being researched, report ready (from the server); and when this person opened it (from the browser). */
  progress?: Record<string, CardProgress>; opened?: Record<string, number>;
  suggestions: PipelineSuggestion[] | null; reviewing: boolean; onReview: () => void;
  /** Some cards are still waiting for their line of summary. */
  summariesWaiting?: boolean;
  onMove: (id: string, state: WorkRecord['state'], revision: number) => void; onOpen: (id: string) => void;
  /** An administrator gives a team to a card nobody works yet without leaving the list (the stage the person is going through stays in view). */
  onAssign?: (item: WorkItem) => void;
}) {
  const now = Date.now();
  // «Abierta hace 1 min» and «Informe listo · hace 2 h» keep counting while the board stays open.
  const [, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 60_000); return () => clearInterval(timer); }, []);
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
  const closed = CLOSED_STAGES.map(stage => {
    const inStage = placed.filter(p => p.stage === stage.id).length;
    return { ...stage, count: stage.id === 'excluded' ? Math.max(totals?.excluded ?? 0, inStage) : inStage, loaded: inStage };
  });
  const stage = [...PIPELINE_STAGES, ...CLOSED_STAGES].find(s => s.id === selected) ?? PIPELINE_STAGES[0];
  const rank = comparePriority(sort);
  const shown = placed.filter(p => p.stage === selected).sort((a, b) => rank({ id: a.item.id, score: a.item.score, days: a.days }, { id: b.item.id, score: b.item.score, days: b.days }));
  const count = stops.find(s => s.id === stage.id)?.count ?? closed.find(s => s.id === stage.id)?.count ?? shown.length;
  const paged = PAGED.includes(stage.id) ? stage.id as PagedStage : null;
  // Another page while there are more and the server gives them (PIPELINE_MAX); beyond that, the search narrows them.
  const more = paged && count > shown.length ? ((limits?.[paged] ?? 0) < 600 ? Math.min(60, count - shown.length) : 0) : 0;
  // What the AI left out loads only when someone opens it, and again after a new search or source left none loaded.
  const excludedWaiting = selected === 'excluded' && count > 0 && !shown.length && !limits?.excluded && loadingMore !== 'excluded';
  useEffect(() => { if (excludedWaiting) onMore?.('excluded'); }, [excludedWaiting, onMore]);
  const select = (id: string) => setSelected(id);
  const advice = new Map((suggestions || []).map(s => [s.id, s]));
  // What the AI reviews (runPipelineReview): the opportunities a team already works. Without any, there is nothing to ask.
  const inProgress = work.filter(w => ['assigned', 'working', 'blocked', 'submitted'].includes(w.state)).length;
  const moves = suggestions?.filter(s => s.move).length ?? 0;

  return (
    <section aria-labelledby="pipeline-title" className="space-y-5 rounded-3xl border bg-gradient-to-b from-muted/40 to-background p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pipeline-title" className="text-lg font-semibold">Embudo de oportunidades</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">Avanzan solas al asignar un equipo, al quedar listo el informe o al marcar que se presentó.</p>
        </div>
        {inProgress ? <Button type="button" variant="outline" onClick={onReview} disabled={reviewing || busy}
          title={`La IA revisa ${inProgress === 1 ? 'la oportunidad en curso' : `las ${inProgress} oportunidades en curso`}: propone a qué etapa moverlas y qué hacer después. Nada cambia sin que lo aceptes.`}>
          {reviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
          {reviewing ? 'Revisando…' : 'Sugerir próximos pasos'}
        </Button> : null}
      </div>
      {suggestions && <p role="status" className="rounded-xl bg-primary/5 px-3 py-2 text-sm">
        {suggestions.length ? `La IA revisó ${suggestions.length} ${suggestions.length === 1 ? 'oportunidad' : 'oportunidades'} en curso: ${moves ? `sugiere mover ${moves}` : 'ninguna necesita cambiar de etapa'} y deja una próxima acción para cada una.` : 'No hay oportunidades en curso para revisar.'}
      </p>}
      <PipelineRoute stops={stops} selected={selected} onSelect={select} />
      {closed.some(s => s.count) ? <div role="group" aria-label="Fuera del embudo" className="flex flex-wrap items-center justify-center gap-1.5">
        {closed.filter(s => s.count).map(s => <button key={s.id} type="button" aria-pressed={selected === s.id} onClick={() => select(s.id)}
          className={cn('rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected === s.id ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
          {s.label} <span className="tabular-nums">{s.count}</span></button>)}
      </div> : null}

      <div className={cn('space-y-3 transition-opacity', refreshing && 'opacity-60')} aria-live="polite" aria-busy={refreshing || loadingMore === stage.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">{stage.label} <span className="text-sm font-normal tabular-nums text-muted-foreground">{count}</span></h3>
          <p className="text-xs text-muted-foreground">{stage.hint}{count > shown.length && shown.length ? ` ${shown.length === 1 ? 'Se muestra 1' : `Se muestran ${shown.length}`} de ${count}, ${sort === 'deadline' ? 'las que cierran antes' : 'las de mayor prioridad'}.` : ''}</p>
        </div>
        {shown.length > 1 && stage.id !== 'excluded' ? <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-xs text-muted-foreground">Las estrellas dicen qué tan bien calza cada una con tu oferta.</p>
          <div role="group" aria-label="Ordenar las oportunidades" className="flex items-center gap-0.5 rounded-full border p-0.5">
            {PRIORITY_SORTS.map(option => <button key={option.id} type="button" aria-pressed={sort === option.id} title={option.hint} onClick={() => onSort?.(option.id)}
              className={cn('rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sort === option.id ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{option.label}</button>)}
          </div>
        </div> : null}
        {!shown.length ? (loadingMore === stage.id || excludedWaiting ? <p role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando…</p>
          : <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p>{filtered ? 'Ninguna oportunidad de esta etapa coincide con la búsqueda o la fuente elegida.' : 'No hay oportunidades en esta etapa.'}</p>
            {filtered && onClearFilters ? <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0" onClick={onClearFilters}>Quitar filtros</Button> : null}
          </div>) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shown.map(({ item, record, days }, index) => {
              const owner = members.find(m => m.user_id === record?.responsible_id);
              const tip = advice.get(item.id);
              const options = record ? MOVES[record.state] ?? [] : [];
              const summary = opportunitySummary(item.data) ?? fallbackLine(item);
              const ads = adsOf(item);
              const marks = progressChips(progress?.[item.id], opened?.[item.id], now);
              return (
                <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-background p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(index, 8) * 50}ms`, animationFillMode: 'both' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      {item.buyer_name || item.company_name || item.data?.evaluation !== 'excluded' ? <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.buyer_name || item.company_name}</p>
                        {item.data?.evaluation !== 'excluded' ? <PriorityStars score={item.score} /> : null}
                      </div> : null}
                      <p className="line-clamp-2 font-medium leading-6">{item.title}</p>
                      {summary ? <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{summary}</p>
                        : summariesWaiting && !(item.data as { summary?: unknown } | null)?.summary ? <span className="block space-y-2 pt-1" aria-hidden="true"><span className="block h-3 w-11/12 rounded-full bg-muted motion-safe:animate-pulse" /><span className="block h-3 w-2/3 rounded-full bg-muted motion-safe:animate-pulse" /></span> : null}
                    </div>
                    {owner ? <span title={`Responsable: ${owner.name}`}><InitialsAvatar name={owner.name} size="sm" /></span> : null}
                  </div>
                  {record ? null : item.data?.evaluation === 'excluded' && item.reasons?.[0] ? <p className="text-xs leading-5 text-muted-foreground">Por qué no: {item.reasons[0]}</p> : null}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {SOURCE_LABELS[item.kind] ? <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{SOURCE_LABELS[item.kind]}</span> : null}
                    {ads ? <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{ads} {ads === 1 ? 'aviso' : 'avisos'}</span> : null}
                    {days !== null ? <span className={cn('rounded-full px-2 py-0.5 font-medium', days < 0 ? 'bg-muted text-muted-foreground' : days < 7 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground/80')}>
                      {days < 0 ? 'Cerrada' : days === 0 ? 'Cierra hoy' : `Cierra en ${days} ${days === 1 ? 'día' : 'días'}`}</span> : null}
                    {record?.state === 'blocked' ? <span className="rounded-full bg-cw-warning-soft px-2 py-0.5 font-medium text-cw-warning">Bloqueada</span> : null}
                    <ProgressMarks marks={marks} />
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
                      </select></label>
                      : !record && item.data?.evaluation !== 'excluded' && onAssign
                        ? <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onAssign(item)} title="Elige quién la trabaja: pasa a «Asignadas» y avisamos a las personas.">
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Asignar</Button>
                        : <span className="text-xs text-muted-foreground">{record || item.data?.evaluation === 'excluded' ? '' : 'Asígnale un equipo para empezar'}</span>}
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpen(item.id)}>Abrir</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {more && paged ? <div className="flex flex-col items-center gap-1.5 pt-1">
          <Button type="button" variant="outline" className="rounded-full" disabled={loadingMore === paged} onClick={() => onMore?.(paged)}>
            {loadingMore === paged ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {loadingMore === paged ? 'Cargando…' : `Cargar ${more} más`}
          </Button>
          <p className="text-xs text-muted-foreground">Quedan {count - shown.length} en esta etapa.</p>
        </div> : paged && count > shown.length && shown.length ? <p className="text-center text-xs text-muted-foreground">Para ver las demás, búscalas por nombre o elige una fuente.</p> : null}
      </div>
    </section>
  );
}
