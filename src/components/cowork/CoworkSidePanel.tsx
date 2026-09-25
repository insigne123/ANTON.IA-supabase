'use client';

import type { ReactNode } from 'react';
import { Check, CircleSlash, LoaderCircle, PanelRightClose, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import type { CoworkArtifact, CoworkProgressStep } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CoworkArtifactIcon, coworkArtifactMeta } from './CoworkTurn';
import { CwButton } from './ui';

function StepIcon({ state }: { state: CoworkProgressStep['state'] }) {
  if (state === 'done') return <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-cw-success text-cw-bg"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (state === 'active') return <LoaderCircle className="h-[18px] w-[18px] text-cw-accent motion-safe:animate-spin" aria-hidden="true" />;
  if (state === 'attention') return <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-cw-warning-soft ring-2 ring-cw-warning"><span className="h-1.5 w-1.5 rounded-full bg-cw-warning" /></span>;
  if (state === 'error') return <TriangleAlert className="h-[18px] w-[18px] text-cw-danger" aria-hidden="true" />;
  if (state === 'skipped') return <CircleSlash className="h-[18px] w-[18px] text-cw-faint" aria-hidden="true" />;
  return <span className="block h-[18px] w-[18px] rounded-full border-2 border-dashed border-cw-border-strong" aria-hidden="true" />;
}

const STATE_TEXT: Record<CoworkProgressStep['state'], string> = {
  done: 'completado', active: 'en curso', attention: 'requiere tu acción', pending: 'pendiente', error: 'con error', skipped: 'omitido',
};

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="border-b border-cw-border px-5 py-4 last:border-b-0">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-[12.5px] font-semibold text-cw-text">{title}</h2>
      {aside}
    </div>
    {children}
  </section>;
}

/** Right rail of the conversation: what is happening, what came out of it and what it used. */
export function CoworkSidePanel({ steps, turnCount, artifacts, openArtifactId, onOpenArtifact, sources, mode, budget, searchQuota, onClose }: {
  steps: CoworkProgressStep[];
  turnCount: number;
  artifacts: CoworkArtifact[];
  openArtifactId: string | null;
  onOpenArtifact: (artifact: CoworkArtifact, opener: HTMLElement) => void;
  sources: string[];
  mode: 'approval' | 'autonomous';
  budget?: { depth: number; maxDepth: number; exhausted: boolean } | null;
  searchQuota: { remaining: number; limit: number } | null;
  onClose: () => void;
}) {
  return <aside aria-label="Resumen del trabajo" className="flex h-full min-h-0 flex-col">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-cw-border px-4">
      <p className="text-[13px] font-medium text-cw-muted">Resumen</p>
      <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Ocultar resumen" title="Ocultar"><PanelRightClose aria-hidden="true" /></CwButton>
    </div>
    <div className="cw-scroll min-h-0 flex-1 overflow-y-auto">
      <Section title="Progreso" aside={turnCount > 1 ? <span className="text-[11.5px] text-cw-faint">Turno {turnCount}</span> : null}>
        <ol className="space-y-2.5">
          {steps.map((step, index) => <li key={step.key} className="relative flex items-start gap-2.5">
            {index < steps.length - 1 && <span className="absolute left-[8.5px] top-[22px] h-[calc(100%-8px)] w-px bg-cw-border" aria-hidden="true" />}
            <span className="relative z-[1] mt-px shrink-0 bg-cw-rail"><StepIcon state={step.state} /></span>
            <div className="min-w-0 text-[13px] leading-5">
              <p className={cn(step.state === 'pending' || step.state === 'skipped' ? 'text-cw-muted' : 'text-cw-text', step.state === 'attention' && 'font-medium')}>
                {step.label}<span className="sr-only"> ({STATE_TEXT[step.state]})</span>
              </p>
              {step.detail && <p className="truncate text-[12px] text-cw-muted">{step.detail}</p>}
            </div>
          </li>)}
        </ol>
      </Section>
      <Section title="Resultados">
        {artifacts.length === 0
          ? <p className="text-[12.5px] leading-5 text-cw-muted">Aquí aparecerán documentos, tablas y archivos de este trabajo.</p>
          : <ul className="-mx-2 space-y-0.5">
            {artifacts.map(artifact => <li key={artifact.id}>
              <button type="button" onClick={event => onOpenArtifact(artifact, event.currentTarget)} aria-current={openArtifactId === artifact.id ? 'true' : undefined}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
                  openArtifactId === artifact.id ? 'bg-cw-active' : 'hover:bg-cw-hover')}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cw-border bg-cw-elevated text-cw-accent"><CoworkArtifactIcon artifact={artifact} className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-cw-text">{artifact.title}</span>
                  <span className="block truncate text-[11.5px] text-cw-muted">{coworkArtifactMeta(artifact)}</span>
                </span>
              </button>
            </li>)}
          </ul>}
      </Section>
      <Section title="Contexto">
        <div className="space-y-3 text-[12.5px]">
          {sources.length > 0 && <div>
            <p className="mb-1.5 text-cw-muted">Datos consultados</p>
            <div className="flex flex-wrap gap-1.5">
              {sources.map(source => <span key={source} className="rounded-md border border-cw-border bg-cw-elevated px-1.5 py-0.5 text-[12px] text-cw-text">{source}</span>)}
            </div>
          </div>}
          <p className="flex items-center gap-1.5 text-cw-text">
            {mode === 'autonomous' ? <Zap className="h-3.5 w-3.5 text-cw-accent" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5 text-cw-success" aria-hidden="true" />}
            {mode === 'autonomous' ? 'Modo autónomo con topes' : 'Con aprobaciones: nada cambia sin tu visto bueno'}
          </p>
          {budget && budget.maxDepth > 0 && <p className="text-cw-muted">Pasos automáticos: {Math.min(budget.depth, budget.maxDepth)} de {budget.maxDepth}{budget.exhausted ? ' · tope alcanzado' : ''}</p>}
          {searchQuota && <p className="text-cw-muted">Búsquedas externas hoy: {searchQuota.remaining} de {searchQuota.limit}</p>}
        </div>
      </Section>
    </div>
  </aside>;
}
