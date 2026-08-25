'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CircleStop, FileCheck2, Inbox, Loader2, MailPlus, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { stopFirstContactFollowUpPlan } from '@/lib/campaigns-v2-client';
import { campaignInboxItemAction } from '@/lib/campaigns-v2-inbox-ui';
import {
  CampaignV2InboxResponseSchema,
  type CampaignV2InboxItem,
  type CampaignV2InboxPage,
  type CampaignV2InboxResponse,
} from '@/lib/campaigns-v2/inbox-contracts';
import { cn } from '@/lib/utils';

type InboxFilter = 'pending' | 'attention';

type CampaignReviewInboxProps = {
  className?: string;
  onEnabledChange?: (enabled: boolean) => void;
};

type LoadInboxOptions = {
  append?: boolean;
  background?: boolean;
  cursor?: string | null;
  focusHeading?: boolean;
  signal?: AbortSignal;
};

const attentionStates = new Set(['deferred', 'failed', 'unknown', 'blocked']);

const apiErrorCopy: Record<string, string> = {
  CAMPAIGN_V2_INBOX_QUERY_INVALID: 'No pudimos abrir esta página de seguimientos. Actualiza la bandeja.',
  CAMPAIGN_V2_INBOX_CURSOR_INVALID: 'La lista cambió mientras cargábamos más seguimientos. Actualiza la bandeja para continuar.',
  CAMPAIGN_V2_INBOX_READ_FAILED: 'No pudimos cargar los seguimientos. Inténtalo de nuevo.',
  CAMPAIGN_V2_DRAFT_PREPARE_FAILED: 'No pudimos preparar este borrador. Inténtalo de nuevo.',
  CAMPAIGN_V2_STEP_ID_INVALID: 'Este seguimiento ya no está disponible. Actualiza la bandeja.',
  CAMPAIGN_V2_STOP_INPUT_INVALID: 'Este seguimiento ya no está disponible. Actualiza la bandeja.',
  CAMPAIGN_V2_STOP_FAILED: 'No pudimos detener el seguimiento. Inténtalo de nuevo.',
  'Campaign recipient step not found': 'Este seguimiento ya no está disponible. Actualiza la bandeja.',
  'Campaign not found': 'Esta campaña ya no está disponible. Actualiza la bandeja.',
};

class CampaignInboxRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CampaignInboxRequestError';
  }
}

function normalizedState(value: string) {
  return String(value || '').trim().toLowerCase();
}

function isAttentionItem(item: CampaignV2InboxItem) {
  return attentionStates.has(normalizedState(item.state));
}

function recipientContext(item: CampaignV2InboxItem) {
  return item.recipientName
    ? `${item.recipientName} (${item.recipientEmail})`
    : item.recipientEmail;
}

