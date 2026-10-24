'use client';

// The parts of the person's own tender radar the workspace list was missing: what to do with each opportunity, where to
// start, the excluded ones by why, and what almost every set of bases asks for.
import { useState } from 'react';
import { Bell, Check, ChevronDown, ClipboardCheck, Flag } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkItem, WorkspaceOverview } from '@/lib/commercial-opportunities/workspace';
import { NEWS_KINDS, TENDER_PREREQUISITES, closesLabel, exclusionGroups, latestNews, startHere, workAdvice, type NewsKind, type WorkAdvice } from '@/lib/commercial-opportunities/workspace-radar';
import { filterChip } from './OpportunityFilters';

const TONES: Record<WorkAdvice['tone'], string> = {
  go: 'bg-cw-success-soft text-cw-success',
  evaluate: 'bg-cw-warning-soft text-cw-warning',
  no: 'bg-muted text-muted-foreground',
  pending: 'bg-muted text-muted-foreground',
};
const dayMonth = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' });

const ADVICE_DONE = ['submitted', 'won', 'lost', 'archived'];

/** «Postular», «Evaluar», «No postular» or «Por evaluar», with the deadline when it is close. */
/** `decision`: once a report exists, an opportunity still «Por evaluar» shows the report's decision instead. */
export function AdvicePill({ item, now = Date.now(), decision, state }: { item: WorkItem; now?: number; decision?: { label: string; tone: WorkAdvice['tone'] }; state?: string | null }) {
  // Once it was presented or closed, «Postular» is advice for a decision already taken: the stage next to it says where it stands.
  if (state && ADVICE_DONE.includes(state)) return null;
  const evaluated = workAdvice(item, now);
  const advice = decision && evaluated.tone === 'pending' ? { ...evaluated, ...decision } : evaluated;
  const closes = advice.urgent ? closesLabel(advice) : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONES[advice.tone])}>{advice.label}</span>
      {closes ? <span className="text-xs font-medium text-destructive">{closes}</span> : null}
    </span>
  );
}

