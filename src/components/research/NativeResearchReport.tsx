'use client';

import { useId, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResearchReportDocumentV1 } from '@/lib/research-report-contracts';
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
  type ResearchReportCompanySections,
  type ResearchReportEvidence,
  type ResearchReportProfileField,
  type ResearchWorkspaceResult,
  type ResearchWorkspaceStatus,
} from '@/lib/research-workspace';

export type NativeResearchReportProps = {
  result: ResearchWorkspaceResult;
  /** Must already be schema- and citation-validated against result.snapshot. */
  reportDocument?: ResearchReportDocumentV1 | null;
  status?: ResearchWorkspaceStatus;
  readiness?: ResearchReadiness;
  researchSnapshotId?: string | null;
  canCreateDraft?: boolean;
  creatingDraft?: boolean;
  createDraftDisabled?: boolean;
  createDraftLabel?: string;
  creatingDraftLabel?: string;
  onCreateDraft?: () => void;
  refreshing?: boolean;
  refreshLabel?: string;
  refreshingLabel?: string;
  onRefresh?: () => void;
  className?: string;
};

const companySectionCopy: Array<{
  key: keyof ResearchReportCompanySections;
  title: string;
  empty: string;
}> = [
  { key: 'overview', title: 'Visión general', empty: 'No hay una descripción corporativa verificable.' },
  { key: 'offerings', title: 'Oferta', empty: 'No se verificaron productos o servicios concretos.' },
  { key: 'market', title: 'Mercado e industria', empty: 'No se verificó información suficiente sobre su mercado.' },
  { key: 'scale', title: 'Escala', empty: 'No se encontraron indicadores públicos de escala.' },
];

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