function formatDueDate(value?: string | null) {
  if (!value) return 'Sin fecha definida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha definida';
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function stateLabel(value: string) {
  const labels: Record<string, string> = {
    pending_initial_send: 'Pendiente del envío inicial',
    not_due: 'Aún no corresponde',
    ready_to_prepare: 'Listo para preparar',
    drafting: 'Preparando borrador',
    review_required: 'Requiere revisión',
    approved: 'Listo para enviar',
    dispatch_pending: 'Envío pendiente',
    sending: 'Enviando',
    sent: 'Enviado',
    deferred: 'Diferido',
    failed: 'Falló',
    unknown: 'Por confirmar',
    skipped: 'Omitido',
    blocked: 'Bloqueado',
  };
  const normalized = normalizedState(value);
  return labels[normalized] || (normalized ? normalized.replaceAll('_', ' ') : 'Pendiente');
}

function stateTone(value: string) {
  const normalized = normalizedState(value);
  if (normalized === 'approved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (attentionStates.has(normalized)) return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
  return 'border-border bg-muted/30 text-muted-foreground';
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const message = 'message' in payload && typeof payload.message === 'string'
    ? payload.message.trim()
    : '';
  const code = 'error' in payload && typeof payload.error === 'string'
    ? payload.error.trim()
    : '';
  if (code && apiErrorCopy[code]) return apiErrorCopy[code];
  if (message) return message;
  if (code && !/^[A-Z0-9_]+$/.test(code)) return code;
  return fallback;
}

function caughtErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return apiErrorCopy[error.message] || error.message || fallback;
}

function mergeInboxItems(current: CampaignV2InboxItem[], nextPage: CampaignV2InboxItem[]) {
  const byStepId = new Map(current.map((item) => [item.stepId, item]));
  nextPage.forEach((item) => byStepId.set(item.stepId, item));
  return [...byStepId.values()];
}

function updatePendingIds(
  setter: Dispatch<SetStateAction<Set<string>>>,
  id: string,
  pending: boolean,
) {
  setter((current) => {
    const next = new Set(current);
    if (pending) next.add(id);
    else next.delete(id);
    return next;
  });
}

function InboxSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('overflow-hidden rounded-2xl border-border/60', className)} aria-busy="true">
      <CardHeader className="border-b border-border/60">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5" role="status" aria-label="Cargando seguimientos">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center justify-between gap-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-7 w-24" /></div>
            <Skeleton className="mt-3 h-3 w-64 max-w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CampaignReviewInbox({ className, onEnabledChange }: CampaignReviewInboxProps) {
  const router = useRouter();
  const { toast } = useToast();
  const requestSequence = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const stopTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<CampaignV2InboxItem[]>([]);
  const [page, setPage] = useState<CampaignV2InboxPage | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [workingStepIds, setWorkingStepIds] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [stopCandidate, setStopCandidate] = useState<CampaignV2InboxItem | null>(null);
  const [stoppingEnrollmentIds, setStoppingEnrollmentIds] = useState<Set<string>>(() => new Set());
  const [stopErrors, setStopErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState('');

  const loadInbox = useCallback(async (options: LoadInboxOptions = {}) => {
    const requestId = ++requestSequence.current;
    const append = options.append === true;
    const background = options.background === true;
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    if (append) {
      setLoadingMore(true);
      setLoadMoreError(null);
      setStatusMessage('Cargando más seguimientos.');
    } else if (background) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const endpoint = options.cursor
        ? `/api/campaigns/v2/inbox?cursor=${encodeURIComponent(options.cursor)}`
        : '/api/campaigns/v2/inbox';
      const response = await fetch(endpoint, { cache: 'no-store', signal: options.signal });
      const payload = await response.json().catch(() => null);
      if (requestId !== requestSequence.current) return;
      if (!response.ok) {
        const code = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : '';
        throw new CampaignInboxRequestError(code, responseMessage(payload, 'No pudimos cargar los seguimientos.'));
      }
      const parsed = CampaignV2InboxResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error('Recibimos una respuesta incompleta. Actualiza la bandeja e inténtalo de nuevo.');
      }
      const inbox: CampaignV2InboxResponse = parsed.data;
      const nextEnabled = inbox.enabled === true;
      setEnabled(nextEnabled);
      onEnabledChange?.(nextEnabled);
      if (!nextEnabled) {
        setItems([]);
        setPage(inbox.page);
        return;
      }
      setItems((current) => append ? mergeInboxItems(current, inbox.items) : inbox.items);
      setPage(inbox.page);
      if (append) {
        setStatusMessage(`${inbox.page.returned} seguimientos más cargados.`);
      } else if (background) {
        setLoadMoreError(null);
        setStatusMessage('Bandeja actualizada.');
      }
      if (options.focusHeading) requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (requestId !== requestSequence.current) return;
      const message = caughtErrorMessage(error, 'No pudimos cargar los seguimientos.');
      if (append) {
        setLoadMoreError(message);
        setStatusMessage('No pudimos cargar más seguimientos.');
        if (error instanceof CampaignInboxRequestError && error.code === 'CAMPAIGN_V2_INBOX_CURSOR_INVALID') {
          setPage((current) => current ? { ...current, hasMore: false, nextCursor: null } : current);
          setStatusMessage('La lista cambió. Estamos actualizando la bandeja desde el inicio.');
          void loadInbox({ background: true });
        }
      }
      else if (background) {
        setRefreshError(message);
        setStatusMessage('No pudimos actualizar la bandeja. Los seguimientos cargados siguen disponibles.');
      } else setLoadError(message);
      if (options.focusHeading) requestAnimationFrame(() => retryButtonRef.current?.focus());
    } finally {
      if (!options.signal?.aborted && requestId === requestSequence.current) {
        if (append) setLoadingMore(false);
        else if (background) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [onEnabledChange]);

  useEffect(() => {
    const controller = new AbortController();
    void loadInbox({ signal: controller.signal });
    return () => controller.abort();
  }, [loadInbox]);

  const summary = useMemo(() => ({
    scope: 'loaded' as const,
    displayed: items.length,
    pending: items.filter((item) => !isAttentionItem(item)).length,
    attention: items.filter(isAttentionItem).length,
    campaigns: new Set(items.map((item) => item.campaignId)).size,
  }), [items]);

  const filteredItems = useMemo(() => items.filter((item) => (
    filter === 'attention' ? isAttentionItem(item) : !isAttentionItem(item)
  )), [filter, items]);

  async function prepareDraft(item: CampaignV2InboxItem) {
    updatePendingIds(setWorkingStepIds, item.stepId, true);
    setStatusMessage(`Preparando borrador para ${recipientContext(item)}.`);
    setActionErrors((current) => ({ ...current, [item.stepId]: '' }));
    try {
      const response = await fetch(`/api/campaigns/v2/recipient-steps/${encodeURIComponent(item.stepId)}/prepare-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => null);
      const composeUrl = typeof payload?.composeUrl === 'string' ? payload.composeUrl.trim() : '';
      if (!response.ok || !payload?.draft || !composeUrl) {
        throw new Error(responseMessage(payload, 'No pudimos preparar este borrador.'));
      }
      router.push(composeUrl);
    } catch (error: unknown) {
      setActionErrors((current) => ({
        ...current,
        [item.stepId]: caughtErrorMessage(error, 'No pudimos preparar este borrador.'),
      }));
      setStatusMessage(`No pudimos preparar el borrador para ${recipientContext(item)}.`);
    } finally {
      updatePendingIds(setWorkingStepIds, item.stepId, false);
    }
  }

  function runItemAction(item: CampaignV2InboxItem) {
    const action = campaignInboxItemAction(item.state, item.nextAction);
    if (action.kind === 'prepare') {
      void prepareDraft(item);
      return;
    }
    if (action.kind === 'open' && item.composeUrl) router.push(item.composeUrl);
  }

  async function stopFollowUp() {
    if (!stopCandidate || stoppingEnrollmentIds.has(stopCandidate.enrollmentId)) return;
    const candidate = stopCandidate;
    updatePendingIds(setStoppingEnrollmentIds, candidate.enrollmentId, true);
    setStopErrors((current) => ({ ...current, [candidate.enrollmentId]: '' }));
    setStatusMessage(`Deteniendo seguimiento de ${recipientContext(candidate)}.`);
    try {
      await stopFirstContactFollowUpPlan({
        campaignId: candidate.campaignId,
        enrollmentId: candidate.enrollmentId,
      });
      setStopCandidate((current) => current?.enrollmentId === candidate.enrollmentId ? null : current);
      setItems((current) => current.filter((item) => item.enrollmentId !== candidate.enrollmentId));
      setStatusMessage(`Seguimiento de ${recipientContext(candidate)} detenido. Actualizando la bandeja.`);
      toast({
        title: 'Seguimiento detenido',
        description: `No se prepararán más correos para ${candidate.recipientName || candidate.recipientEmail}. Los correos anteriores permanecen en el historial.`,
      });
      void loadInbox({ background: true });
    } catch (error: unknown) {
      const message = caughtErrorMessage(error, 'No pudimos detener el seguimiento.');
      setStopErrors((current) => ({ ...current, [candidate.enrollmentId]: message }));
      setStatusMessage(`No pudimos detener el seguimiento de ${recipientContext(candidate)}.`);
      toast({ title: 'No pudimos detenerlo', description: message, variant: 'destructive' });
    } finally {
      updatePendingIds(setStoppingEnrollmentIds, candidate.enrollmentId, false);
    }
  }

  if (loading && enabled === null) return <InboxSkeleton className={className} />;
  if (enabled === false) return null;

  if (loadError) {
    return (
      <Card className={cn('rounded-2xl border-border/60', className)}>
        <CardContent className="p-4 sm:p-5">
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>No pudimos cargar tus seguimientos</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{loadError}</p>
              <Button ref={retryButtonRef} type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void loadInbox({ focusHeading: true })} disabled={loading}>
                {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (enabled !== true) return null;

  const otherFilter: InboxFilter = filter === 'pending' ? 'attention' : 'pending';
  const otherCount = otherFilter === 'attention' ? summary.attention : summary.pending;
  const stopCandidateIsStopping = stopCandidate
    ? stoppingEnrollmentIds.has(stopCandidate.enrollmentId)
    : false;
  const stopError = stopCandidate ? stopErrors[stopCandidate.enrollmentId] : '';

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</p>
      <section aria-labelledby="campaign-review-inbox-heading" className={className}>
        <Card
          className="overflow-hidden rounded-2xl border-border/60 bg-card/90 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)]"
          aria-busy={refreshing}
        >
          <CardHeader className="gap-4 border-b border-border/60 bg-muted/10 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 ref={headingRef} id="campaign-review-inbox-heading" tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Seguimientos en curso</h2>
                {refreshing ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
                    <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Actualizando
                  </span>
                ) : null}
              </div>
              <CardDescription className="mt-1 max-w-2xl leading-6">
                Revisa el trabajo actual y los bloqueos que necesitan atención. Los seguimientos detenidos o finalizados permanecen en el historial.
              </CardDescription>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                En los {summary.displayed} cargados: {summary.pending} pendientes · {summary.attention} necesitan atención · {summary.campaigns} {summary.campaigns === 1 ? 'campaña' : 'campañas'}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:w-auto" role="group" aria-label="Filtrar seguimientos cargados">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'min-h-11 rounded-lg px-3',
                  filter === 'pending'
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-background'
                    : 'text-slate-700 dark:text-slate-300',
                )}
                aria-pressed={filter === 'pending'}
                aria-controls="campaign-review-inbox-results"
                onClick={() => setFilter('pending')}
              >
                Pendientes <span className="text-xs tabular-nums" aria-hidden="true">{summary.pending}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'min-h-11 rounded-lg px-3',
                  filter === 'attention'
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-background'
                    : 'text-slate-700 dark:text-slate-300',
                )}
                aria-pressed={filter === 'attention'}
                aria-controls="campaign-review-inbox-results"
                onClick={() => setFilter('attention')}
              >
                Atención <span className="text-xs tabular-nums" aria-hidden="true">{summary.attention}</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent id="campaign-review-inbox-results" className="p-0">
            <p className="border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5" role="status" aria-live="polite" aria-atomic="true">
              Mostrando {filteredItems.length} {filter === 'attention' ? 'que necesitan atención' : 'pendientes'} de {summary.displayed} seguimientos cargados.
              {page?.hasMore ? ' Aún puede haber más resultados por cargar.' : ' No quedan más seguimientos en curso por cargar.'}
            </p>

            {refreshError ? (
              <Alert variant="destructive" className="m-4 sm:m-5">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>No pudimos actualizar la bandeja</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{refreshError} Los seguimientos ya cargados siguen disponibles.</p>
                  <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void loadInbox({ background: true })} disabled={refreshing}>
                    {refreshing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                    Reintentar actualización
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {filteredItems.length === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center px-5 py-10 text-center">
                <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">
                  {summary.displayed === 0
                    ? page?.hasMore ? 'No hay seguimientos entre los resultados cargados' : 'No hay seguimientos en curso'
                    : filter === 'attention'
                      ? `Ninguno de los ${summary.displayed} cargados necesita atención`
                      : `No hay pendientes entre los ${summary.displayed} cargados`}
                </h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                  {summary.displayed === 0
                    ? 'Los seguimientos detenidos o finalizados no aparecen en esta vista; sus correos permanecen en el historial.'
                    : otherCount > 0
                      ? `Hay ${otherCount} ${otherFilter === 'attention' ? 'que necesitan atención' : 'pendientes'} en la otra vista.`
                      : page?.hasMore
                        ? 'Aún quedan seguimientos por cargar. Carga más para revisar el resto antes de dar por terminada la búsqueda.'
                        : 'Ya revisaste todos los seguimientos en curso de este filtro.'}
                </p>
                {otherCount > 0 ? (
                  <Button type="button" variant="outline" size="sm" className="mt-4 min-h-11" onClick={() => setFilter(otherFilter)}>
                    Ver {otherFilter === 'attention' ? 'los que necesitan atención' : 'pendientes'} ({otherCount})
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {filteredItems.map((item) => {
                  const action = campaignInboxItemAction(item.state, item.nextAction);
                  const working = workingStepIds.has(item.stepId);
                  const actionable = action.kind === 'prepare' || (action.kind === 'open' && Boolean(item.composeUrl));
                  const canStop = normalizedState(item.state) === 'not_due';
                  const stopping = stoppingEnrollmentIds.has(item.enrollmentId);
                  const rowBusy = working || stopping;
                  const guidance = action.kind === 'none'
                    ? action.guidance
                    : !actionable
                      ? 'El borrador aún no está disponible. Actualiza la bandeja más tarde.'
                      : null;
                  const actionError = actionErrors[item.stepId];
                  const recipient = recipientContext(item);
                  return (
                    <li key={item.stepId} className="p-4 sm:p-5" aria-busy={rowBusy}>
                      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words text-sm font-semibold text-foreground">{item.recipientName || item.recipientEmail}</p>
                            <Badge variant="outline" className={cn('font-medium', stateTone(item.state))}>{stateLabel(item.state)}</Badge>
                          </div>
                          <p className="mt-1 break-words text-sm text-muted-foreground">{item.stepName} · {item.campaignName}</p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">{item.recipientEmail} · {formatDueDate(item.dueAt)}</p>
                          {guidance ? (
                            <p className={cn(
                              'mt-2 max-w-2xl text-xs leading-5',
                              isAttentionItem(item) ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                            )}>
                              {guidance}
                            </p>
                          ) : null}
                        </div>
                        {actionable ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 w-full shrink-0 sm:w-auto"
                            onClick={() => runItemAction(item)}
                            disabled={rowBusy}
                            aria-label={`${working ? 'Preparando borrador' : action.label} para ${recipient}`}
                            aria-describedby={actionError ? `campaign-step-error-${item.stepId}` : undefined}
                          >
                            {working
                              ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                              : action.kind === 'prepare'
                                ? <MailPlus aria-hidden="true" />
                                : <FileCheck2 aria-hidden="true" />}
                            {working ? 'Preparando…' : action.label}
                          </Button>
                        ) : canStop ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 w-full shrink-0 border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:border-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-200 sm:w-auto"
                            onClick={(event) => {
                              stopTriggerRef.current = event.currentTarget;
                              setStopErrors((current) => ({ ...current, [item.enrollmentId]: '' }));
                              setStopCandidate(item);
                            }}
                            disabled={rowBusy}
                            aria-label={`${stopping ? 'Deteniendo' : 'Detener'} seguimiento de ${recipient}`}
                          >
                            {stopping
                              ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                              : <CircleStop aria-hidden="true" />}
                            {stopping ? 'Deteniendo…' : 'Detener'}
                          </Button>
                        ) : null}
                      </div>
                      {actionError ? (
                        <Alert id={`campaign-step-error-${item.stepId}`} variant="destructive" className="mt-3">
                          <AlertTitle>No pudimos continuar</AlertTitle>
                          <AlertDescription>{actionError}</AlertDescription>
                        </Alert>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {page && (summary.displayed > 0 || page.hasMore || loadMoreError) ? (
              <div className="border-t border-border/60 bg-muted/10 px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                <div className="min-w-0">
                  <p className="text-xs leading-5 text-muted-foreground">
                    El resumen y los filtros corresponden a los {summary.displayed} seguimientos cargados.
                    {page.hasMore ? ' Aún quedan seguimientos en curso por cargar.' : ' Ya cargaste todos los seguimientos en curso.'}
                  </p>
                  {loadMoreError ? (
                    <p className="mt-1 text-sm text-destructive" role="alert">{loadMoreError}</p>
                  ) : null}
                </div>
                {page.hasMore && page.nextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 min-h-11 w-full shrink-0 sm:mt-0 sm:w-auto"
                    onClick={() => void loadInbox({ append: true, cursor: page.nextCursor })}
                    disabled={loadingMore || refreshing}
                    aria-busy={loadingMore}
                  >
                    {loadingMore ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                    {loadingMore ? 'Cargando…' : loadMoreError ? 'Reintentar carga' : 'Cargar más'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
      <AlertDialog
        open={Boolean(stopCandidate)}
        onOpenChange={(open) => {
          if (!open) setStopCandidate(null);
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl p-4 [overflow-wrap:anywhere] sm:p-6"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = stopTriggerRef.current;
            if (target?.isConnected) target.focus();
            else headingRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>¿Detener este seguimiento?</AlertDialogTitle>
            <AlertDialogDescription className="break-words leading-6">
              No se prepararán ni enviarán los correos pendientes para {stopCandidate?.recipientName || stopCandidate?.recipientEmail || 'este contacto'}. Los mensajes ya enviados permanecerán en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {stopCandidateIsStopping ? (
            <p className="text-sm leading-6 text-muted-foreground" role="status" aria-live="polite">
              Deteniendo el seguimiento… Puedes cerrar este cuadro; te avisaremos cuando termine.
            </p>
          ) : null}
          {stopError ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos detenerlo</AlertTitle>
              <AlertDescription>{stopError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="min-h-11">{stopCandidateIsStopping ? 'Cerrar' : 'Conservar seguimiento'}</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:text-white dark:hover:bg-red-600"
              disabled={stopCandidateIsStopping}
              aria-busy={stopCandidateIsStopping}
              aria-label={`Detener seguimiento de ${stopCandidate ? recipientContext(stopCandidate) : 'este contacto'}`}
              onClick={(event) => {
                event.preventDefault();
                void stopFollowUp();
              }}
            >
              {stopCandidateIsStopping
                ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : <CircleStop aria-hidden="true" />}
              {stopCandidateIsStopping ? 'Deteniendo…' : 'Detener seguimiento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
