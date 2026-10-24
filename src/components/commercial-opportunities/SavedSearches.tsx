'use client';

import { Bell, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isSearch, sameSearch, type SavedSearch, type SearchState } from '@/lib/commercial-opportunities/admin-settings';
import { filterChip } from './OpportunityFilters';

/**
 * The searches of the list the team keeps (OPP-10): one touch puts its filters back. The one on screen says whether this person hears
 * of the new ones in the morning email, and can be removed; filters not saved yet can be. Quiet while there is nothing to keep.
 */
export function SavedSearches({ searches, current, userId, busy, onApply, onSave, onNotify, onRemove }: {
  searches: readonly SavedSearch[]; current: SearchState; userId: string; busy: boolean;
  onApply: (search: SavedSearch) => void; onSave: () => void; onNotify: (id: string, on: boolean) => void; onRemove: (id: string) => void;
}) {
  const active = searches.find(search => sameSearch(search, current));
  const told = Boolean(active?.notify.includes(userId));
  if (!searches.length && !isSearch(current)) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    {searches.length ? <div role="group" aria-label="Búsquedas guardadas" className="-mx-1 flex max-w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 lg:flex-wrap lg:overflow-visible">
      <span className="shrink-0 pr-1 text-xs text-muted-foreground">Guardadas</span>
      {searches.map(search => <button key={search.id} type="button" aria-pressed={search === active} onClick={() => onApply(search)} className={cn(filterChip(search === active, 'sm'), 'shrink-0')}>
        {search.notify.includes(userId) ? <><Bell className="mr-1 h-3 w-3" aria-hidden="true" /><span className="sr-only">Con aviso: </span></> : null}{search.name}</button>)}
    </div> : null}
    {active ? <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" aria-pressed={told} disabled={busy} onClick={() => onNotify(active.id, !told)}
        title="En el correo de la mañana, las nuevas que calcen con esta búsqueda.">
        <Bell className={cn('mr-1.5 h-3.5 w-3.5', told && 'fill-current')} aria-hidden="true" />{told ? 'Te avisamos de las nuevas' : 'Avisarme de las nuevas'}</Button>
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={busy} onClick={() => onRemove(active.id)}>Quitar</Button>
    </div> : isSearch(current) ? <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={onSave}>
      <Bookmark className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Guardar esta búsqueda</Button> : null}
  </div>;
}
