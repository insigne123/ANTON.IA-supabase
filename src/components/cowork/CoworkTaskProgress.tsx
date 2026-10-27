'use client';

import { TriangleAlert } from 'lucide-react';
import type { CoworkTaskProgress, CoworkTaskProgressState } from '@/lib/cowork/task-graph';
import { cn } from '@/lib/utils';
import { DoneMark } from './CoworkActivity';
import { cwFadeRise, cwVariants, m } from './motion';

const STATE_TEXT: Record<CoworkTaskProgressState, string> = { done: 'hecho', current: 'sigue', pending: 'pendiente', attention: 'hay algo que revisar' };

function Marker({ state, live }: { state: CoworkTaskProgressState; live: boolean }) {
  if (state === 'done') return <DoneMark live={live} />;
  if (state === 'attention') return <TriangleAlert className="h-[18px] w-[18px] text-cw-warning" aria-hidden="true" />;
  return <span aria-hidden="true" className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px]',
    state === 'current' ? 'border-cw-accent' : 'border-cw-border-strong')}>
    {state === 'current' && <span className="h-1.5 w-1.5 rounded-full bg-cw-accent" />}
  </span>;
}

/**
 * An approved task's steps, as Claude Cowork keeps its plan in view: what is done, the step it goes on with and what is still to
 * come. It shows under the task's latest turn, as that turn left it.
 */
export function CoworkTaskProgressCard({ progress, live }: { progress: CoworkTaskProgress; live: boolean }) {
  const done = progress.steps.filter(step => step.state === 'done').length;
  const finished = done === progress.steps.length;
  return <m.section {...cwVariants(cwFadeRise, live)} aria-label="Avance de la tarea" className="rounded-2xl border border-cw-border bg-cw-panel px-3.5 py-3">
    <div className="flex items-baseline justify-between gap-3">
      <p className="min-w-0 text-[13px] font-medium leading-5 text-cw-text">{progress.goal}</p>
      <p className="shrink-0 text-[12px] text-cw-muted">{finished ? 'Terminada' : `${done} de ${progress.steps.length} pasos`}</p>
    </div>
    <ol className="mt-2.5 space-y-1.5">
      {progress.steps.map((step, index) => <li key={`${index}-${step.label}`} className="flex items-start gap-2.5 text-[13px] leading-5">
        <span className="mt-px shrink-0"><Marker state={step.state} live={live} /></span>
        <span className={cn('min-w-0 flex-1', step.state === 'current' ? 'font-medium text-cw-text' : step.state === 'attention' ? 'text-cw-warning' : 'text-cw-muted')}>
          {step.label}<span className="sr-only"> ({STATE_TEXT[step.state]})</span>
        </span>
      </li>)}
    </ol>
  </m.section>;
}