/** «Por dónde empezar»: the recommended ones with time to prepare an offer, nearest deadline first. */
export function StartHere({ items, onOpen, now = Date.now() }: { items: WorkItem[]; onOpen: (id: string) => void; now?: number }) {
  const first = startHere(items, now);
  if (!first.length) return null;
  return (
    <section aria-labelledby="start-here-title" className="rounded-xl border bg-background p-4">
      <h2 id="start-here-title" className="flex items-center gap-2 font-semibold"><Flag className="h-4 w-4" aria-hidden="true" />Por dónde empezar</h2>
      <p className="mt-1 text-sm text-muted-foreground">Las de mejor calce con plazo para preparar una oferta, por fecha de cierre.</p>
      <ol className="mt-3 divide-y">
        {first.map(item => {
          const advice = workAdvice(item, now);
          const deadline = new Date(item.deadline_at!);
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item.id)}
                className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                <span className="grid text-center tabular-nums">
                  <span className="text-base font-semibold leading-tight">{dayMonth.format(deadline).replace('.', '')}</span>
                  <span className={cn('text-xs', advice.urgent ? 'font-medium text-destructive' : 'text-muted-foreground')}>{closesLabel(advice)}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONES[advice.tone])}>{advice.label}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">{item.company_name || item.buyer_name}</span>
                  {item.reasons[0] ? <span className="mt-1 line-clamp-2 block text-sm">{item.reasons[0]}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** «No recomendadas» grouped by why, so the person checks a group instead of reading one by one. */
export function ExclusionGroups({ items, onOpen }: { items: WorkItem[]; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {exclusionGroups(items).map(group => (
        <Collapsible key={group.motive} className="rounded-xl border bg-background">
          <CollapsibleTrigger asChild>
            <button type="button" className="group flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <span className="font-medium">{group.label}</span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                {group.items.length}
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y border-t">
              {group.items.map(item => (
                <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.company_name || item.buyer_name}</p>
                    {item.reasons[0] ? <p className="mt-1 text-sm">{item.reasons[0]}</p> : null}
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => onOpen(item.id)}>Abrir</Button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

/** «Antes de postular»: what repeats in almost every set of bases, worth solving once. Folded by default, and quiet while folded: a line, not a card. */
export function TenderPrerequisites() {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type="button" className="group -mx-1 inline-flex max-w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0"><span className="font-medium text-foreground">Antes de postular a una licitación</span><span className="hidden sm:inline"> · lo que piden casi todas las bases, para resolverlo una vez</span></span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid gap-4 rounded-xl border bg-background p-4 sm:grid-cols-2">
          {TENDER_PREREQUISITES.map(block => (
            <div key={block.title} className="min-w-0">
              <h3 className="text-sm font-semibold">{block.title}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {block.items.map(text => <li key={text}>{text}</li>)}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-2">Es una guía general: lo que exige cada licitación lo dicen sus bases.</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * «Novedades» in a few quiet lines. For an administrator, first what waits for their answer: it stays until someone answers, and
 * «Responder» opens the opportunity on the answer box. Then the unread notices, one per opportunity and three at first, each one
 * clearable, and by kind when there is more than one kind.
 */
export function NewsList({ notifications, waiting, onOpen, onDecision, onClear, when }: {
  notifications: WorkspaceOverview['notifications'];
  waiting?: WorkspaceOverview['waiting'] | null;
  onOpen: (opportunityId: string) => void;
  /** Opens the opportunity on the box to answer its decision. */
  onDecision?: (opportunityId: string) => void;
  onClear: (ids: string[]) => void; when: (at: string) => string;
}) {
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<NewsKind | 'all'>('all');
  const { kinds } = latestNews(notifications);
  const shownKind = kind !== 'all' && kinds.includes(kind) ? kind : 'all';
  const { items, ids, byOpportunity } = latestNews(notifications, shownKind);
  const waits = waiting?.lines ?? [];
  if (!items.length && !waits.length) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section aria-labelledby="op-news" className="rounded-2xl border px-4 py-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id="op-news" className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Novedades{items.length ? <span className="font-normal tabular-nums text-muted-foreground">{items.length}</span> : null}</h2>
        {ids.length ? <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onClear(ids)}>Marcar como leídas</Button> : null}
      </div>
      {waits.length ? <div className="mt-1">
        <h3 className="pt-1 text-xs font-medium text-muted-foreground">Esperan tu respuesta · <span className="tabular-nums">{waiting!.total}</span></h3>
        <ul className="divide-y">
          {waits.map(line => (
            <li key={line.id}>
              <button type="button" onClick={() => (line.kind === 'blocked' || !onDecision ? onOpen : onDecision)(line.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md py-2.5 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0"><span className="block line-clamp-2 sm:line-clamp-1">{line.title}</span>
                  <span className={cn('block text-xs', line.urgent ? 'text-destructive' : 'text-muted-foreground')}>{line.detail}</span></span>
                <span className="shrink-0 text-xs font-medium text-primary">{line.kind === 'blocked' ? 'Ver' : 'Responder'}</span>
              </button>
            </li>
          ))}
        </ul>
        {waiting!.total > waits.length ? <p className="pb-1 text-xs text-muted-foreground">Y {waiting!.total - waits.length} más esperan tu respuesta.</p> : null}
      </div> : null}
      {kinds.length > 1 ? <div role="group" aria-label="Tipo de novedad" className="mt-2 flex flex-wrap gap-1">
        {([['all', 'Todas'], ...NEWS_KINDS.filter(([id]) => kinds.includes(id))] as Array<readonly [NewsKind | 'all', string]>).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={shownKind === id} onClick={() => { setKind(id); setAll(false); }} className={filterChip(shownKind === id, 'sm')}>{label}</button>)}
      </div> : null}
      {shown.length ? <ul className={cn('divide-y', waits.length && kinds.length < 2 ? 'mt-1 border-t' : 'mt-1')}>
        {shown.map(n => (
          <li key={n.id} className="flex items-center gap-1">
            {/* On a phone the date goes under the title, so the title reads whole («Informe listo: ADQU…» did not). */}
            <button type="button" onClick={() => onOpen(n.opportunity_id)} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md py-2.5 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="min-w-0 line-clamp-2 sm:line-clamp-1">{n.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{when(n.created_at)}</span>
            </button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" title="Marcar como leída" aria-label={`Marcar como leída: ${n.title}`}
              onClick={() => onClear(byOpportunity.get(n.opportunity_id) ?? [n.id])}><Check className="h-4 w-4" aria-hidden="true" /></Button>
          </li>
        ))}
      </ul> : null}
      {items.length > 3 ? <button type="button" onClick={() => setAll(v => !v)} className="mt-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{all ? 'Ver menos' : `Ver ${items.length - 3} más`}</button> : null}
    </section>
  );
}
