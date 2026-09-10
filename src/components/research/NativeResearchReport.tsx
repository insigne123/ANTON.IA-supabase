'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ResearchReportProgress } from '@/components/research/ResearchReportProgress';
import { researchReportLoadingState } from '@/lib/research-report-loading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ReportFieldAnswers,
  ReportFieldStatusBadge,
  selectPreviewReportFields,
} from '@/components/research/ReportFieldAnswers';
import type { ReportFieldAnswer } from '@/lib/report-field-answers';
import { REPORT_V2_SCHEMA_VERSION, type ReportV2 } from '@/lib/report-v2-contracts';
import type { ResearchReportDocumentV1 } from '@/lib/research-report-contracts';
import { cn } from '@/lib/utils';
import {
  buildResearchReport,
  canShowResearchDraftAction,
  projectResearchReportFieldAnswers,
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
  type ResearchReportProfileField,
  type ResearchReportSynthesisViewState,
  type ResearchWorkspaceResult,
  type ResearchWorkspaceStatus,
} from '@/lib/research-workspace';

export type NativeResearchReportVariant = 'preview' | 'full';

export type NativeResearchReportProps = {
  result: ResearchWorkspaceResult;
  /** Must already be schema- and citation-validated against result.snapshot. */
  reportDocument?: ResearchReportDocumentV1 | ReportV2 | null;
  reportSynthesis?: ResearchReportSynthesisViewState | null;
  startedAt?: string | null;
  loadError?: boolean;
  variant?: NativeResearchReportVariant;
  /** Hides the inner header when an outer Dialog/Sheet already provides the title. */
  hideHeader?: boolean;
  /** Organization-scoped rollout for the expanded questionnaire surface. */
  questionnaireEnabled?: boolean;
  /** Compatible override for the lib `buildReportFieldAnswers` output. */
  fieldAnswers?: ReportFieldAnswer[] | null;
  fieldAnswersLoading?: boolean;
  fieldAnswersError?: string | null;
  onRetryFields?: () => void;
  status?: ResearchWorkspaceStatus;
  readiness?: ResearchReadiness;
  researchSnapshotId?: string | null;
  canCreateDraft?: boolean;
  profileCompletionRequired?: boolean;
  creatingDraft?: boolean;
  createDraftDisabled?: boolean;
  createDraftLabel?: string;
  creatingDraftLabel?: string;
  onCreateDraft?: (styleProfileId: string | null, instruction?: string) => void;
  onCompleteProfile?: () => void;
  refreshing?: boolean;
  refreshLabel?: string;
  refreshingLabel?: string;
  onRefresh?: () => void;
  retryingSynthesis?: boolean;
  onRetrySynthesis?: () => void;
  className?: string;
};

type DraftStyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

const DEFAULT_DRAFT_STYLE = '__default_draft_style__';

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

