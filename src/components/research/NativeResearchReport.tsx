'use client';

import { useId, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  buildResearchReport,
  canShowResearchDraftAction,
  researchDraftBlockReasonLabel,
  researchReadinessFor,
  researchReadinessLabel,
  researchSourceTypeLabel,
  researchStatusLabel,
  researchWarningLabel,
  safeResearchSourceUrl,
  type ResearchReadiness,
  type ResearchReportClaim,
  type ResearchReportEvidence,
  type ResearchWorkspaceResult,
  type ResearchWorkspaceStatus,
} from '@/lib/research-workspace';

export type NativeResearchReportProps = {
  result: ResearchWorkspaceResult;
  status?: ResearchWorkspaceStatus;
  readiness?: ResearchReadiness;
  researchSnapshotId?: string | null;
  canCreateDraft?: boolean;
  creatingDraft?: boolean;
  createDraftLabel?: string;
  creatingDraftLabel?: string;
  onCreateDraft?: () => void;
  refreshing?: boolean;
  refreshLabel?: string;
  refreshingLabel?: string;
  onRefresh?: () => void;
  className?: string;
};

function statusTone(status: ResearchWorkspaceStatus) {
  if (status === 'completed') return 'text-emerald-700 dark:text-emerald-300';
  if (status === 'partial' || status === 'insufficient_data') return 'text-amber-700 dark:text-amber-300';
  if (status === 'failed' || status === 'cancelled') return 'text-rose-700 dark:text-rose-300';
  if (status === 'queued' || status === 'running') return 'text-sky-700 dark:text-sky-300';
  return 'text-muted-foreground';
}

