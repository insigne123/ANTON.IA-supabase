'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { COWORK_TASK_NEVER, type CoworkTaskPlan, type CoworkTaskStepKind } from '@/lib/cowork/task-plan';
import { ReviewActions, ReviewError, ReviewLoading } from './ReviewParts';

const KIND: Record<CoworkTaskStepKind, string> = { search: 'Búsqueda', prepare: 'Contactos', write: 'Redacción', campaign: 'Campaña pausada' };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What the task may spend, in words: «hasta 1 búsqueda de tu cupo diario y 10 créditos», or that it spends nothing. */
export function coworkTaskSpend(limits: CoworkTaskPlan['limits']) {
  const parts = [limits.searches ? `${plural(limits.searches, 'búsqueda', 'búsquedas')} de tu cupo diario` : '',
    limits.credits ? `${plural(limits.credits, 'crédito', 'créditos')} (1 por correo buscado)` : ''].filter(Boolean);
  return parts.length ? `Hasta ${parts.join(' y ')}.` : 'No gasta búsquedas ni créditos.';
}

/**
 * The plan of a long task (Plan 13, 4c), approved once as in Claude Cowork: the steps in order, the most it may spend and what it
 * never does without asking. Each step that fits runs by itself after this approval; anything else comes back as its own card.
 */
export function TaskPlanReview({ runId, onApprove, onReject, resolving }: { runId: string; onApprove: () => void; onReject: () => void; resolving: boolean }) {
  const [plan, setPlan] = useState<CoworkTaskPlan | null>(null);
  const [ttlHours, setTtlHours] = useState(24);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetch(`/api/cowork/runs/${runId}/task`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar el plan.');
        if (!alive) return;
        setPlan(data.plan);
        if (Number.isInteger(data.ttlHours) && data.ttlHours > 0) setTtlHours(data.ttlHours);
      })
      .catch(problem => { if (alive) setError(problem instanceof Error ? problem.message : 'No se pudo cargar el plan.'); });
    return () => { alive = false; };
  }, [runId]);

  if (error) return <div className="space-y-4"><ReviewError message={error} /><ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar el plan" disabled resolving={resolving} /></div>;
  if (!plan) return <ReviewLoading label="Cargando el plan…" />;
  return <div className="space-y-4">
    <p className="text-[14px] font-medium leading-6 text-cw-text">{plan.goal}</p>
    <ol className="divide-y divide-cw-border rounded-xl border border-cw-border">
      {plan.steps.map((step, index) => <li key={`${index}-${step.label}`} className="flex items-start gap-3 px-3.5 py-2.5">
        <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cw-accent-soft text-[11.5px] font-semibold text-cw-accent">{index + 1}</span>
        <span className="min-w-0 flex-1 text-[13.5px] leading-5 text-cw-text">{step.label}</span>
        <span className="shrink-0 rounded-md bg-cw-hover px-1.5 py-0.5 text-[11.5px] text-cw-muted">{KIND[step.kind]}</span>
      </li>)}
    </ol>
    <div className="grid gap-3 text-[13px] leading-5 sm:grid-cols-2">
      <p><span className="block text-[12px] font-medium text-cw-muted">Lo máximo que puede gastar</span>{coworkTaskSpend(plan.limits)}</p>
      <div><span className="block text-[12px] font-medium text-cw-muted">Nunca sin preguntarte</span>
        <ul className="mt-0.5 space-y-0.5">{COWORK_TASK_NEVER.map(item => <li key={item} className="flex items-center gap-1.5">
          <Ban className="h-3.5 w-3.5 shrink-0 text-cw-muted" aria-hidden="true" />{item}</li>)}</ul>
      </div>
    </div>
    <p className="text-[12.5px] leading-5 text-cw-muted">Al aprobarlo, sigo paso a paso y te cuento el avance. Si escribes un mensaje, la tarea se detiene ahí, y si no termina en {ttlHours === 1 ? '1 hora' : `${ttlHours} horas`}, lo que falte te lo pregunto antes.</p>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar el plan" rejectLabel="Descartar plan" resolving={resolving} />
  </div>;
}
