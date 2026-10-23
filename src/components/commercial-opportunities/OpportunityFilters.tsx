'use client';

import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { OPPORTUNITY_CATEGORIES, OPPORTUNITY_SOURCES, type OpportunityCategory, type OpportunitySource } from '@/lib/commercial-opportunities/workspace-radar';

/**
 * The pill of a filter, tab or choice that is on or off. The one that is on is the only dark one: «secondary» on a white page is 1.1 to 1, and
 * in the list of opportunities nobody could tell which filter was active (for a member, none was marked at all).
 */
export function filterChip(on: boolean, size: 'md' | 'sm' = 'md') {
  return cn('shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    size === 'md' ? 'h-8 px-3 text-sm' : 'h-7 px-3 text-xs',
    on ? 'border-transparent bg-foreground font-medium text-background' : 'border-border bg-background text-foreground/75 hover:bg-muted hover:text-foreground');
}

/**
 * What the pipeline and the list share: the words to search, where the opportunities came from (licitaciones, Compra
 * Ágil, LinkedIn or recibidas) and the line of service they are about (seguridad, aseo, outsourcing, reclutamiento; any of the ones
 * picked). The list adds its own filters below (`children`); the pipeline's stages are its own.
 */
export function OpportunityFilters({ query, onQuery, source, onSource, categories = [], onCategories, showSources = true, children }: {
  query: string; onQuery: (value: string) => void; source: OpportunitySource; onSource: (value: OpportunitySource) => void;
  categories?: OpportunityCategory[]; onCategories?: (value: OpportunityCategory[]) => void;
  /** Only the admin sees where each one came from; an assigned person's list is short. */
  showSources?: boolean; children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Nombre, organismo o empresa"
            aria-label="Buscar en las oportunidades" className="h-10 rounded-full pl-9 pr-9" />
          {query ? <button type="button" onClick={() => onQuery('')} aria-label="Borrar la búsqueda"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
        </div>
        {showSources ? <div role="group" aria-label="Fuente" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 lg:mx-0 lg:px-0 lg:pb-0">
          {OPPORTUNITY_SOURCES.map(item => <button key={item.id} type="button" aria-pressed={source === item.id} onClick={() => onSource(item.id)}
            className={filterChip(source === item.id)}>
            {item.label}</button>)}
        </div> : null}
      </div>
      {showSources && onCategories ? <div role="group" aria-label="Rubro" className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 pb-0.5 lg:mx-0 lg:px-0">
        <span className="shrink-0 pr-1 text-xs text-muted-foreground">Rubro</span>
        {OPPORTUNITY_CATEGORIES.map(item => {
          const on = categories.includes(item.id);
          return <button key={item.id} type="button" aria-pressed={on} onClick={() => onCategories(on ? categories.filter(id => id !== item.id) : [...categories, item.id])}
            className={filterChip(on, 'sm')}>
            {item.label}</button>;
        })}
      </div> : null}
      {children}
    </div>
  );
}
