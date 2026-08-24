'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  MAX_RESEARCH_BATCH_SIZE,
  createQueuedResearchWorkspaceRun,
  isResearchInFlight,
  parseResearchWorkspaceRun,
  researchReadinessLabel,
  researchStatusLabel,
  shouldPollResearchRun,
  type ResearchReadiness,
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
    companyDomain: lead.organizationDomain || lead.companyDomain || (lead.email?.split('@')[1] || null),
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
    companyDomain: lead.companyDomain || (normalizeEmail(lead.email)?.split('@')[1] || null),
    organizationIndustry: lead.organizationIndustry || null,
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
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeLeadKey, setActiveLeadKey] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<StoredResearchBatch | null>(null);
  const [activeRun, setActiveRun] = useState<ResearchWorkspaceRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');
  const [startError, setStartError] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<string | null>(null);
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
  const resolvedHandoffRef = useRef<string | null>(null);

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    setLoadError('');
    try {
      const result = scope === 'opportunities' ? await getEnrichedOpportunities() : await getEnrichedLeads();
      const nextLeads = (Array.isArray(result) ? result : []) as ResearchableLead[];
      setLeads(nextLeads);
      setActiveLeadKey((current) => current || (nextLeads[0] ? leadKey(nextLeads[0]) : null));
    } catch {
      setLoadError('No pudimos cargar tus leads. Inténtalo nuevamente para continuar.');
    } finally {
      setLoadingLeads(false);
    }
  }, [scope]);

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

  const runItems = useMemo(() => activeRun?.items || [], [activeRun]);
  const itemByLeadKey = useMemo(
    () => new Map(runItems.map((item) => [item.lead.key, item])),
    [runItems],
  );
  const readyItems = useMemo(() => runItems.filter((item) => item.canCreateDraft), [runItems]);
  const readyKeys = useMemo(() => new Set(readyItems.map((item) => item.lead.key)), [readyItems]);
  const queueLeads = useMemo(() => workspaceLeads.filter((lead) => !readyKeys.has(lead.key)), [readyKeys, workspaceLeads]);
  const filteredQueueLeads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return queueLeads;
    return queueLeads.filter((lead) => [lead.fullName, lead.companyName, lead.title, lead.email]
      .some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [query, queueLeads]);
  const selectableQueueLeads = useMemo(
    () => queueLeads.filter((lead) => !isResearchInFlight(itemByLeadKey.get(lead.key)?.status || 'idle')),
    [itemByLeadKey, queueLeads],
  );
  const selectableVisibleLeads = useMemo(
    () => filteredQueueLeads.filter((lead) => !isResearchInFlight(itemByLeadKey.get(lead.key)?.status || 'idle')),
    [filteredQueueLeads, itemByLeadKey],
  );
  const selectedLeads = useMemo(
    () => selectableQueueLeads.filter((lead) => selectedKeys.includes(lead.key)),
    [selectableQueueLeads, selectedKeys],
  );
  const allVisibleSelected = selectableVisibleLeads.length > 0 && selectableVisibleLeads.every((lead) => selectedKeys.includes(lead.key));
  const activeItem = runItems.find((item) => item.lead.key === activeLeadKey) || null;
  const activeLead = activeItem?.lead || workspaceLeads.find((lead) => lead.key === activeLeadKey) || null;
  const activeStatus = activeItem?.status || 'idle';
  const activeInFlightCount = runItems.filter((item) => isResearchInFlight(item.status)).length;
  const activeRunBlocksNewBatch = Boolean(activeBatch && runLoading) || isPolling || creatingBatch;
  const handoffPending = !handoffReady || !handoffResolved;
  const selectionLocked = activeRunBlocksNewBatch || handoffPending;

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
      setActiveBatch(batch);
      setActiveRun(createQueuedResearchWorkspaceRun({ runId, leads: nextLeads, items: payload?.items }));
      setActiveLeadKey(nextLeads[0]?.key || null);
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

  async function createDraft(item: ResearchWorkspaceRunItem) {
    if (!item.canCreateDraft || !item.researchSnapshotId) return;
    setCreatingDraftId(item.id);
    try {
      const response = await fetch('/api/native-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `native-draft:${item.researchSnapshotId}` },
        body: JSON.stringify({ researchSnapshotId: item.researchSnapshotId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft?.draftId) {
        toast({
          variant: 'destructive',
          title: 'No se pudo preparar el borrador',
          description: friendlyRequestError(payload, 'Inténtalo nuevamente.'),
        });
        return;
      }
      const draftId = encodeURIComponent(payload.draft.draftId);
      const versionId = payload.draft.versionId ? `&versionId=${encodeURIComponent(payload.draft.versionId)}` : '';
      router.push(`/contact/compose?draftId=${draftId}${versionId}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'No se pudo preparar el borrador',
        description: userMessage(error, 'Inténtalo nuevamente.'),
      });
    } finally {
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
    <main className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
      <PageHeader
        title={embedded ? `Investigar ${scopeLabel}` : 'Investigación'}
        description={embedded
          ? `Reúne evidencia aquí y crea el email cuando ${scope === 'opportunities' ? 'la oportunidad' : 'el lead'} esté listo.`
          : 'Reúne evidencia antes de preparar cada correo para que el siguiente paso tenga mejor contexto.'}
      >
        {embedded && onClose ? (
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onClose}>
            <ArrowLeft className="mr-2 size-4" />
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
            <RefreshCw className={runLoading ? 'animate-spin' : ''} />
            Actualizar estado
          </Button>
        ) : null}
      </PageHeader>

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
                {runLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Actualizar estado
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="research-overview-heading">
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
                      {isPolling ? 'Estamos reuniendo información para tu selección' : activeRun?.status === 'completed' ? 'La selección está lista para revisar' : 'Revisa el estado de tu selección'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isPolling
                        ? `${activeInFlightCount} ${activeInFlightCount === 1 ? 'lead sigue en curso' : 'leads siguen en curso'}. Puedes continuar revisando esta pantalla.`
                        : `${readyItems.length} ${readyItems.length === 1 ? 'lead está listo para redactar' : 'leads están listos para redactar'}.`}
                    </p>
                  </div>
                  {isPolling ? <div className="w-full sm:w-52"><Progress value={Math.max(8, Math.round(((runItems.length - activeInFlightCount) / Math.max(runItems.length, 1)) * 100))} className="h-1.5" /></div> : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section aria-labelledby="to-research-heading" className="min-w-0">
          <Card className="min-w-0 overflow-hidden rounded-[28px] border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
            <CardHeader className="gap-4 border-b border-border/60 pb-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <CardTitle id="to-research-heading" className="text-[1.35rem] tracking-[-0.03em]">Por investigar</CardTitle>
                  <CardDescription className="mt-1 max-w-xl leading-6">Selecciona los leads que quieres preparar con contexto antes de redactar.</CardDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="research-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar lead o empresa"
                    aria-label="Buscar leads para investigar"
                    className="h-10 rounded-full border-border/70 bg-background/85 pl-10"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
                    {selectedLeads.length ? `${selectedLeads.length} seleccionados` : `Hasta ${MAX_RESEARCH_BATCH_SIZE} por selección`}
                  </span>
                </div>
                <Button
                  type="button"
                  className="w-full rounded-full sm:w-auto"
                  onClick={() => void startResearch()}
                  disabled={researchUnavailable || selectionLocked || selectedLeads.length === 0}
                  aria-describedby={handoffPending ? 'research-handoff-help' : activeRunBlocksNewBatch ? 'research-batch-help' : undefined}
                >
                  {creatingBatch ? <Loader2 className="animate-spin" /> : <BrainCircuit />}
                  {creatingBatch ? 'Guardando selección…' : handoffPending ? 'Preparando selección…' : selectedLeads.length ? `Investigar ${selectedLeads.length}` : 'Investigar selección'}
                </Button>
              </div>
              {handoffNotice ? <p role="status" className="text-xs leading-5 text-muted-foreground">{handoffNotice}</p> : null}
              {handoffPending ? <p id="research-handoff-help" className="text-xs leading-5 text-muted-foreground">Estamos preparando la selección que trajiste desde tu lista.</p> : activeRunBlocksNewBatch ? <p id="research-batch-help" className="text-xs leading-5 text-muted-foreground">Espera a que termine la selección actual antes de iniciar otra.</p> : null}
            </CardHeader>

            <CardContent className="p-0">
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
              ) : queueLeads.length === 0 && workspaceLeads.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
                  <Target className="mb-3 size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">Aún no hay leads para investigar</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Busca y enriquece leads para preparar el contexto antes de escribirles.</p>
                  <Button type="button" className="mt-4 rounded-full" onClick={() => router.push('/search')}>Buscar leads <ArrowRight /></Button>
                </div>
              ) : queueLeads.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center px-5 py-9 text-center">
                  <CheckCircle2 className="mb-3 size-7 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
                  <p className="font-medium">No hay leads pendientes por investigar</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Revisa los leads listos para redactar antes de iniciar una nueva selección.</p>
                </div>
              ) : filteredQueueLeads.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center px-5 py-9 text-center">
                  <Search className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">No hay coincidencias</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Prueba con otro nombre, empresa o cargo.</p>
                  <Button type="button" className="mt-3 rounded-full" size="sm" variant="outline" onClick={() => setQuery('')}>Limpiar búsqueda</Button>
                </div>
              ) : (
                <ul className="divide-y divide-border/60" aria-label="Leads por investigar">
                  {filteredQueueLeads.map((lead) => {
                    const item = itemByLeadKey.get(lead.key);
                    const isActive = lead.key === activeLeadKey;
                    const inFlight = isResearchInFlight(item?.status || 'idle');
                    const selected = selectedKeys.includes(lead.key);
                    const quality = item?.qualityScore == null ? 'Sin evaluación' : `${item.qualityScore}/100`;
                    const evidence = item ? `${pluralize(item.evidenceCount, 'evidencia')} · ${pluralize(item.sourceCount, 'fuente')}` : 'Sin evidencia todavía';
                    const readiness = item ? researchReadinessLabel(item.readiness) : 'Por investigar';
                    return (
                      <li key={lead.key} className={isActive ? 'bg-primary/[0.04]' : ''}>
                        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3.5 sm:px-5">
                          <div className="pt-1.5">
                            <Checkbox
                              id={researchLeadCheckboxId(lead.key)}
                              checked={selected}
                              disabled={inFlight || selectionLocked}
                              onCheckedChange={(checked) => setLeadSelected(lead.key, Boolean(checked))}
                              aria-label={`Seleccionar ${lead.fullName || lead.companyName || 'lead'} para investigar`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveLeadKey(lead.key)}
                            aria-pressed={isActive}
                            className="min-w-0 rounded-xl text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                                <span><span className="font-medium text-foreground">Calidad:</span> {quality}</span>
                                <span><span className="font-medium text-foreground">Evidencia:</span> {evidence}</span>
                                <span className={`font-medium ${readinessClass(item?.readiness || 'review')}`}>{readiness}</span>
                              </span>
                              {inFlight ? <Progress value={progressFor(item?.status || 'idle')} className="h-1.5" /> : null}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="research-detail-heading" className="min-w-0">
          <Card className="min-w-0 overflow-hidden rounded-[28px] border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
            <CardHeader className="gap-2 border-b border-border/60 pb-4">
              <CardTitle id="research-detail-heading" className="text-[1.35rem] tracking-[-0.03em]">Detalle de investigación</CardTitle>
              <CardDescription className="leading-6">Selecciona un lead para revisar su estado, evidencia y fuentes antes de redactar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-4 sm:p-5">
              {runLoading && !activeRun ? (
                <div aria-busy="true" className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-2xl" />
                  <Skeleton className="h-28 w-full rounded-2xl" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
              ) : (
                <>
                  {readyItems.length > 0 ? (
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1" aria-label="Leads listos para redactar">
                      {readyItems.map((item) => {
                        const selected = item.lead.key === activeLeadKey;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveLeadKey(item.lead.key)}
                            aria-pressed={selected}
                            className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'border-primary/35 bg-primary/[0.06]' : 'border-border/60 bg-background/60 hover:bg-muted/40'}`}
                          >
                              <span className="min-w-0">
                                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="truncate text-sm font-medium">{item.lead.fullName || item.lead.companyName || 'Lead'}</span></span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">{item.lead.companyName || item.lead.email || 'Contexto listo para revisar'}</span>
                              <span className="mt-1 block text-xs text-emerald-700 dark:text-emerald-300">{pluralize(item.evidenceCount, 'evidencia')} · Lista para redactar</span>
                            </span>
                            <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">{item.qualityScore == null ? 'Lista' : `${item.qualityScore}/100`}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-4 text-sm leading-6 text-muted-foreground">
                      Los leads con evidencia suficiente aparecerán aquí cuando estén listos para revisar.
                    </div>
                  )}

                  <Separator />

                  {!activeLead ? (
                    <div className="flex min-h-52 flex-col items-center justify-center px-4 py-8 text-center">
                      <BrainCircuit className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
                      <p className="font-medium">Selecciona un lead</p>
                      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Podrás revisar su estado, calidad y evidencia en este panel.</p>
                    </div>
                  ) : (
                    <article aria-label={`Detalle de investigación de ${activeLead.fullName || activeLead.companyName || 'lead'}`} className="min-w-0 space-y-5">
                      <header className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{activeLead.companyName || 'Empresa'}{activeLead.title ? ` · ${activeLead.title}` : ''}</p>
                        <h2 className="mt-1 break-words text-xl font-semibold tracking-[-0.03em]">{activeLead.fullName || 'Lead sin nombre'}</h2>
                        <p className="mt-1 break-all text-sm text-muted-foreground">{activeLead.email || activeLead.companyDomain || 'Sin email ni dominio disponible'}</p>
                      </header>

                      {isResearchInFlight(activeStatus) ? (
                        <div className="rounded-2xl border border-sky-200 bg-sky-50/75 p-4 dark:border-sky-500/30 dark:bg-sky-500/10">
                          <div className="flex items-start gap-3">
                            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-sky-700 dark:text-sky-300" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-sky-950 dark:text-sky-100">Estamos reuniendo señales públicas</p>
                              <p className="mt-1 text-xs leading-5 text-sky-900/75 dark:text-sky-100/75">El resultado se guarda en tu selección. Puedes seguir revisando otros leads.</p>
                            </div>
                          </div>
                          <Progress value={progressFor(activeStatus)} className="mt-3 h-1.5" />
                        </div>
                      ) : activeStatus === 'failed' || activeStatus === 'cancelled' || activeStatus === 'insufficient_data' ? (
                        <div className={`rounded-2xl border p-4 ${activeStatus === 'failed' || activeStatus === 'cancelled' ? 'border-rose-200 bg-rose-50/80 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100' : 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'}`}>
                          <p className="text-sm font-medium">{activeStatus === 'insufficient_data' ? 'Aún falta evidencia para redactar' : 'Esta investigación necesita atención'}</p>
                          <p className="mt-1 text-xs leading-5 opacity-80">Incluye este lead en una nueva selección cuando tengas más información o quieras volver a investigarlo.</p>
                          <Button type="button" size="sm" variant="outline" className="mt-3 rounded-full" onClick={includeActiveLead} disabled={!canSelectActiveLead || selectionLocked}>
                            {selectedKeys.includes(activeLead.key) ? 'Incluido en la selección' : 'Incluir para investigar'}
                          </Button>
                        </div>
                      ) : activeItem?.result ? (
                        <>
                          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/75 p-4 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">Reporte guardado</p>
                              <p className="mt-1 text-xs leading-5 opacity-80">
                                {scope === 'leads'
                                  ? 'La investigación queda disponible en tu lista de leads cuando vuelvas.'
                                  : 'La investigación queda guardada en esta selección para que puedas revisarla.'}
                              </p>
                            </div>
                          </div>
                          <NativeResearchReport
                            result={activeItem.result}
                            status={activeStatus}
                            readiness={activeReadiness}
                            researchSnapshotId={activeItem.researchSnapshotId}
                            canCreateDraft={activeItem.canCreateDraft}
                            creatingDraft={creatingDraftId === activeItem.id}
                            createDraftLabel="Crear borrador y revisar"
                            creatingDraftLabel="Preparando borrador…"
                            onCreateDraft={() => void createDraft(activeItem)}
                            refreshing={creatingBatch}
                            onRefresh={() => void refreshActiveResearch()}
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
