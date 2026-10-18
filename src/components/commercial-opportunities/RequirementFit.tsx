'use client';
// «¿Cumplimos?» inside the report: each requirement as ✓ meets, ⚠ a missing fact (with its question, answered right
// there) or ✗ does not meet, against the company's «Ficha para licitaciones».
import { useState } from 'react';
import { Check, CircleHelp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FIT_LABELS, fitSummary, type RequirementFit, type ReportFit } from '@/lib/commercial-opportunities/requirement-fit';

export type OpportunityFitView = { available: boolean; latest: ReportFit | null; profileRevision: number | null };
const TONE: Record<RequirementFit['fit'], string> = { meets: 'text-cw-success', missing: 'text-cw-warning', fails: 'text-destructive', na: 'text-muted-foreground' };
const ICON = { meets: Check, missing: CircleHelp, fails: X, na: null } as const;

export function FitBadge({ fit }: { fit: RequirementFit }) {
  const Icon = ICON[fit.fit];
  return (
    <p className={cn('flex items-start gap-1.5 text-xs', TONE[fit.fit])}>
      {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span><span className="font-medium">{FIT_LABELS[fit.fit]}</span>{fit.basis ? <span className="text-muted-foreground"> · {fit.basis}</span> : null}</span>
    </p>
  );
}

/** The AI's question about a missing fact, answered in one tap (Sí / No) or in a few words; the answer goes into the profile. */
export function FitQuestion({ id, question, busy, onAnswer }: { id: string; question: string; busy: boolean; onAnswer: (answer: string) => void }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className="mt-2 rounded-xl bg-cw-warning-soft px-3 py-2.5">
      <p className="text-sm text-foreground" id={`${id}-question`}>{question}</p>
      {writing ? (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (text.trim()) { onAnswer(text.trim()); setWriting(false); setText(''); } }}>
          <label htmlFor={`${id}-answer`} className="sr-only">Tu respuesta</label>
          <Input id={`${id}-answer`} value={text} maxLength={500} autoFocus placeholder="Ej.: Sí, hasta $10.000.000 con boleta bancaria" aria-describedby={`${id}-question`}
            onChange={event => setText(event.target.value)} className="h-8 min-w-0 flex-1 text-sm" />
          <Button type="submit" size="sm" className="h-8" disabled={busy || !text.trim()}>Guardar</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setWriting(false)}>Cancelar</Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Responder a la IA">
          <Button type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={busy} onClick={() => onAnswer('Sí')}>Sí</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={busy} onClick={() => onAnswer('No')}>No</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setWriting(true)}>Responder con detalle</Button>
        </div>
      )}
    </div>
  );
}

/** Above the requirements: how many the company meets, and the way to read them (again) with the current profile. */
export function FitBar({ fit, busy, onFit }: { fit: OpportunityFitView; busy: boolean; onFit?: () => void }) {
  if (!fit.available) return null;
  if (fit.profileRevision === null) {
    return <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Con la «Ficha para licitaciones» de tu empresa, la IA te dice qué requisitos cumples y cuáles faltan. Un administrador la completa en Oportunidades.</p>;
  }
  const summary = fitSummary(fit.latest);
  const stale = !fit.latest || fit.latest.profileRevision < fit.profileRevision;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3" aria-live="polite">
      <p className="text-sm">
        {summary ? <>
          <span className="font-medium text-cw-success">{summary.meets} cumples</span>
          <span className="text-muted-foreground"> · </span><span className="font-medium text-cw-warning">{summary.missing} falta{summary.missing === 1 ? '' : 'n'} un dato</span>
          <span className="text-muted-foreground"> · </span><span className="font-medium text-destructive">{summary.fails} no cumples</span>
          {stale ? <span className="text-muted-foreground"> · tu ficha cambió desde esta revisión</span> : null}
        </> : <span className="text-muted-foreground">¿Cumplimos? La IA compara cada requisito con tu ficha para licitaciones.</span>}
      </p>
      {stale && onFit ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onFit}>
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}{summary ? 'Revisar de nuevo con mi ficha' : 'Revisar con mi ficha'}
        </Button>
      ) : null}
    </div>
  );
}
