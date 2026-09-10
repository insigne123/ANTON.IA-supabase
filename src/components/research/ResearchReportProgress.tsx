'use client';

import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { estimatedResearchProgress } from '@/lib/research-report-loading';

export function ResearchReportProgress({ startedAt, retryScheduled = false }: {
  startedAt?: string | null;
  retryScheduled?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const progress = estimatedResearchProgress(startedAt, now);
  const message = retryScheduled
    ? 'La evidencia está guardada. Reintentaremos la preparación automáticamente.'
    : progress.longRunning
      ? 'Está tomando más de lo estimado. Seguimos esperando el informe final; aparecerá aquí cuando esté listo.'
      : 'Puedes revisar otros leads. El informe aparecerá aquí cuando termine su preparación.';
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-muted/25 p-5 sm:p-6" aria-label="Preparación del informe" aria-busy="true">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h3 className="text-base font-semibold tracking-tight">Preparando el informe completo</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
      </div>
      <Progress value={progress.hasStart ? progress.value : null} className="h-1.5 [&>div]:duration-1000 motion-reduce:[&>div]:transition-none" aria-label="Avance estimado de la espera" aria-valuetext="Estimación de espera, no porcentaje de trabajo completado" />
      <p className="text-xs leading-5 text-muted-foreground">Tiempo orientativo: unos 2 minutos entre investigación y preparación. La barra es una estimación, no mide el trabajo completado ni garantiza un plazo.</p>
    </section>
  );
}
