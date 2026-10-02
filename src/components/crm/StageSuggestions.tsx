'use client';

import { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeStageMove, type CrmStageSuggestion } from '@/lib/crm-stage-suggestions';

/**
 * «Sugerencias de etapa» (Plan 5, PR-10): what the events propose, each with its reason, to accept one by one or all at
 * once. Nothing moves until a person accepts it.
 */
export function StageSuggestions({ suggestions, nameFor, busy, onDecide }: {
  suggestions: CrmStageSuggestion[];
  nameFor: (crmId: string) => string;
  busy: boolean;
  onDecide: (ids: string[], decision: 'accept' | 'dismiss') => void;
}) {
  const [open, setOpen] = useState(true);
  if (!suggestions.length) return null;
  const count = suggestions.length;
  return <section aria-labelledby="stage-suggestions-title" className="border-b border-border/70 bg-muted/20 px-4 py-3 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
        className="flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span id="stage-suggestions-title" className="text-sm font-semibold">{count} {count === 1 ? 'sugerencia de etapa' : 'sugerencias de etapa'}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Nada se mueve hasta que lo aceptes.</span>
      </button>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(suggestions.map(item => item.id), 'dismiss')}>Descartar todas</Button>
        <Button size="sm" disabled={busy} onClick={() => onDecide(suggestions.map(item => item.id), 'accept')}>Aceptar todas</Button>
      </div>
    </div>
    {open && <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
      {suggestions.map(item => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{nameFor(item.crm_id)}</span>
          <span className="text-muted-foreground"> · {describeStageMove(item)}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.reason}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide([item.id], 'accept')} aria-label={`Aceptar: ${nameFor(item.crm_id)} a ${describeStageMove(item)}`}>
            <Check className="h-4 w-4" aria-hidden="true" /> Aceptar
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => onDecide([item.id], 'dismiss')} aria-label={`Descartar la sugerencia de ${nameFor(item.crm_id)}`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </span>
      </li>)}
    </ul>}
  </section>;
}
