'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RouteNode = {
  id: string;
  title: string;
  /** A short line under the title (a date, a count). */
  meta?: string | null;
  detail?: string | null;
  icon?: ReactNode;
  state: 'done' | 'current' | 'next';
  /** Controls for this step (a checkbox, a button), shown under its text. */
  action?: ReactNode;
};

const ROW = 128;
// The road runs down the middle; each step's text sits outward from its milestone, never across the road.
const LEFT = 36;
const RIGHT = 64;

/** The curve through the steps, in a 100-wide box: each step alternates sides and the path bends between them. */
export function routeCurve(count: number) {
  if (count < 2) return '';
  const x = (i: number) => (i % 2 === 0 ? LEFT : RIGHT);
  const y = (i: number) => i * ROW + ROW / 2;
  let d = `M ${x(0)} ${y(0)}`;
  for (let i = 1; i < count; i++) d += ` C ${x(i - 1)} ${y(i - 1) + ROW * 0.55}, ${x(i)} ${y(i) - ROW * 0.55}, ${x(i)} ${y(i)}`;
  return d;
}

/**
 * Steps as a winding path of round milestones, the way a roadmap is drawn: the done ones filled, the current one
 * marked, the rest waiting. On a phone it becomes a straight line. The path draws itself once, only with motion allowed.
 */
export function RoutePath({ nodes, label, className }: { nodes: RouteNode[]; label: string; className?: string }) {
  if (!nodes.length) return null;
  const height = nodes.length * ROW;
  return (
    <div className={cn('relative', className)}>
      {/* Wide screens: the zigzag. */}
      <div className="relative hidden sm:block" style={{ height }}>
        <svg aria-hidden="true" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <path d={routeCurve(nodes.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={14} strokeLinecap="round" className="stroke-muted" />
          <path d={routeCurve(nodes.length)} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeDasharray="6 8" className="stroke-primary/40 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-700" />
        </svg>
        <ol aria-label={label} className="relative h-full">
          {nodes.map((node, index) => {
            const left = index % 2 === 0;
            return (
              <li key={node.id} className="absolute flex items-start gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
                style={{ top: index * ROW + ROW / 2 - 24, width: `calc(${LEFT}% + 24px)`, ...(left ? { right: `calc(${100 - LEFT}% - 24px)`, flexDirection: 'row-reverse' } : { left: `calc(${RIGHT}% - 24px)` }),
                  animationDelay: `${150 + index * 110}ms`, animationFillMode: 'both' }}>
                <Milestone node={node} index={index} />
                <div className={cn('min-w-0 pt-1', left && 'text-right')}>
                  <StepText node={node} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {/* Phones: a straight line. */}
      <ol aria-label={label} className="relative space-y-5 sm:hidden">
        <span aria-hidden="true" className="absolute bottom-6 left-6 top-6 w-px border-l-2 border-dashed border-border" />
        {nodes.map((node, index) => (
          <li key={node.id} className="relative flex items-start gap-3">
            <Milestone node={node} index={index} />
            <div className="min-w-0 pt-1"><StepText node={node} /></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Milestone({ node, index }: { node: RouteNode; index: number }) {
  return (
    <span aria-hidden="true" className={cn('relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold shadow-sm transition-colors',
      node.state === 'done' ? 'border-cw-success bg-cw-success text-white dark:text-background'
        : node.state === 'current' ? 'border-primary bg-background text-primary ring-4 ring-primary/15'
          : 'border-border bg-background text-muted-foreground')}>
      {node.state === 'done' ? <Check className="h-5 w-5" /> : node.icon ?? <span className="tabular-nums">{index + 1}</span>}
    </span>
  );
}

function StepText({ node }: { node: RouteNode }) {
  return (
    <>
      <p className={cn('text-sm font-semibold leading-5', node.state === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
        <span className="sr-only">{node.state === 'done' ? 'Listo: ' : node.state === 'current' ? 'Ahora: ' : ''}</span>{node.title}
      </p>
      {node.meta ? <p className="mt-0.5 text-xs font-medium text-primary">{node.meta}</p> : null}
      {node.detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.detail}</p> : null}
      {node.action ? <div className="mt-1.5">{node.action}</div> : null}
    </>
  );
}
