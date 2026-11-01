'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { companySetupSteps, type CompanySetupFacts, type SetupStepId } from '@/lib/commercial-opportunities/company-setup';

const ACTIONS: Record<SetupStepId, string> = { documents: 'Subir documentos', ticket: 'Conectar el ticket', assign: 'Ver las recomendadas', competitors: 'Ir a Mercado público' };

/**
 * «Prepara tu empresa» (OPP-05): the few things a workspace sets once to work tenders well, while any is missing. The next one carries
 * the only filled button; the ticket is connected in «Conexiones». «Ocultar» puts it away in this browser.
 */
export function CompanySetup({ facts, onStep, onHide }: { facts: CompanySetupFacts; onStep: (id: SetupStepId) => void; onHide?: () => void }) {
  const steps = companySetupSteps(facts);
  const done = steps.filter(step => step.done).length;
  if (!steps.length || done === steps.length) return null;
  const next = steps.find(step => !step.done)?.id;
  return <section aria-labelledby="company-setup-title" className="rounded-2xl border bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 id="company-setup-title" className="text-sm font-semibold">Prepara tu empresa <span className="font-normal tabular-nums text-muted-foreground">· {done} de {steps.length}</span></h2>
      {onHide ? <Button type="button" variant="ghost" size="sm" className="-mr-2 h-8 text-muted-foreground" onClick={onHide}>Ocultar</Button> : null}
    </div>
    <ol className="mt-3 space-y-3">
      {steps.map(step => <li key={step.id} className="flex items-start gap-3">
        <span aria-hidden="true" className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', step.done ? 'border-transparent bg-primary text-primary-foreground' : 'border-border')}>
          {step.done ? <Check className="h-3 w-3" /> : null}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={cn('text-sm', step.done ? 'text-muted-foreground' : 'font-medium')}>{step.title}{step.done ? <span className="sr-only"> (listo)</span> : null}</p>
            <p className="text-xs text-muted-foreground">{step.detail}</p>
          </div>
          {step.done ? null : step.id === 'ticket'
            ? <Button asChild size="sm" variant={step.id === next ? 'secondary' : 'ghost'} className="shrink-0 self-start"><Link href="/connections">{ACTIONS.ticket}</Link></Button>
            : <Button type="button" size="sm" variant={step.id === next ? 'secondary' : 'ghost'} className="shrink-0 self-start" onClick={() => onStep(step.id)}>{ACTIONS[step.id]}</Button>}
        </div>
      </li>)}
    </ol>
  </section>;
}
