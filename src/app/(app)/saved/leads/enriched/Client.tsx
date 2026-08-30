
'use client';
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
import { Trash2, Download, FileSpreadsheet, RotateCw, Eraser, Linkedin, Phone, CheckCircle2, AlertTriangle, MoreHorizontal, ArrowLeft, ChevronDown, ListFilter, Search } from 'lucide-react';
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
  buildResearchReport,
  canShowResearchDraftAction,
  parseResearchReportDetail,
  researchDraftBlockReasonLabel,
  researchDraftErrorMessage,
  researchReadinessFor,
  type ResearchReportDetail,
} from '@/lib/research-workspace';
import { saveResearchWorkspaceHandoff } from '@/lib/research-workspace-handoff';
import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import { isPendingEnrichmentStatus, pendingEnrichmentKind } from '@/lib/enrichment-status';
import NativeResearchReport, { NativeResearchReportSkeleton } from '@/components/research/NativeResearchReport';
import ResearchWorkspace from '@/components/research/ResearchWorkspace';
import {
  MAX_NATIVE_DRAFT_BATCH_SIZE,
  createNativeDraftBatch,
} from '@/lib/native-draft-batch';


const extractDomainFromEmail = (email?: string | null) =>
  email && email.includes('@') ? email.split('@')[1].toLowerCase() : undefined;

type PreparedNativeDraft = {
  lead: EnrichedLead;
  draftId: string;
  versionId: string | null;
  subject: string;
  body: string;
};

type FailedNativeDraft = {
  lead: EnrichedLead;
  message: string;
};

function summarizePendingEnrichment(leads: EnrichedLead[]) {
  const counts = { email: 0, phone: 0, contact: 0, unknown: 0 };
  for (const lead of leads) {
    const kind = pendingEnrichmentKind(lead.enrichmentStatus);
    if (kind) counts[kind] += 1;
  }

  const total = counts.email + counts.phone + counts.contact + counts.unknown;
  if (counts.email === total && total > 0) {
    return {
      total,
      label: total === 1 ? 'actualizando correo' : 'actualizando correos',
      title: 'Actualizando correos',
    };
  }
  if (counts.phone === total && total > 0) {
    return {
      total,
      label: total === 1 ? 'actualizando teléfono' : 'actualizando teléfonos',
      title: 'Actualizando teléfonos',
    };
  }
  return { total, label: 'actualizando datos', title: 'Actualizando datos de contacto' };
}

function isNativeResearchReport(status: NativeResearchLeadStatus | null | undefined) {
  const review = nativeResearchReview(status);
  return Boolean(
    review
    && status
    && ['completed', 'partial'].includes(status.status)
    && status.researchSnapshotId
    && review.report.coverage.companyFacts > 0,
  );
}

function hasNativeResearchResult(status: NativeResearchLeadStatus | null | undefined) {
  return Boolean(
    status?.result
    && ['completed', 'partial', 'insufficient_data'].includes(status.status),
  );
}

function nativeResearchReview(status: NativeResearchLeadStatus | null | undefined) {
  if (!status?.result) return null;
  const report = buildResearchReport(status.result);
  const readiness = researchReadinessFor({
    status: status.status,
    lead: status.result.lead,
    result: status.result,
    snapshotId: status.researchSnapshotId,
    evidenceCount: report.coverage.evidenceRecords,
    sourceCount: report.coverage.sources,
  });
  return { report, readiness };
}

function nativeResearchCanCreateDraft(lead: EnrichedLead, status: NativeResearchLeadStatus | null | undefined) {
  const review = nativeResearchReview(status);
  return Boolean(
    lead.email
    && status?.result
    && review
    && canShowResearchDraftAction({
      readiness: review.readiness,
      snapshotId: status.researchSnapshotId,
      eligible: status.result.draftEligibility.eligible,
      canCreateDraft: true,
    }),
  );
}

import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';

