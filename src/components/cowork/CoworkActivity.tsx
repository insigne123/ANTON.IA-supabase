'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, LoaderCircle, Minus, PenLine, SearchCheck, TriangleAlert } from 'lucide-react';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import {
  coworkAgentLine, coworkAgentRows, coworkAnswerReview, coworkElapsed, coworkFindingText, coworkReadEvents, coworkTurnFindings, describeCoworkObservation, type CoworkAgentRow,
  type CoworkIconKey, type CoworkPlanProgress, type CoworkPlanState, type CoworkReadFinding,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import {
  AnimatePresence, CW_EASE, CwCollapse, CwCount, cwCollapse, cwFadeRise, cwPop, cwSwap, cwVariants, m, useReducedMotion,
} from './motion';
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

/** The check of a finished step draws itself when it finishes while you watch. */
export function DoneMark({ live, size = 18 }: { live: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const draw = live && !reduce;
  return <span className="flex items-center justify-center rounded-full bg-cw-accent text-cw-on-accent" style={{ width: size, height: size }}>
    <svg viewBox="0 0 12 12" style={{ width: size * 0.66, height: size * 0.66 }} fill="none" aria-hidden="true">
      <m.path d="M2.6 6.3l2.3 2.3 4.6-4.8" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.26, ease: CW_EASE, delay: 0.08 }} />
    </svg>
  </span>;
}

/** Pending, in progress, done or skipped: each change of state swaps the marker in place. */
function PlanMarker({ state, live }: { state: CoworkPlanState; live: boolean }) {
  return <span className="relative block h-[18px] w-[18px]" aria-hidden="true">
    <AnimatePresence initial={false}>
      <m.span key={state} className="absolute inset-0 flex items-center justify-center" {...cwVariants(cwPop, live)}>
        {state === 'done' ? <DoneMark live={live} />
          : state === 'current' ? <LoaderCircle className="h-[18px] w-[18px] text-cw-accent motion-safe:animate-spin" />
            : state === 'skipped' ? <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-cw-border text-cw-faint"><Minus className="h-3 w-3" /></span>
              : <span className="block h-[18px] w-[18px] rounded-full border-[1.5px] border-cw-border-strong" />}
      </m.span>
    </AnimatePresence>
  </span>;
}

/** What a finished step found, as a chip beside it: «4 contactos», «sin envíos». */
function Finding({ finding, live }: { finding: CoworkReadFinding; live: boolean }) {
  return <m.span {...cwVariants(cwPop, live)} aria-hidden="true"
    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cw-accent-soft px-2 py-px text-[12px] font-medium leading-5 text-cw-accent">
    {finding.count === null ? finding.label : <><CwCount value={finding.count} animateIn={live} announce={false} /> {finding.label}</>}
  </m.span>;
}

const AGENT_ICONS = { writer: PenLine, reviewer: SearchCheck, judge: SearchCheck } as const;

/** Where an agent stands: working, done, done with something left to look at, or given up (the
 * coordinator took over). It swaps in place; it never loops (the plan's marker and the headline
 * already say the turn is working). */
function AgentMarker({ row, live }: { row: CoworkAgentRow; live: boolean }) {
  const state = row.state === 'working' ? 'working' : row.outcome === 'pending' ? 'pending' : row.outcome === 'skipped' ? 'skipped' : 'done';
  return <span className="relative block h-3.5 w-3.5" aria-hidden="true">
    <AnimatePresence initial={false}>
      <m.span key={state} className="absolute inset-0 flex items-center justify-center" {...cwVariants(cwPop, live)}>
        {state === 'working' ? <span className="block h-3.5 w-3.5 rounded-full border-[1.5px] border-cw-accent" />
          : state === 'pending' ? <TriangleAlert className="h-3.5 w-3.5 text-cw-warning" />
            : state === 'skipped' ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-cw-border text-cw-faint"><Minus className="h-2.5 w-2.5" /></span>
              : <DoneMark live={live} size={14} />}
      </m.span>
    </AnimatePresence>
  </span>;
}

