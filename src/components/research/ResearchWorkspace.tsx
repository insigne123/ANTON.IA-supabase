'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import NativeResearchReport from '@/components/research/NativeResearchReport';
import { ResearchReportProgress } from '@/components/research/ResearchReportProgress';
import { researchDetailLoadingState, researchItemPresentation } from '@/lib/research-report-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import {
  MAX_RESEARCH_BATCH_SIZE,
  createQueuedResearchWorkspaceRun,
  isResearchInFlight,
  isSellerProfileIncompleteDraftError,
  parseResearchWorkspaceRun,
  parseResearchReportDetail,
  researchDraftErrorMessage,
  researchReadinessLabel,
  researchStatusLabel,
  shouldPollResearchRun,
  type ResearchReadiness,
  type ResearchReportDetail,
  type ResearchWorkspaceLead,
  type ResearchWorkspaceRun,
  type ResearchWorkspaceRunItem,
  type ResearchWorkspaceStatus,
} from '@/lib/research-workspace';
import {
  clearResearchWorkspaceHandoff,
  readResearchWorkspaceHandoff,
  type ResearchWorkspaceHandoff,
} from '@/lib/research-workspace-handoff';
import { getEnrichedLeads } from '@/lib/services/enriched-leads-service';
import { getEnrichedOpportunities } from '@/lib/services/enriched-opportunities-service';
import type { EnrichedLead } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  RESEARCH_RAIL_PAGE_SIZE,
  mergeResearchRunItems,
  paginateResearchRail,
  researchItemsFromLeadStatuses,
} from '@/components/research/research-workspace-ui';

const LEGACY_ACTIVE_BATCH_STORAGE_KEY = 'anton.research.active-batch.v1';
const ACTIVE_BATCH_STORAGE_PREFIX = 'anton.research.active-batch.v2';
const ACTIVE_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

type ResearchableLead = Pick<
  EnrichedLead,
  | 'id'
  | 'fullName'
  | 'email'
  | 'title'
  | 'headline'
  | 'seniority'
  | 'departments'
  | 'linkedinUrl'
   | 'companyName'
   | 'companyDomain'
   | 'companyWebsite'
   | 'companyLinkedinUrl'
   | 'descriptionSnippet'
   | 'industry'
   | 'organizationDomain'
  | 'organizationIndustry'
  | 'organizationSize'
  | 'city'
  | 'country'
>;

type StoredResearchBatch = {
  runId: string;
  scope: 'leads' | 'opportunities';
  leads: ResearchWorkspaceLead[];
  createdAt: string;
};

function leadKey(lead: ResearchableLead) {
  return String(lead.id || lead.email || `${lead.fullName}:${lead.companyName}`).trim();
}

function workspaceLead(lead: ResearchableLead): ResearchWorkspaceLead {
  return {
    key: leadKey(lead),
    id: lead.id || null,
    fullName: lead.fullName || null,
    email: lead.email || null,
    title: lead.title || null,
    headline: lead.headline || null,
    seniority: lead.seniority || null,
    departments: lead.departments || null,
    linkedinUrl: lead.linkedinUrl || null,
    companyName: lead.companyName || null,
    companyDomain: lead.organizationDomain || lead.companyDomain || lead.companyWebsite || (lead.email?.split('@')[1] || null),
    companyWebsite: lead.companyWebsite || null,
    companyLinkedinUrl: lead.companyLinkedinUrl || null,
    descriptionSnippet: lead.descriptionSnippet || null,
    industry: lead.industry || null,
    organizationIndustry: lead.organizationIndustry || null,
    organizationSize: lead.organizationSize || null,
    city: lead.city || null,
    country: lead.country || null,
  };
}

function normalizeEmail(value?: string | null) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeUrl(value?: string | null) {
  const url = String(value || '').trim();
  if (!url) return null;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function researchLeadCheckboxId(key: string) {
  return `research-lead-${encodeURIComponent(key)}`;
}

function researchLeadButtonId(key: string) {
  return `research-lead-report-${encodeURIComponent(key)}`;
}

function toResearchLead(lead: ResearchWorkspaceLead) {
  return {
    id: lead.id || null,
    fullName: lead.fullName || null,
    email: normalizeEmail(lead.email),
    title: lead.title || null,
    headline: lead.headline || null,
    seniority: lead.seniority || null,
    departments: Array.isArray(lead.departments) ? lead.departments.filter(Boolean) : null,
    linkedinUrl: normalizeUrl(lead.linkedinUrl),
    companyName: lead.companyName || null,
    companyDomain: lead.companyDomain || lead.companyWebsite || (normalizeEmail(lead.email)?.split('@')[1] || null),
    companyWebsite: normalizeUrl(lead.companyWebsite),
    companyLinkedinUrl: normalizeUrl(lead.companyLinkedinUrl),
    descriptionSnippet: lead.descriptionSnippet || null,
    industry: lead.industry || null,
    organizationIndustry: lead.organizationIndustry || lead.industry || null,
    organizationSize: lead.organizationSize || null,
    city: lead.city || null,
    country: lead.country || null,
  };
}

function statusClass(status: ResearchWorkspaceStatus) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100';
  if (status === 'partial' || status === 'insufficient_data') return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
  if (status === 'failed' || status === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100';
  if (status === 'queued' || status === 'running') return 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100';
  return 'border-border bg-muted/40 text-muted-foreground';
}

function readinessClass(readiness: ResearchReadiness) {
  if (readiness === 'ready') return 'text-emerald-700 dark:text-emerald-300';
  if (readiness === 'in_progress') return 'text-sky-700 dark:text-sky-300';
  if (readiness === 'needs_attention') return 'text-rose-700 dark:text-rose-300';
  if (readiness === 'limited' || readiness === 'missing_evidence' || readiness === 'missing_email' || readiness === 'contact_limit') return 'text-amber-700 dark:text-amber-300';
  return 'text-muted-foreground';
}

function progressFor(status: ResearchWorkspaceStatus) {
  if (status === 'running') return 58;
  if (status === 'queued') return 18;
  return 0;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function activeBatchStorageKey(userId: string, organizationId: string | null, scope: 'leads' | 'opportunities') {
  return `${ACTIVE_BATCH_STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId || 'personal')}:${scope}`;
}

function readStoredBatch(scope: 'leads' | 'opportunities', userId: string, organizationId: string | null): StoredResearchBatch | null {
  if (typeof window === 'undefined') return null;
  try {
    window.localStorage.removeItem(LEGACY_ACTIVE_BATCH_STORAGE_KEY);
    const key = activeBatchStorageKey(userId, organizationId, scope);
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
    const runId = String(parsed?.runId || '').trim();
    const storedScope = parsed?.scope === 'opportunities' ? 'opportunities' : 'leads';
    const leads = Array.isArray(parsed?.leads) ? parsed.leads.filter((lead: unknown) => typeof (lead as any)?.key === 'string') : [];
    const createdAt = String(parsed?.createdAt || '');
    const createdAtMs = Date.parse(createdAt);
    if (storedScope !== scope || !runId || leads.length === 0 || !Number.isFinite(createdAtMs) || Date.now() - createdAtMs > ACTIVE_BATCH_TTL_MS || createdAtMs - Date.now() > 60_000) {
      window.localStorage.removeItem(key);
      return null;
    }
    return { scope: storedScope, runId, leads, createdAt: String(parsed?.createdAt || '') };
  } catch {
    return null;
  }
}

function storeBatch(batch: StoredResearchBatch, userId: string, organizationId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(activeBatchStorageKey(userId, organizationId, batch.scope), JSON.stringify(batch));
  } catch {
    // The server-side batch remains available even when browser storage is unavailable.
  }
}

function removeStoredBatch(scope: 'leads' | 'opportunities', userId: string, organizationId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(activeBatchStorageKey(userId, organizationId, scope));
  } catch {
    // Nothing else is needed when storage is unavailable.
  }
}

