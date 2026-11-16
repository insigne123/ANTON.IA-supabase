'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dropName, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';
import { DropAvatar, DropStageChip, dropStage, stageDotClass } from './drop-contact-parts';

/**
 * Several contacts as a workspace (16 Nov 2026, the owner: «no me gusta que se vea así como una columna … cuesta leerlo»): who they
 * are and where each stands in a list at the side, and one contact to read and act on at a time. Six cards one under another were
 * six times the same wall of text; here the list is the map and the card is the work.
 *
 * On a wide screen the list is a column that stays in view. On a phone it is a row of faces to slide, with the contact under it and
 * «anterior / siguiente» at its foot, so nothing is ever more than a thumb away.
 */
export function DropContactsWorkspace({ items, selectedId, onSelect, children }: {
  items: DropItem[]; selectedId: string; onSelect: (leadId: string) => void;
  /** The card of the selected contact. */
  children: ReactNode;
}) {
  const index = Math.max(0, items.findIndex(item => item.leadId === selectedId));
  const selected = items[index];
  const previous = items[index - 1], next = items[index + 1];
  return <div className="lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-5">
    <nav aria-label="Tus contactos" className="lg:sticky lg:top-6">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden">
        {items.map(item => {
          const stage = dropStage(item);
          const on = item.leadId === selected.leadId;
          return <li key={item.leadId} className="shrink-0 lg:shrink">
            <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onSelect(item.leadId)}
              className={cn('flex w-[4.75rem] flex-col items-center gap-1.5 rounded-xl p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'lg:w-full lg:flex-row lg:items-start lg:gap-3 lg:border lg:p-3 lg:text-left',
                on ? 'bg-primary/5 lg:border-primary/40 lg:shadow-sm' : 'hover:bg-muted/60 lg:border-transparent lg:bg-card/60 lg:hover:border-border')}>
              <span className="relative shrink-0">
                <DropAvatar item={item} className={cn(on && 'ring-2 ring-primary ring-offset-2 ring-offset-background lg:ring-0 lg:ring-offset-0')} />
                <span className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background lg:hidden', stageDotClass(stage))}><span className="sr-only">{stage.label}</span></span>
              </span>
              <span className="w-full min-w-0 lg:flex-1">
                <span className={cn('block truncate text-xs lg:text-sm', on ? 'font-semibold' : 'font-medium')}>{dropName(item)}</span>
                <span className="hidden truncate text-xs text-muted-foreground lg:block">{[item.title, item.company].filter(Boolean).join(' · ')}</span>
                <span className="mt-1.5 hidden lg:block"><DropStageChip stage={stage} /></span>
              </span>
            </button>
          </li>;
        })}
      </ul>
    </nav>
    <div className="min-w-0">
      <div id={`contacto-${selected.leadId}`} className="scroll-mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">{children}</div>
      {items.length > 1 ? <div className="mt-3 flex items-center justify-between gap-2 lg:hidden">
        <Button variant="ghost" size="sm" disabled={!previous} onClick={() => previous && onSelect(previous.leadId)}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Anterior</Button>
        <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{index + 1} de {items.length}</p>
        <Button variant="ghost" size="sm" disabled={!next} onClick={() => next && onSelect(next.leadId)}>Siguiente<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button>
      </div> : null}
    </div>
  </div>;
}
