'use client';

// The parts of the person's own tender radar the workspace list was missing: what to do with each opportunity, where to
// start, the excluded ones by why, and what almost every set of bases asks for.
import { useState } from 'react';
import { Bell, ChevronDown, ClipboardCheck, Flag } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/lib/commercial-opportunities/workspace';
import { TENDER_PREREQUISITES, closesLabel, exclusionGroups, latestNews, startHere, workAdvice, type WorkAdvice } from '@/lib/commercial-opportunities/workspace-radar';

const TONES: Record<WorkAdvice['tone'], string> = {
  go: 'bg-cw-success-soft text-cw-success',
  evaluate: 'bg-cw-warning-soft text-cw-warning',
  no: 'bg-muted text-muted-foreground',
  pending: 'bg-muted text-muted-foreground',
};
const dayMonth = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' });

/** «Postular», «Evaluar», «No postular» or «Por evaluar», with the deadline when it is close. */
/** `decision`: once a report exists, an opportunity still «Por evaluar» shows the report's decision instead. */
export function AdvicePill({ item, now = Date.now(), decision }: { item: WorkItem; now?: number; decision?: { label: string; tone: WorkAdvice['tone'] } }) {
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

/** «Antes de postular»: what repeats in almost every set of bases, worth solving once. Folded by default. */
export function TenderPrerequisites() {
  return (
    <Collapsible className="rounded-xl border bg-background">
      <CollapsibleTrigger asChild>
        <button type="button" className="group flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            <span>
              <span className="block text-sm font-medium">Antes de postular a una licitación</span>
              <span className="block text-xs text-muted-foreground">Lo que piden casi todas las bases. Conviene resolverlo una vez.</span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
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

/** «Novedades» in a few quiet lines: one per opportunity, three at first, and a way to clear them. */
export function NewsList({ notifications, onOpen, onClear, when }: {
  notifications: Array<{ id: string; opportunity_id: string; title: string; created_at: string; read_at: string | null }>;
  onOpen: (opportunityId: string) => void; onClear: (ids: string[]) => void; when: (at: string) => string;
}) {
  const [all, setAll] = useState(false);
  const { items, ids } = latestNews(notifications);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section aria-labelledby="op-news" className="rounded-2xl border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="op-news" className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Novedades<span className="font-normal tabular-nums text-muted-foreground">{items.length}</span></h2>
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onClear(ids)}>Marcar como leídas</Button>
      </div>
      <ul className="mt-1 divide-y">
        {shown.map(n => (
          <li key={n.id}>
            <button type="button" onClick={() => onOpen(n.opportunity_id)} className="flex w-full items-center justify-between gap-3 rounded-md py-2.5 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 truncate">{n.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{when(n.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 3 ? <button type="button" onClick={() => setAll(v => !v)} className="mt-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{all ? 'Ver menos' : `Ver ${items.length - 3} más`}</button> : null}
    </section>
  );
}