function friendlyRequestError(payload: any, fallback: string) {
  const code = String(payload?.error || payload?.code || '').toLowerCase();
  if (code.includes('auth')) return 'Tu sesión ya no está disponible. Vuelve a iniciar sesión e inténtalo nuevamente.';
  if (code.includes('quota')) return 'Alcanzaste el límite disponible para investigar por ahora. Inténtalo más tarde.';
  if (code.includes('privacy') || code.includes('suppressed')) return 'No podemos continuar con este contacto por sus preferencias de privacidad.';
  if (code.includes('setup') || code.includes('metadata')) return 'No pudimos preparar el borrador todavía. Inténtalo nuevamente en unos minutos.';
  const resultMessage = String(payload?.result?.message || '').trim();
  if (resultMessage && resultMessage.length <= 300) return resultMessage;
  return fallback;
}

function userMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return /^(Tu sesión|Alcanzaste|No podemos|No pudimos)/.test(message) ? message : fallback;
}

function activeBatchLeads(batch: StoredResearchBatch | null, currentLeads: ResearchWorkspaceLead[]) {
  if (!batch) return [];
  const byKey = new Map(currentLeads.map((lead) => [lead.key, lead]));
  return batch.leads.map((lead) => {
    const current = byKey.get(lead.key);
    return current ? { ...lead, ...current, key: lead.key } : lead;
  });
}

function mergeWorkspaceLeads(currentLeads: ResearchWorkspaceLead[], handoffLeads: ResearchWorkspaceLead[]) {
  const byKey = new Map(currentLeads.map((lead) => [lead.key, lead]));
  handoffLeads.forEach((lead) => {
    byKey.set(lead.key, { ...byKey.get(lead.key), ...lead });
  });
  return Array.from(byKey.values());
}

function handoffId(handoff: ResearchWorkspaceHandoff) {
  return `${handoff.source}:${handoff.createdAt}:${handoff.leadIds.join('|')}`;
}

export type ResearchWorkspaceProps = {
  embedded?: boolean;
  onClose?: () => void;
  scope?: 'leads' | 'opportunities';
};

