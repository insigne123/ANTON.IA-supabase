'use client';

import type { ReactNode } from 'react';

/**
 * The one main action of the results, pinned to the bottom of the screen while there is something to act on: «Buscar
 * contactos» for the chosen companies, «Guardar» for the chosen people.
 */
export function ResultsActionBar({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Acción principal de los resultados"
      className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-[0_12px_32px_-18px_rgba(15,23,42,0.45)] backdrop-blur sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0" aria-live="polite">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-foreground/70">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{children}</div>
    </div>
  );
}
