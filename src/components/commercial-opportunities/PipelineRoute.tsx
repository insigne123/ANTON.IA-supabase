'use client';

import type { ReactNode } from 'react';
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
// A stage with nothing in it stays on the road, quiet: the ones with work are what the eye should find.
const EMPTY = 'bg-background text-muted-foreground ring-border';
const TOP = 52;
const BOTTOM = 146;
const HEIGHT = 236;
/** Half the stop's circle: the label goes under it. */
const RADIUS = 32;

/** The curve through the stops, in a 1000-wide box: each stop alternates high and low and the road bends between them. */
export function pipelineCurve(count: number) {
  if (count < 2) return '';
  const x = (i: number) => (1000 * (i + 0.5)) / count;
  const y = (i: number) => (i % 2 === 0 ? TOP : BOTTOM);
  let d = `M ${x(0)} ${y(0)}`;
  for (let i = 1; i < count; i++) {
    const gap = (x(i) - x(i - 1)) * 0.55;
    d += ` C ${x(i - 1) + gap} ${y(i - 1)}, ${x(i) - gap} ${y(i)}, ${x(i)} ${y(i)}`;
  }
  return d;
}

/** What the urgent count means, in words: the stop shows it under its name. */
export function urgentLabel(urgent: number) {
  return `${urgent} ${urgent === 1 ? 'cierra' : 'cierran'} en menos de 7 días`;
}

/**
 * The pipeline as a winding road of round milestones, one per stage, with how many opportunities wait in each. Picking a
 * stage shows its opportunities below. Wide screens get the road; phones a list of the same stops.
 */
export function PipelineRoute({ stops, selected, onSelect }: { stops: PipelineStop[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Etapas de las oportunidades">
      <div className="relative hidden md:block" style={{ height: HEIGHT }}>
        <svg aria-hidden="true" viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <path d={pipelineCurve(stops.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={10} strokeLinecap="round" className="stroke-muted opacity-70" />
          <path d={pipelineCurve(stops.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinecap="round" pathLength={1} strokeDasharray="1" className="stroke-primary/35 motion-safe:animate-route-draw" />
        </svg>
        <ol className="relative h-full">
          {stops.map((stop, index) => {
            const high = index % 2 === 0;
            const active = selected === stop.id;
            return (
              <li key={stop.id} className="absolute flex w-[170px] -translate-x-1/2 flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-90"
                style={{ left: `${((index + 0.5) * 100) / stops.length}%`, top: (high ? TOP : BOTTOM) - RADIUS, animationDelay: `${200 + index * 120}ms`, animationFillMode: 'both' }}>
                {/* The circle and its name are one button: the name is what a person reads, so it is what they click. */}
                <button type="button" aria-pressed={active} onClick={() => onSelect(stop.id)} aria-label={`${stop.label}: ${stop.count}`}
                  className="group flex flex-col items-center rounded-2xl px-3 pb-1 focus-visible:outline-none">
                  <span className={cn('flex h-16 w-16 flex-col items-center justify-center rounded-full bg-background ring-2 transition-[transform,box-shadow] duration-200 group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-ring motion-reduce:transition-none',
                    stop.count || active ? HUES[index % HUES.length] : EMPTY, active ? 'scale-110 shadow-lg ring-4' : 'shadow-sm')}>
                    <span aria-hidden="true" className="[&_svg]:h-4 [&_svg]:w-4">{stop.icon}</span>
                    <span className="text-lg font-semibold tabular-nums leading-tight">{stop.count}</span>
                  </span>
                  <span className={cn('mt-2.5 text-sm', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>{stop.label}</span>
                </button>
                {stop.urgent ? <span className="text-xs font-medium text-destructive">{urgentLabel(stop.urgent)}</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
      {/* minmax(0, 1fr): a truncated hint must not widen the column past the screen. */}
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
        {stops.map((stop, index) => (
          <li key={stop.id}>
            <button type="button" aria-pressed={selected === stop.id} onClick={() => onSelect(stop.id)}
              className={cn('flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected === stop.id ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50')}>
              <span aria-hidden="true" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2 [&_svg]:h-4 [&_svg]:w-4', stop.count ? HUES[index % HUES.length] : EMPTY)}>{stop.icon}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{stop.label}</span>
                {stop.urgent ? <span className="block truncate text-xs font-medium text-destructive">{urgentLabel(stop.urgent)}</span>
                  : <span className="block truncate text-xs text-muted-foreground">{stop.hint}</span>}</span>
              <span className={cn('text-lg font-semibold tabular-nums', !stop.count && 'text-muted-foreground')}>{stop.count}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
