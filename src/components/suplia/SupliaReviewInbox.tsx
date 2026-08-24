'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type ReviewFilter = 'pending' | 'ready' | 'all';
type EmailProvider = 'google' | 'outlook';
type DispatchStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'deferred' | 'unknown' | string;

type ReviewProvenance = {
  conversationId: string | null;
  actionId: string | null;
  requestedProvider: EmailProvider | null;
};

type ReviewRecipient = {
  displayName: string | null;
  email: string | null;
  leadRef: string | null;
};

type ReviewDispatch = {
  id: string;
  status: DispatchStatus | null;
  provider: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
};

type ReviewDraftSummary = {
  draftId: string;
  versionId: string | null;
  ownerUserId: string | null;
  lifecycle: string | null;
  revision: number | null;
  recipient: ReviewRecipient | null;
  subject: string | null;
  approvalStatus: string | null;
  preflightStatus: string | null;
};

type CanonicalEmailDraft = {
  draftId: string;
  versionId: string;
  lifecycle: string;
  revision: number;
  channel: string;
  recipient: ReviewRecipient;
  content: {
    subject: string | null;
    text: string | null;
    html: string | null;
  };
  approval: {
    status: string;
  };
  preflight: {
    status: string;
    errors: string[];
    warnings: string[];
  };
};

type ReviewListItem = {
  id: string;
  itemType: 'outbound_email' | 'antonia_report';
  status: string;
  title: string;
  summary: string;
  severity: string;
  createdAt: string;
  provenance: ReviewProvenance | null;
  email: {
    draft: ReviewDraftSummary | null;
    latestDispatch: ReviewDispatch | null;
  } | null;
  report: {
    reportId: string | null;
    type: string | null;
    createdAt: string | null;
  } | null;
};

type ReviewDetail = Omit<ReviewListItem, 'email' | 'report'> & {
  email: {
    draft: CanonicalEmailDraft | null;
    latestDispatch: ReviewDispatch | null;
  } | null;
  report: {
    reportId: string | null;
    type: string | null;
    createdAt: string | null;
    html: string;
  } | null;
};

type ApiProblem = {
  message: string;
  restricted: boolean;
};

const reviewStatusLabels: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Listo para enviar',
  dismissed: 'Descartado',
  resolved: 'Revisado',
};

const dispatchStatusLabels: Record<string, string> = {
  pending: 'Envío pendiente',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Envío fallido',
  deferred: 'Envío diferido',
  unknown: 'Estado por confirmar',
};

const friendlyApiMessages: Record<string, string> = {
  REVIEW_DRAFT_VERSION_CONFLICT: 'El borrador cambió. Actualiza la revisión antes de continuar.',
  REVIEW_EMAIL_PREFLIGHT_FAILED: 'El correo no superó las validaciones necesarias para aprobarse.',
  REVIEW_EMAIL_SUPPRESSED: 'No es posible enviar a este destinatario desde esta organización.',
  REVIEW_EMAIL_DOMAIN_BLOCKED: 'El dominio de este destinatario está bloqueado para esta organización.',
  REVIEW_ITEM_STATUS_CONFLICT: 'Este elemento cambió mientras lo revisabas. Actualiza la bandeja.',
  REVIEW_ITEM_NOT_APPROVABLE: 'Este correo ya no puede aprobarse.',
  REVIEW_ITEM_NOT_FOUND: 'Este elemento ya no está disponible.',
  REVIEW_DRAFT_NOT_FOUND: 'El borrador ya no está disponible.',
  APPROVED_DRAFT_REQUIRED: 'Selecciona un borrador aprobado antes de enviar.',
};

function normalizedStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function isSent(dispatch?: ReviewDispatch | null) {
  return normalizedStatus(dispatch?.status) === 'sent';
}

function isDispatchInProgress(dispatch?: ReviewDispatch | null) {
  const status = normalizedStatus(dispatch?.status);
  return status === 'pending' || status === 'sending';
}

function isDispatchUnknown(dispatch?: ReviewDispatch | null) {
  return normalizedStatus(dispatch?.status) === 'unknown';
}

function isCanonicalDraftReady(draft?: CanonicalEmailDraft | null) {
  return Boolean(
    draft
    && draft.channel === 'email'
    && draft.lifecycle === 'ready'
    && normalizedStatus(draft.approval.status) === 'approved'
    && normalizedStatus(draft.preflight.status) === 'passed',
  );
}

