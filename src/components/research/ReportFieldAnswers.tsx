'use client';

import { useId } from 'react';
import { CheckCircle2, CircleDot, ExternalLink, EyeOff, Lightbulb, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type {
  ReportFieldAnswer,
  ReportFieldGroup,
  ReportFieldStatus,
} from '@/lib/report-field-answers';

export type ReportFieldAnswersVariant = 'preview' | 'full';

export const REPORT_FIELD_GROUP_ORDER: ReportFieldGroup[] = [
  'company',
  'contact',
  'commercial',
  'decision',
  'personalization',
];

export const REPORT_FIELD_GROUP_LABELS: Record<ReportFieldGroup, string> = {
  company: 'Empresa',
  contact: 'Contacto',
  commercial: 'Lectura comercial',
  decision: 'Decisión',
  personalization: 'Personalización',
};

export const REPORT_FIELD_STATUS_LABELS: Record<ReportFieldStatus, string> = {
  confirmed: 'Confirmado',
  estimated: 'Estimado',
  hypothesis: 'Hipótesis',
  unavailable: 'No disponible',
  restricted: 'Restringido',
};

const REPORT_FIELD_STATUS_TONE: Record<ReportFieldStatus, string> = {
  confirmed:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  estimated:
    'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100',
  hypothesis:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
  unavailable: 'border-border bg-muted/40 text-muted-foreground',
  restricted:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-200',
};

function ReportFieldStatusIcon({ status }: { status: ReportFieldStatus }) {
  const className = 'size-3 shrink-0';
  if (status === 'confirmed') return <CheckCircle2 className={className} aria-hidden="true" />;
  if (status === 'estimated') return <CircleDot className={className} aria-hidden="true" />;
  if (status === 'hypothesis') return <Lightbulb className={className} aria-hidden="true" />;
  if (status === 'unavailable') return <EyeOff className={className} aria-hidden="true" />;
  return <Lock className={className} aria-hidden="true" />;
}

export function ReportFieldStatusBadge({
  status,
  className,
}: {
  status: ReportFieldStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4',
        REPORT_FIELD_STATUS_TONE[status],
        className,
      )}
    >
      <ReportFieldStatusIcon status={status} />
      <span className="truncate">{REPORT_FIELD_STATUS_LABELS[status]}</span>
    </span>
  );
}

export function groupReportFieldAnswers(
  answers: ReportFieldAnswer[],
): Record<ReportFieldGroup, ReportFieldAnswer[]> {
  const grouped: Record<ReportFieldGroup, ReportFieldAnswer[]> = {
    company: [],
    contact: [],
    commercial: [],
    decision: [],
    personalization: [],
  };
  answers.forEach((answer) => {
    grouped[answer.group]?.push(answer);
  });
  return grouped;
}

/** Preview keeps the view quiet: only confirmed/estimated keys, capped. */
export function selectPreviewReportFields(
  answers: ReportFieldAnswer[],
  limit = 6,
): ReportFieldAnswer[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  return answers.filter((answer) => answer.status === 'confirmed' || answer.status === 'estimated').slice(0, safeLimit);
}

const fieldDateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function fieldDateLabel(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return fieldDateFormatter.format(parsed);
}

function safeFieldUrl(value: string) {
  const trimmed = String(value || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null;
  } catch {
    return null;
  }
}

function ReportFieldCard({ answer }: { answer: ReportFieldAnswer }) {
  const observed = fieldDateLabel(answer.observedAt);
  const sources = (answer.sourceUrls || []).map(safeFieldUrl).filter((url): url is string => Boolean(url));
  const mutedValue = answer.status === 'unavailable' || answer.status === 'restricted';
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {answer.label}
        </p>
        <ReportFieldStatusBadge status={answer.status} />
      </div>
      <p className={cn('mt-1.5 break-words text-sm leading-6', mutedValue ? 'text-muted-foreground' : 'text-foreground/90')}>
        {answer.value}
      </p>
      {answer.detail ? (
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{answer.detail}</p>
      ) : null}
      {observed ? <p className="mt-1.5 text-xs text-muted-foreground">Observado el {observed}</p> : null}
      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {sources.slice(0, 2).map((url, index) => (
            <a
              key={`${answer.key}-source-${index}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Abrir fuente ${index + 1} de ${answer.label} en una pestaña nueva`}
            >
              <span className="max-w-40 truncate">Fuente {index + 1}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ))}
          {sources.length > 2 ? (
            <span className="text-xs text-muted-foreground">+{sources.length - 2} más</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReportFieldAnswersSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando datos del informe</span>
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-2.5 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export type ReportFieldAnswersProps = {
  answers?: ReportFieldAnswer[] | null;
  variant?: ReportFieldAnswersVariant;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  className?: string;
  id?: string;
};

export function ReportFieldAnswers({
  answers,
  variant = 'full',
  loading = false,
  error,
  onRetry,
  emptyMessage = 'Aún no hay datos suficientes para mostrar estos campos. Actualiza la investigación cuando haya fuentes públicas.',
  className,
  id,
}: ReportFieldAnswersProps) {
  const fallbackId = useId();
  const baseId = id || fallbackId;
  const list = Array.isArray(answers) ? answers : [];

  if (loading) {
    return <ReportFieldAnswersSkeleton className={className} />;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/65 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="min-w-0">{error}</span>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 rounded-full bg-background/80"
            onClick={onRetry}
          >
            Reintentar
          </Button>
        ) : null}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-center">
        <p className="text-sm font-medium">Sin datos para mostrar</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  if (variant === 'preview') {
    return (
      <div id={baseId} className={cn('grid w-full min-w-0 gap-3 sm:grid-cols-2', className)}>
        {list.map((answer) => (
          <ReportFieldCard key={answer.key} answer={answer} />
        ))}
      </div>
    );
  }

  const grouped = groupReportFieldAnswers(list);
  return (
    <div id={baseId} className={cn('w-full min-w-0 space-y-5', className)}>
      {REPORT_FIELD_GROUP_ORDER.map((group) => {
        const items = grouped[group];
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`${baseId}-${group}`}>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h4 id={`${baseId}-${group}`} className="text-sm font-semibold">
                {REPORT_FIELD_GROUP_LABELS[group]}
              </h4>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {items.length} {items.length === 1 ? 'dato' : 'datos'}
              </p>
            </div>
            <div className="mt-2.5 grid w-full min-w-0 gap-3 sm:grid-cols-2">
              {items.map((answer) => (
                <ReportFieldCard key={answer.key} answer={answer} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default ReportFieldAnswers;
