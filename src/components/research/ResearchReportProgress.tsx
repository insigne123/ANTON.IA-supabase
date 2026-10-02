'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { estimatedResearchProgress, researchElapsedLabel, type ResearchReportPhase } from '@/lib/research-report-loading';
import { cn } from '@/lib/utils';

type StepState = 'done' | 'current' | 'pending';

/**
 * The steps the app can tell apart while a report is prepared (Plan 6, PR-C3): the research job, then the written report.
 * Nothing finer is shown, because nothing finer is known while it runs.
 */
const STEPS: Array<{ key: 'research' | 'writing' | 'ready'; label: string; hint: string }> = [
  { key: 'research', label: 'Buscar y leer fuentes', hint: 'De la empresa y de la persona.' },
  { key: 'writing', label: 'Escribir y revisar el informe', hint: 'Cada dato con su respaldo.' },
  { key: 'ready', label: 'Listo para escribirle', hint: 'El informe completo, con lo útil para el correo.' },
];

function stepState(step: (typeof STEPS)[number]['key'], phase: ResearchReportPhase): StepState {
  if (step === 'research') return phase === 'research' ? 'current' : 'done';
  if (step === 'writing') return phase === 'research' ? 'pending' : 'current';
  return 'pending';
}

const STATE_LABEL: Record<StepState, string> = { done: 'hecho', current: 'en curso', pending: 'pendiente' };

export function ResearchReportProgress({ startedAt, retryScheduled = false, phase = 'writing' }: {
  startedAt?: string | null;
  retryScheduled?: boolean;
  /** Which step it is in (researchReportPhase); a scheduled retry is still writing. */
  phase?: ResearchReportPhase;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const progress = estimatedResearchProgress(startedAt, now);
  const current: ResearchReportPhase = retryScheduled ? 'retry' : phase;
  const currentIndex = current === 'research' ? 0 : 1;
  const message = current === 'retry'
    ? 'La evidencia está guardada. Reintentaremos la preparación automáticamente.'
    : progress.slow
      ? 'Está tardando más que 9 de cada 10 investigaciones. Seguimos esperando el informe; aparecerá aquí cuando esté listo.'
      : 'Puedes revisar otros leads. El informe aparecerá aquí cuando termine.';
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-muted/25 p-5 sm:p-6" aria-label="Preparación del informe" aria-busy="true">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h3 className="text-base font-semibold tracking-tight">Preparando el informe completo</h3>
        <p className="mt-1 text-sm font-medium text-foreground">Paso {currentIndex + 1} de {STEPS.length}: {STEPS[currentIndex].label}</p>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
      </div>
      <ol className="space-y-3" aria-label="Pasos de la investigación">
        {STEPS.map((step) => {
          const state = stepState(step.key, current);
          return (
            <li key={step.key} className="flex items-start gap-3" data-step={step.key} data-state={state}>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  state === 'current' && 'border-primary text-primary',
                  state === 'pending' && 'border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : state === 'current'
                  ? <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
                  : <Circle className="h-2 w-2" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm', state === 'pending' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                  {step.label}<span className="sr-only">: {STATE_LABEL[state]}</span>
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">{step.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <Progress value={progress.hasStart ? progress.value : null} className="h-1.5 [&>div]:duration-1000 motion-reduce:[&>div]:transition-none" aria-label="Avance estimado de la espera" aria-valuetext="Estimación de espera, no porcentaje de trabajo completado" />
      <p className="text-xs leading-5 text-muted-foreground">
        {progress.elapsedMs !== null ? `Lleva ${researchElapsedLabel(progress.elapsedMs)}. ` : ''}
        La mitad de las investigaciones tarda menos de 3 minutos y 9 de cada 10, menos de 9. La barra es una estimación, no mide el trabajo completado ni garantiza un plazo.
      </p>
    </section>
  );
}
