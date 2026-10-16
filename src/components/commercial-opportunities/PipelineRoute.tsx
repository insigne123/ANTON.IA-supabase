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
const TOP = 62;
const BOTTOM = 178;
const HEIGHT = 250;
/** The label sits under a high stop and over a low one, where it takes this much height above the circle. */
const LABEL = 28;

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

/**
 * The pipeline as a winding road of round milestones, one per stage, with how many opportunities wait in each. Picking a
 * stage shows its opportunities below. Wide screens get the road; phones a list of the same stops.
 */
export function PipelineRoute({ stops, selected, onSelect }: { stops: PipelineStop[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Etapas de las oportunidades">
      <div className="relative hidden md:block" style={{ height: HEIGHT }}>
        <svg aria-hidden="true" viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <path d={pipelineCurve(stops.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={18} strokeLinecap="round" className="stroke-muted" />
          <path d={pipelineCurve(stops.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeDasharray="7 9" className="stroke-background" />
          <path d={pipelineCurve(stops.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={3} pathLength={1} strokeDasharray="1" className="stroke-primary/40 motion-safe:animate-route-draw" />
        </svg>
        <ol className="relative h-full">
          {stops.map((stop, index) => {
            const high = index % 2 === 0;
            const active = selected === stop.id;
            return (
              <li key={stop.id} className="absolute flex w-[150px] -translate-x-1/2 flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-90"
                style={{ left: `${((index + 0.5) * 100) / stops.length}%`, top: high ? TOP - 34 : BOTTOM - 34 - LABEL, animationDelay: `${200 + index * 120}ms`, animationFillMode: 'both' }}>
                <button type="button" aria-pressed={active} onClick={() => onSelect(stop.id)} aria-label={`${stop.label}: ${stop.count}`}
                  className={cn('relative flex h-[68px] w-[68px] flex-col items-center justify-center rounded-full bg-background shadow-sm ring-2 transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring motion-reduce:transition-none',
                    HUES[index % HUES.length], active && 'scale-110 shadow-md ring-4')}>
                  <span aria-hidden="true" className="[&_svg]:h-4 [&_svg]:w-4">{stop.icon}</span>
                  <span className="text-lg font-semibold tabular-nums leading-tight">{stop.count}</span>
                  {stop.urgent ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground" title={`${stop.urgent} cierran en menos de 7 días`}>{stop.urgent}</span> : null}
                </button>
                <span className={cn('mt-2 text-sm font-semibold', !high && 'order-first mb-2 mt-0')}>{stop.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="grid gap-2 md:hidden">
        {stops.map((stop, index) => (
          <li key={stop.id}>
            <button type="button" aria-pressed={selected === stop.id} onClick={() => onSelect(stop.id)}
              className={cn('flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected === stop.id ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50')}>
              <span aria-hidden="true" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2 [&_svg]:h-4 [&_svg]:w-4', HUES[index % HUES.length])}>{stop.icon}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{stop.label}</span><span className="block truncate text-xs text-muted-foreground">{stop.hint}</span></span>
              <span className="text-lg font-semibold tabular-nums">{stop.count}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
