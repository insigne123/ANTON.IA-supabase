'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CampaignStep = { label: string; hint: string };

/**
 * Where the campaign is (Plan 6, PR-D1): each step says whether it is done, current or still ahead, and a done step can be
 * opened again when the campaign still allows it. The step in progress is the page's aria-current.
 */
export function CampaignSteps({ steps, current, canGoTo, onGo }: {
  steps: CampaignStep[];
  current: number;
  canGoTo: (index: number) => boolean;
  onGo: (index: number) => void;
}) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progreso">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'pending';
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                state === 'done' && 'border-primary bg-primary text-primary-foreground',
                state === 'current' && 'border-primary text-primary',
                state === 'pending' && 'border-border text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="min-w-0 text-left">
              <span className={cn('block text-sm', state === 'pending' ? 'text-muted-foreground' : 'font-semibold text-foreground')}>{step.label}</span>
              <span className="hidden text-xs leading-5 text-muted-foreground sm:block">{step.hint}</span>
              <span className="sr-only">{state === 'done' ? ' (hecho)' : state === 'current' ? ' (paso actual)' : ' (pendiente)'}</span>
            </span>
          </>
        );
        return (
          <li key={step.label} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            {state === 'done' && canGoTo(index) ? (
              <button
                type="button"
                onClick={() => onGo(index)}
                className="flex w-full min-w-0 items-start gap-2 rounded-lg p-1 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Volver a ${step.label}`}
              >
                {content}
              </button>
            ) : (
              <div className="flex min-w-0 items-start gap-2 p-1">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