function isListItemReady(item: ReviewListItem) {
  if (item.itemType !== 'outbound_email' || isSent(item.email?.latestDispatch)) return false;
  const draft = item.email?.draft;
  return item.status === 'approved'
    || (draft?.lifecycle === 'ready' && normalizedStatus(draft.approvalStatus) === 'approved');
}

function formatDate(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function providerLabel(provider?: string | null) {
  if (provider === 'google' || provider === 'gmail') return 'Gmail';
  if (provider === 'outlook') return 'Outlook';
  return 'Sin preferencia';
}

function sourceLabel(item: Pick<ReviewListItem, 'itemType'>) {
  return item.itemType === 'outbound_email' ? 'Correo saliente' : 'Informe ANTONIA';
}

function listTarget(item: ReviewListItem) {
  if (item.itemType === 'antonia_report') {
    return item.report?.type ? `Informe: ${item.report.type}` : item.title || 'Informe ANTONIA';
  }
  const recipient = item.email?.draft?.recipient;
  return recipient?.displayName || recipient?.email || 'Destinatario sin identificar';
}

function dispatchLabel(dispatch?: ReviewDispatch | null) {
  const status = normalizedStatus(dispatch?.status);
  return dispatchStatusLabels[status] || (status ? `Estado: ${status}` : 'Aún no enviado');
}

function providerStatusLabel(dispatch?: ReviewDispatch | null) {
  if (!dispatch?.provider) return dispatchLabel(dispatch);
  return `${dispatchLabel(dispatch)} · ${providerLabel(dispatch.provider)}`;
}

function approvalLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: 'Pendiente de aprobación',
    approved: 'Aprobado',
    rejected: 'No aprobado',
  };
  const normalized = normalizedStatus(status);
  return labels[normalized] || (normalized ? `Estado: ${normalized}` : 'Sin estado');
}

function preflightLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: 'Pendiente de validación',
    passed: 'Validación superada',
    failed: 'Requiere corrección',
  };
  const normalized = normalizedStatus(status);
  return labels[normalized] || (normalized ? `Estado: ${normalized}` : 'Sin estado');
}

function statusTone(status?: string | null) {
  switch (normalizedStatus(status)) {
    case 'approved':
    case 'passed':
    case 'sent':
    case 'resolved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/35 dark:text-emerald-200';
    case 'pending':
    case 'sending':
    case 'deferred':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/35 dark:text-amber-200';
    case 'failed':
    case 'rejected':
    case 'dismissed':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/80 dark:bg-rose-950/35 dark:text-rose-200';
    default:
      return 'border-border bg-muted/55 text-muted-foreground dark:bg-muted/35';
  }
}

function itemStatus(item: { status: string; email: { latestDispatch: ReviewDispatch | null } | null }) {
  const dispatch = item.email?.latestDispatch;
  if (dispatch?.status) return dispatchLabel(dispatch);
  return reviewStatusLabels[normalizedStatus(item.status)] || item.status;
}

function compactId(value?: string | null) {
  return value ? value.slice(0, 8) : null;
}

function problemFromPayload(response: Response, payload: any, fallback: string): ApiProblem {
  const code = typeof payload?.error === 'string' ? payload.error : '';
  if (response.status === 403 || code === 'REVIEW_EMAIL_OWNER_REQUIRED') {
    return {
      restricted: true,
      message: 'Solo la persona propietaria del borrador puede abrir o gestionar este correo.',
    };
  }
  if (response.status === 401) {
    return { restricted: false, message: 'Tu sesión ya no está disponible. Vuelve a iniciar sesión.' };
  }
  return {
    restricted: false,
    message: friendlyApiMessages[code]
      || (typeof payload?.message === 'string' && payload.message.trim())
      || (typeof payload?.error === 'string' && payload.error.trim())
      || fallback,
  };
}

async function responseProblem(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return problemFromPayload(response, payload, fallback);
}

function asApiProblem(error: unknown, fallback: string): ApiProblem {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return {
      message: (error as { message: string }).message,
      restricted: Boolean((error as { restricted?: unknown }).restricted),
    };
  }
  return { restricted: false, message: fallback };
}

