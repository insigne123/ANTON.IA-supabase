'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/dates';
import { LEAD_FIT_STAGES, LEAD_FIT_STAGE_LABELS, leadFitBand, leadFitKey, type LeadFitLead, type LeadFitStage } from '@/lib/lead-fit/core';
import type { LeadFitView } from '@/hooks/use-lead-fit';

const BAND_CLASS = {
  alta: 'bg-cw-success-soft text-cw-success',
  media: 'bg-cw-warning-soft text-cw-warning',
  baja: 'bg-muted text-foreground/70',
} as const;
const BAND_LABEL = { alta: 'Alta', media: 'Media', baja: 'Baja' } as const;

/**
 * «Probabilidad de calce» next to a person: the percentage of the most advanced stage estimated so far, and on hover, focus
 * or tap, why — the reasons that raise or lower it and how it changed from search to research.
 */
export function LeadFitBadge({ lead, stage, view, className }: { lead: LeadFitLead; stage: LeadFitStage; view: LeadFitView; className?: string }) {
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closing.current), []);
  const key = leadFitKey(lead);
  if (!key) return null;
  const person = view.results[key] || {};
  const reached = LEAD_FIT_STAGES.slice(0, LEAD_FIT_STAGES.indexOf(stage) + 1);
  const shown = [...reached].reverse().find(candidate => person[candidate]);
  if (!shown) {
    return view.pending.has(key)
      ? <span role="status" aria-label="Calculando la probabilidad de calce" className={cn('inline-block h-6 w-12 rounded-full bg-muted motion-safe:animate-pulse', className)} />
      : null;
  }
  const current = person[shown]!;
  const band = leadFitBand(current.probability);
  const history = reached.filter(candidate => person[candidate]);
  const show = () => { window.clearTimeout(closing.current); setOpen(true); };
  const hide = () => { window.clearTimeout(closing.current); closing.current = window.setTimeout(() => setOpen(false), 150); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          aria-label={`Probabilidad de calce: ${current.probability} %, ${BAND_LABEL[band].toLowerCase()}. Ver por qué`}
          className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            BAND_CLASS[band], className)}
        >
          {current.probability} %
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-4" onMouseEnter={show} onMouseLeave={hide} onOpenAutoFocus={event => event.preventDefault()}>
        <p className="text-xs text-muted-foreground">Probabilidad de calce · {LEAD_FIT_STAGE_LABELS[shown]}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{current.probability} %</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', BAND_CLASS[band])}>{BAND_LABEL[band]}</span>
        </p>
        <p className="mt-2 text-sm text-foreground">{current.summary}</p>
        {current.factors.length ? (
          <ul className="mt-3 space-y-1.5">
            {current.factors.map(factor => (
              <li key={factor.text} className="flex items-start gap-2 text-sm text-foreground/90">
                {factor.effect === 'up'
                  ? <ArrowUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-success" aria-label="Sube" />
                  : <ArrowDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-danger" aria-label="Baja" />}
                <span>{factor.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {history.length > 1 ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="text-xs text-muted-foreground">Cómo cambió</p>
            <ol className="mt-1 space-y-0.5 text-xs text-foreground/80">
              {history.map(candidate => (
                <li key={candidate} className="flex justify-between gap-3">
                  <span>{LEAD_FIT_STAGE_LABELS[candidate]}</span>
                  <span className="font-medium tabular-nums">{person[candidate]!.probability} %</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          La estima la IA (Haiku) con tu «Perfil», los datos de la persona y los resultados de tu equipo · {formatRelative(current.updatedAt)}. Es una guía, no una garantía.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** One line above the list when the estimates cannot show: no customer in «Perfil», today's cap, or the AI failing. */
export function LeadFitNotice({ view, className }: { view: LeadFitView; className?: string }) {
  const message = view.needsProfile
    ? <>Para ver la probabilidad de calce de cada persona, define tu oferta y tu cliente ideal en <Link href="/profile#icp-heading" className="font-medium text-primary underline-offset-4 hover:underline">Perfil</Link>.</>
    : view.limited ? 'Tu equipo llegó al máximo de probabilidades de calce de hoy; las nuevas se calculan mañana.'
      : view.failed ? 'No pudimos calcular algunas probabilidades de calce. Se reintentan al volver a esta página.' : null;
  return message ? <p className={cn('rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground', className)}>{message}</p> : null;
}
