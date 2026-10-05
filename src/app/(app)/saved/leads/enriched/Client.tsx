
'use client';
import Link from 'next/link';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedLead, LeadResearchReport } from '@/lib/types';
import { findReportForLead, leadResearchStorage, getLeadReports } from '@/lib/lead-research-storage';
import { v4 as uuid } from 'uuid';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { removeEnrichedLeadById, getEnrichedLeads as enrichedLeadsStorageGet, enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { Trash2, Download, FileSpreadsheet, RotateCw, Eraser, Linkedin, Phone, AlertTriangle, MoreHorizontal, ArrowRight, ChevronDown, ListFilter, MailCheck, Search, Upload } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { supabaseService } from '@/lib/supabase-service';
import { supabase } from '@/lib/supabase';
import { hasMeaningfulLeadResearch } from '@/lib/lead-research';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { unmarkResearched } from '@/lib/researched-leads-storage';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { haveSameSelection, retainVisibleSelection } from '@/lib/leads-workspace/selection';
import {
  MAX_RESEARCH_BATCH_SIZE,
  parseResearchReportDetail,
  type ResearchReportDetail,
} from '@/lib/research-workspace';
import { saveResearchWorkspaceHandoff } from '@/lib/research-workspace-handoff';
import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import NativeResearchReport, { NativeResearchReportSkeleton } from '@/components/research/NativeResearchReport';
import { researchDetailLoadingState } from '@/lib/research-report-loading';
import ResearchWorkspace from '@/components/research/ResearchWorkspace';
import { hasActivePhoneLookup } from '@/lib/enriched-phone-status';
import { EmailOwnerWarning, LeadName } from '@/components/leads/LeadName';
import { TeamLockBadge } from '@/components/collaboration/TeamLockBadge';
import { useTeamLocks } from '@/hooks/use-team-locks';
import { normalizeLockEmail } from '@/lib/team-lock';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { useConfirm } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { ActionBar } from '@/components/ui/action-bar';
import { InitialsAvatar } from '@/components/initials-avatar';
import { cn } from '@/lib/utils';
import * as Quota from '@/lib/quota-client';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';
import { createCoalescedRunner } from '@/lib/leads-workspace/coalesced-runner';
import {
  ENRICHED_EXPORT_HEADERS,
  ENRICHED_STAGE_LABELS,
  ENRICHED_STAGE_ORDER,
  enrichedExportRow,
  enrichedSelectionAction,
  enrichedStage,
  filterEnrichedLeads,
  hasUsableEmail,
  hasNativeResearchResult,
  isNativeResearchReport,
  nativeResearchCanCreateDraft,
  pendingPhoneLookupKey,
  withCompanyFromSaved,
  type EnrichedStage,
} from '@/lib/leads-workspace/enriched-view';

const PAGE_SIZE = 50;

export default function EnrichedLeadsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [enriched, setEnriched] = useState<EnrichedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [nativeResearchByLeadId, setNativeResearchByLeadId] = useState<Record<string, NativeResearchLeadStatus>>({});
  const [nativeResearchStatusState, setNativeResearchStatusState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nativeResearchStatusError, setNativeResearchStatusError] = useState('');
  const [openReport, setOpenReport] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [nativeReportDetails, setNativeReportDetails] = useState<Record<string, ResearchReportDetail>>({});
  const [nativeReportDetailLoading, setNativeReportDetailLoading] = useState<Record<string, boolean>>({});
  const [nativeReportDetailErrors, setNativeReportDetailErrors] = useState<Record<string, string>>({});
  const nativeReportDetailRequestsRef = useRef<Set<string>>(new Set());
  const nativeReportControllersRef = useRef(new Set<AbortController>());
  useEffect(() => () => {
    nativeReportControllersRef.current.forEach((controller) => controller.abort());
    nativeReportControllersRef.current.clear();
    nativeReportDetailRequestsRef.current.clear();
  }, []);
  const nativeResearchStatusRequestIdRef = useRef(0);
  const loadDataRequestIdRef = useRef(0);
  const nativeResearchStatusKnown = nativeResearchStatusState === 'ready';
  // Estados para Modal de llamada
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedLead | null>(null);

  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [reportLead, setReportLead] = useState<EnrichedLead | null>(null);

  // One selection for both steps: the action bar says whether it will research, write or both.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<'all' | EnrichedStage>('all');

  // --- Enrichment Options ---
  const [openEnrichOptions, setOpenEnrichOptions] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<EnrichedLead[]>([]);

  async function handleConfirmEnrich(opts: { revealEmail: boolean; revealPhone: boolean }) {
    if (!leadsToEnrich.length) return;
    setEnriching(true);
    try {
      // Map to minimal payload
      const payloadLeads = leadsToEnrich.map(l => ({
        fullName: l.fullName,
        linkedinUrl: l.linkedinUrl,
        companyName: l.companyName,
        companyDomain: l.companyDomain,
        title: l.title,
        sourceOpportunityId: l.sourceOpportunityId,
        clientRef: l.id,
        existingRecordId: l.id,
      }));
      const operationId = uuid();

      const res = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
          // The same daily-quota ticket «Por completar» sends: without it the server could not match the browser's count.
          'x-quota-ticket': getQuotaTicket() || '',
        },
        body: JSON.stringify({
          leads: payloadLeads,
          revealEmail: opts.revealEmail,
          revealPhone: opts.revealPhone,
          tableName: 'enriched_leads'
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = String(data?.error || data?.message || '').slice(0, 200);
        throw new Error(reason || `El servidor respondió ${res.status}. Intenta de nuevo en unos minutos.`);
      }

      if (process.env.NODE_ENV !== 'production' && Array.isArray(data?.debug?.serverLogs)) {
        console.groupCollapsed('[Server Logs] Apollo Enrichment');
        data.debug.serverLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
      }

      const ticket = data?.ticket || res.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);
      const consumed = Number(data?.usage?.consumed ?? 0);
      if (consumed > 0) Quota.incClientQuota('enrich', consumed);
      if (typeof data?.note === 'string' && data.note.includes('Quota')) {
        toast({ variant: 'destructive', title: 'Llegaste al límite de hoy', description: data.note });
      }

      const { enriched: newEnriched } = data;

      if (Array.isArray(newEnriched) && newEnriched.length) {
        const toUpdate: EnrichedLead[] = [];
        const toAdd: EnrichedLead[] = [];

        newEnriched.forEach((incoming: EnrichedLead & { clientRef?: string }) => {
          const incomingEnrichmentStatus = (incoming as any).enrichmentStatus as EnrichedLead['enrichmentStatus'];
          // Match with existing
          const existing = enriched.find(e => e.id === incoming.clientRef);
          if (existing) {
            // Merge important fields, keep ID
            toUpdate.push({
              ...existing, // Keep original creation date, etc
              fullName: incoming.fullName || existing.fullName,
              sourceProvider: incoming.sourceProvider || existing.sourceProvider,
              sourceProviderId: incoming.sourceProviderId || existing.sourceProviderId,
              email: incoming.email || existing.email,
              emailStatus: incoming.emailStatus || existing.emailStatus,
              phoneNumbers: incoming.phoneNumbers,
              primaryPhone: incoming.primaryPhone,
              enrichmentStatus: incomingEnrichmentStatus || existing.enrichmentStatus,
              // If unlocked new info
              linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
              companyName: incoming.companyName || existing.companyName,
              title: incoming.title || existing.title,
              // Ensure we use the proper ID for the update
              id: existing.id
            });
          } else {
            toAdd.push({
              ...incoming,
              enrichmentStatus: incomingEnrichmentStatus || ((incoming.primaryPhone || incoming.phoneNumbers?.length) ? 'completed' : 'pending_phone'),
            });
          }
        });

        if (toUpdate.length > 0) {
          await enrichedLeadsStorage.update(toUpdate);
        }
        if (toAdd.length > 0) {
          await enrichedLeadsStorage.addDedup(toAdd);
        }

        // Reload list
        const fresh = await enrichedLeadsStorageGet();
        setEnriched(fresh);
        const sent = toUpdate.length + toAdd.length;
        toast({
          title: 'Actualizando datos',
          description: `${sent} ${sent === 1 ? 'contacto enviado' : 'contactos enviados'}. Lo que llegue después (como un teléfono) aparece solo en la lista.`,
        });
      } else {
        toast({ title: 'Sin datos nuevos', description: 'El proveedor no devolvió datos nuevos para estos contactos.' });
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No pudimos actualizar los datos', description: e.message || 'Intenta de nuevo en unos minutos.' });
    } finally {
      setEnriching(false);
      setLeadsToEnrich([]);
    }
  }

  function initiateEnrichment(leads: EnrichedLead[]) {
    setLeadsToEnrich(leads);
    setOpenEnrichOptions(true);
  }

  // ===== Filtros (incluye/excluye) =====
  const [showFilters, setShowFilters] = useState(false);
  const [fIncCompany, setFIncCompany] = useState('');
  const [fIncLead, setFIncLead] = useState('');
  const [fIncTitle, setFIncTitle] = useState('');
  const [fExcCompany, setFExcCompany] = useState('');
  const [fExcLead, setFExcLead] = useState('');
  const [fExcTitle, setFExcTitle] = useState('');
  const [applied, setApplied] = useState({
    incCompany: '', incLead: '', incTitle: '',
    excCompany: '', excLead: '', excTitle: '',
  });

  // --- PAGINACIÓN ---
  const pageSize = PAGE_SIZE;
  const [page, setPage] = useState<number>(1);
  const pendingPhoneSyncRef = useRef(false);
  const [syncingPendingPhones, setSyncingPendingPhones] = useState(false);

  // --- FILTROS ---
  const [companyFilter, setCompanyFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [phoneFilter, setPhoneFilter] = useState<'all' | 'ready' | 'pending' | 'missing'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');

  const loadNativeResearchStatuses = useCallback(async (leads: EnrichedLead[]) => {
    const requestId = ++nativeResearchStatusRequestIdRef.current;
    const leadIds = Array.from(new Set(leads.map((lead) => String(lead.id || '').trim()).filter(Boolean)));
    setNativeResearchStatusState('loading');
    setNativeResearchStatusError('');
    if (leadIds.length === 0) {
      setNativeResearchByLeadId({});
      setNativeResearchStatusState('ready');
      return;
    }

    try {
      const chunks = Array.from({ length: Math.ceil(leadIds.length / 200) }, (_, index) => leadIds.slice(index * 200, (index + 1) * 200));
      const responses = await Promise.all(chunks.map(async (leadIdsChunk) => {
        const response = await fetch('/api/native-research/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: leadIdsChunk }),
        });
        if (!response.ok) throw new Error('NATIVE_RESEARCH_LEAD_STATUS_FAILED');
        const payload = await response.json();
        return Array.isArray(payload?.items) ? payload.items as NativeResearchLeadStatus[] : [];
      }));
      const next = Object.fromEntries(responses.flat().map((item) => [item.leadId, item]));
      if (nativeResearchStatusRequestIdRef.current !== requestId) return;
      setNativeResearchByLeadId(next);
      setNativeResearchStatusState('ready');
    } catch (error) {
      if (nativeResearchStatusRequestIdRef.current !== requestId) return;
      console.warn('[enriched-leads] Native research status lookup failed:', error);
      setNativeResearchByLeadId({});
      setNativeResearchStatusState('error');
      setNativeResearchStatusError('No pudimos comprobar qué leads están listos para investigar o redactar.');
    }
  }, []);

  const loadNativeResearchDetail = useCallback(async (status: NativeResearchLeadStatus) => {
    const reportId = String(status.reportId || '').trim();
    if (!reportId || !status.result || nativeReportDetailRequestsRef.current.has(reportId)) return;
    nativeReportDetailRequestsRef.current.add(reportId);
    const controller = new AbortController();
    nativeReportControllersRef.current.add(controller);
    setNativeReportDetailLoading((current) => ({ ...current, [reportId]: true }));
    setNativeReportDetailErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const response = await fetch(`/api/native-research/${encodeURIComponent(reportId)}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error('NATIVE_RESEARCH_DETAIL_FAILED');
      const detail = parseResearchReportDetail(payload, status.result);
      if (!detail) throw new Error('NATIVE_RESEARCH_DETAIL_INVALID');
      setNativeReportDetails((current) => ({ ...current, [reportId]: detail }));
    } catch {
      if (controller.signal.aborted) return;
      setNativeReportDetailErrors((current) => ({
        ...current,
        [reportId]: 'No pudimos actualizar el informe completo. Reintenta para comprobar su estado.',
      }));
    } finally {
      nativeReportControllersRef.current.delete(controller);
      if (controller.signal.aborted) return;
      nativeReportDetailRequestsRef.current.delete(reportId);
      setNativeReportDetailLoading((current) => ({ ...current, [reportId]: false }));
    }
  }, []);

  const retryNativeResearchSynthesis = useCallback(async (reportId: string) => {
    setNativeReportDetailLoading((current) => ({ ...current, [reportId]: true }));
    setNativeReportDetailErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const response = await fetch(`/api/native-research/${encodeURIComponent(reportId)}`, { method: 'POST' });
      if (!response.ok) throw new Error('NATIVE_RESEARCH_REPORT_RETRY_FAILED');
      setNativeReportDetails((current) => {
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
      setNativeReportDetailErrors((current) => ({
        ...current,
        [reportId]: 'No pudimos reintentar la preparación del reporte. Inténtalo nuevamente.',
      }));
    } finally {
      setNativeReportDetailLoading((current) => ({ ...current, [reportId]: false }));
    }
  }, []);

  const loadData = useCallback(async () => {
    const requestId = ++loadDataRequestIdRef.current;
    setLoadError('');
    try {
      const [e, saved] = await Promise.all([
        enrichedLeadsStorageGet(),
        supabaseService.getLeads(),
      ]);

      const patched = withCompanyFromSaved(e, saved);

      if (loadDataRequestIdRef.current !== requestId) return;
      setEnriched(patched);
      setReports(getLeadReports());
      await loadNativeResearchStatuses(patched);
    } catch (error) {
      if (loadDataRequestIdRef.current !== requestId) return;
      console.error('[enriched-leads] Load failed:', error);
      setLoadError('No pudimos cargar tus leads enriquecidos. Vuelve a intentarlo.');
    } finally {
      if (loadDataRequestIdRef.current === requestId) setLoadingLeads(false);
    }
  }, [loadNativeResearchStatuses]);

  // Realtime events, phone results and a late sign-in ask for a reload; a burst of them shares one
  // (src/lib/leads-workspace/coalesced-runner.ts). Before, each event reloaded the whole list at once.
  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);
  const reloaderRef = useRef<ReturnType<typeof createCoalescedRunner> | null>(null);
  useEffect(() => {
    const runner = createCoalescedRunner(() => loadDataRef.current());
    reloaderRef.current = runner;
    return () => {
      runner.cancel();
      if (reloaderRef.current === runner) reloaderRef.current = null;
    };
  }, []);
  const scheduleReload = useCallback(() => { reloaderRef.current?.schedule(); }, []);

  const enrichedRef = useRef(enriched);
  useEffect(() => { enrichedRef.current = enriched; }, [enriched]);

  const syncPendingPhoneLeads = useCallback(async (ids?: string[]) => {
    const targetIds = (ids || enrichedRef.current.filter((lead) => hasActivePhoneLookup(lead)).map((lead) => lead.id))
      .filter(Boolean)
      .slice(0, 50);

    if (targetIds.length === 0 || pendingPhoneSyncRef.current) return;
    pendingPhoneSyncRef.current = true;
    setSyncingPendingPhones(true);

    try {
      const res = await fetch('/api/enriched-leads/phone-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targetIds }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[phone-sync] request failed:', data);
        return;
      }

      if ((data?.updated || 0) > 0 || (data?.completedWithoutPhone || 0) > 0) {
        scheduleReload();
      }
    } catch (error) {
      console.warn('[phone-sync] unexpected error:', error);
    } finally {
      pendingPhoneSyncRef.current = false;
      setSyncingPendingPhones(false);
    }
  }, [scheduleReload]);

  useEffect(() => {
    void loadData();

    // Realtime Subscription
    const channel = supabase
      .channel('enriched-leads-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enriched_leads' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const newData = payload.new as any; // typed as any to access custom cols if needed
            const oldData = payload.old as any;
            const newPhones = Array.isArray(newData.phone_numbers) ? newData.phone_numbers : [];
            const phoneFound = Boolean(newData.primary_phone) || newPhones.length > 0;

            // Detect Status Change: Pending -> Completed
            if (newData.enrichment_status === 'completed' && oldData.enrichment_status === 'pending_phone') {
              if (phoneFound) {
                toast({
                  title: '¡Teléfono encontrado!',
                  description: `Se actualizó el contacto para ${newData.full_name || 'un lead'}.`,
                  duration: 5000,
                });
              } else {
                toast({
                  title: 'Búsqueda de teléfono finalizada',
                  description: `No se encontró teléfono para ${newData.full_name || 'este lead'}.`,
                  duration: 4500,
                });
              }
            }
          }
          scheduleReload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, scheduleReload, toast]);

  // Phone lookups still running are checked when that set changes and then every 15 s. Before, the check ran again on
  // every reload of the list, and a reload after each check could loop.
  const pendingPhoneKey = useMemo(() => pendingPhoneLookupKey(enriched), [enriched]);
  useEffect(() => {
    const pendingIds = pendingPhoneKey ? pendingPhoneKey.split(',') : [];
    if (pendingIds.length === 0) return;

    syncPendingPhoneLeads(pendingIds);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncPendingPhoneLeads(pendingIds);
      }
    }, 15000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncPendingPhoneLeads(pendingIds);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pendingPhoneKey, syncPendingPhoneLeads]);

  // A session that restores late reloads the list.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) scheduleReload();
    });
    return () => subscription.unsubscribe();
  }, [scheduleReload]);


  // Referencia compuesta estable (id || email || linkedin || nombre|empresa)
  const leadRefOf = useCallback((e: EnrichedLead) => {
    return e.id || e.email || e.linkedinUrl || `${e.fullName}|${e.companyName || ''}`;
  }, []);

  const nativeResearchForLead = useCallback((lead: EnrichedLead) => {
    if (!nativeResearchStatusKnown) return null;
    const leadId = String(lead.id || '').trim();
    return leadId ? nativeResearchByLeadId[leadId] || null : null;
  }, [nativeResearchByLeadId, nativeResearchStatusKnown]);

  const reportForLead = useCallback((lead: EnrichedLead) => {
    return findReportForLead({
      leadId: leadRefOf(lead),
      email: lead.email || null,
      companyDomain: lead.organizationDomain || lead.companyDomain || null,
      companyName: lead.companyName || null,
    });
  }, [leadRefOf]);

  /** Solo un reporte del mismo lead puede marcarlo como investigado. */
  const hasReportStrict = useCallback((e: EnrichedLead) => {
    if (isNativeResearchReport(nativeResearchForLead(e))) return true;
    const refs = new Set([leadRefOf(e), e.email || '']
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean));
    return reports.some((report) => refs.has(String(report.meta?.leadRef || '').trim().toLowerCase()) && hasMeaningfulLeadResearch(report));
  }, [leadRefOf, nativeResearchForLead, reports]);

  const hasReport = hasReportStrict;
  const hasViewableReport = useCallback(
    (lead: EnrichedLead) => hasNativeResearchResult(nativeResearchForLead(lead)) || hasReport(lead),
    [hasReport, nativeResearchForLead],
  );

  const canContact = useCallback((lead: EnrichedLead) => {
    if (!nativeResearchStatusKnown) return false;
    const native = nativeResearchForLead(lead);
    if (native?.result) {
      const detail = nativeReportDetails[native.reportId];
      return !nativeReportDetailErrors[native.reportId] && Boolean(detail && researchDetailLoadingState(detail).showReport && !researchDetailLoadingState(detail).failed)
        && nativeResearchCanCreateDraft(lead, native);
    }
    return hasReport(lead) && Boolean(lead.email);
  }, [hasReport, nativeResearchForLead, nativeResearchStatusKnown, nativeReportDetails, nativeReportDetailErrors]);

  const reportStatusLabelFor = (lead: EnrichedLead) => {
    const native = nativeResearchForLead(lead);
    if (!native?.result) return null;
    if (nativeReportDetailErrors[native.reportId]) return 'Revisar informe';
    const detail = nativeReportDetails[native.reportId];
    if (!detail) return 'Comprobando informe';
    const state = researchDetailLoadingState(detail);
    return state.pending ? 'Preparando informe' : state.failed || state.unavailable ? 'Revisar informe' : null;
  };

  const industryOptions = useMemo(
    () => Array.from(new Set(enriched.map((lead) => String(lead.industry || lead.organizationIndustry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [enriched],
  );

  // ---- Filtros con varios términos separados por coma (src/lib/leads-workspace/enriched-view.ts) ----
  const filtered = useMemo(
    () => filterEnrichedLeads(enriched, { searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo, applied }),
    [enriched, applied, searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo],
  );

  // One stage per contact (src/lib/leads-workspace/enriched-view.ts). «Listo para escribir» counts here when the report
  // can draft; the row's «Escribir» still waits for the full report to load, as before.
  const stageOf = useCallback((lead: EnrichedLead): EnrichedStage => {
    const native = nativeResearchForLead(lead);
    return enrichedStage({
      hasEmail: hasUsableEmail(lead.email),
      researching: ['queued', 'running'].includes(native?.status || ''),
      viewable: hasViewableReport(lead),
      ready: native?.result ? nativeResearchCanCreateDraft(lead, native) : hasReport(lead),
    });
  }, [hasReport, hasViewableReport, nativeResearchForLead]);

  const stageCounts = useMemo(() => {
    const counts: Record<EnrichedStage, number> = { to_research: 0, researching: 0, review: 0, ready: 0, no_email: 0 };
    for (const lead of enriched) counts[stageOf(lead)] += 1;
    return counts;
  }, [enriched, stageOf]);

  const listed = useMemo(
    () => stageFilter === 'all' ? filtered : filtered.filter((lead) => stageOf(lead) === stageFilter),
    [filtered, stageFilter, stageOf],
  );

  useEffect(() => {
    setPage(1);
  }, [searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo, applied, stageFilter]);

  // Mantener número de página válido si cambia la cantidad total
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(listed.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [listed.length, pageSize, page]);

  // --- Cálculo de la página actual (sobre la lista que se ve) ---
  const total = listed.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageLeads = useMemo(() => listed.slice(startIdx, endIdx), [listed, startIdx, endIdx]);
  // Who in the team already holds each contact on this page (Plan 5, PR-9b); empty without collaboration.
  const teamLocks = useTeamLocks({ emails: pageLeads.map(e => normalizeLockEmail(e.email)).filter(email => email.includes('@')) });
  const teamLockFor = (lead: EnrichedLead) => teamLocks?.byEmail[normalizeLockEmail(lead.email)];

  const pendingPhoneCount = useMemo(
    () => enriched.filter((lead) => hasActivePhoneLookup(lead)).length,
    [enriched],
  );

  const selectedLeads = useMemo(() => enriched.filter((lead) => selected.has(lead.id)), [enriched, selected]);
  const selectedToResearch = selectedLeads.filter((lead) => stageOf(lead) === 'to_research').length;
  const selectedReady = selectedLeads.filter((lead) => stageOf(lead) === 'ready').length;
  const selectablePage = pageLeads.filter((lead) => hasUsableEmail(lead.email));
  const allPageChecked = selectablePage.length > 0 && selectablePage.every((lead) => selected.has(lead.id));

  useEffect(() => {
    const next = retainVisibleSelection(selected, enriched.map((lead) => lead.id));
    if (!haveSameSelection(selected, next)) setSelected(next);
  }, [enriched, selected]);

  const investigatedInList = useMemo(
    () => listed.filter(hasReportStrict).length,
    [listed, hasReportStrict]
  );

  const selectionLimitToast = () => toast({
    title: `Puedes elegir hasta ${MAX_RESEARCH_BATCH_SIZE} contactos a la vez`,
    description: 'La selección actual se mantuvo. Abre esta selección o quita algunos antes de sumar más.',
  });

  const toggleAllPage = (checked: boolean) => {
    if (!checked) {
      setSelected((current) => {
        const next = new Set(current);
        pageLeads.forEach((lead) => next.delete(lead.id));
        return next;
      });
      return;
    }
    const next = new Set(selected);
    const candidates = selectablePage.filter((lead) => !next.has(lead.id));
    const room = Math.max(0, MAX_RESEARCH_BATCH_SIZE - next.size);
    candidates.slice(0, room).forEach((lead) => next.add(lead.id));
    setSelected(next);
    if (candidates.length > room) selectionLimitToast();
  };

  const toggleLead = (leadId: string, checked: boolean) => {
    if (!checked) {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(leadId);
        return next;
      });
      return;
    }
    if (selected.has(leadId)) return;
    if (selected.size >= MAX_RESEARCH_BATCH_SIZE) {
      selectionLimitToast();
      return;
    }
    setSelected((current) => new Set(current).add(leadId));
  };

  const openResearchWorkspace = (
    leadIds: Iterable<string> = selected,
    options: { refresh?: boolean } = {},
  ) => {
    if (!nativeResearchStatusKnown) return;
    const selectedIds = Array.from(leadIds);
    if (selectedIds.length === 0) return;

    const availableIds = new Set(enriched.map((lead) => lead.id));
    if (selectedIds.some((id) => !availableIds.has(id))) {
      toast({
        variant: 'destructive',
        title: 'La lista cambió',
        description: 'Actualiza la lista antes de abrir la investigación. Tu selección no se modificó.',
      });
      return;
    }

    const handoff = saveResearchWorkspaceHandoff({
      source: 'enriched-leads',
      leadIds: selectedIds,
      refresh: options.refresh === true,
    });
    if (!handoff.ok) {
      toast({ variant: 'destructive', title: 'No pudimos abrir la investigación', description: handoff.message });
      return;
    }

    setResearchOpen(true);
  };

  // Compose sends here a contact that still needs research (?investigar=<id>): open its research directly, once, instead of
  // asking the person to find and select it in the list again.
  const deepLinkedResearch = useRef(false);
  useEffect(() => {
    if (deepLinkedResearch.current || loadingLeads || !nativeResearchStatusKnown) return;
    const target = new URLSearchParams(window.location.search).get('investigar');
    deepLinkedResearch.current = true;
    if (target && enriched.some((lead) => lead.id === target)) openResearchWorkspace([target]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingLeads, nativeResearchStatusKnown, enriched]);

  async function clearInvestigationFor(lead: EnrichedLead) {
    const accepted = await confirm({
      title: `¿Borrar la investigación de ${lead.fullName || 'este contacto'}?`,
      description: 'Podrás investigarlo de nuevo. No se envía ningún correo.',
      confirmLabel: 'Borrar investigación',
      tone: 'danger',
    });
    if (!accepted) return;
    const ref = leadRefOf(lead);

    const removedCount = leadResearchStorage.removeWhere(r => {
      const reportRef = (r?.meta?.leadRef || '').trim().toLowerCase();
      return [ref, lead.email || ''].some((value) => reportRef === String(value).trim().toLowerCase() && reportRef.length > 0);
    });

    unmarkResearched([ref]);
    setReports(getLeadReports());
    setReportToView(null);
    setReportLead(null);
    setOpenReport(false);
    toast({
      title: 'Investigación eliminada',
      description: removedCount > 0 ? `Se borraron los datos de ${lead.fullName}.` : 'No se encontró un reporte para borrar.',
    });
  }

  /** Borra los reportes de los contactos que se ven en la lista (con los filtros actuales) y limpia marcas legacy. */
  async function clearInvestigations() {
    const targets = listed.filter(hasReportStrict);
    if (!targets.length) return;
    const accepted = await confirm({
      title: `¿Borrar ${targets.length === 1 ? 'la investigación de 1 contacto' : `las investigaciones de ${targets.length} contactos`}?`,
      description: 'Solo los contactos de la lista que ves, con los filtros actuales. Podrás investigarlos de nuevo.',
      confirmLabel: 'Borrar investigaciones',
      tone: 'danger',
    });
    if (!accepted) return;

    // 1) Construir referencias exactas de los leads objetivo.
    const refs = targets.map(leadRefOf).filter(Boolean);

    // 2) Eliminar solo reportes ligados a estos leads, nunca los de otro contacto de la empresa.
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim().toLowerCase();
      return Boolean(ref && refs.map((value) => value.toLowerCase()).includes(ref));
    });

    // 3) Desmarcar "investigado"
    unmarkResearched(refs);

    // 4) Refrescar estado
    setReports(getLeadReports());
    setSelected(new Set());

    // 5) Aviso
    toast({
      title: 'Investigaciones borradas',
      description: removedCount > 0
        ? `Se eliminaron ${removedCount} reporte(s). Ahora puedes investigar de nuevo.`
        : 'No se encontraron reportes para borrar. Igual puedes investigar de nuevo.',
    });
  }

  /** Borra reportes e investigación SOLO de los "Contactar seleccionados". */
  async function clearInvestigationsSelected() {
    const targets = selectedLeads;
    if (!targets.length) return;
    const accepted = await confirm({
      title: `¿Borrar la investigación de ${targets.length === 1 ? '1 contacto seleccionado' : `${targets.length} contactos seleccionados`}?`,
      description: 'Podrás investigarlos de nuevo. No se envía ningún correo.',
      confirmLabel: 'Borrar investigación',
      tone: 'danger',
    });
    if (!accepted) return;

    const refs = targets.map(leadRefOf).filter(Boolean);
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim().toLowerCase();
      return Boolean(ref && refs.map((value) => value.toLowerCase()).includes(ref));
    });

    unmarkResearched(refs);
    setReports(getLeadReports());
    toast({
      title: 'Investigaciones borradas (seleccionados)',
      description: removedCount > 0 ? `Se eliminaron ${removedCount} reporte(s).` : 'No se encontraron reportes para borrar.',
    });
  }

  async function handleLogCall(result: 'connected' | 'voicemail' | 'wrong_number' | 'no_answer', notes: string) {
    if (!leadToCall) return;

    try {
      // 1. Guardar en Contactados con notas completas
      const resultLabel = result === 'connected' ? 'Contactado' :
        result === 'voicemail' ? 'Buzón de voz' :
          result === 'wrong_number' ? 'Número equivocado' :
            'No contestó';

      await contactedLeadsStorage.add({
        id: uuid(),
        leadId: leadToCall.id,
        name: leadToCall.fullName,
        email: leadToCall.email || '',
        company: leadToCall.companyName,
        role: leadToCall.title,
        industry: leadToCall.industry || undefined,
        city: leadToCall.city || leadToCall.country || undefined,
        country: leadToCall.country || undefined,
        subject: notes ? `Llamada: ${resultLabel} - ${notes}` : `Llamada telefónica: ${resultLabel}`,
        sentAt: new Date().toISOString(),
        status: result === 'connected' ? 'sent' : 'failed',
        provider: 'phone',
        lastUpdateAt: new Date().toISOString(),
      });

      // 2. Remover de Enriquecidos
      await removeEnrichedLeadById(leadToCall.id);
      setEnriched(prev => prev.filter(e => e.id !== leadToCall.id));

      toast({
        title: 'Llamada registrada',
        description: `Contacto movido a Conversaciones. ${notes ? 'Notas guardadas.' : ''}`
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la llamada.' });
    }
  }

  async function handleDeleteEnriched(id: string) {
    const lead = enriched.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: `¿Quitar a ${lead?.fullName || 'este contacto'} de «Por escribir»?`,
      description: 'No se envía ningún correo. Si lo necesitas de nuevo, búscalo y guárdalo otra vez.',
      confirmLabel: 'Quitar',
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      const next = await removeEnrichedLeadById(id);
      setEnriched(next);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      toast({ title: 'Eliminado', description: 'Se quitó el contacto de «Por escribir».' });
    } catch (error) {
      console.error('[enriched-leads] Delete failed:', error);
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: 'El lead sigue en la lista. Inténtalo nuevamente.' });
    }
  }

  // ---------- Export helpers ----------
  const buildRows = (list: EnrichedLead[]) => list.map(enrichedExportRow);
  const handleExportCsv = () => {
    if (!listed.length) return;
    exportToCsv(ENRICHED_EXPORT_HEADERS, buildRows(listed), `contactos-por-escribir-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const handleExportXlsx = async () => {
    if (!listed.length) return;
    await exportToXlsx(ENRICHED_EXPORT_HEADERS, buildRows(listed), `contactos-por-escribir-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCompanyFilter('');
    setNameFilter('');
    setTitleFilter('');
    setIndustryFilter('all');
    setPhoneFilter('all');
    setCreatedFrom('');
    setCreatedTo('');
    setFIncCompany('');
    setFIncLead('');
    setFIncTitle('');
    setFExcCompany('');
    setFExcLead('');
    setFExcTitle('');
    setApplied({ incCompany: '', incLead: '', incTitle: '', excCompany: '', excLead: '', excTitle: '' });
    setStageFilter('all');
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    searchTerm || companyFilter || nameFilter || titleFilter || industryFilter !== 'all' ||
    phoneFilter !== 'all' || createdFrom || createdTo || Object.values(applied).some(Boolean) || stageFilter !== 'all',
  );

  const nativeReportToView = reportLead ? nativeResearchForLead(reportLead) : null;
  const nativeReportIdToView = String(nativeReportToView?.reportId || '').trim();
  const nativeReportDetailToView = nativeReportIdToView ? nativeReportDetails[nativeReportIdToView] || null : null;
  const nativeReportSynthesisToView = nativeReportDetailToView?.preferredReportSynthesis || null;
  const nativeReportDetailError = nativeReportIdToView ? nativeReportDetailErrors[nativeReportIdToView] || '' : '';
  const nativeReportIsPending = Boolean(
    openReport
    && nativeReportToView?.result
    && nativeReportIdToView
    && ['completed', 'partial', 'insufficient_data'].includes(nativeReportToView.status)
    && !nativeReportDetailToView
    && !nativeReportDetailError
  );
  const nativeReportIsLoading = nativeReportIsPending || Boolean(
    nativeReportIdToView
    && nativeReportDetailLoading[nativeReportIdToView]
    && !nativeReportDetailToView,
  );

  useEffect(() => {
    if (
      !openReport
      || !nativeReportToView?.result
      || !nativeReportIdToView
      || !['completed', 'partial', 'insufficient_data'].includes(nativeReportToView.status)
      || nativeReportDetailToView
      || nativeReportDetailError
    ) return;
    void loadNativeResearchDetail(nativeReportToView);
  }, [loadNativeResearchDetail, nativeReportDetailError, nativeReportDetailToView, nativeReportIdToView, nativeReportToView, openReport]);

  useEffect(() => {
    const targets = [...new Map([
      ...pageLeads.map(nativeResearchForLead),
      ...(openReport ? [nativeReportToView] : []),
    ].filter((status): status is NativeResearchLeadStatus => Boolean(status?.result))
      .map((status) => [status.reportId, status])).values()];
    const poll = (includePending = false) => {
      targets.filter((status) => {
        if (nativeReportDetailErrors[status.reportId] || nativeReportDetailRequestsRef.current.has(status.reportId)) return false;
        const detail = nativeReportDetails[status.reportId];
        return !detail || (includePending && researchDetailLoadingState(detail).pending);
      }).slice(0, Math.max(0, 4 - nativeReportDetailRequestsRef.current.size))
        .forEach((status) => void loadNativeResearchDetail(status));
    };
    poll();
    const interval = window.setInterval(() => poll(true), 5_000);
    return () => window.clearInterval(interval);
  }, [loadNativeResearchDetail, pageLeads, nativeResearchForLead, nativeReportDetails, nativeReportDetailErrors, nativeReportToView, openReport]);

  const STAGE_CHIP_LABELS: Record<EnrichedStage, string> = {
    to_research: 'Por investigar',
    researching: 'Investigando',
    review: 'Revisar informe',
    ready: 'Listos para escribir',
    no_email: 'Sin correo',
  };
  // «Por investigar» and «Listos para escribir» always show (the tour points at them); the rest only when someone is there.
  const stageChips: Array<{ value: 'all' | EnrichedStage; label: string; count: number }> = [
    { value: 'all', label: 'Todos', count: enriched.length },
    ...ENRICHED_STAGE_ORDER
      .filter((stage) => stage === 'to_research' || stage === 'ready' || stageCounts[stage] > 0 || stageFilter === stage)
      .map((stage) => ({ value: stage, label: STAGE_CHIP_LABELS[stage], count: stageCounts[stage] })),
  ];

  const stageBadge = (lead: EnrichedLead) => {
    const stage = stageOf(lead);
    const native = nativeResearchForLead(lead);
    const detail = reportStatusLabelFor(lead);
    const withDetail = (badge: JSX.Element) => (
      <span className="inline-flex flex-col items-start gap-0.5">
        {badge}
        {detail ? <span className="text-xs text-foreground/70">{detail}</span> : null}
      </span>
    );
    if (stage === 'ready') return withDetail(<Badge variant="success">{ENRICHED_STAGE_LABELS.ready}</Badge>);
    if (stage === 'researching') return <Badge variant="info">{ENRICHED_STAGE_LABELS.researching}</Badge>;
    if (stage === 'review') {
      const limited = native?.status === 'insufficient_data' || !isNativeResearchReport(native);
      return withDetail(<Badge variant="warning">{limited ? 'Información limitada' : ENRICHED_STAGE_LABELS.review}</Badge>);
    }
    if (stage === 'no_email') return <Badge variant="neutral">{lead.emailStatus === 'locked' ? 'Correo no revelado' : ENRICHED_STAGE_LABELS.no_email}</Badge>;
    return <Badge variant="neutral">{ENRICHED_STAGE_LABELS.to_research}</Badge>;
  };

  /** The one button each row needs now: write when the report is ready, otherwise look at it, follow it or start it. */
  const rowAction = (lead: EnrichedLead) => {
    const stage = stageOf(lead);
    if (canContact(lead)) return <Button size="sm" onClick={() => openResearchWorkspace([lead.id])}>Escribir</Button>;
    if (stage === 'no_email') return <Button size="sm" variant="ghost" onClick={() => initiateEnrichment([lead])}>Actualizar datos</Button>;
    if (hasViewableReport(lead)) return <Button size="sm" variant="outline" onClick={() => openResearchWorkspace([lead.id])}>Ver investigación</Button>;
    return (
      <Button size="sm" variant="outline" onClick={() => openResearchWorkspace([lead.id])} disabled={!nativeResearchStatusKnown}>
        {stage === 'researching' ? 'Ver avance' : 'Investigar'}
      </Button>
    );
  };

  const rowMenu = (lead: EnrichedLead) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Más acciones para ${lead.fullName}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canContact(lead) && hasViewableReport(lead) ? <DropdownMenuItem onClick={() => openResearchWorkspace([lead.id])}>Ver investigación</DropdownMenuItem> : null}
        <DropdownMenuItem onClick={() => initiateEnrichment([lead])}>Actualizar datos</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void handleDeleteEnriched(lead.id)}>
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const leadIdentity = (lead: EnrichedLead) => (
    <div className="flex min-w-0 items-center gap-3">
      <InitialsAvatar name={lead.fullName} email={lead.email} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium"><LeadName name={lead.fullName} fallback="Contacto sin nombre" /></span>
          {lead.linkedinUrl ? (
            <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded text-foreground/70 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Perfil de LinkedIn de ${lead.fullName || 'este contacto'}`}>
              <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="truncate text-xs text-foreground/70">{lead.title || 'Sin cargo'}</div>
        <TeamLockBadge lock={teamLockFor(lead)} className="mt-0.5" />
      </div>
    </div>
  );

  const companyCell = (lead: EnrichedLead) => (
    <div className="min-w-0">
      <div className="truncate font-medium">{lead.companyName || 'Empresa no informada'}</div>
      <div className="truncate text-xs text-foreground/70">{lead.companyDomain || 'Sin dominio'}</div>
    </div>
  );

  const contactCell = (lead: EnrichedLead) => {
    const fallbackPhone = lead.phoneNumbers?.length ? lead.phoneNumbers[0].sanitized_number : undefined;
    const shownPhone = lead.primaryPhone || fallbackPhone;
    const noPhone = lead.primaryPhone === 'Not Found' || (!shownPhone && !hasActivePhoneLookup(lead));
    return (
      <div className="min-w-0 space-y-1">
        {hasUsableEmail(lead.email) ? (
          <>
            <div className="truncate">{lead.email}</div>
            <EmailOwnerWarning email={lead.email as string} name={lead.fullName} />
          </>
        ) : (
          <div className="text-xs text-foreground/70">{lead.emailStatus === 'locked' ? 'Correo no revelado' : 'Sin correo'}</div>
        )}
        {noPhone ? (
          <div className="text-xs text-foreground/70">Sin teléfono</div>
        ) : shownPhone ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-cw-success underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setLeadToCall(lead);
              setReportToView(reportForLead(lead) || null);
              setCallModalOpen(true);
            }}
            aria-label={`Llamar a ${lead.fullName} al ${shownPhone}`}
          >
            <Phone className="h-3 w-3" aria-hidden="true" />
            <span>{shownPhone}</span>
            {lead.phoneNumbers && lead.phoneNumbers.length > 1 ? <span className="text-[10px] text-foreground/70">+{lead.phoneNumbers.length - 1}</span> : null}
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs text-primary">
            <RotateCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
            Buscando teléfono
          </div>
        )}
      </div>
    );
  };

  const selectionHint = [
    selectedToResearch ? `${selectedToResearch} por investigar` : '',
    selectedReady ? `${selectedReady} ${selectedReady === 1 ? 'listo' : 'listos'} para escribir` : '',
    `hasta ${MAX_RESEARCH_BATCH_SIZE} a la vez`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Por escribir"
        count={enriched.length}
        description="Contactos con correo. Investígalos y escríbeles: la IA prepara el borrador y tú lo revisas antes de enviar."
        actions={(
          <>
            <Button asChild variant="ghost" className="w-full sm:w-auto">
              <Link href="/leads/import?from=por-escribir"><Upload className="h-4 w-4" aria-hidden="true" />Importar lista</Link>
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => router.push('/saved/leads')}>
              Ir a «Por completar»
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por etapa">
        {stageChips.map((option) => {
          const active = stageFilter === option.value;
          const chip = (
            <button
              type="button"
              aria-pressed={active}
              onClick={() => setStageFilter(option.value)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/70 bg-card text-foreground/70 hover:text-foreground',
              )}
            >
              {option.label}
              <span className="tabular-nums text-foreground/70">{option.count}</span>
            </button>
          );
          // The tour points at the first and the last step of the work: research, then write.
          if (option.value === 'to_research') return <span key={option.value} data-tour="enriched-research" className="inline-flex rounded-full">{chip}</span>;
          if (option.value === 'ready') return <span key={option.value} data-tour="enriched-contact" className="inline-flex rounded-full">{chip}</span>;
          return <span key={option.value} className="inline-flex">{chip}</span>;
        })}
      </div>

      {pendingPhoneCount > 0 ? (
        <Alert variant="info" role="status">
          <RotateCw className={cn('h-4 w-4', syncingPendingPhones ? 'motion-safe:animate-spin' : 'motion-safe:animate-pulse')} aria-hidden="true" />
          <AlertTitle>Búsqueda de teléfono en curso</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span>{pendingPhoneCount} {pendingPhoneCount === 1 ? 'teléfono solicitado hace poco' : 'teléfonos solicitados hace poco'}: comprobamos si el proveedor entregó un resultado. Puedes seguir trabajando.</span>
            <Button variant="outline" size="sm" className="shrink-0 bg-background" onClick={() => syncPendingPhoneLeads()} disabled={syncingPendingPhones}>
              <RotateCw className={cn('h-4 w-4', syncingPendingPhones && 'motion-safe:animate-spin')} aria-hidden="true" />
              {syncingPendingPhones ? 'Comprobando…' : 'Comprobar ahora'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_18px_50px_-44px_rgba(15,23,42,0.28)]">
        <CardContent className="p-0">
          <div className="space-y-3 border-b border-border/60 bg-muted/10 p-4 sm:p-5">
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" aria-hidden="true" />
                  <Input
                    className="h-10 rounded-full border-border/70 bg-background/90 pl-10"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar por nombre, empresa, cargo o correo"
                    aria-label="Buscar en «Por escribir»"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full" aria-expanded={showFilters}>
                      <ListFilter className="h-4 w-4" aria-hidden="true" />
                      Filtros
                      <ChevronDown className={cn('h-4 w-4 transition-transform', showFilters && 'rotate-180')} aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="rounded-full" disabled={listed.length === 0}>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Exportar ({listed.length})
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleExportCsv}><Download className="mr-2 h-4 w-4" aria-hidden="true" />CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportXlsx}><FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />Excel</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <CollapsibleContent>
                <div className="mt-3 rounded-2xl border border-border/60 bg-background/60 p-4">
                  <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1.5"><Label htmlFor="enriched-company">Empresa</Label><Input id="enriched-company" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} placeholder="Contiene…" /></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-name">Nombre</Label><Input id="enriched-name" value={nameFilter} onChange={e => setNameFilter(e.target.value)} placeholder="Contiene…" /></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-title">Cargo</Label><Input id="enriched-title" value={titleFilter} onChange={e => setTitleFilter(e.target.value)} placeholder="Contiene…" /></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-industry">Industria</Label><Select value={industryFilter} onValueChange={setIndustryFilter}><SelectTrigger id="enriched-industry"><SelectValue placeholder="Todas" /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem>{industryOptions.map((industry) => <SelectItem key={industry} value={industry}>{industry}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-phone">Teléfono</Label><Select value={phoneFilter} onValueChange={(value) => setPhoneFilter(value as typeof phoneFilter)}><SelectTrigger id="enriched-phone"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="ready">Disponible</SelectItem><SelectItem value="pending">En proceso</SelectItem><SelectItem value="missing">Sin teléfono</SelectItem></SelectContent></Select></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-from">Creado desde</Label><Input id="enriched-from" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label htmlFor="enriched-to">Creado hasta</Label><Input id="enriched-to" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} /></div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <Label htmlFor="enriched-include-company" className="text-xs font-semibold uppercase text-foreground/70">Incluir · Empresa</Label>
                      <Input id="enriched-include-company" className="mt-1" value={fIncCompany} onChange={e => setFIncCompany(e.target.value)} placeholder="contiene… (separa con comas)" />
                    </div>
                    <div>
                      <Label htmlFor="enriched-include-name" className="text-xs font-semibold uppercase text-foreground/70">Incluir · Nombre</Label>
                      <Input id="enriched-include-name" className="mt-1" value={fIncLead} onChange={e => setFIncLead(e.target.value)} placeholder="contiene… (separa con comas)" />
                    </div>
                    <div>
                      <Label htmlFor="enriched-include-title" className="text-xs font-semibold uppercase text-foreground/70">Incluir · Cargo</Label>
                      <Input id="enriched-include-title" className="mt-1" value={fIncTitle} onChange={e => setFIncTitle(e.target.value)} placeholder="contiene… (separa con comas)" />
                    </div>
                    <div>
                      <Label htmlFor="enriched-exclude-company" className="text-xs font-semibold uppercase text-foreground/70">Excluir · Empresa</Label>
                      <Input id="enriched-exclude-company" className="mt-1" value={fExcCompany} onChange={e => setFExcCompany(e.target.value)} placeholder="no contenga… (separa con comas)" />
                    </div>
                    <div>
                      <Label htmlFor="enriched-exclude-name" className="text-xs font-semibold uppercase text-foreground/70">Excluir · Nombre</Label>
                      <Input id="enriched-exclude-name" className="mt-1" value={fExcLead} onChange={e => setFExcLead(e.target.value)} placeholder="no contenga… (separa con comas)" />
                    </div>
                    <div>
                      <Label htmlFor="enriched-exclude-title" className="text-xs font-semibold uppercase text-foreground/70">Excluir · Cargo</Label>
                      <Input id="enriched-exclude-title" className="mt-1" value={fExcTitle} onChange={e => setFExcTitle(e.target.value)} placeholder="no contenga… (separa con comas)" />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters}>Limpiar</Button>
                    <Button
                      onClick={() => {
                        setApplied({
                          incCompany: fIncCompany,
                          incLead: fIncLead,
                          incTitle: fIncTitle,
                          excCompany: fExcCompany,
                          excLead: fExcLead,
                          excTitle: fExcTitle,
                        });
                        setPage(1);
                      }}
                    >
                      Aplicar términos
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <p className="text-xs text-foreground/70" role="status" aria-live="polite">
              {listed.length} de {enriched.length} contactos
            </p>
          </div>

          <div className="p-4 sm:p-5">
            {!loadingLeads && nativeResearchStatusState === 'loading' ? (
              <div className="mb-4 flex items-center gap-2 text-sm text-foreground/70" role="status">
                <RotateCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                Comprobando el estado de investigación…
              </div>
            ) : null}

            {!loadingLeads && nativeResearchStatusState === 'error' ? (
              <Alert variant="warning" className="mb-4">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Estado de investigación no disponible</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{nativeResearchStatusError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 bg-background/80"
                    onClick={() => void loadNativeResearchStatuses(enriched)}
                    aria-label="Reintentar comprobar el estado de investigación de los contactos"
                  >
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {loadError ? (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>No pudimos cargar los contactos</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{loadError}</span>
                  <Button variant="outline" size="sm" onClick={() => { setLoadingLeads(true); void loadData(); }}>Reintentar</Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {loadingLeads ? (
              <div className="space-y-2" aria-busy="true" aria-label="Cargando contactos">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-3 w-56 max-w-full" /></div>
                    <Skeleton className="hidden h-8 w-28 sm:block" />
                  </div>
                ))}
              </div>
            ) : !loadError && pageLeads.length === 0 ? (
              <EmptyState
                className="min-h-56 max-w-none justify-center rounded-2xl border border-dashed border-border/70"
                icon={enriched.length === 0 ? MailCheck : Search}
                title={enriched.length === 0 ? 'Aún no tienes contactos con correo' : 'No hay contactos con estos filtros'}
                description={enriched.length === 0
                  ? 'Busca el correo de tus contactos en «Por completar». Cuando lo encontremos, aparecerán aquí listos para escribirles.'
                  : 'Cambia la etapa, ajusta la búsqueda o limpia los filtros para volver a ver la lista.'}
                action={<Button size="sm" variant={enriched.length === 0 ? 'default' : 'outline'} onClick={() => enriched.length === 0 ? router.push('/saved/leads') : clearFilters()}>{enriched.length === 0 ? 'Ir a «Por completar»' : 'Limpiar filtros'}</Button>}
              />
            ) : !loadError ? (
              <>
                <ul className="space-y-2 lg:hidden" aria-label="Contactos por escribir">
                  {pageLeads.map((e) => (
                    <li key={e.id} className={cn('rounded-xl border border-border/60 bg-card p-3', selected.has(e.id) && 'border-primary/50 bg-primary/5')}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          className="mt-2.5"
                          checked={selected.has(e.id)}
                          disabled={!hasUsableEmail(e.email)}
                          onCheckedChange={(value) => toggleLead(e.id, Boolean(value))}
                          aria-label={`Seleccionar a ${e.fullName || 'este contacto'}`}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          {leadIdentity(e)}
                          <div>{stageBadge(e)}</div>
                          <div className="text-sm">{companyCell(e)}</div>
                          <div className="text-sm">{contactCell(e)}</div>
                          <div className="flex flex-wrap items-center gap-1">
                            {rowAction(e)}
                            <span className="ml-auto flex">{rowMenu(e)}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-background/60 lg:block">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allPageChecked}
                            disabled={selectablePage.length === 0}
                            onCheckedChange={(value) => toggleAllPage(Boolean(value))}
                            aria-label="Seleccionar los contactos de esta página"
                          />
                        </TableHead>
                        <TableHead>Contacto</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead>Correo y teléfono</TableHead>
                        <TableHead>Etapa</TableHead>
                        <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageLeads.map((e) => (
                        <TableRow key={e.id} data-state={selected.has(e.id) ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(e.id)}
                              disabled={!hasUsableEmail(e.email)}
                              onCheckedChange={(value) => toggleLead(e.id, Boolean(value))}
                              aria-label={`Seleccionar a ${e.fullName || 'este contacto'}`}
                            />
                          </TableCell>
                          <TableCell className="max-w-[300px]">{leadIdentity(e)}</TableCell>
                          <TableCell className="max-w-[220px]">{companyCell(e)}</TableCell>
                          <TableCell className="max-w-[280px]">{contactCell(e)}</TableCell>
                          <TableCell>{stageBadge(e)}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {rowAction(e)}
                              {rowMenu(e)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}

          {/* Paginador inferior (igual al superior) */}
          {!loadingLeads && !loadError && total > 0 ? <div className="mt-3 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-foreground/70">
              Mostrando {total === 0 ? 0 : startIdx + 1}–{endIdx} de {total}
            </div>
            <div className="flex max-w-full items-center gap-1">
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" aria-label="Primera página" onClick={() => { setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>«</Button>
              <Button variant="outline" size="sm" aria-label="Página anterior" onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>‹</Button>
              <span className="min-w-20 px-2 text-center text-xs font-medium tabular-nums text-foreground/70 sm:hidden" aria-live="polite">Página {page} de {totalPages}</span>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const half = 3;
                let start = Math.max(1, page - half);
                let end = Math.min(totalPages, start + 6);
                start = Math.max(1, end - 6);
                const n = start + i;
                if (n > end) return null;
                const active = n === page;
                return (
                  <Button
                    key={n}
                    size="sm"
                    className="hidden sm:inline-flex"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => { setPage(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    {n}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" aria-label="Página siguiente" onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>›</Button>
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" aria-label="Última página" onClick={() => { setPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>»</Button>
            </div>
          </div> : null}
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <ActionBar
          ariaLabel="Acciones con los contactos seleccionados"
          label={`${selected.size} ${selected.size === 1 ? 'contacto seleccionado' : 'contactos seleccionados'}`}
          hint={selectionHint}
        >
          <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>Quitar selección</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" aria-label="Más acciones para la selección">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                Más
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => initiateEnrichment(selectedLeads)}>Actualizar datos ({selected.size})</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void clearInvestigationsSelected()}>Borrar investigación de seleccionados</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void clearInvestigations()} disabled={investigatedInList === 0} className="text-destructive focus:text-destructive">Borrar investigaciones de la lista ({investigatedInList})</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            onClick={() => openResearchWorkspace(selectedLeads.filter((lead) => hasUsableEmail(lead.email)).map((lead) => lead.id))}
            disabled={!nativeResearchStatusKnown}
          >
            {enrichedSelectionAction({ total: selected.size, toResearch: selectedToResearch, ready: selectedReady })}
          </Button>
        </ActionBar>
      ) : null}

      <Sheet open={researchOpen} onOpenChange={(open) => {
        setResearchOpen(open);
        if (!open) void loadNativeResearchStatuses(enriched);
      }}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="h-dvh w-full max-w-none overflow-hidden border-l border-border/70 p-0 sm:w-[94vw] sm:max-w-[1280px]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Investigación de leads</SheetTitle>
            <SheetDescription>Investiga los leads enriquecidos y prepara un email con evidencia.</SheetDescription>
          </SheetHeader>
          <ResearchWorkspace embedded scope="leads" onClose={() => {
            setResearchOpen(false);
            void loadNativeResearchStatuses(enriched);
          }} />
        </SheetContent>
      </Sheet>

      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-[28px] p-0 sm:h-[90dvh]" onEscapeKeyDown={() => setOpenReport(false)}>
          <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 pr-12 sm:px-6 sm:pr-12">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Investigación</div>
                <DialogTitle className="mt-1 text-xl">{nativeReportToView?.result?.lead.companyName || reportToView?.cross?.company.name || reportLead?.companyName || 'Reporte del lead'}</DialogTitle>
                <DialogDescription className="mt-1 leading-5">
                  Revisa el estado, la calidad y la evidencia antes de crear el email.
                </DialogDescription>
              </div>
              {reportLead && canContact(reportLead) ? <Button size="sm" onClick={() => { setOpenReport(false); openResearchWorkspace([reportLead.id]); }}>Contactar</Button> : null}
            </div>
          </DialogHeader>
          {reportToView?.cross && reportLead && !hasNativeResearchResult(nativeReportToView) && (
            <div className="flex justify-end px-5 pt-3 sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearInvestigationFor(reportLead)}
                title="Eliminar investigación de este lead"
                className="h-8 text-muted-foreground hover:text-destructive"
              >
                <Eraser className="mr-1 h-4 w-4" /> Eliminar investigación
              </Button>
            </div>
          )}
          {hasNativeResearchResult(nativeReportToView) && nativeReportToView?.result && reportLead ? (
            <div
              role="region"
              aria-label="Contenido del reporte de investigación"
              tabIndex={0}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {nativeReportIsLoading ? (
                <NativeResearchReportSkeleton className="px-5 py-5 sm:px-6 sm:py-6" />
              ) : (
                <>
                  {nativeReportDetailError ? (
                    <div className="mx-5 mt-5 flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/65 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-100 sm:mx-6 sm:flex-row sm:items-center sm:justify-between" role="alert">
                      <span>{nativeReportDetailError}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-full bg-background/80"
                        onClick={() => void loadNativeResearchDetail(nativeReportToView)}
                        aria-label={`Reintentar cargar el reporte completo de ${reportLead.fullName || reportLead.companyName || 'este lead'}`}
                      >
                        <RotateCw aria-hidden="true" />
                        Reintentar
                      </Button>
                    </div>
                  ) : null}
                  <NativeResearchReport
                    key={nativeReportIdToView}
                    variant="preview"
                    hideHeader
                    questionnaireEnabled={Boolean(nativeReportDetailToView?.questionnaireEnabled)}
                    result={nativeReportDetailToView?.result || nativeReportToView.result}
                    reportDocument={nativeReportDetailToView?.preferredReportDocument}
                    startedAt={nativeReportDetailToView?.result.startedAt}
                    loadError={Boolean(nativeReportDetailError)}
                    reportSynthesis={nativeReportSynthesisToView}
                    status={nativeReportToView.status}
                    researchSnapshotId={nativeReportToView.researchSnapshotId}
                    onRefresh={() => {
                      setOpenReport(false);
                      openResearchWorkspace([reportLead.id], { refresh: true });
                    }}
                    retryingSynthesis={Boolean(nativeReportIdToView && nativeReportDetailLoading[nativeReportIdToView])}
                    onRetrySynthesis={nativeReportSynthesisToView?.status === 'failed_permanent'
                      ? () => void retryNativeResearchSynthesis(nativeReportIdToView)
                      : undefined}
                    className="px-5 py-5 sm:px-6 sm:py-6"
                  />
                </>
              )}
            </div>
          ) : reportToView?.cross ? (
            <div
              role="region"
              aria-label="Contenido del reporte de investigación"
              tabIndex={0}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="space-y-4 px-5 pb-6 pt-4 text-sm leading-relaxed [overflow-wrap:anywhere] sm:px-6">
                <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">Ángulo recomendado</div>
                  <p className="mt-2 text-base font-medium text-foreground">
                    {reportToView.cross.leadContext?.iceBreaker || reportToView.cross.nextSteps?.[0]?.action || reportToView.cross.valueProps?.[0] || 'Revisa la investigación y adapta el mensaje al contexto del lead.'}
                  </p>
                  {reportToView.cross.leadContext?.communicationStyle && <p className="mt-2 text-xs text-muted-foreground">Tono sugerido: {reportToView.cross.leadContext.communicationStyle}</p>}
                </section>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Necesidad', value: reportToView.cross.pains?.[0] || 'Sin necesidad confirmada' },
                    { label: 'Cómo ayudar', value: reportToView.cross.valueProps?.[0] || 'Sin propuesta confirmada' },
                    { label: 'Siguiente paso', value: reportToView.cross.nextSteps?.[0]?.action || 'Personalizar el mensaje antes de contactar' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
                      <p className="mt-1.5 text-sm text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>

                {reportToView.cross.overview && <p className="rounded-xl border border-border/60 bg-background p-4 text-sm text-muted-foreground">{reportToView.cross.overview}</p>}

                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="w-full justify-between rounded-xl">
                      Ver investigación completa
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 space-y-4">

                {/* --- Social Context / LinkedIn --- */}
                {reportToView.cross.leadContext && (reportToView.cross.leadContext.iceBreaker || reportToView.cross.leadContext.recentActivitySummary || reportToView.cross.leadContext.profileSummary) && (
                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-4 shadow-sm dark:border-sky-400/25">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Linkedin className="h-5 w-5" />
                      Contexto Social (LinkedIn)
                    </h3>
                    <div className="space-y-3">
                      {reportToView.cross.leadContext.iceBreaker && (
                        <div className="rounded-md border border-border/60 bg-background/80 p-3 shadow-sm">
                          <strong className="mb-2 block text-sm text-foreground">Inicio sugerido:</strong>
                          <p className="text-sm italic leading-relaxed text-muted-foreground">"{reportToView.cross.leadContext.iceBreaker}"</p>
                        </div>
                      )}

                      {reportToView.cross.leadContext.recentActivitySummary && (
                        <div className="rounded-md border border-border/60 bg-background/80 p-3">
                          <strong className="mb-2 block text-sm text-foreground">Actividad reciente:</strong>
                          <p className="text-sm leading-relaxed text-muted-foreground">{reportToView.cross.leadContext.recentActivitySummary}</p>
                        </div>
                      )}

                      {reportToView.cross.leadContext.profileSummary && (
                        <div className="border-t border-border/60 pt-3">
                          <strong className="mb-2 block text-sm text-foreground">Resumen de perfil:</strong>
                          <p className="text-sm leading-relaxed text-muted-foreground">{reportToView.cross.leadContext.profileSummary}</p>
                        </div>
                      )}

                      {reportToView.cross.leadContext.communicationStyle && (
                        <div className="border-t border-border/60 pt-3">
                          <strong className="mb-2 block text-sm text-foreground">Tono sugerido:</strong>
                          <p className="text-sm leading-relaxed text-muted-foreground">{reportToView.cross.leadContext.communicationStyle}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {reportToView.cross.overview && <p>{reportToView.cross.overview}</p>}

                {(() => {
                  const reportSignals = reportToView.signals || [];
                  return reportSignals.length > 0 ? (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Señales recientes</h4>
                    <ul className="space-y-2">
                      {reportSignals.map((signal, i) => (
                        <li key={i} className="rounded-md border bg-muted/40 p-3">
                          <div className="font-medium">{signal.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">{signal.type}{signal.when ? ` · ${signal.when}` : ''}</div>
                          {signal.url ? <a className="underline text-xs mt-1 inline-block" href={signal.url} target="_blank">Abrir fuente</a> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                  ) : null;
                })()}

                {reportToView.cross.pains?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Pains</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.pains.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.opportunities?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Oportunidades</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.opportunities.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.risks?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Riesgos</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.risks.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.valueProps?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Cómo ayudamos</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.valueProps.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.useCases?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Casos de uso</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.useCases.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.talkTracks?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Talk tracks</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.talkTracks.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.subjectLines?.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Asuntos sugeridos</h4>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.subjectLines.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </section>
                )}

                {reportToView.cross.emailDraft && (
                  <section className="border rounded p-3 bg-muted/50">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Borrador de correo</div>
                    <div><strong>Asunto:</strong> {reportToView.cross.emailDraft.subject}</div>
                    <pre className="whitespace-pre-wrap mt-2 font-mono text-xs">{reportToView.cross.emailDraft.body}</pre>
                  </section>
                )}

                {reportToView.cross.nextSteps?.length ? (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Siguientes pasos</h4>
                    <ul className="space-y-2">
                      {reportToView.cross.nextSteps.map((step, i) => (
                        <li key={i} className="rounded-md border bg-muted/40 p-3">
                          <div className="font-medium">{step.action}</div>
                          {step.why ? <div className="mt-1 text-xs text-muted-foreground">{step.why}</div> : null}
                          {step.priority ? <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Prioridad: {step.priority}</div> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {reportToView.cross.contradictions?.length ? (
                  <section className="rounded border border-amber-500/25 bg-amber-500/10 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-foreground">Puntos a validar</div>
                    <ul className="list-disc pl-5">
                      {reportToView.cross.contradictions.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </section>
                ) : null}

                {reportToView.cross.confidence && Object.keys(reportToView.cross.confidence).length > 0 ? (
                  <section className="rounded border border-emerald-500/25 bg-emerald-500/10 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-foreground">Confianza por bloque</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(reportToView.cross.confidence).map(([key, value]) => (
                        <div key={key} className="rounded-md border border-border/60 bg-background/80 px-3 py-2 text-sm">
                          <div className="font-medium capitalize">{key}</div>
                          <div className="text-xs text-muted-foreground">{Math.round(Number(value) * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {reportToView.raw?.buyer_intelligence && (
                  <section className="rounded border border-emerald-500/25 bg-emerald-500/10 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-foreground">Inteligencia comercial</div>
                    <div className="grid gap-2 md:grid-cols-2 text-sm">
                      <div><strong>Fit score:</strong> {reportToView.raw.buyer_intelligence.fit_score ?? '—'}</div>
                      <div><strong>Ángulo recomendado:</strong> {reportToView.raw.buyer_intelligence.recommended_angle || '—'}</div>
                      <div><strong>Canal recomendado:</strong> {reportToView.raw.buyer_intelligence.recommended_channel || '—'}</div>
                      <div><strong>CTA sugerido:</strong> {reportToView.raw.buyer_intelligence.recommended_cta || '—'}</div>
                    </div>
                    {Array.isArray(reportToView.raw.buyer_intelligence.fit_reasons) && reportToView.raw.buyer_intelligence.fit_reasons.length > 0 ? (
                      <ul className="list-disc pl-5 mt-3">
                        {reportToView.raw.buyer_intelligence.fit_reasons.map((reason: string, i: number) => <li key={i}>{reason}</li>)}
                      </ul>
                    ) : null}
                  </section>
                )}

                {reportToView.raw?.outreach_pack?.call_script && (
                  <section className="rounded border border-amber-500/25 bg-amber-500/10 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-foreground">Guion de llamada</div>
                    <div className="space-y-2 text-sm">
                      {reportToView.raw.outreach_pack.call_script.opening ? <p><strong>Apertura:</strong> {reportToView.raw.outreach_pack.call_script.opening}</p> : null}
                      {Array.isArray(reportToView.raw.outreach_pack.call_script.discovery_questions) && reportToView.raw.outreach_pack.call_script.discovery_questions.length > 0 ? (
                        <div>
                          <strong>Preguntas de descubrimiento:</strong>
                          <ul className="list-disc pl-5 mt-1">
                            {reportToView.raw.outreach_pack.call_script.discovery_questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {reportToView.raw.outreach_pack.call_script.cta ? <p><strong>Cierre sugerido:</strong> {reportToView.raw.outreach_pack.call_script.cta}</p> : null}
                    </div>
                  </section>
                )}

                {reportToView.cross.sources?.length ? (
                  <section>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Fuentes</h4>
                    <ul className="space-y-1">
                      {reportToView.cross.sources.map((s, i) => (
                        <li key={i}>• <a className="underline" href={s.url} target="_blank">{s.title || s.url}</a></li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <PhoneCallModal
        open={callModalOpen}
        onOpenChange={setCallModalOpen}
        lead={leadToCall}
        report={reportToView} // Nos aseguramos de pasarle el reporte que corresponde al leadToCall
        onLogCall={handleLogCall}
      />

      <EnrichmentOptionsDialog
        open={openEnrichOptions}
        onOpenChange={setOpenEnrichOptions}
        onConfirm={handleConfirmEnrich}
        loading={enriching}
        leadCount={leadsToEnrich.length}
      />

    </div>
  );
}
