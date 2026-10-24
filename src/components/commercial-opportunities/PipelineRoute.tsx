'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PipelineStop = { id: string; label: string; hint: string; count: number; urgent?: number; icon: ReactNode };

// One hue per stage, light and dark, so the route reads at a glance; the count and the label say the same in words.
const HUES = [
  'bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300',
  'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  'bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:text-violet-300',
  'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  'bg-indigo-500/10 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300',
  'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
];
// A stage with nothing in it stays quiet: the ones with work are what the eye should find.
const EMPTY = 'bg-background text-muted-foreground ring-border';

/** What the urgent count means, in words: the stop shows it under its name. */
export function urgentLabel(urgent: number) {
  return `${urgent} ${urgent === 1 ? 'cierra' : 'cierran'} en menos de 7 días`;
}

/**
 * The stages in one quiet row, each with how many opportunities wait in it (OPP-39): about 64 px, where the winding road took 240
 * before the first card. Picking a stage shows its opportunities below. On a phone the same row scrolls sideways (OPP-42) instead of
 * stacking six rows.
 */
export function PipelineRoute({ stops, selected, onSelect }: { stops: PipelineStop[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Etapas de las oportunidades">
      <ol style={{ '--stops': stops.length } as CSSProperties}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:overflow-visible md:px-0 md:[grid-template-columns:repeat(var(--stops),minmax(0,1fr))] [&::-webkit-scrollbar]:hidden">
        {stops.map((stop, index) => {
          const active = selected === stop.id;
          return (
            <li key={stop.id} className="min-w-[9.5rem] shrink-0 md:min-w-0">
              <button type="button" aria-pressed={active} onClick={() => onSelect(stop.id)} aria-label={`${stop.label}: ${stop.count}`}
                className={cn('grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-2xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-foreground/50 bg-muted/60' : 'border-border hover:bg-muted/40')}>
                <span className={cn('row-span-2 flex h-8 w-8 items-center justify-center rounded-full ring-1 [&_svg]:h-4 [&_svg]:w-4', stop.count || active ? HUES[index % HUES.length] : EMPTY)} aria-hidden="true">{stop.icon}</span>
                <span className={cn('text-lg font-semibold tabular-nums leading-tight', !stop.count && 'text-muted-foreground')}>{stop.count}</span>
                {/* The name is part of the button: what a person reads is what they click. */}
                <span className={cn('truncate text-xs', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>{stop.label}</span>
              </button>
              {stop.urgent ? <span className="mt-1 block px-1 text-xs font-medium text-destructive">{urgentLabel(stop.urgent)}</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