/** The Writer and the Reviewer: who is writing or reviewing now, and what the review changed
 * («Revisora · 1 ajuste» with «sin "gratis"»), or what is still to look at. The judge shows as
 * the Reviewer of the answer («Revisora · Sin ajustes»). */
function AgentRows({ rows, live, className }: { rows: CoworkAgentRow[]; live: boolean; className?: string }) {
  return <ul aria-label="Quién escribe y quién revisa" className={cn('space-y-1.5', className)}>
    {rows.map(row => {
      const Icon = AGENT_ICONS[row.agent];
      const pending = row.state === 'done' && row.outcome === 'pending';
      return <m.li key={row.agent} {...cwVariants(cwFadeRise, live)} className="flex min-w-0 items-start gap-2 text-[13px] leading-5">
        <span aria-hidden="true" className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-cw-accent-soft text-cw-accent">
          <Icon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5">
            <span><span className="font-medium text-cw-text">{row.name}</span><span className="text-cw-faint" aria-hidden="true"> · </span>
              <AnimatePresence initial={false} mode="wait">
                <m.span key={row.label} {...cwVariants(cwSwap, live)} className={pending ? 'text-cw-warning' : 'text-cw-muted'}>
                  {row.label}{row.state === 'working' ? '…' : ''}
                </m.span>
              </AnimatePresence>
            </span>
            <AgentMarker row={row} live={live} />
          </span>
          <span className="sr-only">{row.state === 'working' ? ' (en curso)' : ' (listo)'}</span>
          {row.changes.length > 0 && (pending
            ? <span className="mt-0.5 block space-y-0.5 text-[12.5px] text-cw-muted">{row.changes.map(change => <span key={change} className="block">{change}</span>)}</span>
            : <span className="mt-1 flex flex-wrap gap-1">
              {row.changes.map(change => <m.span key={change} {...cwVariants(cwPop, live)}
                className="rounded-full bg-cw-success-soft px-2 py-px text-[12px] font-medium leading-5 text-cw-success">{change}</m.span>)}
            </span>)}
        </span>
      </m.li>;
    })}
  </ul>;
}

/** The turn's plan as a checklist: what is done and what it found, what it is doing now, what comes next.
 * The Writer and the Reviewer show under the step they do (`agentsAt`). */
function PlanList({ plan, live, className, agents = [], agentsAt = -1 }: {
  plan: CoworkPlanProgress; live: boolean; className?: string; agents?: CoworkAgentRow[]; agentsAt?: number;
}) {
  const current = plan.findIndex(step => step.state === 'current');
  const next = current === -1 ? -1 : plan.findIndex((step, index) => index > current && step.state === 'pending');
  return <ol aria-label="Plan" className={cn('space-y-2', className)}>
    {plan.map((step, index) => <li key={`${index}-${step.label}`} className="flex items-start gap-2.5">
      <span className="mt-[1px] shrink-0"><PlanMarker state={step.state} live={live} /></span>
      <div className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('min-w-0 text-[13.5px] leading-5 transition-colors duration-200',
            step.state === 'current' ? 'font-medium text-cw-text'
              : step.state === 'done' ? 'text-cw-muted'
                : step.state === 'skipped' ? 'text-cw-faint line-through' : 'text-cw-faint')}>
            {step.label}<span className="sr-only"> ({STATE_TEXT[step.state]}{step.state === 'done' && step.found ? `: ${coworkFindingText(step.found)}` : ''})</span>
          </span>
          <AnimatePresence initial={false}>
            {step.state === 'done' && step.found && <Finding key="found" finding={step.found} live={live} />}
            {index === next && <m.span key="next" {...cwVariants(cwSwap, live)} aria-hidden="true" className="text-[11.5px] font-medium text-cw-faint">Siguiente</m.span>}
          </AnimatePresence>
        </span>
        {index === agentsAt && agents.length > 0 && <AgentRows rows={agents} live={live} className="mt-2" />}
      </div>
    </li>)}
  </ol>;
}

