'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import { coworkElapsed, coworkReadEvents, describeCoworkObservation, type CoworkIconKey } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CoworkIcon } from './ui';

type Step = { key: string; label: string; detail: string | null; icon: CoworkIconKey };

function stepsFrom(events: CoworkEvent[]): Step[] {
  const steps: Step[] = [];
  const reads = new Set(coworkReadEvents(events));
  for (const event of events) {
    if (reads.has(event)) {
      const line = describeCoworkObservation(event.payload || {});
      steps.push({ key: String(event.sequence), label: line.label, detail: line.detail, icon: line.icon });
    }
    if (event.kind === 'artifact.created') {
      const name = typeof event.payload?.name === 'string' ? event.payload.name : 'archivo';
      steps.push({ key: String(event.sequence), label: `Generó ${name}`, detail: null, icon: 'file' });
    }
  }
  return steps;
}

/** Compact, expandable trace of what the assistant consulted, like a tool-use log. */
export function CoworkActivity({ events, active, liveLabel, startedAt, defaultOpen = false }: {
  events: CoworkEvent[]; active: boolean; liveLabel: string; startedAt?: string; defaultOpen?: boolean;
}) {
  const steps = stepsFrom(events);
  const [open, setOpen] = useState(defaultOpen);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!steps.length && !active) return null;
  const icons = [...new Set(steps.map(step => step.icon))].slice(0, 3);
  const reads = coworkReadEvents(events).length;
  const files = steps.length - reads;
  const summary = active ? liveLabel
    : [reads ? `Hizo ${reads} ${reads === 1 ? 'consulta' : 'consultas'}` : '', files ? `generó ${files} ${files === 1 ? 'archivo' : 'archivos'}` : '']
      .filter(Boolean).join(' y ').replace(/^generó/, 'Generó');
  const elapsed = active ? coworkElapsed(startedAt) : '';

  return <div className="text-[13.5px]">
    <button type="button" onClick={() => steps.length && setOpen(value => !value)} aria-expanded={steps.length ? open : undefined}
      disabled={!steps.length}
      className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-cw-muted transition-colors enabled:hover:bg-cw-hover enabled:hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:cursor-default">
      {icons.length > 0 && <span className="flex shrink-0 -space-x-1" aria-hidden="true">
        {icons.map(icon => <span key={icon} className="flex h-5 w-5 items-center justify-center rounded-full border border-cw-border bg-cw-elevated">
          <CoworkIcon name={icon} className="h-3 w-3" />
        </span>)}
      </span>}
      <span className={cn('min-w-0 truncate', active && 'cw-shimmer')} role={active ? 'status' : undefined}>{summary}</span>
      {elapsed && <span className="shrink-0 text-[12px] tabular-nums text-cw-faint">{elapsed}</span>}
      {steps.length > 0 && <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />}
    </button>
    {open && steps.length > 0 && <ol className="cw-fade relative ml-[9px] mt-1 space-y-2.5 border-l border-cw-border py-1 pl-4">
      {steps.map(step => <li key={step.key} className="relative flex min-w-0 items-start gap-2">
        <span className="absolute -left-[23px] top-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-cw-bg" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-cw-border-strong" />
        </span>
        <CoworkIcon name={step.icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-muted" />
        <span className="min-w-0">
          <span className="text-cw-text">{step.label}</span>
          {step.detail && <span className="text-cw-muted"> · {step.detail}</span>}
        </span>
      </li>)}
    </ol>}
  </div>;
}