export default function ResearchWorkspace({ embedded = false, onClose, scope = 'leads' }: ResearchWorkspaceProps) {
  const scopeLabel = scope === 'opportunities' ? 'oportunidades' : 'leads';
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [leads, setLeads] = useState<ResearchableLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [railPage, setRailPage] = useState(1);
  const [mobilePane, setMobilePane] = useState<'list' | 'report'>('list');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeLeadKey, setActiveLeadKey] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<StoredResearchBatch | null>(null);
  const [activeRun, setActiveRun] = useState<ResearchWorkspaceRun | null>(null);
  const [persistedItems, setPersistedItems] = useState<ResearchWorkspaceRunItem[]>([]);
  const [persistedItemsLoading, setPersistedItemsLoading] = useState(false);
  const [persistedItemsError, setPersistedItemsError] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');
  const [startError, setStartError] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<string | null>(null);
  const [profileRequiredItemId, setProfileRequiredItemId] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState<Record<string, ResearchReportDetail>>({});
  const [reportDetailLoading, setReportDetailLoading] = useState<Record<string, boolean>>({});
  const [reportDetailErrors, setReportDetailErrors] = useState<Record<string, string>>({});
  const [researchUnavailable, setResearchUnavailable] = useState(false);
  const [handoff, setHandoff] = useState<ResearchWorkspaceHandoff | null>(null);
  const [handoffLeads, setHandoffLeads] = useState<ResearchWorkspaceLead[]>([]);
  const [handoffSelectionKeys, setHandoffSelectionKeys] = useState<string[]>([]);
  const [handoffReady, setHandoffReady] = useState(false);
  const [handoffResolved, setHandoffResolved] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const currentRunIdRef = useRef<string | null>(null);
  const runRequestRef = useRef<string | null>(null);
  const reportDetailRequestsRef = useRef<Set<string>>(new Set());
  const reportDetailControllersRef = useRef(new Set<AbortController>());
  useEffect(() => () => {
    reportDetailControllersRef.current.forEach((controller) => controller.abort());
    reportDetailControllersRef.current.clear();
    reportDetailRequestsRef.current.clear();
  }, []);
  const draftRequestRef = useRef<string | null>(null);
  const resolvedHandoffRef = useRef<string | null>(null);
  const persistedItemsRequestRef = useRef(0);
  const pendingReportFocusRef = useRef(false);
  const pendingRailFocusKeyRef = useRef<string | null>(null);

  const loadPersistedResearchItems = useCallback(async (nextLeads: ResearchWorkspaceLead[]) => {
    const requestId = ++persistedItemsRequestRef.current;
    const leadIds = Array.from(new Set(nextLeads.map((lead) => String(lead.id || '').trim()).filter(Boolean)));
    setPersistedItemsLoading(true);
    setPersistedItemsError('');
    if (leadIds.length === 0) {
      setPersistedItems([]);
      setPersistedItemsLoading(false);
      return;
    }

    try {
      const chunks = Array.from(
        { length: Math.ceil(leadIds.length / 200) },
        (_, index) => leadIds.slice(index * 200, (index + 1) * 200),
      );
      const responses = await Promise.all(chunks.map(async (chunk) => {
        const response = await fetch('/api/native-research/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: chunk }),
        });
        if (!response.ok) throw new Error('NATIVE_RESEARCH_LEAD_STATUS_FAILED');
        const payload = await response.json().catch(() => null);
        return Array.isArray(payload?.items) ? payload.items as NativeResearchLeadStatus[] : [];
      }));
      if (persistedItemsRequestRef.current !== requestId) return;
      setPersistedItems(researchItemsFromLeadStatuses(responses.flat(), nextLeads));
    } catch {
      if (persistedItemsRequestRef.current !== requestId) return;
      setPersistedItemsError('No pudimos recuperar algunos reportes anteriores.');
    } finally {
      if (persistedItemsRequestRef.current === requestId) setPersistedItemsLoading(false);
    }
  }, []);

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    setLoadError('');
    try {
      const result = scope === 'opportunities' ? await getEnrichedOpportunities() : await getEnrichedLeads();
      const nextLeads = (Array.isArray(result) ? result : []) as ResearchableLead[];
      const nextWorkspaceLeads = nextLeads.map(workspaceLead);
      setLeads(nextLeads);
      setActiveLeadKey((current) => current || (nextLeads[0] ? leadKey(nextLeads[0]) : null));
      void loadPersistedResearchItems(nextWorkspaceLeads);
    } catch {
      setLoadError('No pudimos cargar tus leads. Inténtalo nuevamente para continuar.');
    } finally {
      setLoadingLeads(false);
    }
  }, [loadPersistedResearchItems, scope]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    const result = readResearchWorkspaceHandoff();
    if (!result.ok) {
      setHandoffError(result.message);
      setHandoffResolved(true);
      setHandoffReady(true);
      return;
    }

    const expectedSource = scope === 'opportunities' ? 'enriched-opportunities' : 'enriched-leads';
    if (result.handoff && result.handoff.source !== expectedSource) {
      clearResearchWorkspaceHandoff();
      setHandoff(null);
      setHandoffResolved(true);
    } else {
      setHandoff(result.handoff);
      setHandoffResolved(result.handoff === null);
    }
    setHandoffReady(true);
  }, [scope]);

  useEffect(() => {
    if (authLoading || !user?.id) return;
    const stored = readStoredBatch(scope, user.id, organizationId);
    if (!stored) return;
    currentRunIdRef.current = stored.runId;
    setActiveBatch(stored);
    setActiveLeadKey((current) => current || stored.leads[0]?.key || null);
  }, [authLoading, organizationId, scope, user?.id]);

  const resolveHandoff = useCallback((nextHandoff: ResearchWorkspaceHandoff, sourceLeads: ResearchableLead[]) => {
    const id = handoffId(nextHandoff);
    if (resolvedHandoffRef.current === id) return;

    const leadsById = new Map(sourceLeads.map((lead) => [lead.id, lead]));
    const selectedSourceLeads = nextHandoff.leadIds.map((leadId) => leadsById.get(leadId));
    if (selectedSourceLeads.some((lead) => !lead)) {
      clearResearchWorkspaceHandoff();
      setHandoff(null);
      setHandoffNotice('');
      setHandoffError('La selección cambió antes de abrir la investigación. No iniciamos ningún lote; vuelve a la lista y selecciónala nuevamente.');
      setHandoffResolved(true);
      resolvedHandoffRef.current = id;
      return;
    }

    const selectedWorkspaceLeads = (selectedSourceLeads as ResearchableLead[]).map(workspaceLead);
    setHandoffLeads(selectedWorkspaceLeads);
    setHandoffSelectionKeys(selectedWorkspaceLeads.map((lead) => lead.key));
    setHandoffNotice(`Trajimos ${pluralize(selectedWorkspaceLeads.length, 'lead')} a esta selección. Revísala y comienza cuando estés listo.`);
    setHandoffError('');
    setHandoffResolved(true);
    resolvedHandoffRef.current = id;
  }, []);

  useEffect(() => {
    const expectedSource = scope === 'opportunities' ? 'enriched-opportunities' : 'enriched-leads';
    if (!handoff || handoff.source !== expectedSource || handoffResolved || loadingLeads || loadError) return;
    resolveHandoff(handoff, leads);
  }, [handoff, handoffResolved, leads, loadError, loadingLeads, resolveHandoff, scope]);

  const workspaceLeads = useMemo(
    () => mergeWorkspaceLeads(leads.map(workspaceLead), handoffLeads),
    [handoffLeads, leads],
  );
  const batchLeads = useMemo(() => activeBatchLeads(activeBatch, workspaceLeads), [activeBatch, workspaceLeads]);

  const fetchRun = useCallback(async (runId: string, batch: ResearchWorkspaceLead[], showLoading: boolean) => {
    if (runRequestRef.current === runId) return;
    runRequestRef.current = runId;
    if (showLoading) setRunLoading(true);
    setRunError('');

    try {
      const response = await fetch(`/api/native-research/run/${encodeURIComponent(runId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 404 && payload?.error === 'NATIVE_RESEARCH_RUN_NOT_FOUND' && currentRunIdRef.current === runId) {
          currentRunIdRef.current = null;
          setActiveBatch(null);
          setActiveRun(null);
          if (user?.id) removeStoredBatch(scope, user.id, organizationId);
          setRunError('No pudimos recuperar la investigación guardada. Puedes iniciar una nueva selección.');
          if (showLoading) setRunLoading(false);
          return;
        }
        throw new Error(friendlyRequestError(payload, 'No pudimos actualizar el estado de la investigación.'));
      }
      const run = parseResearchWorkspaceRun(payload, batch);
      if (!run) throw new Error('No pudimos leer el estado de la investigación.');
      if (currentRunIdRef.current === runId) setActiveRun(run);
    } catch (error) {
      if (currentRunIdRef.current === runId) {
        setRunError(userMessage(error, 'No pudimos actualizar el estado de la investigación.'));
      }
    } finally {
      if (runRequestRef.current === runId) runRequestRef.current = null;
      if (showLoading && currentRunIdRef.current === runId) setRunLoading(false);
    }
  }, [organizationId, scope, user?.id]);

  const fetchReportDetail = useCallback(async (reportId: string, fallbackResult: ResearchWorkspaceRunItem['result']) => {
    if (!reportId || !fallbackResult || reportDetailRequestsRef.current.has(reportId)) return;
    reportDetailRequestsRef.current.add(reportId);
    const controller = new AbortController();
    reportDetailControllersRef.current.add(controller);
    setReportDetailLoading((current) => ({ ...current, [reportId]: true }));
    setReportDetailErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const response = await fetch(`/api/native-research/${encodeURIComponent(reportId)}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error('NATIVE_RESEARCH_DETAIL_FAILED');
      const detail = parseResearchReportDetail(payload, fallbackResult);
      if (!detail) throw new Error('NATIVE_RESEARCH_DETAIL_INVALID');
      setReportDetails((current) => ({ ...current, [reportId]: detail }));
    } catch {
      if (controller.signal.aborted) return;
      setReportDetailErrors((current) => ({
        ...current,
        [reportId]: 'No pudimos actualizar el informe completo. Mostramos la evidencia disponible; reintenta para comprobar su estado.',
      }));
    } finally {
      reportDetailControllersRef.current.delete(controller);
      if (controller.signal.aborted) return;
      reportDetailRequestsRef.current.delete(reportId);
      setReportDetailLoading((current) => ({ ...current, [reportId]: false }));
    }
  }, []);

  const retryReportSynthesis = useCallback(async (reportId: string) => {
    setReportDetailLoading((current) => ({ ...current, [reportId]: true }));
    setReportDetailErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const response = await fetch(`/api/native-research/${encodeURIComponent(reportId)}`, { method: 'POST' });
      if (!response.ok) throw new Error('NATIVE_RESEARCH_REPORT_RETRY_FAILED');
      setReportDetails((current) => {
        const detail = current[reportId];
        return detail ? {
          ...current,
          [reportId]: {
            ...detail,
            preferredReportSynthesis: {
              status: 'queued', retryable: false, attemptCount: 0, nextRetryAt: null, errorCode: null, updatedAt: new Date().toISOString(),
            },
            reportSynthesis: {
              status: 'queued',
              retryable: false,
              attemptCount: 0,
              nextRetryAt: null,
              errorCode: null,
              updatedAt: new Date().toISOString(),
            },
          },
        } : current;
      });
    } catch {
      setReportDetailErrors((current) => ({
        ...current,
        [reportId]: 'No pudimos reintentar la preparación del reporte. Inténtalo nuevamente.',
      }));
    } finally {
      setReportDetailLoading((current) => ({ ...current, [reportId]: false }));
    }
  }, []);

  useEffect(() => {
    if (!activeBatch?.runId) return;
    void fetchRun(activeBatch.runId, batchLeads, true);
  }, [activeBatch?.runId, batchLeads, fetchRun]);

  const isPolling = shouldPollResearchRun(activeRun);
  useEffect(() => {
    if (!activeBatch?.runId || !isPolling) return;
    const interval = window.setInterval(() => {
      void fetchRun(activeBatch.runId, batchLeads, false);
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [activeBatch?.runId, batchLeads, fetchRun, isPolling]);

  const activeRunItems = useMemo(() => activeRun?.items || [], [activeRun]);
  const baseRunItems = useMemo(
    () => mergeResearchRunItems(persistedItems, activeRunItems),
    [activeRunItems, persistedItems],
  );
  const runItems = useMemo(() => baseRunItems.map((item) => {
    const detail = item.reportId ? reportDetails[item.reportId] : null;
    return researchItemPresentation(item, detail, Boolean(item.reportId && reportDetailErrors[item.reportId]));
  }), [baseRunItems, reportDetails, reportDetailErrors]);

  // Research completion is not editorial completion. Track all batch reports,
  // not only the selected lead, with bounded concurrent detail reads.
  useEffect(() => {
    const poll = (includePending = false) => {
      baseRunItems.filter((item) => {
        if (!item.reportId || !item.result || !['completed', 'partial', 'insufficient_data'].includes(item.status)) return false;
        if (reportDetailErrors[item.reportId]) return false;
        const detail = reportDetails[item.reportId];
        return !reportDetailRequestsRef.current.has(item.reportId) && (!detail || (includePending && researchDetailLoadingState(detail).pending));
      }).slice(0, Math.max(0, 4 - reportDetailRequestsRef.current.size)).forEach((item) => void fetchReportDetail(item.reportId!, item.result));
    };
    poll();
    const timer = window.setInterval(() => poll(true), 5_000);
    return () => window.clearInterval(timer);
  }, [baseRunItems, fetchReportDetail, reportDetails, reportDetailErrors]);
  const itemByLeadKey = useMemo(
    () => new Map(runItems.map((item) => [item.lead.key, item])),
    [runItems],
  );
  const readyItems = useMemo(() => runItems.filter((item) => item.canCreateDraft), [runItems]);
  const readyKeys = useMemo(() => new Set(readyItems.map((item) => item.lead.key)), [readyItems]);
  const queueLeads = useMemo(() => workspaceLeads.filter((lead) => !readyKeys.has(lead.key)), [readyKeys, workspaceLeads]);
  const queueKeys = useMemo(() => new Set(queueLeads.map((lead) => lead.key)), [queueLeads]);
  const railLeads = useMemo(
    () => mergeWorkspaceLeads(workspaceLeads, runItems.map((item) => item.lead)),
    [runItems, workspaceLeads],
  );
  const filteredRailLeads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return railLeads;
    return railLeads.filter((lead) => [lead.fullName, lead.companyName, lead.title, lead.email]
      .some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [query, railLeads]);
  const paginatedRail = useMemo(
    () => paginateResearchRail(filteredRailLeads, railPage, RESEARCH_RAIL_PAGE_SIZE),
    [filteredRailLeads, railPage],
  );
  const selectableQueueLeads = useMemo(
    () => queueLeads.filter((lead) => !isResearchInFlight(itemByLeadKey.get(lead.key)?.status || 'idle')),
    [itemByLeadKey, queueLeads],
  );
  const selectableVisibleLeads = useMemo(
    () => paginatedRail.items.filter((lead) => queueKeys.has(lead.key) && !isResearchInFlight(itemByLeadKey.get(lead.key)?.status || 'idle')),
    [itemByLeadKey, paginatedRail.items, queueKeys],
  );
  const selectedLeads = useMemo(
    () => selectableQueueLeads.filter((lead) => selectedKeys.includes(lead.key)),
    [selectableQueueLeads, selectedKeys],
  );
  const allVisibleSelected = selectableVisibleLeads.length > 0 && selectableVisibleLeads.every((lead) => selectedKeys.includes(lead.key));
  const activeItem = runItems.find((item) => item.lead.key === activeLeadKey) || null;
  const activeLead = activeItem?.lead || workspaceLeads.find((lead) => lead.key === activeLeadKey) || null;
  const activeStatus = activeItem?.status || 'idle';
  const activeReportId = activeItem?.reportId || null;
  const activeReportDetail = activeReportId ? reportDetails[activeReportId] || null : null;
  const activeReportSynthesis = activeReportDetail?.preferredReportSynthesis || null;
  const activeReportSynthesisPending = Boolean(activeReportDetail && researchDetailLoadingState(activeReportDetail).pending);
  const activeReportSynthesisFailed = activeReportSynthesis?.status === 'failed_permanent';
  const activeReportDetailError = activeReportId ? reportDetailErrors[activeReportId] || '' : '';
  const activeReportDetailPending = Boolean(
    activeItem?.result
    && activeReportId
    && ['completed', 'partial', 'insufficient_data'].includes(activeStatus)
    && !activeReportDetail
    && !activeReportDetailError,
  );
  const activeReportDetailLoading = activeReportDetailPending || Boolean(activeReportId && reportDetailLoading[activeReportId] && !activeReportDetail);
  const activeInFlightCount = runItems.filter((item) => isResearchInFlight(item.status)).length;
  const activeRunInFlightCount = runItems.filter((item) => activeRunItems.some((active) => active.id === item.id) && isResearchInFlight(item.status)).length;
  const activeRunProgress = Math.round(((activeRunItems.length - activeRunInFlightCount) / Math.max(activeRunItems.length, 1)) * 100);
  const batchPending = isPolling || activeRunInFlightCount > 0;
  const activeRunBlocksNewBatch = Boolean(activeBatch && runLoading) || isPolling || creatingBatch;
  const handoffPending = !handoffReady || !handoffResolved;
  const selectionLocked = activeRunBlocksNewBatch || handoffPending;
  const draftRequestPending = creatingDraftId !== null;

  useEffect(() => {
    if (
      !activeItem?.result
      || !activeReportId
      || !['completed', 'partial', 'insufficient_data'].includes(activeStatus)
      || activeReportDetail
      || activeReportDetailError
    ) return;
    void fetchReportDetail(activeReportId, activeItem.result);
  }, [activeItem?.result, activeReportDetail, activeReportDetailError, activeReportId, activeStatus, fetchReportDetail]);

  useEffect(() => {
    setSelectedKeys((current) => current.filter((key) => selectableQueueLeads.some((lead) => lead.key === key)));
  }, [selectableQueueLeads]);

  useEffect(() => {
    if (handoffSelectionKeys.length === 0) return;

    const availableKeys = new Set(selectableQueueLeads.map((lead) => lead.key));
    if (!handoffSelectionKeys.every((key) => availableKeys.has(key))) {
      if (activeRunBlocksNewBatch) return;
      setHandoffSelectionKeys([]);
      setHandoffNotice('');
      setHandoffError('Parte de la selección ya tiene una investigación activa o lista. Revisa los leads disponibles antes de iniciar otro lote.');
      return;
    }

    setSelectedKeys((current) => Array.from(new Set([...current, ...handoffSelectionKeys])));
    setHandoffSelectionKeys([]);
  }, [activeRunBlocksNewBatch, handoffSelectionKeys, selectableQueueLeads]);

  useEffect(() => {
    const availableKeys = new Set([
      ...queueLeads.map((lead) => lead.key),
      ...runItems.map((item) => item.lead.key),
    ]);
    if (activeLeadKey && availableKeys.has(activeLeadKey)) return;
    setActiveLeadKey(readyItems[0]?.lead.key || queueLeads[0]?.key || null);
  }, [activeLeadKey, queueLeads, readyItems, runItems]);

  function setLeadSelected(key: string, checked: boolean) {
    if (!checked) {
      setSelectedKeys((current) => current.filter((item) => item !== key));
      return;
    }
    if (selectedKeys.includes(key)) return;
    if (selectedKeys.length >= MAX_RESEARCH_BATCH_SIZE) {
      toast({ title: 'Selecciona hasta 50 leads', description: 'Inicia esta selección antes de agregar más leads.' });
      return;
    }
    setSelectedKeys((current) => [...current, key]);
  }

  function selectVisibleLeads(checked: boolean) {
    if (!checked) {
      const visibleKeys = new Set(selectableVisibleLeads.map((lead) => lead.key));
      setSelectedKeys((current) => current.filter((key) => !visibleKeys.has(key)));
      return;
    }
    const selected = new Set(selectedKeys);
    const additionalKeys = selectableVisibleLeads
      .map((lead) => lead.key)
      .filter((key) => !selected.has(key));
    const remainingCapacity = Math.max(0, MAX_RESEARCH_BATCH_SIZE - selectedKeys.length);
    const keysToAdd = additionalKeys.slice(0, remainingCapacity);

    setSelectedKeys((current) => {
      const currentKeys = new Set(current);
      const capacity = Math.max(0, MAX_RESEARCH_BATCH_SIZE - current.length);
      return [...current, ...keysToAdd.filter((key) => !currentKeys.has(key)).slice(0, capacity)];
    });
    if (additionalKeys.length > remainingCapacity) {
      toast({ title: 'La selección admite hasta 50 leads', description: 'Inicia esta selección antes de agregar más leads.' });
    }
  }

  function includeActiveLead() {
    if (!activeLead || isResearchInFlight(activeStatus)) return;
    setLeadSelected(activeLead.key, true);
  }

  async function startResearchFor(nextLeads: ResearchWorkspaceLead[], forceRefresh = false) {
    if (!nextLeads.length || selectionLocked || researchUnavailable) return;
    setCreatingBatch(true);
    setStartError('');
    try {
      const refresh = forceRefresh || nextLeads.some((lead) => Boolean(itemByLeadKey.get(lead.key))) || handoff?.refresh === true;
      const response = await fetch('/api/native-research/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: nextLeads.map(toResearchLead),
          options: { depth: 'deep', language: 'es', refresh },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 404 || String(payload?.error || '').includes('DISABLED')) setResearchUnavailable(true);
        throw new Error(friendlyRequestError(payload, 'No pudimos guardar esta selección para investigar.'));
      }
      const runId = String(payload?.runId || '').trim();
      if (!runId) throw new Error('No pudimos confirmar la investigación.');

      const batch: StoredResearchBatch = {
        runId,
        scope,
        leads: nextLeads,
        createdAt: new Date().toISOString(),
      };
      currentRunIdRef.current = runId;
      if (user?.id) storeBatch(batch, user.id, organizationId);
      clearResearchWorkspaceHandoff();
      setHandoff(null);
      setHandoffLeads([]);
      setHandoffNotice('');
      setPersistedItems((current) => mergeResearchRunItems(current, activeRunItems));
      setActiveBatch(batch);
      setActiveRun(createQueuedResearchWorkspaceRun({ runId, leads: nextLeads, items: payload?.items }));
      setActiveLeadKey(nextLeads[0]?.key || null);
      setMobilePane('report');
      window.requestAnimationFrame(() => document.getElementById('research-report-panel')?.focus());
      setSelectedKeys([]);
      toast({
        title: refresh ? 'Investigación actualizada' : 'Investigación iniciada',
        description: `${pluralize(nextLeads.length, 'lead')} ${nextLeads.length === 1 ? 'quedó' : 'quedaron'} guardados en esta selección.`,
      });
      void fetchRun(runId, nextLeads, false);
    } catch (error) {
      setStartError(userMessage(error, 'No pudimos guardar esta selección para investigar.'));
    } finally {
      setCreatingBatch(false);
    }
  }

  async function startResearch() {
    await startResearchFor(selectedLeads);
  }

  async function refreshActiveResearch() {
    if (!activeLead) return;
    await startResearchFor([activeLead], true);
  }

  async function createDraft(item: ResearchWorkspaceRunItem, styleProfileId: string | null = null) {
    if (!item.canCreateDraft || !item.researchSnapshotId || draftRequestRef.current) return;
    draftRequestRef.current = item.id;
    setProfileRequiredItemId((current) => current === item.id ? null : current);
    setCreatingDraftId(item.id);
    try {
      const response = await fetch('/api/native-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `native-draft:${item.researchSnapshotId}` },
        body: JSON.stringify({ researchSnapshotId: item.researchSnapshotId, styleProfileId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft?.draftId) {
        const description = researchDraftErrorMessage(payload, 'Inténtalo nuevamente.');
        const sellerProfileIncomplete = isSellerProfileIncompleteDraftError(payload)
          && description === 'Completa tu perfil comercial para crear un borrador alineado con tu propuesta.';
        if (sellerProfileIncomplete) setProfileRequiredItemId(item.id);
        toast({
          variant: 'destructive',
          title: 'No se pudo preparar el borrador',
          description,
          action: sellerProfileIncomplete ? (
            <ToastAction altText="Completar perfil comercial" onClick={() => router.push('/profile')}>
              Completar perfil
            </ToastAction>
          ) : undefined,
        });
        return;
      }
      const draftId = encodeURIComponent(payload.draft.draftId);
      setProfileRequiredItemId(null);
      const versionId = payload.draft.versionId ? `&versionId=${encodeURIComponent(payload.draft.versionId)}` : '';
      router.push(`/contact/compose?draftId=${draftId}${versionId}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'No se pudo preparar el borrador',
        description: userMessage(error, 'Inténtalo nuevamente.'),
      });
    } finally {
      if (draftRequestRef.current === item.id) draftRequestRef.current = null;
      setCreatingDraftId(null);
    }
  }

  const summary = [
    { label: 'Por investigar', value: queueLeads.length, detail: 'leads disponibles', icon: Target },
    { label: 'En curso', value: activeInFlightCount, detail: activeInFlightCount === 1 ? 'investigación activa' : 'investigaciones activas', icon: BrainCircuit },
    { label: 'Listos para redactar', value: readyItems.length, detail: 'con evidencia suficiente', icon: Sparkles },
  ];
  const activeReadiness = activeItem?.readiness || 'review';
  const canSelectActiveLead = Boolean(
    activeLead
    && queueLeads.some((lead) => lead.key === activeLead.key)
    && !isResearchInFlight(activeStatus)
    && !selectedKeys.includes(activeLead.key)
    && selectedKeys.length < MAX_RESEARCH_BATCH_SIZE,
  );

  return (
    <main className={cn(
      'mx-auto w-full max-w-[1500px]',
      embedded
        ? 'flex h-full min-h-0 max-w-none flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:gap-4 lg:p-5'
        : 'space-y-5 pb-8',
    )}>
      <div className="shrink-0">
        {embedded ? (
          <header className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Investigación de {scopeLabel}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {onClose ? (
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onClose}>
                  <ArrowLeft aria-hidden="true" />
                  Volver a {scopeLabel}
                </Button>
              ) : null}
              {activeBatch ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-border/70 bg-background/85"
                  onClick={() => void fetchRun(activeBatch.runId, batchLeads, true)}
                  disabled={runLoading}
                  aria-label="Actualizar el estado de la investigación"
                >
                  <RefreshCw className={runLoading ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
                  Actualizar estado
                </Button>
              ) : null}
            </div>
          </header>
        ) : (
          <PageHeader
            title="Investigación"
            description="Reúne evidencia antes de preparar cada correo para que el siguiente paso tenga mejor contexto."
          >
            {activeBatch ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-border/70 bg-background/85"
                onClick={() => void fetchRun(activeBatch.runId, batchLeads, true)}
                disabled={runLoading}
                aria-label="Actualizar el estado de la investigación"
              >
                <RefreshCw className={runLoading ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
                Actualizar estado
              </Button>
            ) : null}
          </PageHeader>
        )}
      </div>

      {researchUnavailable || handoffError || startError || runError ? (
        <div className={cn('shrink-0 space-y-3', embedded && 'max-h-[35dvh] overflow-y-auto overscroll-y-contain')}>
          {researchUnavailable ? (
            <Alert className="border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <CircleAlert className="text-amber-600 dark:text-amber-300" />
              <AlertTitle>La investigación no está disponible ahora</AlertTitle>
              <AlertDescription>Tu selección no se modificó. Vuelve a intentarlo más tarde.</AlertDescription>
            </Alert>
          ) : null}

          {handoffError ? (
            <Alert variant="destructive" className="border-destructive/35 bg-destructive/5">
              <ShieldAlert />
              <AlertTitle>No pudimos recuperar la selección</AlertTitle>
              <AlertDescription>{handoffError}</AlertDescription>
            </Alert>
          ) : null}

          {startError ? (
            <Alert variant="destructive" className="border-destructive/35 bg-destructive/5">
              <ShieldAlert />
              <AlertTitle>No pudimos iniciar la investigación</AlertTitle>
              <AlertDescription>{startError}</AlertDescription>
            </Alert>
          ) : null}

          {runError ? (
            <Alert variant="destructive" className="border-destructive/35 bg-destructive/5">
              <ShieldAlert />
              <AlertTitle>No pudimos actualizar esta investigación</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{runError}</span>
                {activeBatch ? (
                  <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => void fetchRun(activeBatch.runId, batchLeads, true)} disabled={runLoading}>
                    {runLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
                    Actualizar estado
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="research-overview-heading" className={cn('shrink-0', embedded && 'hidden')}>
        <h2 id="research-overview-heading" className="sr-only">Resumen de investigación</h2>
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/80 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.28)]">
          <CardContent className="p-0">
            <div className="grid divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {summary.map((item) => (
                <div key={item.label} className="flex min-w-0 items-center gap-3 px-4 py-4 sm:px-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <item.icon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-xl font-semibold tracking-[-0.03em]">{item.value}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            {activeBatch ? (
              <div className="border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {batchPending ? 'Estamos preparando los informes de tu selección' : activeRun?.status === 'completed' ? 'La selección está lista para revisar' : 'Revisa el estado de tu selección'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {batchPending
                        ? `${activeInFlightCount} ${activeInFlightCount === 1 ? 'lead sigue en curso' : 'leads siguen en curso'}. Puedes continuar revisando esta pantalla.`
                        : `${readyItems.length} ${readyItems.length === 1 ? 'lead está listo para redactar' : 'leads están listos para redactar'}.`}
                    </p>
                  </div>
                  {batchPending ? <div className="w-full sm:w-52"><Progress value={Math.min(95, activeRunProgress)} className="h-1.5" aria-label={`Progreso de la selección: ${activeRunProgress}%`} /></div> : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <div className={cn(
        'grid min-w-0 gap-5 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]',
        embedded && 'min-h-0 flex-1 overflow-hidden lg:grid-rows-[minmax(0,1fr)]',
      )}>
        <section
          aria-labelledby="to-research-heading"
          className={cn(
            'min-w-0 lg:self-start',
            embedded && 'h-full min-h-0 lg:self-stretch',
            mobilePane === 'report' && 'hidden lg:block',
          )}
        >
          <Card className={cn(
            'min-w-0 overflow-hidden rounded-[24px] border-border/60 bg-muted/[0.08] shadow-none',
            embedded ? 'flex h-full min-h-0 flex-col' : 'lg:flex lg:max-h-[calc(100vh-2.5rem)] lg:flex-col',
          )}>
            <CardHeader className={cn(
              'shrink-0 space-y-0 border-b border-border/60 px-4',
              embedded ? 'gap-3 py-3' : 'gap-4 pb-4 pt-5',
            )}>
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <h2 id="to-research-heading" className="text-lg font-semibold tracking-[-0.025em]">Leads</h2>
                <CardDescription className="truncate text-xs leading-4">
                  {queueLeads.length} por investigar · {readyItems.length} listos para redactar
                </CardDescription>
              </div>

              <div className="space-y-3">
                <div className="relative w-full">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                   <Input
                    id="research-search"
                    value={query}
                     onChange={(event) => {
                       setQuery(event.target.value);
                       setRailPage(1);
                     }}
                    placeholder="Buscar lead o empresa"
                    aria-label="Buscar leads para investigar"
                    className="h-10 rounded-full border-border/70 bg-background/85 pl-10"
                  />
                </div>

                <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="select-visible-research-leads"
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => selectVisibleLeads(Boolean(checked))}
                        disabled={selectableVisibleLeads.length === 0 || selectionLocked}
                      />
                      <label htmlFor="select-visible-research-leads" className="cursor-pointer text-sm text-muted-foreground">Seleccionar visibles</label>
                    </div>
                    <span className="text-xs text-muted-foreground" aria-live="polite">
                      {selectedLeads.length}/{MAX_RESEARCH_BATCH_SIZE}
                    </span>
                  </div>
                  <Button
                    type="button"
                    className="w-full rounded-full"
                    onClick={() => void startResearch()}
                    disabled={researchUnavailable || selectionLocked || selectedLeads.length === 0}
                    aria-describedby={handoffPending ? 'research-handoff-help' : activeRunBlocksNewBatch ? 'research-batch-help' : undefined}
                  >
                    {creatingBatch ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <BrainCircuit />}
                    {creatingBatch ? 'Guardando selección…' : handoffPending ? 'Preparando selección…' : selectedLeads.length ? `Investigar ${selectedLeads.length}` : 'Investigar selección'}
                  </Button>
                </div>
                 {handoffNotice ? <p role="status" className="text-xs leading-5 text-muted-foreground">{handoffNotice}</p> : null}
                 {handoffPending ? <p id="research-handoff-help" className="text-xs leading-5 text-muted-foreground">Estamos preparando la selección que trajiste desde tu lista.</p> : activeRunBlocksNewBatch ? <p id="research-batch-help" className="text-xs leading-5 text-muted-foreground">Espera a que termine la selección actual antes de iniciar otra.</p> : null}
                 {persistedItemsLoading ? <p role="status" className="text-xs leading-5 text-muted-foreground">Actualizando reportes guardados…</p> : persistedItemsError ? <p role="status" className="text-xs leading-5 text-amber-700 dark:text-amber-300">{persistedItemsError}</p> : null}
               </div>
            </CardHeader>

            <CardContent
              id="research-queue-list"
              className={cn(
                'min-h-0 p-0',
                embedded
                  ? 'flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]'
                  : 'lg:block lg:flex-1 lg:overflow-y-auto',
              )}
            >
              {loadingLeads ? (
                <div aria-busy="true" className="space-y-3 p-4 sm:p-5">
                  {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-[104px] w-full rounded-2xl" />)}
                </div>
              ) : loadError ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
                  <ShieldAlert className="mb-3 size-7 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                  <p className="font-medium">No pudimos cargar tus leads</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{loadError}</p>
                  <Button type="button" className="mt-4 rounded-full" variant="outline" onClick={() => void loadLeads()}>Reintentar</Button>
                </div>
              ) : railLeads.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
                  <Target className="mb-3 size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">Aún no hay leads para investigar</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Busca y enriquece leads para preparar el contexto antes de escribirles.</p>
                  <Button type="button" className="mt-4 rounded-full" onClick={() => router.push('/search')}>Buscar leads <ArrowRight /></Button>
                </div>
              ) : filteredRailLeads.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center px-5 py-9 text-center">
                  <Search className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">No hay coincidencias</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Prueba con otro nombre, empresa o cargo.</p>
                  <Button type="button" className="mt-3 rounded-full" size="sm" variant="outline" onClick={() => setQuery('')}>Limpiar búsqueda</Button>
                </div>
              ) : (
                <ul className="divide-y divide-border/60" aria-label="Leads de la investigación">
                  {paginatedRail.items.map((lead) => {
                    const item = itemByLeadKey.get(lead.key);
                    const isActive = lead.key === activeLeadKey;
                    const inFlight = isResearchInFlight(item?.status || 'idle');
                    const selectable = queueKeys.has(lead.key);
                    const selected = selectedKeys.includes(lead.key);
                    const evidence = item ? `${pluralize(item.evidenceCount, 'evidencia')} · ${pluralize(item.sourceCount, 'fuente')}` : 'Sin evidencia todavía';
                    const readiness = item ? researchReadinessLabel(item.readiness) : 'Por investigar';
                    return (
                      <li key={lead.key} className={isActive ? 'bg-primary/[0.04]' : ''}>
                        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3.5 sm:px-5">
                          <div className="pt-1.5">
                            <Checkbox
                              id={researchLeadCheckboxId(lead.key)}
                              checked={selected}
                              disabled={!selectable || inFlight || selectionLocked}
                              onCheckedChange={(checked) => setLeadSelected(lead.key, Boolean(checked))}
                              aria-label={`Seleccionar ${lead.fullName || lead.companyName || 'lead'} para investigar`}
                            />
                          </div>
                          <button
                            id={researchLeadButtonId(lead.key)}
                            type="button"
                            onClick={() => {
                              setActiveLeadKey(lead.key);
                              setMobilePane('report');
                              window.requestAnimationFrame(() => document.getElementById('research-report-panel')?.focus());
                            }}
                            disabled={draftRequestPending}
                            aria-pressed={isActive}
                            className="min-w-0 rounded-xl text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="flex min-w-0 flex-col gap-2 px-1 py-0.5">
                              <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-foreground">{lead.fullName || 'Lead sin nombre'}</span>
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[lead.title || 'Sin cargo', lead.companyName || 'Empresa sin identificar'].join(' · ')}</span>
                                </span>
                                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClass(item?.status || 'idle')}`}>{researchStatusLabel(item?.status || 'idle')}</span>
                              </span>
                              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
                                <span>{evidence}</span>
                                <span className={`font-medium ${readinessClass(item?.readiness || 'review')}`}>{readiness}</span>
                              </span>
                              {inFlight ? <Progress value={progressFor(item?.status || 'idle')} className="h-1.5" aria-label={`Progreso de investigación de ${lead.fullName || lead.companyName || 'lead'}: ${researchStatusLabel(item?.status || 'idle')}`} /> : null}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            {paginatedRail.totalPages > 1 ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-background/70 px-4 py-3 sm:px-5">
                <p className="text-xs text-muted-foreground">
                  {paginatedRail.start}-{paginatedRail.end} de {paginatedRail.totalItems}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setRailPage(Math.max(1, paginatedRail.page - 1))}
                    disabled={paginatedRail.page <= 1}
                  >
                    <ArrowLeft aria-hidden="true" />
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setRailPage(Math.min(paginatedRail.totalPages, paginatedRail.page + 1))}
                    disabled={paginatedRail.page >= paginatedRail.totalPages}
                  >
                    Siguiente
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </section>

        <section
          aria-labelledby="research-detail-heading"
          className={cn(
            'min-w-0 flex-col',
            embedded && 'h-full min-h-0 lg:self-stretch',
            mobilePane === 'list' ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div className="mb-2 shrink-0 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full px-2.5"
              onClick={() => {
                setMobilePane('list');
                window.requestAnimationFrame(() => {
                  const activeLeadButton = activeLeadKey
                    ? document.getElementById(researchLeadButtonId(activeLeadKey))
                    : null;
                  (activeLeadButton || document.getElementById('research-search'))?.focus();
                });
              }}
            >
              <ArrowLeft aria-hidden="true" />
              Todos los leads
            </Button>
          </div>
          <Card className={cn(
            'min-w-0 rounded-[28px] border-border/60 bg-card/95 shadow-[0_22px_64px_-46px_rgba(15,23,42,0.4)] dark:bg-card/80',
            embedded && 'flex min-h-0 flex-1 flex-col overflow-hidden',
          )}>
            {!activeItem?.result ? <CardHeader className="shrink-0 gap-2 border-b border-border/60 pb-4">
              <h2 id="research-detail-heading" className="text-[1.35rem] font-semibold leading-none tracking-[-0.03em]">Detalle de investigación</h2>
              <CardDescription className="leading-6">Selecciona un lead para revisar su estado, evidencia y fuentes antes de redactar.</CardDescription>
            </CardHeader> : <h2 id="research-detail-heading" className="sr-only">Informe de investigación</h2> /* Solo título accesible: el informe completo ya muestra su propio encabezado. */}
            <CardContent className={cn(
              'space-y-5 p-4 outline-none sm:p-6 xl:p-8',
              embedded && 'min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            )}
              id="research-report-panel"
              role="region"
              aria-labelledby="research-detail-heading"
              tabIndex={-1}
            >
              {runLoading && !activeRun ? (
                <div aria-busy="true" className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-2xl" />
                  <Skeleton className="h-28 w-full rounded-2xl" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
              ) : (
                <>
                  {!activeLead ? (
                    <div className="flex min-h-52 flex-col items-center justify-center px-4 py-8 text-center">
                      <BrainCircuit className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
                      <p className="font-medium">Selecciona un lead</p>
                      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Podrás revisar su estado, calidad y evidencia en este panel.</p>
                    </div>
                  ) : (
                    <article aria-label={`Detalle de investigación de ${activeLead.fullName || activeLead.companyName || 'lead'}`} className="min-w-0 space-y-5">
                      {!activeItem?.result ? <header className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{activeLead.companyName || 'Empresa'}{activeLead.title ? ` · ${activeLead.title}` : ''}</p>
                        <h2 className="mt-1 break-words text-xl font-semibold tracking-[-0.03em]">{activeLead.fullName || 'Lead sin nombre'}</h2>
                        <p className="mt-1 break-all text-sm text-muted-foreground">{activeLead.email || activeLead.companyDomain || 'Sin email ni dominio disponible'}</p>
                      </header> : null}

                      {isResearchInFlight(activeStatus) ? (
                        <ResearchReportProgress key={activeItem?.id || activeLead.key} startedAt={activeReportDetail?.result.startedAt || activeItem?.startedAt} retryScheduled={activeReportSynthesis?.status === 'retry_scheduled'} />
                      ) : (activeStatus === 'failed' || activeStatus === 'cancelled') && !activeItem?.result ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                          <p className="text-sm font-medium">Esta investigación necesita atención</p>
                          <p className="mt-1 text-xs leading-5 opacity-80">Incluye este lead en una nueva selección cuando tengas más información o quieras volver a investigarlo.</p>
                          <Button type="button" size="sm" variant="outline" className="mt-3 rounded-full" onClick={includeActiveLead} disabled={!canSelectActiveLead || selectionLocked}>
                            {selectedKeys.includes(activeLead.key) ? 'Incluido en la selección' : 'Incluir para investigar'}
                          </Button>
                        </div>
                      ) : activeItem?.result ? (
                        <>
                          {activeReportDetailLoading ? (
                            <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50/75 px-4 py-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100" role="status">
                              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                              <span>Estamos preparando la versión interpretada. Mientras tanto puedes revisar la evidencia disponible.</span>
                            </div>
                          ) : null}
                          {activeReportDetailError ? (
                                 <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/65 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between" role="alert">
                                  <span>{activeReportDetailError}</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 rounded-full bg-background/80"
                                    onClick={() => void fetchReportDetail(activeReportId!, activeItem.result)}
                                    aria-label={`Reintentar cargar el reporte completo de ${activeLead.fullName || activeLead.companyName || 'este lead'}`}
                                  >
                                    <RefreshCw aria-hidden="true" />
                                    Reintentar
                                  </Button>
                                 </div>
                          ) : null}
                          <NativeResearchReport
                            key={activeItem.id}
                            variant="full"
                            questionnaireEnabled={Boolean(activeReportDetail?.questionnaireEnabled)}
                            result={activeReportDetail?.result || activeItem.result}
                            reportDocument={activeReportDetail?.preferredReportDocument}
                            startedAt={activeReportDetail?.result.startedAt || activeItem.startedAt}
                            loadError={Boolean(activeReportDetailError)}
                            reportSynthesis={activeReportSynthesis}
                            status={activeReportDetail?.result.status || activeItem.result.status}
                            readiness={activeReadiness}
                            researchSnapshotId={activeItem.researchSnapshotId}
                            canCreateDraft={activeItem.canCreateDraft}
                            profileCompletionRequired={profileRequiredItemId === activeItem.id}
                            creatingDraft={creatingDraftId === activeItem.id}
                            createDraftDisabled={draftRequestPending || activeReportDetailLoading || Boolean(activeReportDetailError) || activeReportSynthesisPending || activeReportSynthesisFailed}
                            createDraftLabel="Crear borrador y revisar"
                            creatingDraftLabel="Preparando borrador…"
                            onCreateDraft={(styleProfileId) => void createDraft(activeItem, styleProfileId)}
                            onCompleteProfile={() => router.push('/profile')}
                            refreshing={creatingBatch}
                            onRefresh={selectionLocked || researchUnavailable ? undefined : () => void refreshActiveResearch()}
                            retryingSynthesis={Boolean(activeReportId && reportDetailLoading[activeReportId])}
                            onRetrySynthesis={activeReportSynthesisFailed && activeReportId ? () => void retryReportSynthesis(activeReportId) : undefined}
                          />
                        </>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center">
                          <BrainCircuit className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true" />
                          <p className="text-sm font-medium">Aún no hay una investigación para este lead</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">Inclúyelo en la selección para reunir evidencia antes de redactar.</p>
                          <Button type="button" size="sm" variant="outline" className="mt-4 rounded-full" onClick={includeActiveLead} disabled={!canSelectActiveLead || selectionLocked}>
                            {selectedKeys.includes(activeLead.key) ? 'Incluido en la selección' : 'Incluir para investigar'}
                          </Button>
                        </div>
                      )}
                    </article>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      {activeBatch ? (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {isPolling
            ? `${activeInFlightCount} ${activeInFlightCount === 1 ? 'investigación en curso' : 'investigaciones en curso'}.`
            : `${readyItems.length} ${readyItems.length === 1 ? 'lead listo para redactar' : 'leads listos para redactar'}.`}
        </p>
      ) : null}
    </main>
  );
}