/** The step the agents work on: the one in progress, else the last one that ran. */
function agentStep(plan: CoworkPlanProgress) {
  const current = plan.findIndex(step => step.state === 'current');
  if (current !== -1) return current;
  for (let index = plan.length - 1; index >= 0; index--) if (plan[index].state !== 'skipped') return index;
  return plan.length - 1;
}

/** While the plan runs: what it is doing now, how far it is, and the plan below. */
function LivePlan({ plan, liveLabel, elapsed, agents }: { plan: CoworkPlanProgress; liveLabel: string; elapsed: string; agents: CoworkAgentRow[] }) {
  const reduce = useReducedMotion();
  const current = plan.find(step => step.state === 'current');
  const working = agents.find(row => row.state === 'working');
  const finished = plan.filter(step => step.state === 'done' || step.state === 'skipped').length;
  const done = plan.filter(step => step.state === 'done').length;
  // A step in progress counts a little, so the bar moves as soon as the work starts.
  const progress = Math.min(1, (finished + (current ? 0.35 : 0)) / plan.length);
  const headline = (working ? coworkAgentLine(working) : current ? current.label : liveLabel).replace(/[.…\s]+$/, '');
  return <div className="rounded-2xl border border-cw-border bg-cw-panel px-3.5 py-3">
    <div className="flex items-center gap-2 text-[13px]">
      <span className="shrink-0 rounded-md bg-cw-accent-soft px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-cw-accent">Ahora</span>
      <span className="min-w-0 flex-1">
        <AnimatePresence initial={false} mode="wait">
          <m.span key={headline} {...cwVariants(cwSwap)} className="cw-shimmer block truncate font-medium">{headline}…</m.span>
        </AnimatePresence>
      </span>
      <span className="shrink-0 tabular-nums text-cw-faint" aria-hidden="true">{done}/{plan.length}{elapsed ? ` · ${elapsed}` : ''}</span>
    </div>
    <p role="status" className="sr-only">{`${headline}. ${done} de ${plan.length} pasos listos${elapsed ? `, ${elapsed}` : ''}.`}</p>
    <div className="mb-3 mt-2.5 h-1 overflow-hidden rounded-full bg-cw-hover" aria-hidden="true">
      <m.div className="h-full w-full origin-left rounded-full bg-cw-accent" initial={false} animate={{ scaleX: progress }}
        transition={reduce ? { duration: 0 } : { duration: 0.45, ease: CW_EASE }} />
    </div>
    <PlanList plan={plan} live agents={agents} agentsAt={agentStep(plan)} />
  </div>;
}

/** What Cowork did in a turn. While it works with a plan, the plan shows open
 * with its progress; when the turn ends it folds into one line, like a tool-use
 * log, and opens again on demand. */
