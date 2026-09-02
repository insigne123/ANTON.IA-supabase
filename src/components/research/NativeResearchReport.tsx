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
  profileCompletionRequired?: boolean;
  creatingDraft?: boolean;
  createDraftDisabled?: boolean;
  createDraftLabel?: string;
  creatingDraftLabel?: string;
  onCreateDraft?: () => void;
  onCompleteProfile?: () => void;
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
  return reportDateFormatter.format(parsed);
}

const reportDateFormatter = new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
});

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
                'min-w-0 break-words text-sm leading-6 text-foreground/90',
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

function NarrativeText({
  paragraphs,
  empty,
  onShowEvidence,
  showClassification = false,
}: {
  paragraphs: Array<{
    text: string;
    evidenceIds?: string[];
    classification?: 'fact' | 'hypothesis' | 'signal' | 'fit';
    observedAt?: string | null;
  }>;
  empty: string;
  onShowEvidence?: () => void;
  showClassification?: boolean;
}) {
  if (paragraphs.length === 0) {
    return <p className="text-sm leading-7 text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="max-w-[72ch] space-y-4 text-[15px] leading-7 text-foreground/90 sm:text-base sm:leading-8">
      {paragraphs.map((paragraph, index) => {
        const observedAt = dateLabel(paragraph.observedAt || null);
        const label = paragraph.classification === 'hypothesis'
          ? 'Hipótesis'
          : paragraph.classification === 'signal'
            ? 'Señal pública'
            : paragraph.classification === 'fit'
              ? 'Posible encaje'
              : 'Verificado';
        return (
          <div key={`${paragraph.text}-${index}`}>
            {showClassification && paragraph.classification ? (
              <p className={cn(
                'mb-1 text-[10px] font-semibold uppercase tracking-[0.13em]',
                paragraph.classification === 'fit'
                  ? 'text-amber-700 dark:text-amber-300'
                  : paragraph.classification === 'hypothesis'
                    ? 'text-primary'
                    : 'text-emerald-700 dark:text-emerald-300',
              )}>
                {label}{observedAt ? ` · ${observedAt}` : ''}
              </p>
            ) : null}
            <p className="break-words">{paragraph.text}</p>
            {onShowEvidence && paragraph.evidenceIds?.length ? (
              <button
                type="button"
                onClick={onShowEvidence}
                className="mt-1.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Ver respaldo
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
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

function CompanySections({ sections, showEmpty = true }: { sections: ResearchReportCompanySections; showEmpty?: boolean }) {
  const visibleSections = companySectionCopy.filter((section) => showEmpty || sections[section.key].length > 0);
  if (visibleSections.length === 0) return null;
  return (
    <div className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/70 bg-background/45 px-4 sm:px-5">
      {visibleSections.map((section) => {
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
      <div className="space-y-3 border-b border-border/60 pb-6">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="space-y-3"><Skeleton className="h-5 w-36" /><Skeleton className="h-32 w-full rounded-3xl" /></div>
      <div className="space-y-3"><Skeleton className="h-5 w-44" /><Skeleton className="h-24 w-full rounded-2xl" /></div>
      <div className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-44 w-full rounded-2xl" /></div>
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
  profileCompletionRequired = false,
  creatingDraft = false,
  createDraftDisabled = false,
  createDraftLabel = 'Crear borrador y revisar',
  creatingDraftLabel = 'Preparando borrador…',
  refreshing = false,
  refreshLabel = 'Actualizar investigación',
  refreshingLabel = 'Actualizando…',
  onCreateDraft,
  onCompleteProfile,
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
  const actionAvailable = !profileCompletionRequired && canShowResearchDraftAction({
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
  const narrative = reportDocument?.narrative;
  const canonicalClaimById = new Map((result.snapshot?.claims || []).map((claim) => [claim.id, claim]));
  const canonicalEvidenceById = new Map((result.snapshot?.evidence || []).map((evidence) => [evidence.id, evidence]));
  const canonicalSourceById = new Map((result.snapshot?.sources || []).map((source) => [source.id, source]));
  const decorateNarrative = (paragraphs: Array<{ text: string; claimIds: string[]; evidenceIds: string[] }>) => paragraphs.map((paragraph) => {
    const claims = paragraph.claimIds.map((claimId) => canonicalClaimById.get(claimId)).filter(Boolean);
    const classification: 'fact' | 'hypothesis' | 'signal' = claims.some((claim) => claim?.classification === 'hypothesis')
      ? 'hypothesis'
      : claims.some((claim) => ['news_signal', 'hiring_signal', 'technology_signal', 'site_signal'].includes(claim?.kind || ''))
        ? 'signal'
        : 'fact';
    const evidence = paragraph.evidenceIds.map((evidenceId) => canonicalEvidenceById.get(evidenceId)).find(Boolean);
    const source = evidence ? canonicalSourceById.get(evidence.sourceId) : null;
    return {
      ...paragraph,
      classification,
      observedAt: evidence?.observedAt || source?.publishedAt || source?.retrievedAt || null,
    };
  });
  const claimParagraphs = (claims: ResearchReportClaim[]) => claims.map((claim) => ({
    text: claim.statement,
    evidenceIds: claim.evidence.map((item) => item.id),
    classification: (claim.classification === 'hypothesis'
      ? 'hypothesis'
      : ['news_signal', 'hiring_signal', 'technology_signal', 'site_signal'].includes(claim.kind)
        ? 'signal'
        : 'fact') as 'fact' | 'hypothesis' | 'signal',
    observedAt: claim.observedAt,
  }));
  const executiveNarrative = narrative ? decorateNarrative(narrative.executiveSummary) : claimParagraphs(report.executive);
  const companyNarrative = narrative ? decorateNarrative(narrative.companyProfile) : [];
  const leadNarrative = narrative ? decorateNarrative(narrative.leadContext) : [];
  const commercialNarrative = narrative
    ? decorateNarrative(narrative.commercialReading)
    : claimParagraphs([...report.signals, ...report.opportunities]);
  const serviceFitNarrative = narrative?.serviceFit
    ? decorateNarrative(narrative.serviceFit).map((paragraph) => ({ ...paragraph, classification: 'fit' as const }))
    : [];
  const sellerContext = reportDocument?.sellerContext;
  const sellerOffer = sellerContext?.valueProposition
    || sellerContext?.services?.join(', ')
    || sellerContext?.description
    || '';
  const showServiceFit = serviceFitNarrative.length > 0 || Boolean(sellerOffer);
  const evidenceClaims = [...new Map([
    ...report.executive,
    ...report.person.facts,
    ...companySectionCopy.flatMap((section) => report.companySections[section.key]),
    ...report.signals,
    ...report.opportunities,
  ].map((claim) => [claim.id, claim])).values()];
  const companyName = result.lead.companyName || result.lead.companyDomain || 'la empresa';
  const leadName = result.lead.fullName || result.lead.email || 'el contacto';
  const showEvidence = () => {
    setDetailsOpen(true);
    window.requestAnimationFrame(() => document.getElementById(`${id}-details`)?.focus());
  };

  return (
    <article className={cn('min-w-0 space-y-9', className)} aria-label="Reporte de investigación">
      <header className="space-y-6 border-b border-border/60 pb-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Informe de investigación</p>
            <h2 className="mt-2 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">{companyName}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Contexto empresarial y comercial para {leadName}.</p>
          </div>
          {updatedAt ? <p className="shrink-0 text-xs text-muted-foreground">Actualizado el {updatedAt}</p> : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5" role="status" aria-live="polite">
            {inFlight ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-300" aria-hidden="true" />
            ) : readiness === 'ready' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
            ) : (
              <CircleAlert className={cn('mt-0.5 size-4 shrink-0', statusTone(status))} aria-hidden="true" />
            )}
            <p className="min-w-0 text-sm">
              <span className={cn('font-semibold', statusTone(status))}>{researchStatusLabel(status)}</span>
              <span className="px-1.5 text-muted-foreground" aria-hidden="true">·</span>
              <span className={readinessTone(readiness)}>{researchReadinessLabel(readiness)}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{sourceCount} {sourceCount === 1 ? 'fuente revisable' : 'fuentes revisables'}</p>
        </div>
      </header>

      <section aria-labelledby={`${id}-executive`}>
        <SectionHeading
          id={`${id}-executive`}
          eyebrow="Resumen ejecutivo"
          title="Lo que conviene saber"
          description="Síntesis de la empresa, el contacto y las señales con mejor respaldo."
        />
        <div className="mt-4 rounded-3xl border border-border/70 bg-muted/[0.16] px-5 py-5 sm:px-6 sm:py-6">
          <NarrativeText
            paragraphs={executiveNarrative}
            empty="La evidencia disponible aún no permite preparar un resumen ejecutivo verificable."
            onShowEvidence={showEvidence}
          />
        </div>
      </section>

      <section aria-labelledby={`${id}-person`}>
        <SectionHeading
          id={`${id}-person`}
          eyebrow="Contacto"
          title="Quién es y qué sabemos"
          description="El contexto importado se distingue de la información encontrada en fuentes públicas."
        />
        {leadNarrative.length > 0 ? (
          <div className="mt-4">
            <NarrativeText paragraphs={leadNarrative} empty="" onShowEvidence={showEvidence} />
          </div>
        ) : null}
        <div className="mt-4 rounded-2xl border border-border/70 bg-muted/[0.16] px-4 py-4 sm:px-5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto importado</p>
          {report.person.fields.length > 0
            ? <ImportedFields fields={report.person.fields} />
            : <p className="text-sm leading-6 text-muted-foreground">No hay contexto personal importado para este contacto.</p>}
        </div>
        {report.person.facts.length > 0 ? <div className="mt-5">
          <h4 className="text-sm font-semibold">Hechos públicos verificados</h4>
          <div className="mt-2"><ClaimList claims={report.person.facts} /></div>
        </div> : null}
      </section>

      <section aria-labelledby={`${id}-company`}>
        <SectionHeading
          id={`${id}-company`}
          eyebrow="Empresa"
          title="Qué hace y cómo opera"
          description="Una lectura de su actividad, oferta, mercado y escala observable."
        />
        {companyNarrative.length > 0 ? (
          <div className="mt-4">
            <NarrativeText paragraphs={companyNarrative} empty="" onShowEvidence={showEvidence} />
          </div>
        ) : null}
        {report.companyContext.length > 0 ? (
          <div className="mt-5 border-l-2 border-border/70 pl-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto de empresa importado</p>
            <ImportedFields fields={report.companyContext} />
          </div>
        ) : null}
        <CompanySections sections={report.companySections} showEmpty={companyNarrative.length === 0} />
      </section>

      <section aria-labelledby={`${id}-commercial`}>
        <SectionHeading
          id={`${id}-commercial`}
          eyebrow="Lectura comercial"
          title="Señales y temas para explorar"
          description="Interpretación prudente de la actividad pública. Las hipótesis no representan necesidades confirmadas."
        />
        <div className="mt-4 border-l-2 border-primary/30 pl-4 sm:pl-5">
          <NarrativeText
            paragraphs={commercialNarrative}
            empty="La evidencia no permite formular todavía una lectura comercial citada."
            onShowEvidence={showEvidence}
            showClassification
          />
        </div>
        {report.signals.length > 0 ? (
          <div className="mt-5">
            <h4 className="text-sm font-semibold">Señales públicas verificadas</h4>
            <div className="mt-2"><ClaimList claims={report.signals} tone="signal" /></div>
          </div>
        ) : null}
      </section>

      {showServiceFit ? (
        <section aria-labelledby={`${id}-service-fit`}>
          <SectionHeading
            id={`${id}-service-fit`}
            eyebrow="Tu propuesta"
            title="Cómo podrías ayudar"
            description="Relacionamos lo que ofreces con la evidencia disponible, sin asumir una necesidad que aún no se ha confirmado."
          />
          {sellerContext && sellerOffer ? (
            <div className="mt-4 rounded-2xl border border-border/70 bg-muted/[0.16] px-4 py-4 sm:px-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Perfil utilizado</p>
              <p className="mt-1 text-sm font-medium text-foreground">{sellerContext.companyName}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{sellerOffer}</p>
            </div>
          ) : null}
          {serviceFitNarrative.length > 0 ? (
            <div className="mt-4 border-l-2 border-primary/30 pl-4 sm:pl-5">
              <NarrativeText
                paragraphs={serviceFitNarrative}
                empty="La evidencia disponible todavía no permite relacionar tu propuesta con una situación concreta de esta empresa."
                onShowEvidence={showEvidence}
                showClassification
              />
            </div>
          ) : (
            <p className="mt-4 text-sm leading-7 text-muted-foreground">La evidencia disponible todavía no permite relacionar tu propuesta con una situación concreta de esta empresa.</p>
          )}
        </section>
      ) : null}

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
        <section id={`${id}-details`} aria-labelledby={`${id}-details-heading`} className="border-y border-border/60 outline-none" tabIndex={-1}>
          <h3 id={`${id}-details-heading`} className="sr-only">Fuentes y calidad del reporte</h3>
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
                  {report.completeness?.claimCoverage
                    ? report.completeness.claimCoverage.available === 0
                      ? 'Aún no hay hechos públicos vigentes con respaldo para medir cobertura.'
                      : `${report.completeness.claimCoverage.represented} de ${report.completeness.claimCoverage.available} hechos públicos vigentes incluidos (${Math.round(report.completeness.claimCoverage.score * 100)}%).`
                    : report.completeness
                      ? `${report.completeness.status === 'complete' ? 'Secciones completas' : 'Secciones parciales'} (${Math.round(report.completeness.score * 100)}%).`
                    : `${report.coverage.claims} afirmaciones visibles con respaldo canónico.`}
                </p>
              </div>
            </div>
            {evidenceClaims.length > 0 ? (
              <div className="border-t border-border/60 py-4">
                <p className="font-medium">Base de afirmaciones</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Hechos e hipótesis canónicas usados para construir la lectura del informe.</p>
                <div className="mt-3"><ClaimList claims={evidenceClaims} /></div>
              </div>
            ) : null}
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
            {profileCompletionRequired ? 'Completa tu perfil comercial' : actionAvailable ? 'Borrador disponible para revisión' : showCompanyContextGuidance ? 'Hace falta contexto de empresa' : 'Borrador no disponible'}
          </p>
          <p id={`${id}-action-help`} className="mt-1 text-xs leading-5 text-muted-foreground">
            {profileCompletionRequired
              ? 'Agrega Productos y servicios o Propuesta de valor para crear un correo alineado con tu oferta.'
              : actionAvailable
              ? 'Se abrirá como borrador para que puedas revisarlo. No se enviará automáticamente.'
               : showCompanyContextGuidance
                ? 'Actualiza la investigación para buscar una fuente corporativa verificable.'
                : refreshAvailable
                  ? 'Actualiza la investigación para revisar fuentes y señales más recientes.'
                  : blockReason}
          </p>
        </div>
        {profileCompletionRequired && onCompleteProfile ? (
          <Button
            type="button"
            className="w-full shrink-0 rounded-full sm:w-auto"
            onClick={onCompleteProfile}
            aria-describedby={`${id}-action-help`}
          >
            <FileText aria-hidden="true" />
            Completar perfil
          </Button>
        ) : onCreateDraft && actionAvailable ? (
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
