'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Minus } from 'lucide-react';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import {
  coworkElapsed, coworkReadEvents, describeCoworkObservation, type CoworkIconKey, type CoworkPlanProgress, type CoworkPlanState,
} from '@/lib/cowork/presentation';
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

const STATE_TEXT: Record<CoworkPlanState, string> = { done: 'hecho', current: 'en curso', pending: 'pendiente', skipped: 'no hizo falta' };

function PlanMarker({ state }: { state: CoworkPlanState }) {
  if (state === 'done') return <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-cw-accent text-cw-on-accent"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (state === 'current') return <span className="flex h-[18px] w-[18px] items-center justify-center text-cw-accent"><LoaderCircle className="h-[18px] w-[18px] motion-safe:animate-spin" aria-hidden="true" /></span>;
  if (state === 'skipped') return <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-cw-border text-cw-faint"><Minus className="h-3 w-3" aria-hidden="true" /></span>;
  return <span className="block h-[18px] w-[18px] rounded-full border-[1.5px] border-cw-border-strong" aria-hidden="true" />;
}

/** The turn's plan as a checklist: what is done, what it is doing now, what comes next. */
function PlanList({ plan, className }: { plan: CoworkPlanProgress; className?: string }) {
  return <ol aria-label="Plan" className={cn('space-y-2', className)}>
    {plan.map((step, index) => <li key={`${index}-${step.label}`} className="flex items-start gap-2.5">
      <span className="mt-[1px] shrink-0" aria-hidden="true"><PlanMarker state={step.state} /></span>
      <span className={cn('min-w-0 text-[13.5px] leading-5',
        step.state === 'current' ? 'font-medium text-cw-text'
          : step.state === 'done' ? 'text-cw-muted'
            : step.state === 'skipped' ? 'text-cw-faint line-through' : 'text-cw-faint')}>
        {step.label}<span className="sr-only"> ({STATE_TEXT[step.state]})</span>
      </span>
    </li>)}
  </ol>;
}

/** Compact, expandable trace of what the assistant consulted, like a tool-use
 * log. While it works with a plan, the plan shows open with its progress. */
export function CoworkActivity({ events, active, liveLabel, startedAt, plan = null, defaultOpen = false }: {
  events: CoworkEvent[]; active: boolean; liveLabel: string; startedAt?: string; plan?: CoworkPlanProgress | null; defaultOpen?: boolean;
}) {
  const steps = stepsFrom(events);
  const [open, setOpen] = useState(defaultOpen);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const elapsed = active ? coworkElapsed(startedAt) : '';
  // The checklist stays open while a step is in progress; an approved action running afterwards reads as one line.
  if (active && plan?.some(step => step.state === 'current')) {
    const done = plan.filter(step => step.state === 'done').length;
    return <div className="cw-fade rounded-2xl border border-cw-border bg-cw-panel px-3.5 py-3">
      <div className="mb-2.5 flex items-center gap-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate text-cw-muted cw-shimmer" role="status">{liveLabel}</span>
        <span className="shrink-0 tabular-nums text-cw-faint" aria-label={`${done} de ${plan.length} pasos${elapsed ? `, ${elapsed}` : ''}`}>{done}/{plan.length}{elapsed ? ` · ${elapsed}` : ''}</span>
      </div>
      <PlanList plan={plan} />
    </div>;
  }

  if (!steps.length && !active && !plan) return null;
  const expandable = steps.length > 0 || Boolean(plan);
  const icons = [...new Set(steps.map(step => step.icon))].slice(0, 3);
  const reads = coworkReadEvents(events).length;
  const files = steps.length - reads;
  const parts = [
    plan ? `Siguió un plan de ${plan.length} pasos` : '',
    reads ? `hizo ${reads} ${reads === 1 ? 'consulta' : 'consultas'}` : '',
    files ? `generó ${files} ${files === 1 ? 'archivo' : 'archivos'}` : '',
  ].filter(Boolean);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] || '';
  const summary = active ? liveLabel : joined.charAt(0).toUpperCase() + joined.slice(1);

  return <div className="text-[13.5px]">
    <button type="button" onClick={() => expandable && setOpen(value => !value)} aria-expanded={expandable ? open : undefined}
      disabled={!expandable}
      className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-cw-muted transition-colors enabled:hover:bg-cw-hover enabled:hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:cursor-default">
      {icons.length > 0 && <span className="flex shrink-0 -space-x-1" aria-hidden="true">
        {icons.map(icon => <span key={icon} className="flex h-5 w-5 items-center justify-center rounded-full border border-cw-border bg-cw-elevated">
          <CoworkIcon name={icon} className="h-3 w-3" />
        </span>)}
      </span>}
      <span className={cn('min-w-0 truncate', active && 'cw-shimmer')} role={active ? 'status' : undefined}>{summary}</span>
      {elapsed && <span className="shrink-0 text-[12px] tabular-nums text-cw-faint">{elapsed}</span>}
      {expandable && <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />}
    </button>
    {open && plan && <PlanList plan={plan} className="cw-fade ml-0.5 mt-1.5" />}
    {open && steps.length > 0 && <ol aria-label="Consultas" className="cw-fade relative ml-[9px] mt-2 space-y-2.5 border-l border-cw-border py-1 pl-4">
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