function sendFailureMessage(response: Response, payload: any) {
  const dispatchStatus = normalizedStatus(payload?.status);
  if (response.status === 202 || dispatchStatus === 'pending' || dispatchStatus === 'sending') {
    return 'El proveedor aún no confirma el envío. El estado se actualizará en esta bandeja.';
  }
  if (dispatchStatus === 'deferred') {
    return 'El envío quedó diferido. Revisa su estado antes de volver a intentarlo.';
  }
  if (dispatchStatus === 'failed') {
    return 'El proveedor no pudo enviar el correo. Revisa la conexión y vuelve a intentarlo.';
  }
  return problemFromPayload(response, payload, 'No se pudo confirmar el envío.').message;
}

function StatusPill({ label, status }: { label: string; status?: string | null }) {
  return (
    <span className={cn('inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-medium', statusTone(status))}>
      <span className="truncate">{label}</span>
    </span>
  );
}

function InboxRow({ item, selected, disabled, onSelect }: { item: ReviewListItem; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55',
        selected
          ? 'border-primary/35 bg-primary/[0.07] shadow-sm dark:border-primary/45 dark:bg-primary/10'
          : 'border-transparent hover:border-border hover:bg-muted/55 dark:hover:bg-muted/35',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {item.itemType === 'outbound_email' ? <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{sourceLabel(item)}</span>
          </div>
          <div className="mt-1 line-clamp-2 break-words text-sm font-semibold text-foreground">{listTarget(item)}</div>
        </div>
        <time className="shrink-0 pt-0.5 text-[11px] text-muted-foreground" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{item.summary || 'Sin resumen disponible.'}</p>
      <div className="mt-3">
        <StatusPill label={itemStatus(item)} status={item.email?.latestDispatch?.status || item.status} />
      </div>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Cargando revisiones">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border/70 p-3.5">
          <div className="flex items-center justify-between gap-4"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-14" /></div>
          <Skeleton className="mt-3 h-4 w-3/5" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-5 sm:p-7" role="status" aria-label="Cargando detalle de revisión">
      <div className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-3/5" /><Skeleton className="h-4 w-2/5" /></div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="mx-auto flex min-h-[16rem] max-w-md flex-col items-start justify-center px-5 py-12 sm:px-7">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-muted/55 text-muted-foreground dark:bg-muted/35">
        <Inbox className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">Elige una revisión</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Selecciona un correo o informe para ver solo la información necesaria y decidir el siguiente paso.</p>
    </div>
  );
}

function DetailStateRow({ label, value, status }: { label: string; value: string; status?: string | null }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground"><StatusPill label={value} status={status} /></dd>
    </div>
  );
}