export function CoworkActivity({ events, active, liveLabel, startedAt, plan = null, defaultOpen = false }: {
  events: CoworkEvent[]; active: boolean; liveLabel: string; startedAt?: string; plan?: CoworkPlanProgress | null; defaultOpen?: boolean;
}) {
  const reduce = useReducedMotion();
  const steps = stepsFrom(events);
  const agents = coworkAgentRows(events);
  const [open, setOpen] = useState(defaultOpen);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const elapsed = active ? coworkElapsed(startedAt) : '';
  // The checklist stays open while a step is in progress; an approved action running afterwards reads as one line.
  const livePlan = active && plan?.some(step => step.state === 'current') ? plan : null;
  if (!livePlan && !steps.length && !active && !plan && !agents.length) return null;
  // While a turn without a plan works, its agents show open below the line.
  const expandable = steps.length > 0 || Boolean(plan) || (agents.length > 0 && !active);
  const icons = [...new Set(steps.map(step => step.icon))].slice(0, 3);
  const reads = coworkReadEvents(events).length;
  const files = steps.length - reads;
  // «Escribió 3 correos»: the Writer's last step says what it wrote (nothing when it gave up).
  const wrote = agents.find(row => row.agent === 'writer' && row.state === 'done' && row.outcome !== 'skipped')?.label || '';
  // «Revisó la respuesta»: the judge read it before it was shown (nothing when it could not). Whether
  // it changed is told by the Reviewer's row and, with the live text, by the notice under the answer.
  const reviewed = coworkAnswerReview(agents) !== null;
  const parts = [
    plan ? `Siguió un plan de ${plan.length} pasos` : '',
    reads ? `hizo ${reads} ${reads === 1 ? 'consulta' : 'consultas'}` : '',
    files ? `generó ${files} ${files === 1 ? 'archivo' : 'archivos'}` : '',
    wrote ? wrote.charAt(0).toLocaleLowerCase('es') + wrote.slice(1) : '',
    reviewed ? 'revisó la respuesta' : '',
  ].filter(Boolean);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] || '';
  const summary = active ? liveLabel : joined.charAt(0).toUpperCase() + joined.slice(1);
  // Where the answer comes from, at a glance: what the reads found («3 contactos», «sin envíos»).
  const findings = active ? [] : coworkTurnFindings(events).slice(0, 3).map(coworkFindingText);

  // When the plan ends it closes its space and the one-line summary takes its place.
  return <AnimatePresence initial={false} mode="wait">
    {livePlan
      ? <m.div key="live" {...cwVariants(reduce ? cwSwap : cwCollapse)}>
        <LivePlan plan={livePlan} liveLabel={liveLabel} elapsed={elapsed} agents={agents} />
      </m.div>
      : <m.div key="summary" {...cwVariants(cwFadeRise)} className="text-[13.5px]">
        <button type="button" onClick={() => expandable && setOpen(value => !value)} aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-cw-muted transition-colors enabled:hover:bg-cw-hover enabled:hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:cursor-default">
          {icons.length > 0 && <span className="flex shrink-0 -space-x-1" aria-hidden="true">
            {icons.map(icon => <span key={icon} className="flex h-5 w-5 items-center justify-center rounded-full border border-cw-border bg-cw-elevated">
              <CoworkIcon name={icon} className="h-3 w-3" />
            </span>)}
          </span>}
          <span className={cn('min-w-0 truncate', active && 'cw-shimmer')} role={active ? 'status' : undefined}>{summary}</span>
          {findings.length > 0 && <>
            <span className="sr-only">. Encontró: {findings.join(', ')}</span>
            {!open && <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden="true">
              {findings.map(text => <span key={text} className="rounded-full bg-cw-accent-soft px-2 py-px text-[12px] font-medium leading-5 text-cw-accent">{text}</span>)}
            </span>}
          </>}
          {elapsed && <span className="shrink-0 text-[12px] tabular-nums text-cw-faint">{elapsed}</span>}
          {expandable && <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />}
        </button>
        {/* The line already says what a lone agent is doing; the rows show once there is more to follow. */}
        {active && !plan && (agents.length > 1 || agents.some(row => row.state === 'done')) && <AgentRows rows={agents} live className="ml-0.5 pt-1.5" />}
        <CwCollapse show={open && expandable}>
          {plan && <PlanList plan={plan} live={false} className="ml-0.5 pt-1.5" agents={agents} agentsAt={agentStep(plan)} />}
          {!plan && !active && agents.length > 0 && <AgentRows rows={agents} live={false} className="ml-0.5 pt-1.5" />}
          {steps.length > 0 && <div className="pt-2"><ol aria-label="Consultas" className="relative ml-[9px] space-y-2.5 border-l border-cw-border py-1 pl-4">
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
          </ol></div>}
        </CwCollapse>
      </m.div>}
  </AnimatePresence>;
}