function EvidenceLink({ evidence }: { evidence: ResearchReportEvidence }) {
  const sourceUrl = safeResearchSourceUrl(evidence.sourceUrl);
  if (!sourceUrl) return null;
  const meta = [
    researchSourceTypeLabel(evidence.sourceType),
    dateLabel(evidence.publishedAt || evidence.retrievedAt),
  ].filter(Boolean).join(' · ');
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Abrir evidencia en ${evidence.sourceTitle}`}
      title={meta || evidence.sourceTitle}
    >
      <span className="max-w-56 truncate">{evidence.sourceTitle}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ClaimList({
  claims,
  tone = 'default',
}: {
  claims: ResearchReportClaim[];
  tone?: 'default' | 'signal' | 'hypothesis' | 'executive';
}) {
  return (
    <ul className={cn(
      'divide-y divide-border/60',
      tone === 'hypothesis' && 'rounded-2xl border border-primary/20 bg-primary/[0.035] px-4 dark:bg-primary/[0.08]',
      tone === 'executive' && 'rounded-2xl border border-border/70 bg-muted/[0.18] px-4 sm:px-5',
    )}>
      {claims.map((claim) => {
        const observed = tone === 'signal' ? dateLabel(claim.observedAt) : null;
        return (
          <li key={claim.id} className="py-4 first:pt-3.5 last:pb-3.5">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className={cn(
                'min-w-0 text-sm leading-6 text-foreground/90',
                tone === 'executive' && 'text-[15px] font-medium leading-7',
              )}>
                {claim.statement}
              </p>
              <span className={cn(
                'shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em]',
                claim.classification === 'hypothesis'
                  ? 'text-primary'
                  : 'text-emerald-700 dark:text-emerald-300',
              )}>
                {claim.classification === 'hypothesis' ? 'Hipótesis' : 'Verificado'}
              </span>
            </div>
            {observed ? <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">Observado el {observed}</p> : null}
            {claim.evidence.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span className="sr-only">Evidencia:</span>
                {claim.evidence.map((evidence) => <EvidenceLink key={evidence.id} evidence={evidence} />)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p> : null}
      <h3 id={id} className={cn(eyebrow ? 'mt-1' : '', 'text-lg font-semibold tracking-[-0.02em]')}>{title}</h3>
      {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function ImportedFields({ fields }: { fields: ResearchReportProfileField[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{field.label}</dt>
          <dd className="mt-1 break-words text-sm leading-5 text-foreground/90">
            {field.href ? (
              <a
                href={field.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {field.value}<ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CompanySections({ sections }: { sections: ResearchReportCompanySections }) {
  return (
    <div className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/70 bg-background/45 px-4 sm:px-5">
      {companySectionCopy.map((section) => {
        const claims = sections[section.key];
        return (
          <section key={section.key} className="grid gap-2 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5">
            <h4 className="text-sm font-semibold text-foreground/90">{section.title}</h4>
            {claims.length > 0
              ? <ClaimList claims={claims} />
              : <p className="text-sm leading-6 text-muted-foreground">{section.empty}</p>}
          </section>
        );
      })}
    </div>
  );
}

export function NativeResearchReportSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-8', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando el reporte completo</span>
      <div className="space-y-3 border-b border-border/60 pb-5">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-3 gap-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      </div>
      <div className="space-y-3"><Skeleton className="h-5 w-36" /><Skeleton className="h-28 w-full rounded-2xl" /></div>
      <div className="space-y-3"><Skeleton className="h-5 w-44" /><Skeleton className="h-40 w-full rounded-2xl" /></div>
      <div className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-56 w-full rounded-2xl" /></div>
    </div>
  );
}

export function NativeResearchReport({
  result,
  reportDocument,
  status = result.status,
  readiness: readinessProp,
  researchSnapshotId = result.researchSnapshotId,
  canCreateDraft,
  creatingDraft = false,
  createDraftDisabled = false,
  createDraftLabel = 'Crear borrador y revisar',
  creatingDraftLabel = 'Preparando borrador…',
  refreshing = false,
  refreshLabel = 'Actualizar investigación',
  refreshingLabel = 'Actualizando…',
  onCreateDraft,
  onRefresh,
  className,
}: NativeResearchReportProps) {
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const report = buildResearchReport(result, reportDocument);
  const evidenceCount = report.coverage.evidenceRecords;
  const sourceCount = report.coverage.sources;
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
  const showCompanyContextGuidance = needsCompanyContext && refreshAvailable;
  const hasReviewPoints = report.gaps.length > 0 || report.contradictions.length > 0;
  const updatedAt = dateLabel(report.updatedAt);

  return (
    <article className={cn('min-w-0 space-y-9', className)} aria-label="Reporte de investigación">
      <header className="space-y-5 border-b border-border/60 pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
          {updatedAt ? <p className="text-xs text-muted-foreground">Actualizado el {updatedAt}</p> : null}
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border/60 rounded-2xl bg-muted/[0.2] py-3 text-center tabular-nums">
          {[
            { label: 'Afirmaciones', value: report.coverage.claims },
            { label: 'Evidencias', value: evidenceCount },
            { label: 'Fuentes', value: sourceCount },
          ].map((metric) => (
            <div key={metric.label} className="min-w-0 px-2 sm:px-4">
              <dt className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</dt>
              <dd className="text-lg font-semibold tracking-[-0.025em]">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section aria-labelledby={`${id}-executive`}>
        <SectionHeading
          id={`${id}-executive`}
          eyebrow="Resumen ejecutivo"
          title="Lo esencial para decidir el siguiente paso"
          description="Una síntesis de los hechos con mejor respaldo en la investigación."
        />
        <div className="mt-4">
          {report.executive.length > 0 ? (
            <ClaimList claims={report.executive} tone="executive" />
          ) : (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-4 text-sm leading-6 text-muted-foreground">
              La evidencia disponible aún no permite preparar un resumen ejecutivo verificable.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby={`${id}-person`}>
        <SectionHeading
          id={`${id}-person`}
          eyebrow="Persona"
          title="Contexto del contacto"
          description="El contexto importado de tu lista se mantiene separado de los hechos encontrados en fuentes públicas."
        />
        <div className="mt-4 rounded-2xl border border-border/70 bg-muted/[0.16] px-4 py-4 sm:px-5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto importado</p>
          {report.person.fields.length > 0
            ? <ImportedFields fields={report.person.fields} />
            : <p className="text-sm leading-6 text-muted-foreground">No hay contexto personal importado para este contacto.</p>}
        </div>
        <div className="mt-5">
          <h4 className="text-sm font-semibold">Hechos públicos verificados</h4>
          {report.person.facts.length > 0 ? (
            <div className="mt-2"><ClaimList claims={report.person.facts} /></div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              No encontramos hechos públicos de la persona con una coincidencia de identidad suficiente.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby={`${id}-company`}>
        <SectionHeading
          id={`${id}-company`}
          eyebrow="Empresa"
          title="Actividad y contexto comercial"
          description="Descripción, oferta, mercado y escala respaldados por fuentes revisables."
        />
        {report.companyContext.length > 0 ? (
          <div className="mt-4 border-l-2 border-border/70 pl-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto de empresa importado</p>
            <ImportedFields fields={report.companyContext} />
          </div>
        ) : null}
        <CompanySections sections={report.companySections} />
      </section>

      <section aria-labelledby={`${id}-signals`}>
        <SectionHeading
          id={`${id}-signals`}
          eyebrow="Señales públicas"
          title="Actividad con fecha"
          description="Observaciones atribuibles que conviene confirmar antes de usarlas en una conversación."
        />
        {report.signals.length > 0 ? (
          <div className="mt-3"><ClaimList claims={report.signals} tone="signal" /></div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">No se encontraron señales públicas recientes y atribuibles.</p>
        )}
      </section>

      <section aria-labelledby={`${id}-hypotheses`}>
        <SectionHeading
          id={`${id}-hypotheses`}
          eyebrow="Hipótesis comerciales"
          title="Temas para explorar, no necesidades confirmadas"
          description="Estas posibilidades se apoyan en la evidencia disponible, pero deben validarse con el contacto."
        />
        {report.opportunities.length > 0 ? (
          <div className="mt-4"><ClaimList claims={report.opportunities} tone="hypothesis" /></div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">La evidencia no permite formular una hipótesis comercial citada.</p>
        )}
      </section>

      {hasReviewPoints ? (
        <section aria-labelledby={`${id}-review`}>
          <SectionHeading
            id={`${id}-review`}
            eyebrow="Límites del reporte"
            title="Vacíos y contradicciones"
            description="Puntos que conviene considerar antes de personalizar el contacto."
          />
          <div className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/70 px-4 sm:px-5">
            {report.contradictions.map((item) => (
              <div key={item.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-6">{item.summary}</p>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', item.status === 'resolved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
                    {item.status === 'resolved' ? 'Resuelta' : 'Sin resolver'}
                  </span>
                </div>
                {item.evidence.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                    {item.evidence.map((evidence) => <EvidenceLink key={evidence.id} evidence={evidence} />)}
                  </div>
                ) : null}
              </div>
            ))}
            {report.gaps.map((gap) => (
              <p key={gap.id} className="py-4 text-sm leading-6 text-muted-foreground">{gap.description}</p>
            ))}
          </div>
        </section>
      ) : null}

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <section aria-labelledby={`${id}-details`} className="border-y border-border/60">
          <h3 id={`${id}-details`} className="sr-only">Fuentes y calidad del reporte</h3>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between rounded-none px-0 py-4 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Fuentes y calidad</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {evidenceCount} {evidenceCount === 1 ? 'evidencia' : 'evidencias'} · {sourceCount} {sourceCount === 1 ? 'fuente única' : 'fuentes únicas'}
                </span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', detailsOpen && 'rotate-180')} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-5">
            <div className="grid gap-4 border-t border-border/60 py-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Evaluación</p>
                <p className="mt-1 leading-6 text-muted-foreground">
                  {qualityScore == null ? 'La calidad aún no fue evaluada.' : `Calidad general: ${qualityScore}/100.`}
                </p>
              </div>
              <div>
                <p className="font-medium">Cobertura</p>
                <p className="mt-1 leading-6 text-muted-foreground">
                  {report.completeness
                    ? `${report.completeness.status === 'complete' ? 'Cobertura completa' : 'Cobertura parcial'} (${Math.round(report.completeness.score * 100)}%).`
                    : `${report.coverage.claims} afirmaciones visibles con respaldo canónico.`}
                </p>
              </div>
            </div>
            {result.warnings.length > 0 ? (
              <div className="border-t border-border/60 py-4">
                <p className="font-medium">Puntos de calidad</p>
                <ul className="mt-2 space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                  {result.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="list-disc">{researchWarningLabel(warning)}</li>)}
                </ul>
              </div>
            ) : null}
            {sourceCount > 0 ? (
              <ul className="divide-y divide-border/60 border-t border-border/60">
                {report.sources.map((source) => {
                  const sourceUrl = safeResearchSourceUrl(source.sourceUrl);
                  const meta = [researchSourceTypeLabel(source.sourceType), dateLabel(source.publishedAt || source.retrievedAt)].filter(Boolean).join(' · ');
                  return (
                    <li key={source.sourceId || source.id} className="flex min-w-0 items-start justify-between gap-3 py-3.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium leading-6 text-foreground/90">{source.sourceTitle}</p>
                        {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
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
                Aún no hay fuentes utilizables. Actualiza la investigación cuando exista una fuente pública verificable.
              </p>
            )}
          </CollapsibleContent>
        </section>
      </Collapsible>

      <footer className="sticky bottom-0 z-10 -mx-2 flex flex-col gap-3 border-t border-border/70 bg-background/95 px-2 py-4 shadow-[0_-16px_30px_-30px_rgba(15,23,42,0.45)] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {actionAvailable ? 'Borrador disponible para revisión' : showCompanyContextGuidance ? 'Hace falta contexto de empresa' : 'Borrador no disponible'}
          </p>
          <p id={`${id}-action-help`} className="mt-1 text-xs leading-5 text-muted-foreground">
            {actionAvailable
              ? 'Se abrirá como borrador para que puedas revisarlo. No se enviará automáticamente.'
               : showCompanyContextGuidance
                ? 'Actualiza la investigación para buscar una fuente corporativa verificable.'
                : refreshAvailable
                  ? 'Actualiza la investigación para revisar fuentes y señales más recientes.'
                  : blockReason}
          </p>
        </div>
        {onCreateDraft && actionAvailable ? (
          <Button
            type="button"
            className="w-full shrink-0 rounded-full sm:w-auto"
            onClick={onCreateDraft}
            disabled={creatingDraft || createDraftDisabled}
            aria-describedby={`${id}-action-help`}
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
            aria-describedby={`${id}-action-help`}
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