export function SupliaReviewInbox() {
  const { toast } = useToast();
  const [items, setItems] = useState<ReviewListItem[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<ApiProblem | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiProblem | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);

  const mountedRef = useRef(true);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const selectedReviewIdRef = useRef<string | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const listPanelRef = useRef<HTMLElement>(null);
  const returnFocusToListRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const response = await fetch('/api/suplia/reviews', { cache: 'no-store' });
      if (!response.ok) throw await responseProblem(response, 'No se pudo cargar la bandeja de revisión.');
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload?.items)) throw new Error('La respuesta de la bandeja no tiene el formato esperado.');
      if (!mountedRef.current || requestId !== listRequestRef.current) return;
      setItems(payload.items as ReviewListItem[]);
    } catch (error) {
      if (!mountedRef.current || requestId !== listRequestRef.current) return;
      setListError(asApiProblem(error, 'No se pudo cargar la bandeja de revisión.'));
    } finally {
      if (mountedRef.current && requestId === listRequestRef.current) setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (reviewId: string) => {
    const requestId = ++detailRequestRef.current;
    if (selectedReviewIdRef.current !== reviewId) return;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const response = await fetch(`/api/suplia/reviews/${encodeURIComponent(reviewId)}`, { cache: 'no-store' });
      if (!response.ok) throw await responseProblem(response, 'No se pudo cargar esta revisión.');
      const payload = await response.json().catch(() => null);
      if (!payload?.item) throw new Error('La respuesta de la revisión no tiene el formato esperado.');
      if (!mountedRef.current || requestId !== detailRequestRef.current || selectedReviewIdRef.current !== reviewId) return;
      setDetail(payload.item as ReviewDetail);
    } catch (error) {
      if (!mountedRef.current || requestId !== detailRequestRef.current || selectedReviewIdRef.current !== reviewId) return;
      setDetailError(asApiProblem(error, 'No se pudo cargar esta revisión.'));
    } finally {
      if (mountedRef.current && requestId === detailRequestRef.current && selectedReviewIdRef.current === reviewId) {
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedReviewId) {
      detailRequestRef.current += 1;
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void loadDetail(selectedReviewId);
  }, [loadDetail, selectedReviewId]);

  const filteredItems = useMemo(() => items.filter((item) => {
    if (filter === 'pending') return item.status === 'pending';
    if (filter === 'ready') return isListItemReady(item);
    return true;
  }), [filter, items]);

  const selectedListItem = useMemo(
    () => items.find((item) => item.id === selectedReviewId) || null,
    [items, selectedReviewId],
  );
  const currentDetail = detail?.id === selectedReviewId ? detail : null;
  const emailDraft = currentDetail?.email?.draft || null;
  const dispatch = currentDetail?.email?.latestDispatch || null;
  const emailReadyToSend = Boolean(
    currentDetail?.itemType === 'outbound_email'
    && currentDetail.status === 'approved'
    && isCanonicalDraftReady(emailDraft)
    && !isSent(dispatch)
    && !isDispatchInProgress(dispatch)
    && !isDispatchUnknown(dispatch),
  );
  const emailCanBeDismissed = Boolean(
    currentDetail?.itemType === 'outbound_email'
    && currentDetail.status !== 'dismissed'
    && currentDetail.status !== 'resolved'
    && !isSent(dispatch),
  );
  const emailCanBeApproved = Boolean(
    currentDetail?.itemType === 'outbound_email'
    && currentDetail.status === 'pending'
    && emailDraft?.versionId,
  );
  const requestedProvider = currentDetail?.provenance?.requestedProvider || null;
  const providers: EmailProvider[] = requestedProvider === 'outlook' ? ['outlook', 'google'] : ['google', 'outlook'];
  const anyActionInFlight = Boolean(activeAction);

  useEffect(() => {
    if (!currentDetail) return;
    const frameId = window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [currentDetail]);

  useEffect(() => {
    if (selectedReviewId || !returnFocusToListRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      returnFocusToListRef.current = false;
      listPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [selectedReviewId]);

  function selectReview(reviewId: string) {
    selectedReviewIdRef.current = reviewId;
    setSelectedReviewId(reviewId);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setDismissConfirmOpen(false);
  }

  function clearSelection() {
    returnFocusToListRef.current = true;
    selectedReviewIdRef.current = null;
    setSelectedReviewId(null);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setDismissConfirmOpen(false);
  }

  async function refreshReview(reviewId: string) {
    await Promise.all([loadList(), loadDetail(reviewId)]);
  }

  async function refreshInbox() {
    setActionError(null);
    await Promise.all([
      loadList(),
      selectedReviewId ? loadDetail(selectedReviewId) : Promise.resolve(),
    ]);
  }

  async function approveEmail() {
    const reviewId = currentDetail?.id;
    const versionId = emailDraft?.versionId;
    if (!reviewId || !versionId || anyActionInFlight) return;

    setActiveAction('approve');
    setActionError(null);
    try {
      const response = await fetch(`/api/suplia/reviews/${encodeURIComponent(reviewId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw problemFromPayload(response, payload, 'No se pudo aprobar el correo.');
      }
      await refreshReview(reviewId);
      toast({ title: 'Correo aprobado', description: 'Ya puedes elegir el proveedor para enviarlo.' });
    } catch (error) {
      const problem = asApiProblem(error, 'No se pudo aprobar el correo.');
      if (problem.restricted) {
        setDetail(null);
        setDetailError(problem);
      } else {
        setActionError(problem.message);
      }
      toast({ variant: 'destructive', title: 'No se pudo aprobar', description: problem.message });
    } finally {
      if (mountedRef.current) setActiveAction(null);
    }
  }

  async function sendEmail(provider: EmailProvider) {
    const reviewId = currentDetail?.id;
    const draft = emailDraft;
    if (!reviewId || !draft || !emailReadyToSend || anyActionInFlight) return;

    setActiveAction(`send-${provider}`);
    setActionError(null);
    try {
      const response = await fetch('/api/providers/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          draftId: draft.draftId,
          versionId: draft.versionId,
          idempotencyKey: `suplia:review:${draft.draftId}:${draft.versionId}`,
        }),
      });
      const payload = await response.json().catch(() => null);
      const confirmedSent = response.status === 200 && payload?.success === true && payload?.status === 'sent';
      if (!confirmedSent) {
        await refreshReview(reviewId);
        throw new Error(sendFailureMessage(response, payload));
      }
      await refreshReview(reviewId);
      toast({ title: 'Correo enviado', description: `Se confirmó el envío con ${providerLabel(provider)}.` });
    } catch (error) {
      const message = asApiProblem(error, 'No se pudo confirmar el envío.').message;
      setActionError(message);
      toast({ variant: 'destructive', title: 'Envío sin confirmar', description: message });
    } finally {
      if (mountedRef.current) setActiveAction(null);
    }
  }

  async function updateStatus(status: 'dismissed' | 'resolved') {
    const reviewId = currentDetail?.id;
    if (!reviewId || anyActionInFlight) return;

    setActiveAction(status);
    setActionError(null);
    try {
      const response = await fetch(`/api/suplia/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw await responseProblem(response, 'No se pudo actualizar esta revisión.');
      await refreshReview(reviewId);
      toast({
        title: status === 'resolved' ? 'Informe revisado' : 'Elemento descartado',
        description: status === 'resolved' ? 'El informe quedó marcado como revisado.' : 'Este elemento ya no aparecerá entre los pendientes.',
      });
    } catch (error) {
      const problem = asApiProblem(error, 'No se pudo actualizar esta revisión.');
      if (problem.restricted) {
        setDetail(null);
        setDetailError(problem);
      } else {
        setActionError(problem.message);
      }
      toast({ variant: 'destructive', title: 'No se pudo actualizar', description: problem.message });
    } finally {
      if (mountedRef.current) setActiveAction(null);
    }
  }

  function confirmDismiss() {
    setDismissConfirmOpen(false);
    void updateStatus('dismissed');
  }

  const emptyCopy = filter === 'pending'
    ? { title: 'No hay revisiones pendientes', description: 'Los nuevos borradores e informes aparecerán aquí cuando estén listos para revisar.' }
    : filter === 'ready'
      ? { title: 'No hay correos listos para enviar', description: 'Un correo aparece aquí después de quedar aprobado y validado.' }
      : { title: 'La bandeja está al día', description: 'Todavía no hay borradores ni informes para mostrar.' };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border/80 bg-background/95 px-4 py-4 pl-16 backdrop-blur-sm sm:px-6 sm:pl-20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground">
              <Link href="/suplia"><ChevronLeft className="h-4 w-4" />Volver a SUPL.IA</Link>
            </Button>
            <div className="mt-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Bandeja de revisión</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Aprueba correos salientes y revisa informes de ANTONIA en un solo lugar.</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {items.length} {items.length === 1 ? 'elemento' : 'elementos'}
            </span>
            <Button variant="outline" size="sm" onClick={refreshInbox} disabled={listLoading || anyActionInFlight}>
              <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
              Actualizar
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section
          ref={listPanelRef}
          tabIndex={-1}
          className={cn(
            'flex shrink-0 flex-col border-b border-border/80 bg-muted/[0.16] lg:min-h-0 lg:w-[22rem] lg:border-b-0 lg:border-r xl:w-[25rem]',
            selectedReviewId && 'hidden lg:flex',
          )}
          aria-label="Lista de revisiones"
          aria-busy={listLoading}
        >
          <div className="shrink-0 px-4 pb-3 pt-4 sm:px-5">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as ReviewFilter)}>
              <TabsList aria-label="Filtrar revisiones" className="grid h-auto w-full grid-cols-3 rounded-xl p-1">
                <TabsTrigger value="pending" className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-4 sm:text-sm">Pendientes</TabsTrigger>
                <TabsTrigger value="ready" className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-4 sm:text-sm">Listos para enviar</TabsTrigger>
                <TabsTrigger value="all" className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-4 sm:text-sm">Todo</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <Separator />

          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {listError ? (
              <div className="p-3">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>No se pudo cargar la bandeja</AlertTitle>
                  <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span>{listError.message}</span>
                    {!listError.restricted && <Button variant="outline" size="sm" onClick={loadList} disabled={listLoading}>Reintentar</Button>}
                  </AlertDescription>
                </Alert>
              </div>
            ) : listLoading && items.length === 0 ? <ListSkeleton /> : filteredItems.length === 0 ? (
              <div className="px-5 py-12">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground dark:bg-card">
                  <Inbox className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-semibold">{emptyCopy.title}</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">{emptyCopy.description}</p>
              </div>
            ) : (
              <div className={cn('space-y-1 p-2.5', listLoading && 'opacity-60')} aria-busy={listLoading}>
                {filteredItems.map((item) => (
                  <InboxRow key={item.id} item={item} selected={item.id === selectedReviewId} disabled={anyActionInFlight} onSelect={() => selectReview(item.id)} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section
          className={cn('flex min-h-0 flex-1 flex-col bg-background', !selectedReviewId && 'hidden lg:flex')}
          aria-label="Detalle de revisión"
          aria-busy={detailLoading || anyActionInFlight}
        >
          <div className="shrink-0 border-b border-border/80 px-4 py-2 lg:hidden">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground" onClick={clearSelection}>
              <ChevronLeft className="h-4 w-4" />
              Volver a revisiones
            </Button>
          </div>
          <div className="min-h-[18rem] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {!selectedReviewId ? listLoading && items.length === 0 ? <DetailSkeleton /> : <DetailPlaceholder /> : detailLoading ? <DetailSkeleton /> : detailError ? (
              <div className="mx-auto max-w-2xl p-5 sm:p-7">
                <Alert variant={detailError.restricted ? 'default' : 'destructive'}>
                  {detailError.restricted ? <XCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  <AlertTitle>{detailError.restricted ? 'Esta revisión es privada' : 'No se pudo abrir la revisión'}</AlertTitle>
                  <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span>{detailError.message}</span>
                    {!detailError.restricted && <Button variant="outline" size="sm" onClick={() => selectedReviewId && loadDetail(selectedReviewId)}>Reintentar</Button>}
                  </AlertDescription>
                </Alert>
              </div>
            ) : currentDetail?.itemType === 'outbound_email' ? (
              <article className="mx-auto w-full max-w-3xl space-y-6 p-5 sm:p-7">
                <header>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Mail className="h-4 w-4" />Correo saliente</span>
                    <StatusPill label={itemStatus(currentDetail)} status={dispatch?.status || currentDetail.status} />
                  </div>
                  <h2 ref={detailHeadingRef} tabIndex={-1} className="mt-3 break-words text-xl font-semibold tracking-tight sm:text-2xl">{emailDraft?.recipient.displayName || emailDraft?.recipient.email || currentDetail.title || 'Correo para revisión'}</h2>
                  <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{currentDetail.summary || 'Revisa el borrador antes de aprobarlo o enviarlo.'}</p>
                </header>

                {!emailDraft ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>El borrador ya no está disponible</AlertTitle>
                    <AlertDescription>Solo puedes descartar esta revisión; no hay contenido canónico para aprobar ni enviar.</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-border/90">
                      <dl className="space-y-3 text-sm">
                        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
                          <dt className="text-muted-foreground">Para</dt>
                          <dd className="break-words font-medium text-foreground">{emailDraft.recipient.displayName || 'Sin nombre'}{emailDraft.recipient.email ? ` · ${emailDraft.recipient.email}` : ''}</dd>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
                          <dt className="text-muted-foreground">Asunto</dt>
                          <dd className="break-words font-medium text-foreground">{emailDraft.content.subject || 'Sin asunto'}</dd>
                        </div>
                      </dl>
                    </section>

                    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-border/90" aria-labelledby="email-body-heading">
                      <div className="flex items-center justify-between gap-4">
                        <h3 id="email-body-heading" className="text-sm font-semibold">Mensaje</h3>
                        <span className="text-xs text-muted-foreground">Texto sin formato</span>
                      </div>
                      <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">{emailDraft.content.text || 'Este borrador no incluye una versión de texto para mostrar.'}</pre>
                    </section>

                    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-border/90" aria-labelledby="email-state-heading">
                      <h3 id="email-state-heading" className="text-sm font-semibold">Estado</h3>
                      <dl className="mt-2">
                        <DetailStateRow label="Aprobación" value={approvalLabel(emailDraft.approval.status)} status={emailDraft.approval.status} />
                        <DetailStateRow label="Validación" value={preflightLabel(emailDraft.preflight.status)} status={emailDraft.preflight.status} />
                        <DetailStateRow label="Proveedor" value={providerStatusLabel(dispatch)} status={dispatch?.status} />
                      </dl>
                      {normalizedStatus(emailDraft.preflight.status) === 'failed' && emailDraft.preflight.errors.length > 0 && (
                        <p className="mt-3 text-sm leading-6 text-rose-700 dark:text-rose-300">{emailDraft.preflight.errors.slice(0, 2).join(' ')}</p>
                      )}
                    </section>

                    <section className="rounded-2xl border border-border bg-muted/[0.25] p-4 dark:bg-muted/20" aria-labelledby="email-source-heading">
                      <h3 id="email-source-heading" className="text-sm font-semibold">Origen</h3>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div><dt className="text-muted-foreground">Fuente</dt><dd className="mt-1 font-medium">SUPL.IA</dd></div>
                        <div><dt className="text-muted-foreground">Proveedor solicitado</dt><dd className="mt-1 font-medium">{providerLabel(currentDetail.provenance?.requestedProvider)}</dd></div>
                        {compactId(currentDetail.provenance?.conversationId) && <div><dt className="text-muted-foreground">Conversación</dt><dd className="mt-1 font-mono text-xs font-medium">{compactId(currentDetail.provenance?.conversationId)}</dd></div>}
                        {compactId(currentDetail.provenance?.actionId) && <div><dt className="text-muted-foreground">Acción</dt><dd className="mt-1 font-mono text-xs font-medium">{compactId(currentDetail.provenance?.actionId)}</dd></div>}
                      </dl>
                    </section>
                  </>
                )}

                <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-border/90" aria-label="Acciones del correo" aria-busy={anyActionInFlight}>
                  {actionError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>La acción no se completó</AlertTitle>
                      <AlertDescription>{actionError}</AlertDescription>
                    </Alert>
                  )}

                  {isSent(dispatch) ? (
                    <div className="flex items-start gap-3 text-sm leading-6 text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>El proveedor confirmó este envío. El historial se actualiza automáticamente.</p>
                    </div>
                  ) : isDispatchInProgress(dispatch) ? (
                    <div className="flex items-start gap-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
                      <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>{dispatchLabel(dispatch)}. Espera la confirmación antes de intentar otro envío.</p>
                    </div>
                  ) : isDispatchUnknown(dispatch) ? (
                    <div className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>El estado del último envío aún no se puede confirmar. Actualiza la bandeja antes de volver a intentar.</p>
                    </div>
                  ) : currentDetail.status === 'dismissed' ? (
                    <p className="text-sm leading-6 text-muted-foreground">Este correo está descartado y no se enviará.</p>
                  ) : emailCanBeApproved ? (
                    <div>
                      <p className="mb-3 text-sm leading-6 text-muted-foreground">La aprobación valida la versión actual del borrador. Podrás elegir el proveedor después.</p>
                      <Button onClick={approveEmail} disabled={anyActionInFlight}>
                        {activeAction === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {activeAction === 'approve' ? 'Aprobando correo…' : 'Aprobar correo'}
                      </Button>
                    </div>
                  ) : emailReadyToSend && emailDraft ? (
                    <div>
                      <p className="mb-3 text-sm leading-6 text-muted-foreground">Elige cómo enviar esta versión aprobada. El contenido se toma del borrador canónico.</p>
                      {normalizedStatus(dispatch?.status) === 'failed' || normalizedStatus(dispatch?.status) === 'deferred' ? (
                        <p className="mb-3 text-sm leading-6 text-amber-800 dark:text-amber-200">{dispatchLabel(dispatch)}. Puedes volver a intentar el envío.</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {providers.map((provider, index) => (
                          <Button
                            key={provider}
                            variant={index === 0 ? 'default' : 'outline'}
                            onClick={() => sendEmail(provider)}
                            disabled={anyActionInFlight}
                          >
                            {activeAction === `send-${provider}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {activeAction === `send-${provider}` ? 'Enviando…' : `Enviar con ${providerLabel(provider)}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">Este correo debe estar aprobado y validado antes de poder enviarse.</p>
                  )}

                  {emailCanBeDismissed && (
                    <>
                      <Separator className="my-5" />
                      <Button variant="ghost" size="sm" onClick={() => setDismissConfirmOpen(true)} disabled={anyActionInFlight} className="text-rose-800 hover:bg-rose-100 hover:text-rose-900 dark:text-rose-200 dark:hover:bg-rose-950/60 dark:hover:text-rose-100">
                        {activeAction === 'dismissed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                        Descartar
                      </Button>
                    </>
                  )}
                </section>
              </article>
            ) : currentDetail?.itemType === 'antonia_report' ? (
              <article className="mx-auto w-full max-w-4xl space-y-6 p-5 sm:p-7">
                <header>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileText className="h-4 w-4" />Informe ANTONIA</span>
                    <StatusPill label={reviewStatusLabels[normalizedStatus(currentDetail.status)] || currentDetail.status} status={currentDetail.status} />
                  </div>
                  <h2 ref={detailHeadingRef} tabIndex={-1} className="mt-3 break-words text-xl font-semibold tracking-tight sm:text-2xl">{currentDetail.title || currentDetail.report?.type || 'Informe de ANTONIA'}</h2>
                  <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{currentDetail.summary || 'Informe generado por ANTONIA para tu revisión.'}</p>
                  <p className="mt-3 text-xs text-muted-foreground">Generado {formatDate(currentDetail.report?.createdAt || currentDetail.createdAt)} · Solo lectura</p>
                </header>

                <section className="overflow-hidden rounded-2xl border border-border bg-muted/[0.18] p-2 shadow-sm dark:bg-muted/15" aria-label="Vista previa del informe">
                  {currentDetail.report?.html ? (
                    <iframe
                      title={currentDetail.title || 'Informe de ANTONIA'}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={currentDetail.report.html}
                      loading="lazy"
                      className="min-h-[32rem] w-full rounded-xl border border-border bg-background"
                    />
                  ) : (
                    <div className="flex min-h-56 items-center justify-center px-5 text-center text-sm leading-6 text-muted-foreground">Este informe no tiene contenido disponible.</div>
                  )}
                </section>

                <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-border/90" aria-label="Acciones del informe" aria-busy={anyActionInFlight}>
                  {actionError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>La acción no se completó</AlertTitle>
                      <AlertDescription>{actionError}</AlertDescription>
                    </Alert>
                  )}
                  {currentDetail.status !== 'resolved' && currentDetail.status !== 'dismissed' ? (
                    <div>
                      <p className="mb-3 text-sm leading-6 text-muted-foreground">Marca el informe cuando hayas terminado de revisarlo. No genera ningún envío.</p>
                      <Button onClick={() => updateStatus('resolved')} disabled={anyActionInFlight}>
                        {activeAction === 'resolved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {activeAction === 'resolved' ? 'Marcando…' : 'Marcar como revisado'}
                      </Button>
                      <Separator className="my-5" />
                      <Button variant="ghost" size="sm" onClick={() => setDismissConfirmOpen(true)} disabled={anyActionInFlight} className="text-rose-800 hover:bg-rose-100 hover:text-rose-900 dark:text-rose-200 dark:hover:bg-rose-950/60 dark:hover:text-rose-100">
                        {activeAction === 'dismissed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                        Descartar
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">Este informe ya está {currentDetail.status === 'resolved' ? 'marcado como revisado' : 'descartado'}.</p>
                  )}
                </section>
              </article>
            ) : selectedListItem ? (
              <div className="p-5 text-sm text-muted-foreground">No se pudo preparar el detalle de este elemento.</div>
            ) : <DetailPlaceholder />}
          </div>
        </section>
      </div>
      <AlertDialog open={dismissConfirmOpen} onOpenChange={setDismissConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar esta revisión?</AlertDialogTitle>
            <AlertDialogDescription>
              El elemento dejará de aparecer entre los pendientes. Un correo descartado no se enviará.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anyActionInFlight}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-500"
              disabled={anyActionInFlight}
              onClick={confirmDismiss}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
