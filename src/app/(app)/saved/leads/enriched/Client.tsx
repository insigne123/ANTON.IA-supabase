
'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { findReportForLead, leadResearchStorage, getLeadReports } from '@/lib/lead-research-storage';
import { v4 as uuid } from 'uuid';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { removeEnrichedLeadById, getEnrichedLeads as enrichedLeadsStorageGet, enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { Trash2, Download, FileSpreadsheet, RotateCw, Undo2, Save, Eraser, Linkedin, Phone, CheckCircle2, AlertTriangle, MoreHorizontal, ArrowLeft, ChevronDown, ListFilter, Search } from 'lucide-react';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { supabaseService } from '@/lib/supabase-service';
import { supabase } from '@/lib/supabase';
import { hasMeaningfulLeadResearch } from '@/lib/lead-research';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { unmarkResearched } from '@/lib/researched-leads-storage';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { renderTemplate, buildPersonEmailContext } from '@/lib/template';
import { buildEffectiveCompanyProfile, buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { generateCompanyOutreachV2, ensureSubjectPrefix } from '@/lib/outreach-templates';
import { emailDraftsStorage } from '@/lib/email-drafts-storage';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { restyleDraftWithProfile } from '@/lib/email-style-restyle';
import { profileService, type Profile } from '@/lib/services/profile-service';
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
  researchDraftBlockReasonLabel,
  researchReadinessFor,
} from '@/lib/research-workspace';
import { saveResearchWorkspaceHandoff } from '@/lib/research-workspace-handoff';
import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import NativeResearchReport from '@/components/research/NativeResearchReport';
import ResearchWorkspace from '@/components/research/ResearchWorkspace';


const extractDomainFromEmail = (email?: string | null) =>
  email && email.includes('@') ? email.split('@')[1].toLowerCase() : undefined;

function isPendingEnrichmentStatus(status?: string | null) {
  return String(status || '').trim().toLowerCase().startsWith('pending');
}

function nativeDraftRequestMessage(payload: any, fallback: string) {
  const code = String(payload?.error || payload?.code || '').toLowerCase();
  if (code.includes('auth')) return 'Tu sesión ya no está disponible. Vuelve a iniciar sesión e inténtalo nuevamente.';
  if (code.includes('privacy') || code.includes('suppressed')) return 'No podemos continuar con este contacto por sus preferencias de privacidad.';
  if (code.includes('setup') || code.includes('metadata')) return 'No pudimos preparar el email todavía. Inténtalo nuevamente en unos minutos.';
  const resultMessage = String(payload?.result?.message || '').trim();
  return resultMessage && resultMessage.length <= 300 ? resultMessage : fallback;
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
    evidenceCount: report.sources.length,
    sourceCount: report.sources.length,
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

  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;

    profileService.getCurrentProfile()
      .then((profile) => {
        if (!active) return;
        setCurrentProfile(profile);
      })
      .catch((error) => {
        if (!active) return;
        console.error('No se pudo cargar el perfil actual para leads enriquecidos', error);
        setCurrentProfile(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const [enriched, setEnriched] = useState<EnrichedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});           // selección para INVESTIGAR
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [nativeResearchByLeadId, setNativeResearchByLeadId] = useState<Record<string, NativeResearchLeadStatus>>({});
  const [openReport, setOpenReport] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<string | null>(null);
  // Estados para Modal de llamada
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedLead | null>(null);

  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [reportLead, setReportLead] = useState<EnrichedLead | null>(null);

  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());
  const [openCompose, setOpenCompose] = useState(false);
  const [composeList, setComposeList] = useState<Array<{ lead: EnrichedLead; subject: string; body: string; researchSnapshotId: string | null }>>([]);
  const [bulkOperationId, setBulkOperationId] = useState('');
  const [sendingBulk, setSendingBulk] = useState(false);
  const [sendProgress, setSendProgress] = useState({ done: 0, total: 0 });
  const [bulkProvider, setBulkProvider] = useState<'outlook' | 'gmail'>('outlook');
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');
  const [usePixel, setUsePixel] = useState(true);
  const [useLinkTracking, setUseLinkTracking] = useState(false);
  const [useReadReceipt, setUseReadReceipt] = useState(false);

  // Editor IA inline (dentro del modal actual, sin abrir otro <Dialog/>)
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [applyingEdit, setApplyingEdit] = useState(false);

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
        console.groupCollapsed('[Server Logs] Apollo Enrichment');
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
              apolloId: incoming.apolloId || existing.apolloId,
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
        toast({ title: 'Enriquecimiento completado', description: `Se actualizaron ${toUpdate.length} y agregaron ${toAdd.length} leads.` });
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
    const leadIds = Array.from(new Set(leads.map((lead) => String(lead.id || '').trim()).filter(Boolean)));
    if (leadIds.length === 0) {
      setNativeResearchByLeadId({});
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
      setNativeResearchByLeadId(next);
    } catch (error) {
      console.warn('[enriched-leads] Native research status lookup failed:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
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

      setEnriched(patched);
      setReports(getLeadReports());
      setStyleProfiles(styleProfilesStorage.list());
      await loadNativeResearchStatuses(patched);
    } catch (error) {
      console.error('[enriched-leads] Load failed:', error);
      setLoadError('No pudimos cargar tus leads enriquecidos. Vuelve a intentarlo.');
    } finally {
      setLoadingLeads(false);
    }
  }, [loadNativeResearchStatuses]);

  const syncPendingPhoneLeads = useCallback(async (ids?: string[]) => {
    const targetIds = (ids || enriched.filter((lead) => isPendingEnrichmentStatus(lead.enrichmentStatus)).map((lead) => lead.id))
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
        await loadData();
      }
    } catch (error) {
      console.warn('[phone-sync] unexpected error:', error);
    } finally {
      pendingPhoneSyncRef.current = false;
      setSyncingPendingPhones(false);
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

            // Detect Status Change: Pending -> Completed
            if (newData.enrichment_status === 'completed' && isPendingEnrichmentStatus(oldData.enrichment_status)) {
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
  }, [enriched, syncPendingPhoneLeads]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
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
    const leadId = String(lead.id || '').trim();
    return leadId ? nativeResearchByLeadId[leadId] || null : null;
  }, [nativeResearchByLeadId]);

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
    const native = nativeResearchForLead(lead);
    if (native?.result) {
      return nativeResearchCanCreateDraft(lead, native);
    }
    return hasReport(lead) && Boolean(lead.email);
  }, [hasReport, nativeResearchForLead]);

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
    if (isPendingEnrichmentStatus(lead.enrichmentStatus)) return 'pending';
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
    () => filtered.filter(e => !!e.email && !hasReportStrict(e)).length,
    [filtered, hasReportStrict]
  );
  const pendingPhoneCount = useMemo(
    () => enriched.filter((lead) => isPendingEnrichmentStatus(lead.enrichmentStatus)).length,
    [enriched],
  );

  // === Métricas para los "seleccionar todos" ===
  const researchEligiblePage = useMemo(
    () => pageLeads.filter(e => e.email && !hasReportStrict(e)).length,
    [pageLeads, hasReportStrict]
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
    pageLeads.forEach(l => { if (canContact(l)) next.add(l.id); });
    setSelectedToContact(next);
  };

  const openResearchWorkspace = (
    leadIds: Iterable<string> = Object.keys(sel).filter((id) => sel[id]),
    options: { refresh?: boolean } = {},
  ) => {
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

  async function buildComposeDrafts(source: 'investigation' | 'style', styleName?: string) {
    const company = buildEffectiveCompanyProfile(currentProfile);
    const sender = buildSenderInfo(currentProfile);
    const overrides = emailDraftsStorage.getMap();
    const profile = source === 'style'
      ? (styleProfiles.find(p => p.name === styleName) || styleProfiles[0] || null)
      : null;

    const drafts = await Promise.all(
      enriched
      .filter(l => selectedToContact.has(l.id))
      .map(async (l) => {
        const rep = reportForLead(l);
        const seed = rep?.cross?.emailDraft
          ? { subject: rep.cross.emailDraft.subject, body: rep.cross.emailDraft.body }
          : (() => {
            const v2 = generateCompanyOutreachV2({
              leadFirstName: (l.fullName || '').split(' ')[0] || '',
              companyName: l.companyName,
              myCompanyProfile: company,
            });
            return { subject: v2.subjectBase, body: v2.body };
          })();

        let subj = seed.subject || '';
        let body = seed.body || '';

        const ctx = buildPersonEmailContext({
          lead: { name: l.fullName, email: l.email!, title: l.title, company: l.companyName },
          company: { name: l.companyName, domain: l.companyDomain },
          sender,
        });
        subj = renderTemplate(subj, ctx);
        body = renderTemplate(body, ctx);

        if (profile) {
          const styled = await restyleDraftWithProfile({
            mode: 'leads',
            baseSubject: subj,
            baseBody: body,
            styleProfile: profile,
            lead: { id: l.id, fullName: l.fullName, email: l.email!, title: l.title, companyName: l.companyName, companyDomain: l.companyDomain, linkedinUrl: l.linkedinUrl },
            report: rep?.cross || null,
            companyProfile: company,
          });
          subj = styled.subject;
          body = styled.body;
        }

        body = applySignaturePlaceholders(body, sender);

        // Asegurar prefijo con el nombre SOLO en el asunto
        subj = ensureSubjectPrefix(subj, ctx.lead.firstName);

        // Aplicar override guardado, si existe
        const ov = overrides[l.id];
        if (ov?.subject || ov?.body) {
          subj = ov.subject || subj;
          body = ov.body || body;
        }

        return {
          lead: l,
          subject: subj,
          body,
          researchSnapshotId: String(rep?.raw?.research_snapshot_id || '').trim() || null,
        };
      })
    );

    return drafts;
  }

  function openBulkCompose() {
    openResearchWorkspace(selectedToContact);
  }

  function sendBulk() {
    openResearchWorkspace(selectedToContact);
  }

  async function generateEmailFromReportFor(lead: EnrichedLead) {
    if (!canContact(lead)) {
      toast({
        title: 'El email aún no está disponible',
        description: 'Necesitamos un email válido y evidencia suficiente antes de preparar el borrador.',
      });
      return;
    }
    const nativeStatus = nativeResearchForLead(lead);
    if (nativeStatus?.result && nativeStatus.result.draftEligibility.eligible !== true) {
      toast({
        title: 'El email aún no está disponible',
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

    setCreatingDraftId(lead.id);
    try {
      const response = await fetch('/api/native-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `native-draft:${researchSnapshotId}` },
        body: JSON.stringify({ researchSnapshotId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft?.draftId) {
        throw new Error(nativeDraftRequestMessage(payload, 'No pudimos preparar el email.'));
      }
      const draftId = encodeURIComponent(payload.draft.draftId);
      const versionId = payload.draft.versionId ? `&versionId=${encodeURIComponent(payload.draft.versionId)}` : '';
      router.push(`/contact/compose?draftId=${draftId}${versionId}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo crear el email', description: error instanceof Error ? error.message : 'Inténtalo nuevamente.' });
    } finally {
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
          onClick={openBulkCompose}
          disabled={contactCount === 0 || loadingLeads}
            title={contactCount === 0 ? 'Selecciona leads con reporte y email' : 'Abrir la investigación de los leads seleccionados'}
          >
          Abrir investigación {contactCount > 0 ? `(${contactCount})` : ''}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm shadow-[0_14px_35px_-32px_rgba(15,23,42,0.28)]">
        <span><strong className="font-semibold tabular-nums">{phoneReadyCount}</strong> <span className="text-muted-foreground">con teléfono</span></span>
        <span><strong className="font-semibold tabular-nums">{researchEligible}</strong> <span className="text-muted-foreground">por investigar</span></span>
        {pendingPhoneCount > 0 ? <span><strong className="font-semibold tabular-nums">{pendingPhoneCount}</strong> <span className="text-muted-foreground">actualizando teléfono</span></span> : null}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} visibles</span>
      </div>

      {pendingPhoneCount > 0 ? (
        <Alert className="border-sky-500/25 bg-sky-500/5 text-foreground dark:border-sky-400/25">
          <RotateCw className={`h-4 w-4 ${syncingPendingPhones ? 'animate-spin' : 'animate-pulse'}`} />
          <AlertTitle>Actualizando teléfonos</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-muted-foreground">{pendingPhoneCount} {pendingPhoneCount === 1 ? 'contacto sigue' : 'contactos siguen'} en proceso. La lista se actualizará automáticamente.</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full bg-background"
              onClick={() => syncPendingPhoneLeads()}
              disabled={syncingPendingPhones}
            >
              <RotateCw className={`mr-2 h-4 w-4 ${syncingPendingPhones ? 'animate-spin' : ''}`} />
              {syncingPendingPhones ? 'Actualizando...' : 'Actualizar ahora'}
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
                {contactCount > 0 ? `${contactCount} para revisar en Investigación` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setSel({}); setSelectedToContact(new Set()); }}>Cancelar</Button>
                 {researchCount > 0 ? <Button variant="secondary" size="sm" onClick={() => openResearchWorkspace()}>Investigar selección ({researchCount})</Button> : null}
                 {contactCount > 0 ? <Button size="sm" onClick={openBulkCompose}>Abrir investigación ({contactCount})</Button> : null}
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
                        disabled={!e.email || hasReportStrict(e)}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para investigar`}
                      />
                      <span className="truncate">Investigar</span>
                    </label>
                    <label className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1">
                      <Checkbox
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(value) => {
                          const next = new Set(selectedToContact);
                          if (value) next.add(e.id);
                          else next.delete(e.id);
                          setSelectedToContact(next);
                        }}
                        disabled={!draftable}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para revisar en Investigación`}
                      />
                      <span className="truncate">Revisar</span>
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {viewable ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => openReportFor(e)}>Ver investigación</Button> : null}
                    {draftable ? (
                      <Button size="sm" className="rounded-full" onClick={() => void generateEmailFromReportFor(e)} disabled={creatingDraftId === e.id}>
                        {creatingDraftId === e.id ? 'Creando…' : 'Crear email'}
                      </Button>
                    ) : !viewable ? (
                      <Button size="sm" className="rounded-full" onClick={() => openResearchWorkspace([e.id])} disabled={!e.email}>Investigar</Button>
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
                  <TableHead className="w-12 text-center" title="Marcar para investigar">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Invest.</span>
                      <Checkbox
                        checked={allResearchChecked}
                        disabled={researchEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllResearch(Boolean(v))}
                        aria-label="Seleccionar todos para investigar"
                      />
                    </div>
                  </TableHead>
                  <TableHead className="w-12 text-center" title="Marcar para revisar en Investigación">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Rev.</span>
                      <Checkbox
                        checked={contactEligiblePage > 0 ? allContactChecked : false}
                        disabled={contactEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllContact(Boolean(v))}
                        aria-label="Seleccionar todos para revisar en Investigación"
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
                  <TableRow key={e.id} className="align-middle">
                    <TableCell className="py-3 text-center">
                      <Checkbox
                        checked={!!sel[e.id]}
                        onCheckedChange={(v) => toggleResearchLead(e.id, Boolean(v))}
                        disabled={
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
                    <TableCell className="py-3 text-center">
                      <Checkbox
                        disabled={!canContact(e)}
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selectedToContact);
                          if (v) next.add(e.id);
                          else next.delete(e.id);
                          setSelectedToContact(next);
                        }}
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para revisar en Investigación`}
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
                        const fallbackPhone = e.phoneNumbers?.length ? e.phoneNumbers[0].sanitized_number : undefined;
                        const shownPhone = e.primaryPhone || fallbackPhone;

                        if (e.primaryPhone === 'Not Found' || (!shownPhone && !isPendingEnrichmentStatus(e.enrichmentStatus))) {
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

                        if (isPendingEnrichmentStatus(e.enrichmentStatus)) {
                          return (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300" title="Actualizando teléfono">
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
                          {hasViewableReport(e) ? <Button size="sm" variant="outline" className="h-8 rounded-full px-3" onClick={() => openReportFor(e)}>Ver investigación</Button> : null}
                          {canContact(e) ? (
                            <Button
                              size="sm"
                              className="h-8 rounded-full px-3 shadow-none"
                              onClick={() => void generateEmailFromReportFor(e)}
                              disabled={creatingDraftId === e.id}
                            >
                              {creatingDraftId === e.id ? 'Creando…' : 'Crear email'}
                            </Button>
                          ) : !hasViewableReport(e) ? (
                            <Button
                              size="sm"
                              className="h-8 rounded-full px-3 shadow-none"
                              onClick={() => openResearchWorkspace([e.id])}
                              disabled={!e.email}
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
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" aria-label="Primera página" onClick={() => { setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>«</Button>
              <Button variant="outline" size="sm" aria-label="Página anterior" onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>‹</Button>
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
                    variant={active ? 'default' : 'outline'}
                    onClick={() => { setPage(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    {n}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" aria-label="Página siguiente" onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>›</Button>
              <Button variant="outline" size="sm" aria-label="Última página" onClick={() => { setPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>»</Button>
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
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-[28px] p-0" onEscapeKeyDown={() => setOpenReport(false)}>
          <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Investigación</div>
                <DialogTitle className="mt-1 text-xl">{nativeReportToView?.result?.lead.companyName || reportToView?.cross?.company.name || reportLead?.companyName || 'Reporte del lead'}</DialogTitle>
                <DialogDescription className="mt-1 leading-5">
                  Revisa el estado, la calidad y la evidencia antes de crear el email.
                </DialogDescription>
              </div>
              {reportLead && !hasNativeResearchResult(nativeReportToView) && canContact(reportLead) ? <Button size="sm" onClick={() => { void generateEmailFromReportFor(reportLead); setOpenReport(false); }}>Crear email</Button> : null}
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
            <ScrollArea className="min-h-0 flex-1">
              <NativeResearchReport
                result={nativeReportToView.result}
                status={nativeReportToView.status}
                researchSnapshotId={nativeReportToView.researchSnapshotId}
                canCreateDraft={canContact(reportLead)}
                creatingDraft={creatingDraftId === reportLead.id}
                onCreateDraft={() => {
                  void generateEmailFromReportFor(reportLead);
                  setOpenReport(false);
                }}
                onRefresh={() => {
                  setOpenReport(false);
                  openResearchWorkspace([reportLead.id], { refresh: true });
                }}
                className="px-5 py-5 sm:px-6 sm:py-6"
              />
            </ScrollArea>
          ) : reportToView?.cross ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-5 pb-6 pt-4 text-sm leading-relaxed sm:px-6">
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
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden rounded-[28px] p-0" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Revisión de borradores</div>
                <DialogTitle className="mt-1 text-xl">Revisa {composeList.length} borradores</DialogTitle>
                <DialogDescription className="mt-1">Cada mensaje se personaliza antes de enviarse.</DialogDescription>
              </div>
              <Button variant="outline" size="sm" className="w-fit rounded-full" onClick={() => setShowBulkEditor(v => !v)} disabled={composeList.length === 0}>
                {showBulkEditor ? 'Cerrar edición IA' : 'Editar todos con IA'}
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="sticky top-0 z-10 grid grid-cols-1 gap-3 border-b border-border/60 bg-background/95 px-5 py-4 backdrop-blur sm:grid-cols-3 sm:px-6">
            <div className="col-span-1">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Origen del borrador</div>
              <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/30 p-1">
                <Button type="button" size="sm" variant={draftSource === 'investigation' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => {
                    setDraftSource('investigation');
                    if (openCompose) {
                      void buildComposeDrafts('investigation', selectedStyleName || styleProfiles[0]?.name || '').then(setComposeList).catch((e: any) => {
                        toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo actualizar el borrador.' });
                      });
                    }
                  }}>Investigación</Button>
                <Button type="button" size="sm" variant={draftSource === 'style' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => {
                    const nextStyle = selectedStyleName || styleProfiles[0]?.name || '';
                    setDraftSource('style');
                    if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
                    if (openCompose && nextStyle) {
                      void buildComposeDrafts('style', nextStyle).then(setComposeList).catch((e: any) => {
                        toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo aplicar la personalizacion.' });
                      });
                    }
                  }}>Estilo</Button>
              </div>
            </div>
            <div className="col-span-1">
              <label htmlFor="bulk-style" className="mb-1.5 block text-xs font-medium text-muted-foreground">Perfil de estilo</label>
              <select
                id="bulk-style"
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-50"
                disabled={draftSource !== 'style' || styleProfiles.length === 0}
                value={selectedStyleName}
                onChange={(e) => {
                  const nextStyle = e.target.value;
                  setSelectedStyleName(nextStyle);
                  if (openCompose && draftSource === 'style') {
                    void buildComposeDrafts('style', nextStyle).then(setComposeList).catch((err: any) => {
                      toast({ variant: 'destructive', title: 'Error', description: err?.message || 'No se pudo aplicar la personalizacion.' });
                    });
                  }
                }}
              >
                {styleProfiles.length === 0 ? <option value="">(No hay estilos guardados)</option> :
                  styleProfiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)
                }
              </select>
            </div>
            <div className="col-span-1">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Proveedor</div>
              <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/30 p-1">
                <Button type="button" size="sm" variant={bulkProvider === 'outlook' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => setBulkProvider('outlook')}>Outlook</Button>
                <Button type="button" size="sm" variant={bulkProvider === 'gmail' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => setBulkProvider('gmail')}>Gmail</Button>
              </div>
            </div>
          </div>

          {showBulkEditor && (
            <div className="mx-5 mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:mx-6">
              <label htmlFor="bulk-ai-instruction" className="text-sm font-medium">Cambio para todos los borradores</label>
              <p className="mt-1 text-xs text-muted-foreground">Ejemplo: haz el cierre más directo y reduce cada mensaje a tres párrafos.</p>
              <Textarea
                id="bulk-ai-instruction"
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={3}
                className="mt-3"
                placeholder="Describe el ajuste que quieres aplicar..."
              />
              <div className="mt-2 flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => { setEditInstruction(''); setShowBulkEditor(false); }}
                  disabled={applyingEdit}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={async () => {
                    if (!editInstruction.trim() || !composeList.length) return;
                    setApplyingEdit(true);
                    try {
                      const payload = {
                        instruction: editInstruction.trim(),
                        drafts: composeList.map(it => ({
                          subject: it.subject,
                          body: it.body,
                          lead: {
                            id: it.lead.id,
                            fullName: it.lead.fullName,
                            email: it.lead.email,
                            title: it.lead.title,
                            companyName: it.lead.companyName,
                            companyDomain: it.lead.companyDomain,
                            linkedinUrl: it.lead.linkedinUrl,
                          },
                        })),
                      };
                      const r = await fetch('/api/email/bulk-edit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      const j = await r.json();
                      if (!r.ok) throw new Error(j?.error || 'No se pudo aplicar la edición');
                      const edited = (j?.drafts || []) as Array<{ subject: string; body: string }>;
                      if (edited.length === composeList.length) {
                        setComposeList(prev => prev.map((it, i) => ({ ...it, subject: edited[i].subject, body: edited[i].body })));
                      }
                      setShowBulkEditor(false);
                      setEditInstruction('');
                      toast({ title: 'Edición aplicada', description: `Se actualizaron ${edited.length} borradores.` });
                    } catch (e: any) {
                      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'Falló la edición con IA' });
                    } finally {
                      setApplyingEdit(false);
                    }
                  }}
                  disabled={applyingEdit || !editInstruction.trim() || composeList.length === 0}
                >
                  {applyingEdit ? 'Aplicando…' : 'Aplicar a todos'}
                </Button>
              </div>
            </div>
          )}


          <div className="space-y-3 px-5 py-4 sm:px-6">
            {composeList.map(({ lead, subject, body }, i) => (
              <div key={lead.id} className="rounded-2xl border border-border/60 bg-card p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="font-semibold text-sm">{lead.fullName} <span className="font-normal text-muted-foreground">· {lead.companyName}</span></div>
                  <div className="text-xs text-muted-foreground">{lead.email}</div>
                </div>
                <div className="text-xs text-muted-foreground">{lead.title || 'Sin cargo'}</div>

                <div className="mt-3 text-xs font-semibold">Asunto</div>
                <Input
                  value={subject}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComposeList(prev => {
                      const next = [...prev]; next[i] = { ...next[i], subject: v }; return next;
                    });
                    emailDraftsStorage.set(lead.id, v, body);
                  }}
                  aria-label={`Asunto para ${lead.fullName}`}
                />

                <div className="mt-3 text-xs font-semibold">Cuerpo</div>
                <Textarea
                  value={body}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComposeList(prev => {
                      const next = [...prev]; next[i] = { ...next[i], body: v }; return next;
                    });
                    emailDraftsStorage.set(lead.id, subject, v);
                  }}
                  rows={7}
                  aria-label={`Cuerpo para ${lead.fullName}`}
                  className="font-mono"
                />

                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Regenerar orientado a persona con datos actuales
                      const company = buildEffectiveCompanyProfile(currentProfile);
                      const sender = buildSenderInfo(currentProfile);
                      const rep = reportForLead(lead);
                      const seed = rep?.cross?.emailDraft
                        ? { subject: rep.cross.emailDraft.subject, body: rep.cross.emailDraft.body }
                        : (() => {
                          const v2 = generateCompanyOutreachV2({
                            leadFirstName: (lead.fullName || '').split(' ')[0] || '',
                            companyName: lead.companyName,
                            myCompanyProfile: company,
                          });
                          return { subject: v2.subjectBase, body: v2.body };
                        })();
                      const ctx = buildPersonEmailContext({
                        lead: { name: lead.fullName, email: lead.email!, title: lead.title, company: lead.companyName },
                        company: { name: lead.companyName, domain: lead.companyDomain },
                        sender,
                      });
                      let subj = renderTemplate(seed.subject || '', ctx);
                      let bod = renderTemplate(seed.body || '', ctx);
                      bod = applySignaturePlaceholders(bod, sender);
                      subj = ensureSubjectPrefix(subj, ctx.lead.firstName);

                      setComposeList(prev => {
                        const next = [...prev]; next[i] = { ...next[i], subject: subj, body: bod }; return next;
                      });
                      emailDraftsStorage.set(lead.id, subj, bod);
                      toast({ title: 'Borrador regenerado', description: `Se personalizó para ${ctx.lead.firstName}.` });
                    }}
                    title="Regenerar con IA orientado a persona"
                  >
                    <RotateCw className="h-4 w-4 mr-1" /> Regenerar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      emailDraftsStorage.remove(lead.id);
                      toast({ title: 'Borrador restaurado', description: 'Se eliminó la edición local.' });
                      // Reabrimos el modal recomputando con overrides limpios
                      setComposeList(prev => {
                        const next = [...prev];
                        // Simplemente recargamos sin override:
                        // (Dejamos al usuario pulsar "Regenerar" si quiere 100% desde plantilla)
                        return next;
                      });
                    }}
                    title="Eliminar cambios guardados localmente"
                  >
                    <Undo2 className="h-4 w-4 mr-1" /> Restaurar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      emailDraftsStorage.set(lead.id, subject, body);
                      toast({ title: 'Guardado', description: 'Se guardó el borrador editado.' });
                    }}
                    title="Guardar cambios del borrador"
                  >
                    <Save className="h-4 w-4 mr-1" /> Guardar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </div>
           <div className="flex shrink-0 flex-col gap-3 border-t border-border/60 bg-background/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {sendingBulk
              ? <div className="text-xs">Enviando… {sendProgress.done}/{sendProgress.total}</div>
              : <div className="text-xs text-muted-foreground">
                Revisa y ajusta los borradores antes de enviar. Proveedor: <strong>{bulkProvider}</strong>
              </div>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenCompose(false)} disabled={sendingBulk}>Cerrar</Button>
              <Button onClick={sendBulk} disabled={sendingBulk || selectedToContact.size === 0}>
                 Revisar selección
              </Button>
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