function ClaimList({ claims }: { claims: ResearchReportClaim[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {claims.map((claim) => {
        const observed = dateLabel(claim.observedAt);
        return (
          <li key={claim.id} className="py-4 first:pt-3.5 last:pb-3.5">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="min-w-0 break-words text-sm leading-6 text-foreground/90">
                {claim.statement}
              </p>
              {claim.classification === 'hypothesis' ? (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Hipótesis</span>
              ) : null}
            </div>
            {observed ? <p className="mt-1 text-xs text-muted-foreground">Observado el {observed}</p> : null}
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
  showClassification = false,
}: {
  paragraphs: Array<{
    text: string;
    evidenceIds?: string[];
    classification?: 'fact' | 'hypothesis' | 'signal' | 'fit';
    observedAt?: string | null;
  }>;
  empty: string;
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
            : 'Posible encaje';
        const showLabel = showClassification && paragraph.classification && paragraph.classification !== 'fact';
        return (
          <div key={`${paragraph.text}-${index}`}>
            {showLabel ? (
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
          </div>
        );
      })}
    </div>
  );
}

function NarrativeOrClaims({
  paragraphs,
  claims,
  empty,
  showClassification = false,
}: {
  paragraphs: Parameters<typeof NarrativeText>[0]['paragraphs'];
  claims: ResearchReportClaim[];
  empty: string;
  showClassification?: boolean;
}) {
  if (paragraphs.length > 0) {
    return <NarrativeText paragraphs={paragraphs} empty={empty} showClassification={showClassification} />;
  }
  if (claims.length > 0) {
    return (
      <div>
        <p className="mb-2 text-sm leading-6 text-muted-foreground">La lectura interpretada no está disponible todavía. Mostramos los datos verificables para que puedas revisarlos.</p>
        <ClaimList claims={claims} />
      </div>
    );
  }
  return <NarrativeText paragraphs={[]} empty={empty} showClassification={showClassification} />;
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

function ReportCollapsibleSection({
  id,
  eyebrow,
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <section aria-labelledby={`${id}-heading`}>
        <h3 id={`${id}-heading`}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="group h-auto w-full justify-between gap-5 whitespace-normal rounded-none px-0 py-5 text-left hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-describedby={`${id}-description`}
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</span>
                <span className="mt-1 block text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </h3>
        <p id={`${id}-description`} className="-mt-2 max-w-2xl pb-4 text-sm leading-6 text-muted-foreground">{description}</p>
        <CollapsibleContent>
          <div className="border-t border-border/60 py-5">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/* Questionnaire answers come from `projectResearchReportFieldAnswers`, which keeps
   full audit provenance outside the model-facing/model-derived presentation. */

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
  reportSynthesis,
  startedAt,
  loadError = false,
  variant = 'full',
  hideHeader = false,
  questionnaireEnabled = false,
  fieldAnswers,
  fieldAnswersLoading = false,
  fieldAnswersError = null,
  onRetryFields,
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
  retryingSynthesis = false,
  onRetrySynthesis,
  className,
}: NativeResearchReportProps) {
  const id = useId();
  const report = useMemo(() => buildResearchReport(result, reportDocument), [result, reportDocument]);
  const evidenceCount = report.coverage.evidenceRecords;
  const sourceCount = report.coverage.sources;
  const baseReadiness = readinessProp || researchReadinessFor({
    status,
    lead: result.lead,
    result,
    snapshotId: researchSnapshotId,
    evidenceCount,
    sourceCount,
  });
  const qualityScore = result.quality.score ?? result.score;
  const eligible = result.draftEligibility.eligible === true;
  const loadingState = researchReportLoadingState({ status, snapshotId: researchSnapshotId, document: reportDocument, synthesis: reportSynthesis });
  const synthesisPending = loadingState.pending;
  const synthesisFailed = loadingState.failed;
  const readiness = synthesisFailed ? 'needs_attention' : synthesisPending ? 'in_progress' : baseReadiness;
  const actionAvailable = loadingState.showReport && !loadError && !profileCompletionRequired && !synthesisFailed && canShowResearchDraftAction({
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
  const narrative = reportDocument?.schemaVersion === 'research-report-document/v1' ? reportDocument.narrative : null;
  const canonicalClaimById = new Map((result.snapshot?.claims || []).map((claim) => [claim.id, claim]));
  const canonicalEvidenceById = new Map((result.snapshot?.evidence || []).map((evidence) => [evidence.id, evidence]));
  const canonicalSourceById = new Map((result.snapshot?.sources || []).map((source) => [source.id, source]));
  const v2ClaimById = new Map(reportDocument?.schemaVersion === REPORT_V2_SCHEMA_VERSION
    ? reportDocument.evidenceGraph.claims.map((claim) => [claim.id, claim])
    : []);
  const decorateNarrative = (paragraphs: Array<{
    text: string;
    claimIds: string[];
    evidenceIds?: string[];
    classification?: 'fact' | 'hypothesis' | 'signal' | 'fit';
    observedAt?: string | null;
    basis?: 'source' | 'profile' | 'analysis' | 'recommendation';
  }>) => paragraphs.map((paragraph) => {
    const claims = paragraph.claimIds.map((claimId) => canonicalClaimById.get(claimId)).filter(Boolean);
    const v2Claims = paragraph.claimIds.map((claimId) => v2ClaimById.get(claimId)).filter(Boolean);
    const classification: 'fact' | 'hypothesis' | 'signal' | 'fit' = paragraph.classification || (paragraph.basis === 'analysis' || paragraph.basis === 'recommendation' || claims.some((claim) => claim?.classification === 'hypothesis') || v2Claims.some((claim) => claim?.type === 'hypothesis')
      ? 'hypothesis'
      : claims.some((claim) => ['news_signal', 'hiring_signal', 'technology_signal', 'site_signal'].includes(claim?.kind || '')) || v2Claims.some((claim) => claim?.dimension === 'signal')
        ? 'signal'
        : 'fact');
    const evidence = (paragraph.evidenceIds || []).map((evidenceId) => canonicalEvidenceById.get(evidenceId)).find(Boolean);
    const source = evidence ? canonicalSourceById.get(evidence.sourceId) : null;
    return {
      ...paragraph,
      classification,
      observedAt: paragraph.observedAt || evidence?.observedAt || source?.publishedAt || source?.retrievedAt || v2Claims.map((claim) => claim?.observedAt).find(Boolean) || null,
    };
  });
  const v2Paragraphs = (...keys: ReportV2['sections'][number]['key'][]) => reportDocument?.schemaVersion === REPORT_V2_SCHEMA_VERSION
    ? reportDocument.sections.filter((section) => keys.includes(section.key)).flatMap((section) => section.paragraphs)
    : [];
  const executiveNarrative = narrative ? decorateNarrative(narrative.executiveSummary) : decorateNarrative(v2Paragraphs('verdict'));
  const companyNarrative = narrative ? decorateNarrative(narrative.companyProfile) : decorateNarrative(v2Paragraphs('snapshot', 'company'));
  const leadNarrative = narrative ? decorateNarrative(narrative.leadContext) : decorateNarrative(v2Paragraphs('contact', 'committee'));
  const commercialNarrative = narrative ? decorateNarrative(narrative.commercialReading) : decorateNarrative(v2Paragraphs('signals', 'angle', 'discovery', 'objections', 'risks'));
  const serviceFitNarrative = narrative?.serviceFit
    ? decorateNarrative(narrative.serviceFit).map((paragraph) => ({ ...paragraph, classification: 'fit' as const }))
    : decorateNarrative(v2Paragraphs('fit').map((paragraph) => ({ ...paragraph, classification: 'fit' as const })));
  const companyClaims = Object.values(report.companySections).flat();
  const commercialClaims = [...report.signals, ...report.opportunities];
  const showServiceFit = serviceFitNarrative.length > 0;
  const hasCommercialReading = commercialNarrative.length > 0 || commercialClaims.length > 0 || showServiceFit;
  const hasUnresolvedContradiction = report.contradictions.some((item) => item.status === 'unresolved');
  const hasBlockingGap = report.gaps.length > 0 && !actionAvailable;
  const reviewNeedsAttention = hasUnresolvedContradiction || hasBlockingGap;
  const evidenceClaims = [...new Map([
    ...report.executive,
    ...report.person.facts,
    ...Object.values(report.companySections).flat(),
    ...report.signals,
    ...report.opportunities,
  ].map((claim) => [claim.id, claim])).values()];
  const contradictionEvidence = [...new Map(
    report.contradictions
      .flatMap((item) => item.evidence)
      .map((evidence) => [evidence.id, evidence]),
  ).values()];
  const companyName = result.lead.companyName || result.lead.companyDomain || 'la empresa';
  const leadName = result.lead.fullName || result.lead.email || 'el contacto';
  const reportIdentity = researchSnapshotId || result.lead.id || result.lead.email || `${leadName}:${companyName}`;
  const isPreview = variant === 'preview';
  const localFieldAnswers = useMemo(
    () => fieldAnswers ?? projectResearchReportFieldAnswers(report, result),
    [fieldAnswers, report, result],
  );
  const previewFieldAnswers = useMemo(
    () => selectPreviewReportFields(localFieldAnswers, 6),
    [localFieldAnswers],
  );
  const assumptionFieldAnswers = useMemo(
    () => localFieldAnswers.filter((answer) => answer.status === 'hypothesis' || answer.status === 'estimated'),
    [localFieldAnswers],
  );
  const [contactOpen, setContactOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [commercialOpen, setCommercialOpen] = useState(isPreview ? false : hasCommercialReading);
  const [reviewOpen, setReviewOpen] = useState(isPreview ? false : reviewNeedsAttention);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftStyles, setDraftStyles] = useState<DraftStyleOption[]>([]);
  const [draftStyleId, setDraftStyleId] = useState(DEFAULT_DRAFT_STYLE);
  const [draftInstruction, setDraftInstruction] = useState({ reportIdentity, value: '' });
  const currentDraftInstruction = draftInstruction.reportIdentity === reportIdentity ? draftInstruction.value : '';
  useEffect(() => { setDraftInstruction({ reportIdentity, value: '' }); }, [reportIdentity]);
  const showActionFooter = (profileCompletionRequired && Boolean(onCompleteProfile))
    || (actionAvailable && Boolean(onCreateDraft))
    || refreshAvailable
    || (!inFlight && Boolean(blockReason));

  useEffect(() => {
    setContactOpen(false);
    setCompanyOpen(false);
    setCommercialOpen(isPreview ? false : hasCommercialReading);
    setReviewOpen(isPreview ? false : reviewNeedsAttention);
    setDetailsOpen(false);
  }, [hasCommercialReading, isPreview, reportIdentity, reviewNeedsAttention]);

  useEffect(() => {
    if (!actionAvailable) return;
    const controller = new AbortController();
    void fetch('/api/email-styles?includePresets=true', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.styles)) return;
        const styles: DraftStyleOption[] = payload.styles.flatMap((style: any): DraftStyleOption[] => {
          const id = String(style?.id || '').trim();
          const name = String(style?.name || '').trim();
          return id && name ? [{ id, name, isDefault: Boolean(style?.isDefault) }] : [];
        });
        setDraftStyles(styles);
        const defaultStyle = styles.find((style) => style.isDefault);
        if (defaultStyle) setDraftStyleId(defaultStyle.id);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setDraftStyles([]);
      });
    return () => controller.abort();
  }, [actionAvailable]);

  if (!loadingState.showReport) return (
    <article className={cn('min-w-0 space-y-6', className)} aria-label="Reporte de investigación">
      <header>
        <p className="text-xs text-muted-foreground">Informe de investigación</p>
        <h2 className="mt-1 break-words text-2xl font-semibold tracking-tight">{companyName}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Para {leadName}</p>
      </header>
      {synthesisPending && !loadError ? (
        <ResearchReportProgress key={reportIdentity} startedAt={startedAt || result.startedAt} retryScheduled={reportSynthesis?.status === 'retry_scheduled'} />
      ) : (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/25 p-5" role="status">
          <h3 className="font-semibold">{loadError ? 'No pudimos actualizar el informe' : synthesisFailed ? 'No pudimos preparar el informe completo' : 'El informe completo no está disponible'}</h3>
          <p className="text-sm leading-6 text-muted-foreground">{loadError ? 'Reintenta la carga para comprobar su estado. No mostraremos un informe preliminar.' : 'No mostramos evidencia preliminar como informe final. Puedes volver a intentarlo.'}</p>
          {!loadError && (onRetrySynthesis || onRefresh) ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={onRetrySynthesis || onRefresh} disabled={retryingSynthesis || refreshing}>
              <RefreshCw className={cn((retryingSynthesis || refreshing) && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
              {retryingSynthesis || refreshing ? 'Reintentando…' : onRetrySynthesis ? 'Reintentar informe' : 'Actualizar investigación'}
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );

  return (
    <article className={cn('min-w-0 space-y-7', className)} aria-label="Reporte de investigación">
      {hideHeader ? null : (
      <header className="space-y-4 border-b border-border/60 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Informe de investigación</p>
            <h2 className="mt-1 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground">{companyName}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Contexto empresarial y comercial para {leadName}.</p>
          </div>
          {updatedAt ? <p className="shrink-0 text-xs text-muted-foreground">Actualizado el {updatedAt}</p> : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5" role="status" aria-live="polite">
            {inFlight ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-300" aria-hidden="true" />
            ) : readiness === 'ready' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
            ) : (
              <CircleAlert className={cn('mt-0.5 size-4 shrink-0', statusTone(status))} aria-hidden="true" />
            )}
            <p className="min-w-0 text-sm">
              <span className={cn('font-semibold', statusTone(status))}>{synthesisFailed ? 'Actualización fallida' : researchStatusLabel(status)}</span>
              <span className="px-1.5 text-muted-foreground" aria-hidden="true">·</span>
              <span className={readinessTone(readiness)}>{researchReadinessLabel(readiness)}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{sourceCount} {sourceCount === 1 ? 'fuente revisable' : 'fuentes revisables'}</p>
        </div>
      </header>
      )}

      {synthesisPending ? (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50/75 px-4 py-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100" role="status">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <div>
            <p className="font-medium">Estamos preparando el reporte completo</p>
            <p className="mt-1 text-xs leading-5 opacity-80">
              {reportSynthesis?.status === 'retry_scheduled'
                ? 'La evidencia está guardada y volveremos a intentarlo automáticamente.'
                : 'La evidencia ya está disponible. Esta vista se actualizará cuando termine la interpretación.'}
            </p>
          </div>
        </div>
      ) : null}

      {synthesisFailed ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div>
            <p className="font-medium">No pudimos preparar el reporte completo</p>
            <p className="mt-1 text-xs leading-5 opacity-80">Mostramos el último informe disponible. La evidencia sigue guardada; puedes reintentar sin repetir la investigación.</p>
          </div>
          {onRetrySynthesis ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full bg-background/80" onClick={onRetrySynthesis} disabled={retryingSynthesis}>
              <RefreshCw className={cn(retryingSynthesis && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
              {retryingSynthesis ? 'Reintentando…' : 'Reintentar reporte'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby={`${id}-executive`}>
        <SectionHeading
          id={`${id}-executive`}
          eyebrow="Antes de contactar"
          title={`Lo esencial sobre ${leadName}`}
          description="Una lectura breve para llegar a la conversación con contexto, sin convertir señales en certezas."
        />
        <div className="mt-4 rounded-3xl border border-primary/15 bg-primary/[0.04] px-5 py-5 sm:px-6">
          <NarrativeOrClaims
            paragraphs={executiveNarrative}
            claims={report.executive}
            empty="La evidencia disponible aún no permite preparar un resumen ejecutivo verificable."
          />
        </div>
      </section>

      {isPreview ? (
        questionnaireEnabled ? (
        <section aria-labelledby={`${id}-key-fields`}>
          <SectionHeading
            id={`${id}-key-fields`}
            eyebrow="Datos clave"
            title="Lo confirmado y lo estimado"
            description="Los datos más útiles para decidir el siguiente paso."
          />
          <div className="mt-4">
            <ReportFieldAnswers
              answers={previewFieldAnswers}
              variant="preview"
              loading={fieldAnswersLoading}
              error={fieldAnswersError}
              onRetry={onRetryFields}
            />
          </div>
        </section>
        ) : null
      ) : (
        <>
          {questionnaireEnabled ? <section aria-labelledby={`${id}-key-fields`}>
            <SectionHeading
              id={`${id}-key-fields`}
              eyebrow="Datos verificados"
              title="Empresa, contacto y lectura"
              description="Cada dato indica si está confirmado, estimado o es una hipótesis."
            />
            <div className="mt-4">
              <ReportFieldAnswers
                answers={localFieldAnswers}
                variant="full"
                loading={fieldAnswersLoading}
                error={fieldAnswersError}
                onRetry={onRetryFields}
            />
          </div>
          </section> : null}

          {report.signals.length > 0 ? (
            <section aria-labelledby={`${id}-timeline`}>
              <SectionHeading
                id={`${id}-timeline`}
                eyebrow="Señales"
                title="Cronología de señales"
                description="Hechos públicos recientes en orden de observación."
              />
              <ol className="relative mt-4 space-y-4 border-l border-border/60 pl-5">
                {report.signals.slice(0, 6).map((signal) => {
                  const observed = dateLabel(signal.observedAt);
                  return (
                    <li key={signal.id} className="relative min-w-0">
                      <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-primary/60 ring-4 ring-background" aria-hidden="true" />
                      <p className="break-words text-sm leading-6 text-foreground/90">{signal.statement}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {observed ? `Observado el ${observed}` : 'Fecha por confirmar'}
                        {signal.evidence.length > 0 ? ` · ${signal.evidence.length} ${signal.evidence.length === 1 ? 'fuente' : 'fuentes'}` : ''}
                      </p>
                      {signal.evidence.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                          {signal.evidence.slice(0, 2).map((evidence) => (
                            <EvidenceLink key={evidence.id} evidence={evidence} />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {report.opportunities.length > 0 ? (
            <section aria-labelledby={`${id}-decision-map`}>
              <SectionHeading
                id={`${id}-decision-map`}
                eyebrow="Decisión"
                title="Mapa de decisión"
                description="Caminos posibles según la evidencia. Valídalos en la conversación."
              />
              <ol className="mt-4 space-y-3">
                {report.opportunities.slice(0, 5).map((opportunity, index) => (
                  <li key={opportunity.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-border/60 bg-card/35 px-4 py-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm leading-6 text-foreground/90">{opportunity.statement}</p>
                      {opportunity.evidence.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                          {opportunity.evidence.slice(0, 2).map((evidence) => (
                            <EvidenceLink key={evidence.id} evidence={evidence} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {questionnaireEnabled && assumptionFieldAnswers.length > 0 ? (
            <section aria-labelledby={`${id}-assumptions`}>
              <SectionHeading
                id={`${id}-assumptions`}
                eyebrow="Supuestos"
                title="Supuestos y estimaciones"
                description="Lo que aún necesita confirmación antes de usarlo como argumento."
              />
              <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card/35">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[32%]">Campo</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="w-[132px]">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assumptionFieldAnswers.slice(0, 8).map((answer) => (
                      <TableRow key={answer.key}>
                        <TableCell className="break-words align-top font-medium">{answer.label}</TableCell>
                        <TableCell className="min-w-0 break-words align-top text-muted-foreground">
                          <span className="block break-words text-sm leading-6 text-foreground/90">{answer.value}</span>
                          {answer.detail ? <span className="mt-0.5 block text-xs">{answer.detail}</span> : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <ReportFieldStatusBadge status={answer.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </>
      )}

      <div className="divide-y divide-border/60 rounded-3xl border border-border/70 bg-card/35 px-5 sm:px-6">
        <ReportCollapsibleSection
          id={`${id}-commercial`}
          eyebrow="Lectura comercial"
          title="Qué explorar y cómo ayudar"
          description="Hipótesis para orientar preguntas y conectar tu oferta sin asumir un dolor confirmado."
          open={commercialOpen}
          onOpenChange={setCommercialOpen}
        >
          <div className="space-y-6">
            <section aria-labelledby={`${id}-possible-challenges`}>
              <h4 id={`${id}-possible-challenges`} className="text-sm font-semibold">Posibles retos a validar</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Son hipótesis basadas en el contexto de empresa, cargo, área y señales públicas. Confírmalas en la conversación.</p>
              <div className="mt-3 border-l-2 border-amber-400/50 pl-4 sm:pl-5">
                <NarrativeOrClaims
                  paragraphs={commercialNarrative}
                  claims={commercialClaims}
                  empty="No hay señales suficientes para proponer un reto concreto."
                  showClassification
                />
              </div>
            </section>
            <section aria-labelledby={`${id}-seller-fit`} className="border-t border-border/60 pt-5">
              <h4 id={`${id}-seller-fit`} className="text-sm font-semibold">Lo que puedes ofrecer</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Una conexión posible entre tu propuesta y el contexto investigado.</p>
              <div className="mt-3 border-l-2 border-primary/30 pl-4 sm:pl-5">
                <NarrativeText
                  paragraphs={serviceFitNarrative}
                  empty="Aún no hay un encaje suficientemente respaldado para recomendar una oferta concreta."
                  showClassification
                />
              </div>
            </section>
          </div>
        </ReportCollapsibleSection>

        <ReportCollapsibleSection
          id={`${id}-person`}
          eyebrow="Contacto"
          title="Quién es y qué sabemos"
          description="Contexto del contacto para interpretar su rol antes de escribirle."
          open={contactOpen}
          onOpenChange={setContactOpen}
        >
          <NarrativeOrClaims
            paragraphs={leadNarrative}
            claims={report.person.facts}
            empty="No encontramos contexto público adicional sobre este contacto."
          />
          <div className="mt-5 rounded-2xl border border-border/70 bg-muted/[0.16] px-4 py-4 sm:px-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto importado</p>
            {report.person.fields.length > 0
              ? <ImportedFields fields={report.person.fields} />
              : <p className="text-sm leading-6 text-muted-foreground">No hay contexto personal importado para este contacto.</p>}
          </div>
        </ReportCollapsibleSection>

        <ReportCollapsibleSection
          id={`${id}-company`}
          eyebrow="Empresa"
          title="Qué hace y cómo opera"
          description="Actividad, oferta, mercado y escala observables."
          open={companyOpen}
          onOpenChange={setCompanyOpen}
        >
          <NarrativeOrClaims
            paragraphs={companyNarrative}
            claims={companyClaims}
            empty="Todavía no hay una lectura corporativa suficientemente clara. Revisa las fuentes y los vacíos antes de usar este contexto."
          />
          {report.companyContext.length > 0 ? (
            <div className="mt-5 border-l-2 border-border/70 pl-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Contexto importado</p>
              <ImportedFields fields={report.companyContext} />
            </div>
          ) : null}
        </ReportCollapsibleSection>

      </div>

      {hasReviewPoints ? (
        <div className="rounded-3xl border border-border/70 bg-card/35 px-5 sm:px-6">
          <ReportCollapsibleSection
            id={`${id}-review`}
            eyebrow="Límites del reporte"
            title="Vacíos y contradicciones"
            description="Puntos que conviene considerar antes de personalizar el contacto."
            open={reviewOpen}
            onOpenChange={setReviewOpen}
          >
            <div className="divide-y divide-border/60 rounded-2xl border border-border/70 px-4 sm:px-5">
              {report.contradictions.map((item) => (
                <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-4">
                  <p className="text-sm font-medium leading-6">{item.summary}</p>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', item.status === 'resolved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
                    {item.status === 'resolved' ? 'Resuelta' : 'Sin resolver'}
                  </span>
                </div>
              ))}
              {report.gaps.map((gap) => (
                <p key={gap.id} className="py-4 text-sm leading-6 text-muted-foreground">{gap.description}</p>
              ))}
            </div>
          </ReportCollapsibleSection>
        </div>
      ) : null}

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <section id={`${id}-details`} aria-labelledby={`${id}-details-heading`} className="border-y border-border/60">
          <h3 id={`${id}-details-heading`} className="sr-only">Fuentes y calidad del reporte</h3>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between whitespace-normal rounded-none px-0 py-4 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  {reportDocument?.schemaVersion === REPORT_V2_SCHEMA_VERSION
                    ? reportDocument.audit.status === 'passed' ? 'Revisión final completada.' : 'Revisión completada con observaciones. Consulta los límites antes de usar el reporte.'
                    : qualityScore == null ? 'La calidad aún no fue evaluada.' : `Calidad general: ${qualityScore}/100.`}
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
            {contradictionEvidence.length > 0 ? (
              <div className="border-t border-border/60 py-4">
                <p className="font-medium">Respaldo de contradicciones</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
                  {contradictionEvidence.map((evidence) => <EvidenceLink key={evidence.id} evidence={evidence} />)}
                </div>
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

      {actionAvailable && onCreateDraft ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-draft-instruction`}>Indicaciones para el borrador <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Textarea id={`${id}-draft-instruction`} rows={3} maxLength={1_000}
            className="min-h-24 resize-y" value={currentDraftInstruction}
            onChange={(event) => setDraftInstruction({ reportIdentity, value: event.target.value })}
            disabled={creatingDraft || createDraftDisabled}
            placeholder="Ej. usa un tono más directo y enfócate en una consecuencia práctica." />
        </div>
      ) : null}

      {showActionFooter ? <footer aria-label="Acciones del informe" className={cn('flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between', !isPreview && 'sticky bottom-0 z-10 -mx-1 bg-background/90 px-1 pb-1 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/75')}>
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
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-64">
            <Label htmlFor={`${id}-draft-style`} className="text-xs text-muted-foreground">Estilo del correo</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={draftStyleId} onValueChange={setDraftStyleId} disabled={creatingDraft || createDraftDisabled}>
                <SelectTrigger id={`${id}-draft-style`} className="h-11 w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DRAFT_STYLE}>Estilo predeterminado</SelectItem>
                  {draftStyles.map((style) => (
                    <SelectItem key={style.id} value={style.id}>
                      {style.name}{style.isDefault ? ' · Predeterminado' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                className="min-h-11 w-full shrink-0 rounded-full sm:w-auto"
                onClick={() => onCreateDraft(draftStyleId === DEFAULT_DRAFT_STYLE ? null : draftStyleId, currentDraftInstruction.trim() || undefined)}
                disabled={creatingDraft || createDraftDisabled}
                aria-describedby={`${id}-action-help`}
              >
                {creatingDraft ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileText aria-hidden="true" />}
                {creatingDraft ? creatingDraftLabel : createDraftLabel}
              </Button>
            </div>
          </div>
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
      </footer> : null}
    </article>
  );
}

export default NativeResearchReport;