export default function EnrichedLeadsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [tick, setTick] = useState(0); // Force re-render
  // ... existing state

  const [enriched, setEnriched] = useState<EnrichedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});           // selección para INVESTIGAR
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [nativeResearchByLeadId, setNativeResearchByLeadId] = useState<Record<string, NativeResearchLeadStatus>>({});
  const [nativeResearchStatusState, setNativeResearchStatusState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nativeResearchStatusError, setNativeResearchStatusError] = useState('');
  const [openReport, setOpenReport] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<string | null>(null);
  const [creatingDraftBatch, setCreatingDraftBatch] = useState(false);
  const [draftBatchProgress, setDraftBatchProgress] = useState({ done: 0, total: 0 });
  const [nativeReportDetails, setNativeReportDetails] = useState<Record<string, ResearchReportDetail>>({});
  const [nativeReportDetailLoading, setNativeReportDetailLoading] = useState<Record<string, boolean>>({});
  const [nativeReportDetailErrors, setNativeReportDetailErrors] = useState<Record<string, string>>({});
  const nativeReportDetailRequestsRef = useRef<Set<string>>(new Set());
  const nativeDraftRequestRef = useRef<string | null>(null);
  const nativeResearchStatusRequestIdRef = useRef(0);
  const loadDataRequestIdRef = useRef(0);
  const nativeResearchStatusKnown = nativeResearchStatusState === 'ready';
  const draftRequestPending = creatingDraftId !== null || creatingDraftBatch;
  // Estados para Modal de llamada
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedLead | null>(null);

  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [reportLead, setReportLead] = useState<EnrichedLead | null>(null);

  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());
  const [openCompose, setOpenCompose] = useState(false);
  const [composeList, setComposeList] = useState<PreparedNativeDraft[]>([]);
  const [failedComposeList, setFailedComposeList] = useState<FailedNativeDraft[]>([]);

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
        },
        body: JSON.stringify({
          leads: payloadLeads,
          revealEmail: opts.revealEmail,
          revealPhone: opts.revealPhone,
          tableName: 'enriched_leads'
        }),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();

      // Print server-side logs for debugging
      if (data?.debug?.serverLogs && Array.isArray(data.debug.serverLogs)) {
        console.groupCollapsed('[Server Logs] FullEnrich Enrichment');
        data.debug.serverLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
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
        toast({
          title: 'Enriquecimiento en curso',
          description: `Enviados: ${toUpdate.length + toAdd.length}. Los datos se actualizarán al finalizar.`,
        });
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
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
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const pendingEnrichmentSyncRef = useRef(false);
  const [syncingPendingEnrichment, setSyncingPendingEnrichment] = useState(false);

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
    setNativeReportDetailLoading((current) => ({ ...current, [reportId]: true }));
    setNativeReportDetailErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const response = await fetch(`/api/native-research/${encodeURIComponent(reportId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error('NATIVE_RESEARCH_DETAIL_FAILED');
      const detail = parseResearchReportDetail(payload, status.result);
      if (!detail) throw new Error('NATIVE_RESEARCH_DETAIL_INVALID');
      setNativeReportDetails((current) => ({ ...current, [reportId]: detail }));
    } catch {
      setNativeReportDetailErrors((current) => ({
        ...current,
        [reportId]: 'No pudimos cargar la versión completa. Mostramos la evidencia disponible en este reporte.',
      }));
    } finally {
      nativeReportDetailRequestsRef.current.delete(reportId);
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

      const patched = e.map((x) => {
        if (x.companyName && x.companyDomain) return x;

        // buscar el lead guardado que corresponde (mismo linkedin o mismo nombre+empresa)
        const match =
          saved.find(s => x.linkedinUrl && s.linkedinUrl === x.linkedinUrl) ||
          saved.find(s => `${s.name}|${s.company}`.toLowerCase() === `${x.fullName}|${x.companyName || ''}`.toLowerCase());

        const fromEmail = extractDomainFromEmail(x.email);
        const fromWebsite =
          match?.companyWebsite
            ? (match.companyWebsite.startsWith('http') ? new URL(match.companyWebsite).hostname : match.companyWebsite)
              .replace(/^https?:\/\//, '').replace(/^www\./, '')
            : undefined;

        return {
          ...x,
          companyName: x.companyName ?? match?.company ?? x.companyName ?? undefined,
          companyDomain: x.companyDomain ?? fromWebsite ?? fromEmail ?? x.companyDomain ?? undefined,
        };
      });

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

  const syncPendingEnrichmentLeads = useCallback(async (ids?: string[]) => {
    const targetIds = (ids || enriched.filter((lead) => isPendingEnrichmentStatus(lead.enrichmentStatus)).map((lead) => lead.id))
      .filter(Boolean)
      .slice(0, 50);

    if (targetIds.length === 0 || pendingEnrichmentSyncRef.current) return;
    pendingEnrichmentSyncRef.current = true;
    setSyncingPendingEnrichment(true);

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
        await loadData();
      }
    } catch (error) {
      console.warn('[phone-sync] unexpected error:', error);
    } finally {
      pendingEnrichmentSyncRef.current = false;
      setSyncingPendingEnrichment(false);
    }
  }, [enriched, loadData]);

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
            const emailFound = Boolean(newData.email) && newData.email !== 'Not Found';
            const pendingKind = pendingEnrichmentKind(oldData.enrichment_status);

            if (newData.enrichment_status === 'completed' && pendingKind) {
              if (pendingKind === 'email') {
                toast({
                  title: emailFound ? 'Correo encontrado' : 'Búsqueda de correo finalizada',
                  description: emailFound
                    ? `Se actualizó el contacto para ${newData.full_name || 'un lead'}.`
                    : `No se encontró correo para ${newData.full_name || 'este lead'}.`,
                  duration: 4500,
                });
              } else if (pendingKind === 'phone' && phoneFound) {
                toast({
                  title: '¡Teléfono encontrado!',
                  description: `Se actualizó el contacto para ${newData.full_name || 'un lead'}.`,
                  duration: 5000,
                });
              } else if (pendingKind === 'phone') {
                toast({
                  title: 'Búsqueda de teléfono finalizada',
                  description: `No se encontró teléfono para ${newData.full_name || 'este lead'}.`,
                  duration: 4500,
                });
              } else {
                const foundContactData = emailFound || phoneFound;
                toast({
                  title: foundContactData ? 'Datos de contacto actualizados' : 'Búsqueda de datos finalizada',
                  description: foundContactData
                    ? `Se actualizó el contacto para ${newData.full_name || 'un lead'}.`
                    : `No se encontraron datos nuevos para ${newData.full_name || 'este lead'}.`,
                  duration: 4500,
                });
              }
            }
          }
          // Reload data
          void loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, toast]);

  // Listen for Auth Changes to reload data if session restores late
  useEffect(() => {
    const pendingIds = enriched
      .filter((lead) => isPendingEnrichmentStatus(lead.enrichmentStatus))
      .map((lead) => lead.id)
      .filter(Boolean);

    if (pendingIds.length === 0) return;

    syncPendingEnrichmentLeads(pendingIds);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncPendingEnrichmentLeads(pendingIds);
      }
    }, 15000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncPendingEnrichmentLeads(pendingIds);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enriched, syncPendingEnrichmentLeads]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        void loadData();
      }
    });
    return () => subscription.unsubscribe();
  }, [loadData]);

  // 🔄 Refrescar si otro tab/página (compose) modifica el localStorage
  // DEPRECATED: Cloud sync handles this differently (realtime), removing local storage listener.
  /*
  useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (ev.key === 'leadflow-enriched-leads') {
        setEnriched(enrichedLeadsStorageGet());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  */

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
      return nativeResearchCanCreateDraft(lead, native);
    }
    return hasReport(lead) && Boolean(lead.email);
  }, [hasReport, nativeResearchForLead, nativeResearchStatusKnown]);

  // Normaliza cadenas (quita acentos y pasa a minúsculas)
  const norm = useCallback((s?: string | null) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''), []);

  const splitTerms = useCallback((value: string) =>
    value
      .split(',')
      .map(t => norm(t).trim())
      .filter(Boolean), [norm]);

  const getLeadPhoneState = useCallback((lead: EnrichedLead) => {
    const fallbackPhone = lead.phoneNumbers?.length ? lead.phoneNumbers[0].sanitized_number : undefined;
    const shownPhone = lead.primaryPhone || fallbackPhone;
    if (shownPhone && shownPhone !== 'Not Found') return 'ready';
    const pendingKind = pendingEnrichmentKind(lead.enrichmentStatus);
    if (pendingKind === 'phone' || pendingKind === 'contact' || pendingKind === 'unknown') return 'pending';
    return 'missing';
  }, []);

  const industryOptions = useMemo(
    () => Array.from(new Set(enriched.map((lead) => String(lead.industry || lead.organizationIndustry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [enriched],
  );

  // ---- Aplicación de filtros con soporte de múltiples términos (separados por coma) ----
  const filtered = useMemo(() => {
    // incluye
    const incCompanies = splitTerms(applied.incCompany);
    const incLeads = splitTerms(applied.incLead);
    const incTitles = splitTerms(applied.incTitle);
    // excluye
    const excCompanies = splitTerms(applied.excCompany);
    const excLeads = splitTerms(applied.excLead);
    const excTitles = splitTerms(applied.excTitle);

    const containsAny = (value?: string | null, terms?: string[]) => {
      if (!terms || terms.length === 0) return true; // si no hay filtro, pasa
      const v = norm(value);
      return terms.some(t => v.includes(t));
    };

    const excludesAll = (value?: string | null, terms?: string[]) => {
      if (!terms || terms.length === 0) return true; // si no hay filtro, pasa
      const v = norm(value);
      return terms.every(t => !v.includes(t));
    };


    return enriched.filter(e =>
      (!searchTerm || [e.fullName, e.companyName, e.title, e.email, e.companyDomain]
        .some((value) => norm(value).includes(norm(searchTerm)))) &&
      // INCLUIR: debe cumplir todos los grupos que el usuario haya escrito
      containsAny(e.companyName, incCompanies) &&
      containsAny(e.fullName, incLeads) &&
      containsAny(e.title, incTitles) &&

      (!companyFilter || norm(e.companyName).includes(norm(companyFilter))) &&
      (!nameFilter || norm(e.fullName).includes(norm(nameFilter))) &&
      (!titleFilter || norm(e.title).includes(norm(titleFilter))) &&
      (industryFilter === 'all' || String(e.industry || e.organizationIndustry || '').trim() === industryFilter) &&
      (phoneFilter === 'all' || getLeadPhoneState(e) === phoneFilter) &&
      (() => {
        if (!createdFrom && !createdTo) return true;
        const created = new Date(e.createdAt || 0);
        if (Number.isNaN(created.getTime())) return false;
        if (createdFrom && created < new Date(`${createdFrom}T00:00:00`)) return false;
        if (createdTo && created > new Date(`${createdTo}T23:59:59`)) return false;
        return true;
      })() &&

      // EXCLUIR: si alguno matchea, se descarta
      excludesAll(e.companyName, excCompanies) &&
      excludesAll(e.fullName, excLeads) &&
      excludesAll(e.title, excTitles)
    );
  }, [enriched, applied, splitTerms, norm, searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo, getLeadPhoneState]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo, applied]);

  // Mantener número de página válido si cambia la cantidad total
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [filtered.length, pageSize, page]);

  // Resetear a la primera página si cambia el tamaño de página
  useEffect(() => { setPage(1); }, [pageSize]);

  // --- Cálculo de la página actual (sobre filtrados) ---
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageLeads = useMemo(() => filtered.slice(startIdx, endIdx), [filtered, startIdx, endIdx]);

  // Elegibles totales (sobre la lista filtrada completa)
  const researchEligible = useMemo(
    () => nativeResearchStatusKnown ? filtered.filter(e => !!e.email && !hasReportStrict(e)).length : 0,
    [filtered, hasReportStrict, nativeResearchStatusKnown]
  );
  const pendingEnrichment = useMemo(() => summarizePendingEnrichment(enriched), [enriched]);

  // === Métricas para los "seleccionar todos" ===
  const researchEligiblePage = useMemo(
    () => nativeResearchStatusKnown ? pageLeads.filter(e => e.email && !hasReportStrict(e)).length : 0,
    [pageLeads, hasReportStrict, nativeResearchStatusKnown]
  );
  const contactEligiblePage = useMemo(() => pageLeads.filter(canContact).length, [pageLeads, canContact]);

  const allResearchChecked = useMemo(
    () => researchEligiblePage > 0 && pageLeads.filter(e => e.email && !hasReportStrict(e)).every(e => sel[e.id]),
    [pageLeads, sel, researchEligiblePage, hasReportStrict]
  );
  const allContactChecked = useMemo(
    () => contactEligiblePage > 0 && pageLeads.filter(canContact).every(l => selectedToContact.has(l.id)),
    [pageLeads, selectedToContact, contactEligiblePage, canContact]
  );
  const researchCount = Object.values(sel).filter(Boolean).length;

  useEffect(() => {
    const availableIds = enriched.map((lead) => lead.id);
    const nextResearchSelection = retainVisibleSelection(
      Object.keys(sel).filter((id) => sel[id]),
      availableIds,
    );
    const currentResearchSelection = new Set(Object.keys(sel).filter((id) => sel[id]));
    if (!haveSameSelection(currentResearchSelection, nextResearchSelection)) {
      setSel(Object.fromEntries(Array.from(nextResearchSelection).map((id) => [id, true])));
    }

    const nextContactSelection = retainVisibleSelection(selectedToContact, availableIds);
    if (!haveSameSelection(selectedToContact, nextContactSelection)) {
      setSelectedToContact(nextContactSelection);
    }
  }, [enriched, sel, selectedToContact]);

  const anyInvestigated = useMemo(
    () => enriched.some(hasReportStrict),
    [enriched, hasReportStrict]
  );

  const toggleAllResearch = (checked: boolean) => {
    if (!checked) {
      // desmarca solo los visibles
      setSel(prev => {
        const copy = { ...prev };
        pageLeads.forEach(e => { delete copy[e.id]; });
        return copy;
      });
      return;
    }

    const candidates = pageLeads.filter((lead) => (
      lead.email && !hasReportStrict(lead) && !sel[lead.id]
    ));
    const remainingCapacity = Math.max(0, MAX_RESEARCH_BATCH_SIZE - researchCount);
    const leadsToAdd = candidates.slice(0, remainingCapacity);

    setSel(prev => {
      const next = { ...prev };
      leadsToAdd.forEach((lead) => { next[lead.id] = true; });
      return next;
    });

    if (leadsToAdd.length < candidates.length) {
      toast({
        title: `Puedes investigar hasta ${MAX_RESEARCH_BATCH_SIZE} leads`,
        description: 'La selección actual se mantuvo. Desmarca algunos leads antes de agregar más.',
      });
    }
  };

  const toggleResearchLead = (leadId: string, checked: boolean) => {
    if (!checked) {
      setSel((prev) => ({ ...prev, [leadId]: false }));
      return;
    }
    if (sel[leadId]) return;
    if (researchCount >= MAX_RESEARCH_BATCH_SIZE) {
      toast({
        title: `Puedes investigar hasta ${MAX_RESEARCH_BATCH_SIZE} leads`,
        description: 'Inicia esta selección o desmarca un lead antes de agregar otro.',
      });
      return;
    }
    setSel((prev) => ({ ...prev, [leadId]: true }));
  };
  const toggleAllContact = (checked: boolean) => {
    if (!checked) {
      const next = new Set<string>(selectedToContact);
      pageLeads.forEach(l => next.delete(l.id));
      setSelectedToContact(next);
      return;
    }

    const next = new Set<string>(selectedToContact);
    const candidates = pageLeads.filter((lead) => canContact(lead) && !next.has(lead.id));
    const remainingCapacity = Math.max(0, MAX_NATIVE_DRAFT_BATCH_SIZE - next.size);
    candidates.slice(0, remainingCapacity).forEach((lead) => next.add(lead.id));
    setSelectedToContact(next);
    if (candidates.length > remainingCapacity) {
      toast({
        title: `Puedes preparar hasta ${MAX_NATIVE_DRAFT_BATCH_SIZE} borradores a la vez`,
        description: 'Prepara esta selección antes de agregar más leads.',
      });
    }
  };

  const toggleContactLead = (leadId: string, checked: boolean) => {
    if (!checked) {
      setSelectedToContact((current) => {
        const next = new Set(current);
        next.delete(leadId);
        return next;
      });
      return;
    }
    if (selectedToContact.has(leadId)) return;
    if (selectedToContact.size >= MAX_NATIVE_DRAFT_BATCH_SIZE) {
      toast({
        title: `Puedes preparar hasta ${MAX_NATIVE_DRAFT_BATCH_SIZE} borradores a la vez`,
        description: 'Prepara esta selección o desmarca un lead antes de agregar otro.',
      });
      return;
    }
    setSelectedToContact((current) => new Set(current).add(leadId));
  };

  const openResearchWorkspace = (
    leadIds: Iterable<string> = Object.keys(sel).filter((id) => sel[id]),
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

  function clearInvestigationFor(lead: EnrichedLead) {
    if (!confirm(`¿Borrar investigación para ${lead.fullName}?`)) return;
    const ref = leadRefOf(lead);

    const removedCount = leadResearchStorage.removeWhere(r => {
      const reportRef = (r?.meta?.leadRef || '').trim().toLowerCase();
      return [ref, lead.email || ''].some((value) => reportRef === String(value).trim().toLowerCase() && reportRef.length > 0);
    });

    unmarkResearched([ref]);
    setSelectedToContact((current) => {
      const next = new Set(current);
      next.delete(lead.id);
      return next;
    });
    setReports(getLeadReports());
    setReportToView(null);
    setReportLead(null);
    setOpenReport(false);
    toast({
      title: 'Investigación eliminada',
      description: removedCount > 0 ? `Se borraron los datos de ${lead.fullName}.` : 'No se encontró un reporte para borrar.',
    });
  }

  /** Borra reportes de investigación de los leads visibles y limpia marcas legacy. */
  function clearInvestigations() {
    if (!enriched.length) return;
    const ok = confirm('¿Borrar todos los reportes e investigaciones de los leads listados? Podrás investigarlos nuevamente.');
    if (!ok) return;

    // 1) Construir referencias exactas de los leads objetivo.
    const refs = enriched.map(leadRefOf).filter(Boolean);

    // 2) Eliminar solo reportes ligados a estos leads, nunca los de otro contacto de la empresa.
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim().toLowerCase();
      return Boolean(ref && refs.map((value) => value.toLowerCase()).includes(ref));
    });

    // 3) Desmarcar "investigado"
    unmarkResearched(refs);

    // 4) Refrescar estado
    setReports(getLeadReports());
    setSel({});                         // limpiar selección de investigar
    setSelectedToContact(new Set());    // limpiar selección de contactar

    // 5) Aviso
    toast({
      title: 'Investigaciones borradas',
      description: removedCount > 0
        ? `Se eliminaron ${removedCount} reporte(s). Ahora puedes investigar de nuevo.`
        : 'No se encontraron reportes para borrar. Igual puedes investigar de nuevo.',
    });
  }

  /** Borra reportes e investigación SOLO de los "Contactar seleccionados". */
  function clearInvestigationsSelected() {
    const targets = enriched.filter(l => selectedToContact.has(l.id));
    if (!targets.length) return;
    const ok = confirm(`¿Borrar investigaciones de ${targets.length} lead(s) seleccionados? Podrás investigarlos nuevamente.`);
    if (!ok) return;

    const refs = targets.map(leadRefOf).filter(Boolean);
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim().toLowerCase();
      return Boolean(ref && refs.map((value) => value.toLowerCase()).includes(ref));
    });

    unmarkResearched(refs);

    // Limpiar selección de contactar para los que ya no tienen reporte
    const nextSel = new Set<string>(selectedToContact);
    targets.forEach(t => nextSel.delete(t.id));
    setSelectedToContact(nextSel);

    setReports(getLeadReports());
    toast({
      title: 'Investigaciones borradas (seleccionados)',
      description: removedCount > 0 ? `Se eliminaron ${removedCount} reporte(s).` : 'No se encontraron reportes para borrar.',
    });
  }

  /** Borra reportes e investigación de un único lead (usado en el modal de reporte). */
  function clearSingleInvestigation(lead: EnrichedLead) {
    const ok = confirm(`¿Borrar la investigación de ${lead.fullName}?`);
    if (!ok) return;
    const ref = leadRefOf(lead);
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const rref = (r?.meta?.leadRef || '').trim().toLowerCase();
      return [ref, lead.email || ''].some((value) => rref === String(value).trim().toLowerCase() && rref.length > 0);
    });
    unmarkResearched([ref]);
    const nextSel = new Set<string>(selectedToContact); nextSel.delete(lead.id);
    setSelectedToContact(nextSel);
    setReports(getLeadReports());
    setOpenReport(false);
    toast({
      title: 'Investigación borrada',
      description: removedCount > 0 ? 'Se eliminó el reporte. Ya puedes reinvestigar.' : 'No se encontró reporte para borrar.',
    });
  }

  async function openBulkCompose() {
    if (nativeDraftRequestRef.current || !nativeResearchStatusKnown) return;
    const selectedLeads = enriched
      .filter((lead) => selectedToContact.has(lead.id) && canContact(lead))
      .slice(0, MAX_NATIVE_DRAFT_BATCH_SIZE);
    if (selectedLeads.length === 0) {
      toast({ title: 'Selecciona leads listos', description: 'Elige al menos un lead investigado con email válido.' });
      return;
    }

    const leadById = new Map(selectedLeads.map((lead) => [lead.id, lead]));
    const missingSnapshot: FailedNativeDraft[] = [];
    const targets = selectedLeads.flatMap((lead) => {
      const nativeStatus = nativeResearchForLead(lead);
      const report = reportForLead(lead);
      const researchSnapshotId = String(
        nativeStatus?.researchSnapshotId
        || report?.raw?.research_snapshot_id
        || report?.raw?.researchSnapshotId
        || '',
      ).trim();
      if (!researchSnapshotId) {
        missingSnapshot.push({ lead, message: 'La investigación necesita actualizarse antes de crear el borrador.' });
        return [];
      }
      return [{ leadId: lead.id, researchSnapshotId }];
    });

    setComposeList([]);
    setFailedComposeList(missingSnapshot);
    setDraftBatchProgress({ done: missingSnapshot.length, total: selectedLeads.length });
    setOpenCompose(true);
    if (targets.length === 0) return;

    nativeDraftRequestRef.current = 'batch';
    setCreatingDraftBatch(true);
    try {
      const results = await createNativeDraftBatch({
        targets,
        concurrency: 3,
        onProgress: (done) => setDraftBatchProgress({ done: done + missingSnapshot.length, total: selectedLeads.length }),
        createDraft: async (target) => {
          const response = await fetch('/api/native-drafts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': `native-draft:${target.researchSnapshotId}`,
            },
            body: JSON.stringify({ researchSnapshotId: target.researchSnapshotId }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.draft?.draftId) {
            throw new Error(researchDraftErrorMessage(payload, 'No pudimos preparar este borrador.'));
          }
          return payload.draft;
        },
      });

      const prepared = results.flatMap((result): PreparedNativeDraft[] => {
        if (result.status !== 'drafted') return [];
        const lead = leadById.get(result.target.leadId);
        if (!lead) return [];
        return [{
          lead,
          draftId: String(result.draft.draftId),
          versionId: String(result.draft.versionId || '').trim() || null,
          subject: String(result.draft.content?.subject || ''),
          body: String(result.draft.content?.text || ''),
        }];
      });
      const failed = results.flatMap((result): FailedNativeDraft[] => {
        if (result.status !== 'failed') return [];
        const lead = leadById.get(result.target.leadId);
        return lead ? [{ lead, message: result.error }] : [];
      });
      const preparedIds = new Set(prepared.map((item) => item.lead.id));
      setComposeList(prepared);
      setFailedComposeList([...missingSnapshot, ...failed]);
      setSelectedToContact((current) => new Set([...current].filter((leadId) => !preparedIds.has(leadId))));
      toast({
        title: prepared.length === 1 ? 'Borrador preparado' : `${prepared.length} borradores preparados`,
        description: failed.length || missingSnapshot.length
          ? 'Algunos leads necesitan revisión antes de volver a intentarlo.'
          : 'Revísalos uno por uno antes de contactar. Nada se envió automáticamente.',
      });
    } finally {
      if (nativeDraftRequestRef.current === 'batch') nativeDraftRequestRef.current = null;
      setCreatingDraftBatch(false);
    }
  }

  async function generateEmailFromReportFor(lead: EnrichedLead) {
    if (nativeDraftRequestRef.current) return;
    if (!nativeResearchStatusKnown) return;
    if (!canContact(lead)) {
      toast({
        title: 'El borrador aún no está disponible',
        description: 'Necesitamos un email válido y evidencia suficiente antes de prepararlo.',
      });
      return;
    }
    const nativeStatus = nativeResearchForLead(lead);
    if (nativeStatus?.result && nativeStatus.result.draftEligibility.eligible !== true) {
      toast({
        title: 'El borrador aún no está disponible',
        description: researchDraftBlockReasonLabel(nativeStatus.result.draftEligibility.blockReason),
      });
      return;
    }
    const report = reportForLead(lead);
    const researchSnapshotId = String(
      nativeStatus?.researchSnapshotId
      || report?.raw?.research_snapshot_id
      || report?.raw?.researchSnapshotId
      || '',
    ).trim();
    if (!researchSnapshotId) {
      toast({ title: 'Necesitamos actualizar la investigación', description: 'Este reporte no tiene un snapshot listo para crear el email.' });
      openResearchWorkspace([lead.id]);
      return;
    }

    nativeDraftRequestRef.current = lead.id;
    setCreatingDraftId(lead.id);
    try {
      const response = await fetch('/api/native-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `native-draft:${researchSnapshotId}` },
        body: JSON.stringify({ researchSnapshotId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft?.draftId) {
        throw new Error(researchDraftErrorMessage(payload, 'No pudimos preparar el borrador.'));
      }
      const draftId = encodeURIComponent(payload.draft.draftId);
      const versionId = payload.draft.versionId ? `&versionId=${encodeURIComponent(payload.draft.versionId)}` : '';
      router.push(`/contact/compose?draftId=${draftId}${versionId}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo preparar el borrador', description: error instanceof Error ? error.message : 'Inténtalo nuevamente.' });
    } finally {
      if (nativeDraftRequestRef.current === lead.id) nativeDraftRequestRef.current = null;
      setCreatingDraftId(null);
    }
  }

  function openReportFor(e: EnrichedLead) {
    const native = nativeResearchForLead(e);
    const rep = reportForLead(e);
    if (!hasNativeResearchResult(native) && !rep?.cross) {
      toast({ title: 'Sin reporte', description: 'Investiga este lead antes de abrir su reporte.' });
      return;
    }
    setReportToView(rep);
    setReportLead(e);
    setOpenReport(true);
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
        description: `Lead movido a Contactados. ${notes ? 'Notas guardadas.' : ''}`
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la llamada.' });
    }
  }

  async function handleDeleteEnriched(id: string) {
    const ok = confirm('¿Eliminar este lead de Enriquecidos?');
    if (!ok) return;
    try {
      const next = await removeEnrichedLeadById(id);
      setEnriched(next);
      // limpia selecciones
      setSel(prev => { const p = { ...prev }; delete p[id]; return p; });
      const s = new Set(selectedToContact); s.delete(id); setSelectedToContact(s);
      toast({ title: 'Eliminado', description: 'Se quitó el lead de Enriquecidos.' });
    } catch (error) {
      console.error('[enriched-leads] Delete failed:', error);
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: 'El lead sigue en la lista. Inténtalo nuevamente.' });
    }
  }

  // Contadores para toda la selección (no solo la página actual)
  const contactCount = selectedToContact.size;

  // ---------- Export helpers ----------
  const exportHeaders = ['Nombre', 'Cargo', 'Empresa', 'Email', 'Teléfono', 'LinkedIn', 'Dominio'];
  const toRow = (e: EnrichedLead): (string | number)[] => ([
    e.fullName || '',
    e.title || '',
    e.companyName || '',
    e.email || (e.emailStatus === 'locked' ? '(locked)' : ''),
    e.primaryPhone || (e.phoneNumbers && e.phoneNumbers[0] ? e.phoneNumbers[0].sanitized_number : '') || '',
    e.linkedinUrl || '',
    e.companyDomain || '',
  ]);
  const buildRows = (list: EnrichedLead[]) => list.map(toRow);
  const handleExportCsv = () => {
    if (!filtered.length) return;
    exportToCsv(exportHeaders, buildRows(filtered), 'enriched-leads.csv');
  };
  const handleExportXlsx = async () => {
    if (!filtered.length) return;
    await exportToXlsx(exportHeaders, buildRows(filtered), 'enriched-leads.xlsx');
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
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    searchTerm || companyFilter || nameFilter || titleFilter || industryFilter !== 'all' ||
    phoneFilter !== 'all' || createdFrom || createdTo || Object.values(applied).some(Boolean),
  );

  const phoneReadyCount = useMemo(
    () => enriched.filter((lead) => getLeadPhoneState(lead) === 'ready').length,
    [enriched, getLeadPhoneState],
  );
  const nativeReportToView = reportLead ? nativeResearchForLead(reportLead) : null;
  const nativeReportIdToView = String(nativeReportToView?.reportId || '').trim();
  const nativeReportDetailToView = nativeReportIdToView ? nativeReportDetails[nativeReportIdToView] || null : null;
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

  return (
    <div className="space-y-4 pb-8">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-3 mb-1 rounded-full text-muted-foreground" onClick={() => router.push('/saved/leads')}>
            <ArrowLeft className="h-4 w-4" />
            Guardados
          </Button>
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[2rem]">Leads enriquecidos</h1>
            <span className="text-sm tabular-nums text-muted-foreground">{enriched.length}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Investiga contactos, revisa su contexto y prepara el siguiente contacto.</p>
        </div>
        <Button
          className="w-full rounded-full sm:w-auto"
          onClick={() => {
            if (contactCount > 0) void openBulkCompose();
            else setOpenCompose(true);
          }}
          disabled={(contactCount === 0 && composeList.length === 0 && failedComposeList.length === 0) || loadingLeads || !nativeResearchStatusKnown || draftRequestPending}
          title={contactCount > 0 ? 'Crear borradores para revisar antes de contactar' : composeList.length > 0 ? 'Volver a los borradores preparados' : 'Selecciona leads investigados con email'}
        >
          {creatingDraftBatch
            ? `Preparando ${draftBatchProgress.done}/${draftBatchProgress.total}`
            : contactCount > 0
              ? `Crear borradores (${contactCount})`
              : composeList.length > 0
                ? `Ver borradores (${composeList.length})`
                : 'Crear borradores'}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm shadow-[0_14px_35px_-32px_rgba(15,23,42,0.28)]">
        <span><strong className="font-semibold tabular-nums">{phoneReadyCount}</strong> <span className="text-muted-foreground">con teléfono</span></span>
        <span><strong className="font-semibold tabular-nums">{nativeResearchStatusKnown ? researchEligible : '—'}</strong> <span className="text-muted-foreground">por investigar</span></span>
        {pendingEnrichment.total > 0 ? <span><strong className="font-semibold tabular-nums">{pendingEnrichment.total}</strong> <span className="text-muted-foreground">{pendingEnrichment.label}</span></span> : null}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} visibles</span>
      </div>

      {pendingEnrichment.total > 0 ? (
        <Alert className="border-sky-500/25 bg-sky-500/5 text-foreground dark:border-sky-400/25">
          <RotateCw className={`h-4 w-4 ${syncingPendingEnrichment ? 'animate-spin' : 'animate-pulse'}`} />
          <AlertTitle>{pendingEnrichment.title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-muted-foreground">{pendingEnrichment.total} {pendingEnrichment.total === 1 ? 'contacto sigue' : 'contactos siguen'} en proceso. La lista se actualizará automáticamente.</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full bg-background"
              onClick={() => syncPendingEnrichmentLeads()}
              disabled={syncingPendingEnrichment}
            >
              <RotateCw className={`mr-2 h-4 w-4 ${syncingPendingEnrichment ? 'animate-spin' : ''}`} />
              {syncingPendingEnrichment ? 'Actualizando...' : 'Actualizar ahora'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden rounded-3xl border-border/60 bg-card/85 shadow-[0_18px_50px_-44px_rgba(15,23,42,0.28)] dark:bg-card/70">
        <CardContent className="p-0">
          <div className="space-y-3 border-b border-border/60 bg-muted/10 p-4 sm:p-5">
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-10 rounded-full border-border/70 bg-background/90 pl-10"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por lead, empresa, cargo o email"
                  aria-label="Buscar leads enriquecidos"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full" aria-expanded={showFilters}>
                      <ListFilter className="h-4 w-4" />
                      Filtros
                      <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </Button>
                </CollapsibleTrigger>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="rounded-full" disabled={filtered.length === 0}>
                      <Download className="h-4 w-4" />
                      Exportar ({filtered.length})
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleExportCsv}><Download className="mr-2 h-4 w-4" />CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportXlsx}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

          {/* Panel de filtros (colapsable) */}
              <CollapsibleContent>
            <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5"><Label htmlFor="enriched-company">Empresa</Label><Input id="enriched-company" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} placeholder="Contiene…" /></div>
                <div className="space-y-1.5"><Label htmlFor="enriched-name">Nombre</Label><Input id="enriched-name" value={nameFilter} onChange={e => setNameFilter(e.target.value)} placeholder="Contiene…" /></div>
                <div className="space-y-1.5"><Label htmlFor="enriched-title">Cargo</Label><Input id="enriched-title" value={titleFilter} onChange={e => setTitleFilter(e.target.value)} placeholder="Contiene…" /></div>
                <div className="space-y-1.5"><Label>Industria</Label><Select value={industryFilter} onValueChange={setIndustryFilter}><SelectTrigger aria-label="Filtrar por industria"><SelectValue placeholder="Todas" /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem>{industryOptions.map((industry) => <SelectItem key={industry} value={industry}>{industry}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Teléfono</Label><Select value={phoneFilter} onValueChange={(value) => setPhoneFilter(value as typeof phoneFilter)}><SelectTrigger aria-label="Filtrar por estado del teléfono"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="ready">Disponible</SelectItem><SelectItem value="pending">En proceso</SelectItem><SelectItem value="missing">Sin teléfono</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label htmlFor="enriched-from">Creado desde</Label><Input id="enriched-from" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="enriched-to">Creado hasta</Label><Input id="enriched-to" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="enriched-include-company" className="text-xs font-semibold uppercase text-muted-foreground">Incluir · Empresa</Label>
                    <Input id="enriched-include-company" className="mt-1" value={fIncCompany} onChange={e => setFIncCompany(e.target.value)} placeholder="contiene… (separa con comas)" />
                  </div>
                  <div>
                    <Label htmlFor="enriched-include-name" className="text-xs font-semibold uppercase text-muted-foreground">Incluir · Nombre</Label>
                    <Input id="enriched-include-name" className="mt-1" value={fIncLead} onChange={e => setFIncLead(e.target.value)} placeholder="contiene… (separa con comas)" />
                  </div>
                  <div>
                    <Label htmlFor="enriched-include-title" className="text-xs font-semibold uppercase text-muted-foreground">Incluir · Cargo</Label>
                    <Input id="enriched-include-title" className="mt-1" value={fIncTitle} onChange={e => setFIncTitle(e.target.value)} placeholder="contiene… (separa con comas)" />
                  </div>
                  <div>
                    <Label htmlFor="enriched-exclude-company" className="text-xs font-semibold uppercase text-muted-foreground">Excluir · Empresa</Label>
                    <Input id="enriched-exclude-company" className="mt-1" value={fExcCompany} onChange={e => setFExcCompany(e.target.value)} placeholder="no contenga… (separa con comas)" />
                  </div>
                  <div>
                    <Label htmlFor="enriched-exclude-name" className="text-xs font-semibold uppercase text-muted-foreground">Excluir · Nombre</Label>
                    <Input id="enriched-exclude-name" className="mt-1" value={fExcLead} onChange={e => setFExcLead(e.target.value)} placeholder="no contenga… (separa con comas)" />
                  </div>
                  <div>
                    <Label htmlFor="enriched-exclude-title" className="text-xs font-semibold uppercase text-muted-foreground">Excluir · Cargo</Label>
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
          </div>

          <div className="p-4 sm:p-5">
          {!loadingLeads && nativeResearchStatusState === 'loading' ? (
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <RotateCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Comprobando el estado de investigación…
            </div>
          ) : null}

          {!loadingLeads && nativeResearchStatusState === 'error' ? (
            <Alert className="mb-4 border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="alert">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              <AlertTitle>Estado de investigación no disponible</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{nativeResearchStatusError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-full bg-background/80"
                  onClick={() => void loadNativeResearchStatuses(enriched)}
                  aria-label="Reintentar comprobar el estado de investigación de los leads"
                >
                  <RotateCw aria-hidden="true" />
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {loadError ? (
            <Alert className="border-destructive/25 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertTitle>No pudimos cargar los leads</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{loadError}</span>
                <Button variant="outline" size="sm" onClick={() => { setLoadingLeads(true); void loadData(); }}>Reintentar</Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {(researchCount > 0 || contactCount > 0) ? (
            <div className="sticky top-14 z-20 mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-lg shadow-black/5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm font-medium" aria-live="polite">
                {researchCount > 0 ? `${researchCount} para investigar · máximo ${MAX_RESEARCH_BATCH_SIZE}` : ''}
                {researchCount > 0 && contactCount > 0 ? ' · ' : ''}
                {contactCount > 0 ? `${contactCount} borrador${contactCount === 1 ? '' : 'es'} · máximo ${MAX_NATIVE_DRAFT_BATCH_SIZE}` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setSel({}); setSelectedToContact(new Set()); }}>Cancelar</Button>
                 {researchCount > 0 ? <Button variant="secondary" size="sm" onClick={() => openResearchWorkspace()} disabled={!nativeResearchStatusKnown || draftRequestPending}>Investigar selección ({researchCount})</Button> : null}
                 {contactCount > 0 ? (
                   <Button size="sm" onClick={() => void openBulkCompose()} disabled={!nativeResearchStatusKnown || draftRequestPending}>
                     {creatingDraftBatch ? `Preparando ${draftBatchProgress.done}/${draftBatchProgress.total}` : `Crear borradores (${contactCount})`}
                   </Button>
                 ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Más acciones para la selección"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onClick={() => initiateEnrichment(filtered.filter(e => selectedToContact.has(e.id)))} disabled={contactCount === 0}>Actualizar datos</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={clearInvestigationsSelected} disabled={contactCount === 0}>Borrar investigación de seleccionados</DropdownMenuItem>
                    <DropdownMenuItem onClick={clearInvestigations} disabled={!anyInvestigated} className="text-destructive focus:text-destructive">Borrar todas las investigaciones</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ) : null}

          {loadingLeads ? (
            <div className="overflow-hidden rounded-2xl border border-border/60" aria-busy="true" aria-live="polite">
              <span className="sr-only">Cargando leads enriquecidos</span>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 p-4 last:border-b-0 md:grid-cols-[40px_minmax(180px,1fr)_minmax(140px,0.8fr)_160px] md:gap-4">
                  <Skeleton className="h-4 w-4" />
                  <div className="space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-28" /></div>
                  <Skeleton className="hidden h-4 w-28 md:block" />
                  <Skeleton className="hidden h-8 w-24 md:ml-auto md:block" />
                </div>
              ))}
            </div>
          ) : !loadError ? (
          <>
          <div className="space-y-3 lg:hidden">
            {pageLeads.map((e) => {
              const native = nativeResearchForLead(e);
              const viewable = hasViewableReport(e);
              const draftable = canContact(e);
              const researching = ['queued', 'running'].includes(native?.status || '');
              return (
                <article key={e.id} className="rounded-2xl border border-border/60 bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{e.fullName || 'Lead sin nombre'}</h2>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{e.title || 'Sin cargo'} · {e.companyName || 'Sin empresa'}</p>
                    </div>
                    {viewable ? (
                      native?.status === 'insufficient_data' || !isNativeResearchReport(native) ? (
                        <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">Información limitada</span>
                      ) : <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">Investigado</span>
                    ) : researching ? <span className="shrink-0 text-xs font-medium text-sky-700 dark:text-sky-300">En curso</span> : null}
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    <p className="truncate">{e.email && e.email !== 'Not Found' ? e.email : e.emailStatus === 'locked' ? 'Email no revelado' : 'Sin email'}</p>
                    <p className="truncate">{e.companyDomain || 'Sin dominio'}</p>
                    {e.linkedinUrl ? <a className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline" href={e.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a> : null}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/25 p-2 text-xs">
                    <label className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1">
                      <Checkbox
                        checked={!!sel[e.id]}
                        onCheckedChange={(value) => toggleResearchLead(e.id, Boolean(value))}
                        disabled={!nativeResearchStatusKnown || !e.email || hasReportStrict(e)}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para investigar`}
                      />
                      <span className="truncate">Investigar</span>
                    </label>
                    <label className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1">
                      <Checkbox
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(value) => {
                          toggleContactLead(e.id, Boolean(value));
                        }}
                        disabled={!nativeResearchStatusKnown || !draftable}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para crear un borrador`}
                      />
                      <span className="truncate">Borrador</span>
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {viewable ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => openReportFor(e)} disabled={draftRequestPending}>Ver investigación</Button> : null}
                    {draftable ? (
                      <Button size="sm" className="rounded-full" onClick={() => void generateEmailFromReportFor(e)} disabled={draftRequestPending}>
                        {creatingDraftId === e.id ? 'Preparando borrador…' : 'Crear borrador y revisar'}
                      </Button>
                    ) : !viewable ? (
                      <Button size="sm" className="rounded-full" onClick={() => openResearchWorkspace([e.id])} disabled={!nativeResearchStatusKnown || !e.email || draftRequestPending}>Investigar</Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label={`Más acciones para ${e.fullName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => initiateEnrichment([e])}>Actualizar datos</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteEnriched(e.id)}><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-background/60 lg:block">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableHead className="sticky left-0 z-20 w-12 bg-muted/95 text-center backdrop-blur" title="Marcar para investigar">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Invest.</span>
                      <Checkbox
                        checked={allResearchChecked}
                        disabled={!nativeResearchStatusKnown || researchEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllResearch(Boolean(v))}
                        aria-label="Seleccionar todos para investigar"
                      />
                    </div>
                  </TableHead>
                  <TableHead className="sticky left-12 z-20 w-12 bg-muted/95 text-center backdrop-blur" title="Marcar para crear un borrador">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Borr.</span>
                      <Checkbox
                        checked={contactEligiblePage > 0 ? allContactChecked : false}
                        disabled={!nativeResearchStatusKnown || contactEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllContact(Boolean(v))}
                        aria-label="Seleccionar todos para crear borradores"
                      />
                    </div>
                  </TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-52 text-right"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.map(e => (
                  <TableRow key={e.id} className="group align-middle">
                    <TableCell className="sticky left-0 z-10 bg-background py-3 text-center group-hover:bg-muted/50">
                      <Checkbox
                        checked={!!sel[e.id]}
                        onCheckedChange={(v) => toggleResearchLead(e.id, Boolean(v))}
                        disabled={
                          !nativeResearchStatusKnown ||
                          !e.email ||
                          hasReportStrict(e)
                        }
                        title={
                          !e.email
                            ? 'Este lead no tiene email revelado'
                            : hasReportStrict(e)
                              ? 'Este lead ya fue investigado'
                              : ''
                        }
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para investigar`}
                      />
                    </TableCell>
                    <TableCell className="sticky left-12 z-10 bg-background py-3 text-center group-hover:bg-muted/50">
                      <Checkbox
                        disabled={!nativeResearchStatusKnown || !canContact(e)}
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(v) => {
                          toggleContactLead(e.id, Boolean(v));
                        }}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para crear un borrador`}
                      />
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="max-w-[200px] truncate font-medium">{e.fullName}</div>
                      <div className="max-w-[220px] truncate text-xs text-muted-foreground">{e.title || 'Sin cargo'}</div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="max-w-[180px] truncate font-medium">{e.companyName || '—'}</div>
                      <div className="max-w-[180px] truncate text-xs text-muted-foreground">{e.companyDomain || 'Sin dominio'}</div>
                    </TableCell>
                    <TableCell className="py-3">
                      {(!e.email || e.email === 'Not Found')
                        ? (e.emailStatus === 'locked'
                          ? <span className="text-xs text-muted-foreground">Email no revelado</span>
                          : <span className="text-xs text-muted-foreground">Sin email</span>)
                        : <div className="max-w-[260px] truncate">{e.email}</div>}
                      {(() => {
                        const pendingKind = pendingEnrichmentKind(e.enrichmentStatus);
                        return pendingKind === 'email' || pendingKind === 'contact' ? (
                          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300" title="Actualizando correo">
                            <RotateCw className="h-3 w-3 animate-spin" />
                            Buscando correo
                          </div>
                        ) : null;
                      })()}
                      {(() => {
                        const fallbackPhone = e.phoneNumbers?.length ? e.phoneNumbers[0].sanitized_number : undefined;
                        const shownPhone = e.primaryPhone || fallbackPhone;
                        const pendingKind = pendingEnrichmentKind(e.enrichmentStatus);
                        const phonePending = pendingKind === 'phone' || pendingKind === 'contact' || pendingKind === 'unknown';

                        if (e.primaryPhone === 'Not Found' || (!shownPhone && !phonePending)) {
                          return <div className="mt-1 text-xs text-muted-foreground">Sin teléfono</div>;
                        }

                        if (shownPhone) {
                          return (
                            <button
                              type="button"
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300"
                              onClick={() => {
                                  const rep = reportForLead(e);
                                setLeadToCall(e);
                                setReportToView(rep || null); // Reusamos estado o pasamos directo
                                setCallModalOpen(true);
                              }}
                              aria-label={`Llamar a ${e.fullName} al ${shownPhone}`}
                            >
                              <Phone className="h-3 w-3" />
                              <span>{shownPhone}</span>
                              {e.phoneNumbers && e.phoneNumbers.length > 1 && (
                                <span className="text-[10px] text-muted-foreground">+{e.phoneNumbers.length - 1}</span>
                              )}
                            </button>
                          );
                        }

                        if (phonePending) {
                          return (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300" title={pendingKind === 'unknown' ? 'Actualizando datos' : 'Actualizando teléfono'}>
                              <RotateCw className="h-3 w-3 animate-spin" />
                              En proceso
                            </div>
                          );
                        }

                        return <span className="text-muted-foreground text-xs italic">—</span>;
                      })()}
                    </TableCell>
                    <TableCell className="py-3">
                      {hasViewableReport(e) ? (
                        nativeResearchForLead(e)?.status === 'insufficient_data' || !isNativeResearchReport(nativeResearchForLead(e)) ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Información limitada</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Investigado</span>
                        )
                      ) : ['queued', 'running'].includes(nativeResearchForLead(e)?.status || '') ? (
                        <span className="text-xs font-medium text-sky-700 dark:text-sky-300">Investigación en curso</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pendiente de investigación</span>
                      )}
                      {e.linkedinUrl ? <a className="mt-1 block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" target="_blank" rel="noreferrer" href={e.linkedinUrl}>LinkedIn</a> : null}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex min-w-[180px] items-center justify-end gap-1">
                          {hasViewableReport(e) ? <Button size="sm" variant="outline" className="h-8 rounded-full px-3" onClick={() => openReportFor(e)} disabled={draftRequestPending}>Ver investigación</Button> : null}
                          {canContact(e) ? (
                            <Button
                              size="sm"
                              className="h-8 rounded-full px-3 shadow-none"
                              onClick={() => void generateEmailFromReportFor(e)}
                              disabled={draftRequestPending}
                            >
                              {creatingDraftId === e.id ? 'Preparando borrador…' : 'Crear borrador y revisar'}
                            </Button>
                          ) : !hasViewableReport(e) ? (
                            <Button
                              size="sm"
                              className="h-8 rounded-full px-3 shadow-none"
                              onClick={() => openResearchWorkspace([e.id])}
                              disabled={!nativeResearchStatusKnown || !e.email || draftRequestPending}
                            >
                              Investigar
                            </Button>
                          ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label={`Más acciones para ${e.fullName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => initiateEnrichment([e])}>Actualizar datos</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteEnriched(e.id)}><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
          ) : null}

          {!loadingLeads && !loadError && pageLeads.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 px-6 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/60"><Search className="h-5 w-5 text-muted-foreground" /></div>
              <h2 className="mt-4 font-medium">{enriched.length === 0 ? 'Aún no hay leads enriquecidos' : 'No hay resultados con estos filtros'}</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{enriched.length === 0 ? 'Enriquece leads guardados para investigarlos y preparar tu contacto.' : 'Ajusta la búsqueda o limpia los filtros para volver a ver la lista.'}</p>
              <Button className="mt-4" size="sm" variant={enriched.length === 0 ? 'default' : 'outline'} onClick={() => enriched.length === 0 ? router.push('/saved/leads') : clearFilters()}>{enriched.length === 0 ? 'Ver guardados' : 'Limpiar filtros'}</Button>
            </div>
          ) : null}
          {/* Paginador inferior (igual al superior) */}
          {!loadingLeads && !loadError && total > 0 ? <div className="mt-3 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-muted-foreground">
              Mostrando {total === 0 ? 0 : startIdx + 1}–{endIdx} de {total}
            </div>
            <div className="flex max-w-full items-center gap-1">
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" aria-label="Primera página" onClick={() => { setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>«</Button>
              <Button variant="outline" size="sm" aria-label="Página anterior" onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>‹</Button>
              <span className="min-w-20 px-2 text-center text-xs font-medium tabular-nums text-muted-foreground sm:hidden" aria-live="polite">Página {page} de {totalPages}</span>
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

      <Sheet open={researchOpen} onOpenChange={(open) => {
        setResearchOpen(open);
        if (!open) void loadNativeResearchStatuses(enriched);
      }}>
        <SheetContent side="right" className="h-dvh w-full overflow-y-auto overscroll-contain px-4 py-5 sm:max-w-5xl sm:px-6 sm:py-6 lg:px-8">
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
              {reportLead && !hasNativeResearchResult(nativeReportToView) && canContact(reportLead) ? <Button size="sm" onClick={() => { void generateEmailFromReportFor(reportLead); setOpenReport(false); }} disabled={draftRequestPending}>Crear borrador y revisar</Button> : null}
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
                    result={nativeReportDetailToView?.result || nativeReportToView.result}
                    reportDocument={nativeReportDetailToView?.reportDocument}
                    status={nativeReportToView.status}
                    researchSnapshotId={nativeReportToView.researchSnapshotId}
                    canCreateDraft={canContact(reportLead)}
                    creatingDraft={creatingDraftId === reportLead.id}
                    createDraftDisabled={draftRequestPending}
                    onCreateDraft={() => void generateEmailFromReportFor(reportLead)}
                    onRefresh={() => {
                      setOpenReport(false);
                      openResearchWorkspace([reportLead.id], { refresh: true });
                    }}
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

      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="flex max-h-[92dvh] max-w-3xl flex-col gap-0 overflow-hidden rounded-[28px] p-0" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-5 pr-12 sm:px-6 sm:pr-12">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Borradores para revisión</div>
            <DialogTitle className="mt-1 text-xl">
              {creatingDraftBatch
                ? `Preparando ${draftBatchProgress.done} de ${draftBatchProgress.total}`
                : `${composeList.length} borrador${composeList.length === 1 ? '' : 'es'} preparado${composeList.length === 1 ? '' : 's'}`}
            </DialogTitle>
            <DialogDescription className="mt-1 leading-5">
              Nada se envía automáticamente. Abre cada correo para editarlo, aprobarlo y elegir el proveedor.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6" aria-busy={creatingDraftBatch}>
            {creatingDraftBatch ? (
              <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/20 px-6 text-center" role="status" aria-live="polite">
                <RotateCw className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Creando borradores con la investigación disponible</p>
                <p className="mt-1 text-xs text-muted-foreground">Puedes cerrar esta ventana; la selección seguirá en esta página.</p>
              </div>
            ) : null}

            {failedComposeList.length > 0 ? (
              <Alert className="border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{failedComposeList.length} sin preparar</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2">
                    {failedComposeList.map(({ lead, message }) => (
                      <li key={lead.id}><span className="font-medium">{lead.fullName || lead.email}</span>: {message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {!creatingDraftBatch && composeList.length === 0 && failedComposeList.length === 0 ? (
              <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 px-6 text-center">
                <p className="text-sm font-medium">No hay borradores en esta revisión</p>
                <p className="mt-1 text-xs text-muted-foreground">Selecciona leads investigados desde la tabla para preparar sus correos.</p>
              </div>
            ) : null}

            {composeList.map(({ lead, draftId, versionId, subject, body }) => (
              <article key={draftId} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm shadow-black/[0.02]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{lead.fullName || 'Contacto'}</h3>
                    <p className="truncate text-xs text-muted-foreground">{lead.email} · {lead.companyName || 'Sin empresa'}</p>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0 rounded-full"
                    onClick={() => {
                      const version = versionId ? `&versionId=${encodeURIComponent(versionId)}` : '';
                      router.push(`/contact/compose?draftId=${encodeURIComponent(draftId)}${version}`);
                    }}
                  >
                    Revisar y contactar
                  </Button>
                </div>
                <div className="mt-4 rounded-xl border border-border/50 bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Asunto</p>
                  <p className="mt-1 text-sm font-medium">{subject}</p>
                  <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t border-border/60 bg-background/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs text-muted-foreground">Cada borrador requiere revisión y aprobación antes del envío.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenCompose(false)}>Cerrar</Button>
              {composeList.length > 0 ? (
                <Button onClick={() => {
                  const first = composeList[0];
                  const version = first.versionId ? `&versionId=${encodeURIComponent(first.versionId)}` : '';
                  router.push(`/contact/compose?draftId=${encodeURIComponent(first.draftId)}${version}`);
                }}>
                  Revisar primero
                </Button>
              ) : null}
            </div>
          </div>
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