function readinessTone(readiness: ResearchReadiness) {
  if (readiness === 'ready') return 'text-emerald-700 dark:text-emerald-300';
  if (readiness === 'in_progress') return 'text-sky-700 dark:text-sky-300';
  if (readiness === 'needs_attention') return 'text-rose-700 dark:text-rose-300';
  if (['limited', 'missing_email', 'missing_evidence', 'contact_limit'].includes(readiness)) {
    return 'text-amber-700 dark:text-amber-300';
  }
  return 'text-muted-foreground';
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function ClaimList({ claims, tone = 'default' }: { claims: ResearchReportClaim[]; tone?: 'default' | 'signal' | 'opportunity' }) {
  const border = tone === 'opportunity'
    ? 'border-primary/25 bg-primary/[0.035] dark:bg-primary/[0.09]'
    : tone === 'signal'
      ? 'border-sky-200/80 bg-sky-50/55 dark:border-sky-500/25 dark:bg-sky-500/[0.07]'
      : 'border-border/70 bg-background/65';
  return (
    <ul className="space-y-3">
      {claims.map((claim) => (
        <li key={claim.id} className={cn('rounded-2xl border px-4 py-3.5', border)}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <p className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">{claim.statement}</p>
            <span className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
              claim.classification === 'hypothesis'
                ? 'border-primary/20 bg-primary/10 text-primary dark:border-primary/30'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
            )}>
              {claim.classification === 'hypothesis' ? 'Hipótesis' : 'Verificado'}
            </span>
          </div>
          {claim.evidence.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
              {claim.evidence.map((evidence) => <EvidenceLink key={evidence.id} evidence={evidence} />)}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EvidenceLink({ evidence }: { evidence: ResearchReportEvidence }) {
  const sourceUrl = safeResearchSourceUrl(evidence.sourceUrl);
  const meta = [
    researchSourceTypeLabel(evidence.sourceType),
    dateLabel(evidence.publishedAt || evidence.retrievedAt),
  ].filter(Boolean).join(' · ');
  return sourceUrl ? (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Abrir fuente: ${evidence.sourceTitle}`}
      title={meta || evidence.sourceTitle}
    >
      <span className="max-w-56 truncate">{evidence.sourceTitle}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  ) : null;
}

function SectionHeading({ id, eyebrow, title, description }: { id: string; eyebrow?: string; title: string; description?: string }) {
  return (
    <div>
      {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p> : null}
      <h3 id={id} className={cn(eyebrow ? 'mt-1' : '', 'text-base font-semibold tracking-[-0.015em]')}>{title}</h3>
      {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function NativeResearchReport({
  result,
  status = result.status,
  readiness: readinessProp,
  researchSnapshotId = result.researchSnapshotId,
  canCreateDraft,
  creatingDraft = false,
  createDraftLabel = 'Crear email',
  creatingDraftLabel = 'Creando…',
  refreshing = false,
  refreshLabel = 'Actualizar investigación',
  refreshingLabel = 'Actualizando…',
  onCreateDraft,
  onRefresh,
  className,
}: NativeResearchReportProps) {
  const helpId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const report = buildResearchReport(result);
  const evidenceCount = report.sources.length;
  const sourceCount = report.sources.length;
  const readiness = readinessProp || researchReadinessFor({
    status,
    lead: result.lead,
    result,
    snapshotId: researchSnapshotId,
    evidenceCount,
    sourceCount,
  });
  const qualityScore = result.quality.score ?? result.score;
  const eligible = result.draftEligibility.eligible === true;
  const actionAvailable = canShowResearchDraftAction({
    readiness,
    snapshotId: researchSnapshotId,
    eligible,
    canCreateDraft,
  });
  const blockReason = researchDraftBlockReasonLabel(result.draftEligibility.blockReason, readiness);
  const inFlight = status === 'queued' || status === 'running';
  const needsCompanyContext = report.missing.company && !inFlight;
  const refreshAvailable = Boolean(onRefresh)
    && !actionAvailable
    && !inFlight
    && !['contact_limit', 'missing_email'].includes(readiness);
  const hasPersonSection = report.person.fields.length > 0 || report.person.facts.length > 0 || report.missing.person;

  return (
    <article className={cn('min-w-0 space-y-7', className)} aria-label="Reporte de investigación">
      <header className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
          {inFlight ? (
            <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-300" aria-hidden="true" />
          ) : readiness === 'ready' ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
          ) : (
            <CircleAlert className={cn('mt-0.5 size-5 shrink-0', statusTone(status))} aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className={cn('text-sm font-semibold', statusTone(status))}>{researchStatusLabel(status)}</p>
            <p className={cn('mt-1 text-sm', readinessTone(readiness))}>{researchReadinessLabel(readiness)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground sm:justify-end">
          {qualityScore == null ? <span>Calidad sin evaluar</span> : <span>Calidad {qualityScore}/100</span>}
          <span>{report.coverage.companyFacts} {report.coverage.companyFacts === 1 ? 'dato comprobado' : 'datos comprobados'}</span>
          <span>{sourceCount} {sourceCount === 1 ? 'fuente útil' : 'fuentes útiles'}</span>
        </div>
      </header>

      {hasPersonSection ? (
        <section aria-labelledby={`${helpId}-person`}>
          <SectionHeading
            id={`${helpId}-person`}
            eyebrow="Contacto"
            title="Perfil de la persona"
            description={report.person.fields.length > 0 ? 'Datos importados de tu lista. No se presentan como hechos de la investigación.' : undefined}
          />
          {report.person.fields.length > 0 ? (
            <dl className="mt-3 grid gap-x-5 gap-y-3 rounded-2xl border border-border/70 bg-muted/[0.18] px-4 py-4 sm:grid-cols-2">
              {report.person.fields.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{field.label}</dt>
                  <dd className="mt-1 break-words text-sm leading-5 text-foreground/90">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {report.person.facts.length > 0 ? (
            <div className={report.person.fields.length > 0 ? 'mt-5' : 'mt-3'}>
              <p className="mb-2 text-sm font-medium">Información pública respaldada</p>
              <ClaimList claims={report.person.facts} />
            </div>
          ) : null}
          {report.missing.person ? (
            <p className="mt-3 rounded-2xl border border-dashed border-border/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
              No hay datos personales verificables en las fuentes revisadas. El perfil importado sigue disponible para dar contexto.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby={`${helpId}-company`}>
        <SectionHeading
          id={`${helpId}-company`}
          eyebrow="Empresa"
          title="Información comprobada"
          description={report.company.length > 0 ? 'Cada dato enlaza a una fuente que puedes revisar.' : undefined}
        />
        {report.company.length > 0 ? (
          <div className="mt-3"><ClaimList claims={report.company} /></div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/45 px-4 py-4 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/[0.07] dark:text-amber-100">
            No encontramos una descripción verificable de la empresa. No usamos resultados genéricos ni datos de registro para completar este reporte.
          </div>
        )}
      </section>

      {report.signals.length > 0 ? (
        <section aria-labelledby={`${helpId}-signals`}>
          <SectionHeading
            id={`${helpId}-signals`}
            eyebrow="Señales públicas"
            title="Actividad relevante"
            description="Son observaciones recientes o contextuales; conviene validarlas antes de usarlas en una conversación."
          />
          <div className="mt-3"><ClaimList claims={report.signals} tone="signal" /></div>
        </section>
      ) : null}

      {report.opportunities.length > 0 ? (
        <section aria-labelledby={`${helpId}-opportunity`}>
          <SectionHeading
            id={`${helpId}-opportunity`}
            eyebrow="Siguiente conversación"
            title="Oportunidades para explorar"
            description="Son hipótesis basadas en las señales disponibles, no afirmaciones sobre una prioridad de la empresa."
          />
          <div className="mt-3"><ClaimList claims={report.opportunities} tone="opportunity" /></div>
        </section>
      ) : null}

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <section aria-labelledby={`${helpId}-details`} className="border-y border-border/60">
          <h3 id={`${helpId}-details`} className="sr-only">Fuentes verificadas</h3>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between rounded-none px-0 py-4 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Fuentes verificadas</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {sourceCount > 0
                    ? `${sourceCount} ${sourceCount === 1 ? 'fuente vinculada' : 'fuentes vinculadas'} a este reporte`
                    : 'Aún no hay fuentes que respalden datos utilizables'}
                </span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', detailsOpen && 'rotate-180')} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-5">
            {sourceCount > 0 ? (
              <ul className="divide-y divide-border/60 border-t border-border/60 pt-1">
                {report.sources.map((source) => {
                  const sourceUrl = safeResearchSourceUrl(source.sourceUrl);
                  const meta = [researchSourceTypeLabel(source.sourceType), dateLabel(source.publishedAt || source.retrievedAt)].filter(Boolean).join(' · ');
                  return (
                    <li key={source.id} className="flex min-w-0 items-start justify-between gap-3 py-3.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm leading-6 text-foreground/90">{source.sourceTitle}</p>
                        {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{source.statement}</p>
                      </div>
                      {sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={`Abrir ${source.sourceTitle} en una pestaña nueva`}
                        >
                          Abrir <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="border-t border-border/60 pt-4 text-sm leading-6 text-muted-foreground">
                Actualiza la investigación cuando haya un dominio corporativo o una fuente pública que pueda verificarse.
              </p>
            )}
          </CollapsibleContent>
        </section>
      </Collapsible>

      {result.warnings.length > 0 ? (
        <section aria-labelledby={`${helpId}-warnings`}>
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <CircleAlert className="size-4" aria-hidden="true" />
            <h3 id={`${helpId}-warnings`} className="text-sm font-semibold">Puntos a revisar</h3>
          </div>
          <ul className="mt-2 space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
            {result.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="list-disc">{researchWarningLabel(warning)}</li>)}
          </ul>
        </section>
      ) : null}

      <footer className="flex flex-col gap-3 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {actionAvailable ? 'Borrador disponible' : needsCompanyContext ? 'Hace falta contexto de empresa' : 'Borrador no disponible'}
          </p>
          <p id={helpId} className="mt-1 text-xs leading-5 text-muted-foreground">
            {actionAvailable
              ? 'El email se abrirá para que lo revises antes de enviarlo.'
              : needsCompanyContext
                ? 'Vuelve a investigar para buscar una fuente corporativa verificable antes de preparar el email.'
                : refreshAvailable
                  ? 'Actualiza la investigación para revisar fuentes y señales públicas más recientes.'
                  : blockReason}
          </p>
        </div>
        {onCreateDraft && actionAvailable ? (
          <Button
            type="button"
            className="w-full shrink-0 rounded-full sm:w-auto"
            onClick={onCreateDraft}
            disabled={creatingDraft}
            aria-describedby={helpId}
          >
            {creatingDraft ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileText aria-hidden="true" />}
            {creatingDraft ? creatingDraftLabel : createDraftLabel}
          </Button>
        ) : refreshAvailable ? (
          <Button
            type="button"
            variant="outline"
            className="w-full shrink-0 rounded-full sm:w-auto"
            onClick={onRefresh}
            disabled={refreshing}
            aria-describedby={helpId}
          >
            {refreshing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {refreshing ? refreshingLabel : refreshLabel}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

export default NativeResearchReport;
