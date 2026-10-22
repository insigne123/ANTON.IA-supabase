'use client';
// «¿Cumplimos?» inside the report: each requirement as ✓ meets, ⚠ a missing fact (with its question, answered right
// there) or ✗ does not meet, against the company's «Ficha para licitaciones».
import { useEffect, useState } from 'react';
import { Check, CircleHelp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FIT_LABELS, fitSummary, type RequirementFit, type ReportFit } from '@/lib/commercial-opportunities/requirement-fit';
import type { SealNote } from '@/lib/commercial-opportunities/gender-criterion';
import type { FemaleLedSeal } from '@/lib/commercial-opportunities/tender-profile';

/** `seal` is what the profile says about the «Sello Empresa Mujer»: null before the profile exists. */
export type OpportunityFitView = { available: boolean; latest: ReportFit | null; profileRevision: number | null; seal?: FemaleLedSeal | null };
const TONE: Record<RequirementFit['fit'], string> = { meets: 'text-cw-success', missing: 'text-cw-warning', fails: 'text-destructive', na: 'text-muted-foreground' };
const ICON = { meets: Check, missing: CircleHelp, fails: X, na: null } as const;

const SEAL_TONE = { good: 'bg-cw-success-soft', ask: 'bg-cw-warning-soft', neutral: 'bg-muted/40' } as const;
/** Only when the bases value a company led by women (gender-criterion.ts): whether this company adds those points. */
export function SealCard({ note }: { note: SealNote | null }) {
  if (!note) return null;
  return (
    <div className={cn('mt-6 rounded-2xl px-4 py-3', SEAL_TONE[note.tone])}>
      <p className="text-sm font-medium text-foreground">{note.title}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{note.body}</p>
    </div>
  );
}

export function FitBadge({ fit }: { fit: RequirementFit }) {
  const Icon = ICON[fit.fit];
  return (
    <p className={cn('flex items-start gap-1.5 text-xs', TONE[fit.fit])}>
      {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span><span className="font-medium">{FIT_LABELS[fit.fit]}</span>{fit.basis ? <span className="text-muted-foreground"> · {fit.basis}</span> : null}</span>
    </p>
  );
}

/**
 * The AI looks at the requirements again with the new answer, which takes some seconds: the answered question says so, with a bar that
 * moves (and, with reduced motion, only the words), so the page never looks stuck.
 */
export function FitThinking({ answer }: { answer: string }) {
  return (
    <div role="status" aria-live="polite" className="mt-2 space-y-2">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <span>Guardé tu respuesta («{answer.length > 80 ? `${answer.slice(0, 80)}…` : answer}»). La IA está revisando todos los requisitos con tu ficha…</span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <div className="h-full w-1/4 rounded-full bg-primary motion-safe:animate-thinking-slide motion-reduce:w-full motion-reduce:opacity-40" />
      </div>
      <p className="text-xs text-muted-foreground">Tarda unos segundos. Puedes seguir leyendo el informe.</p>
    </div>
  );
}

/** The AI's question about a missing fact, answered in one tap (Sí / No) or in a few words; the answer goes into the profile. */
export function FitQuestion({ id, question, why, kind, busy, onAnswer }: {
  id: string; question: string; busy: boolean; onAnswer: (answer: string) => void;
  /** Why it is asked (for a question that is not about one requirement). */
  why?: string;
  /** detail: the answer takes figures, names or several things, so it is asked in words and not with yes / no. */
  kind?: 'detail';
}) {
  const detail = kind === 'detail';
  const [writing, setWriting] = useState(detail);
  const [text, setText] = useState('');
  // What this question was just answered with, while the page waits for the AI to read the requirements again.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { if (!busy) setSent(null); }, [busy]);
  const answer = (value: string) => { setSent(value); onAnswer(value); };
  return (
    <div className="mt-2 rounded-xl bg-cw-warning-soft px-3 py-2.5">
      <p className="text-sm text-foreground" id={`${id}-question`}>{question}</p>
      {why ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{why}</p> : null}
      {sent !== null && busy ? <FitThinking answer={sent} /> : writing ? (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (text.trim()) { answer(text.trim()); setWriting(detail); setText(''); } }}>
          <label htmlFor={`${id}-answer`} className="sr-only">Tu respuesta</label>
          {detail
            ? <Textarea id={`${id}-answer`} value={text} maxLength={500} rows={3} placeholder="Escribe la respuesta con el detalle: cifras, nombres y fechas." aria-describedby={`${id}-question`}
              onChange={event => setText(event.target.value)} className="min-h-[72px] w-full resize-y text-sm" />
            : <Input id={`${id}-answer`} value={text} maxLength={500} autoFocus placeholder="Ej.: Sí, hasta $10.000.000 con boleta bancaria" aria-describedby={`${id}-question`}
              onChange={event => setText(event.target.value)} className="h-8 min-w-0 flex-1 text-sm" />}
          <Button type="submit" size="sm" className="h-8" disabled={busy || !text.trim()}>{detail ? 'Guardar y revisar' : 'Guardar'}</Button>
          {detail ? null : <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setWriting(false)}>Cancelar</Button>}
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Responder a la IA">
          <Button type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={busy} onClick={() => answer('Sí')}>Sí</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={busy} onClick={() => answer('No')}>No</Button>
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
