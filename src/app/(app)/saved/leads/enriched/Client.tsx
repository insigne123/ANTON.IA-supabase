
'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { upsertLeadReports, findReportForLead, leadResearchStorage, getLeadReports } from '@/lib/lead-research-storage';
import { v4 as uuid } from 'uuid';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { removeEnrichedLeadById, getEnrichedLeads as enrichedLeadsStorageGet, enrichedLeadsStorage, updateEnrichedLead } from '@/lib/services/enriched-leads-service';
import { Trash2, Download, FileSpreadsheet, RotateCw, Undo2, Save, Eraser, Linkedin, Phone, BrainCircuit, CheckCircle2, AlertTriangle, MoreHorizontal, ArrowLeft, ChevronDown, ListFilter, Search } from 'lucide-react';
import { extensionService } from '@/lib/services/extension-service';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { supabaseService } from '@/lib/supabase-service';
import { supabase } from '@/lib/supabase';
import { adaptLeadResearchResponseToReport, getLeadResearchWarnings, hasMeaningfulLeadResearch, unwrapLeadResearchResponse } from '@/lib/lead-research';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import { sendEmail } from '@/lib/outlook-email-service';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { isResearched, markResearched, unmarkResearched } from '@/lib/researched-leads-storage';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { renderTemplate, buildPersonEmailContext } from '@/lib/template';
import { buildEffectiveCompanyProfile, buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import * as Quota from '@/lib/quota-client';
import { generateCompanyOutreachV2, ensureSubjectPrefix } from '@/lib/outreach-templates';
import { emailDraftsStorage } from '@/lib/email-drafts-storage';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getFirstNameSafe } from '@/lib/template';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { restyleDraftWithProfile } from '@/lib/email-style-restyle';
import { profileService, type Profile } from '@/lib/services/profile-service';
import { buildLinkedinDraft } from '@/lib/ai/linkedin-templates';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { plannerService, ScheduleConfig } from '@/lib/services/planner-service';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { haveSameSelection, retainVisibleSelection } from '@/lib/leads-workspace/selection';
import { buildManualEmailOperation } from '@/lib/manual-send-idempotency';


const extractDomainFromEmail = (email?: string | null) =>
  email && email.includes('@') ? email.split('@')[1].toLowerCase() : undefined;

function isPendingEnrichmentStatus(status?: string | null) {
  return String(status || '').trim().toLowerCase().startsWith('pending');
}

type ResearchLifecycleStatus = 'idle' | 'preparing' | 'queued' | 'in_progress' | 'completed' | 'partial' | 'insufficient_data' | 'failed';

const RESEARCH_STANDARD_ESTIMATE_MS = 55000;

function getResearchStageCopy(status: ResearchLifecycleStatus, elapsedMs: number) {
  if (status === 'queued') return 'En cola para iniciar investigacion';
  if (status === 'completed') return 'Investigacion completada';
  if (status === 'partial') return 'Investigacion parcial lista';
  if (status === 'insufficient_data') return 'Informacion limitada, armando resumen';
  if (status === 'failed') return 'La investigacion encontro un error';

  if (elapsedMs < 6000) return 'Preparando contexto del lead';
  if (elapsedMs < 18000) return 'Analizando empresa, sitio y posicionamiento';
  if (elapsedMs < 32000) return 'Buscando señales y contexto reciente';
  if (elapsedMs < 46000) return 'Construyendo angulos, pains y oportunidades';
  return 'Redactando borradores y guion de llamada';
}

function getResearchProgressValue(status: ResearchLifecycleStatus, elapsedMs: number) {
  if (status === 'completed' || status === 'partial') return 100;
  if (status === 'failed') return 100;
  if (status === 'insufficient_data') return 92;
  if (status === 'queued') return 8;

  const ratio = Math.min(elapsedMs / RESEARCH_STANDARD_ESTIMATE_MS, 0.95);
  return Math.max(6, Math.round(ratio * 100));
}

import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';

import { organizationService } from '@/lib/services/organization-service';

export default function EnrichedLeadsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [tick, setTick] = useState(0); // Force re-render
  // ... existing state

  // --- Social Credits ---
  const [socialCredits, setSocialCredits] = useState<number | null>(null);
  const [socialEnabled, setSocialEnabled] = useState(true);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  // ... existing useEffects

  useEffect(() => {
    // Load credits on mount
    organizationService.getCredits().then(res => {
      if (res) {
        setSocialCredits(res.credits);
        setSocialEnabled(res.enabled);
      }
    });
  }, []);

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
  const [openReport, setOpenReport] = useState(false);
  // Estados para Modal de llamada
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedLead | null>(null);

  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [reportLead, setReportLead] = useState<EnrichedLead | null>(null);

  const [seqRunning, setSeqRunning] = useState(false);
  const [seqDone, setSeqDone] = useState(0);
  const [seqTotal, setSeqTotal] = useState(0);
  const [researchUi, setResearchUi] = useState<{
    leadName: string;
    index: number;
    total: number;
    startedAt: number;
    status: ResearchLifecycleStatus;
    reportId?: string | null;
    warning?: string | null;
  }>({
    leadName: '',
    index: 0,
    total: 0,
    startedAt: 0,
    status: 'idle',
    reportId: null,
    warning: null,
  });
  const [researchPulseMs, setResearchPulseMs] = useState(0);

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

  // --- LinkedIn Modal ---
  const [openLinkedin, setOpenLinkedin] = useState(false);
  const [linkedinLead, setLinkedinLead] = useState<EnrichedLead | null>(null);
  const [linkedinMessage, setLinkedinMessage] = useState('');
  const [linkedinDraftNote, setLinkedinDraftNote] = useState('');
  const [linkedinDraftIsPersonalized, setLinkedinDraftIsPersonalized] = useState(false);
  const [sendingLinkedin, setSendingLinkedin] = useState(false);

  // --- Campaign Schedule Modal ---
  const [openSchedule, setOpenSchedule] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({
    startDate: new Date(),
    msgsPerDay: 50,
    skipWeekends: true,
    channel: 'email'
  });
  const [scheduling, setScheduling] = useState(false);

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
    } catch (error) {
      console.error('[enriched-leads] Load failed:', error);
      setLoadError('No pudimos cargar tus leads enriquecidos. Vuelve a intentarlo.');
    } finally {
      setLoadingLeads(false);
    }
  }, []);

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
    if (!seqRunning || !researchUi.startedAt) {
      setResearchPulseMs(0);
      return;
    }

    const tick = () => setResearchPulseMs(Date.now() - researchUi.startedAt);
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [seqRunning, researchUi.startedAt]);

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

  /** Reporte (cualquier fuente: por ref, por dominio o por nombre). */
  const hasReport = useCallback((e: EnrichedLead) => {
    const ref = leadRefOf(e);
    const byRef = reports.find(r => (r.meta?.leadRef || '') === ref);
    if (byRef && hasMeaningfulLeadResearch(byRef)) return true;
    const domain = e.companyDomain;
    if (domain && reports.find(r => r.company.domain === domain && hasMeaningfulLeadResearch(r))) return true;
    const name = e.companyName;
    if (name && reports.find(r => (r.company.name || '').toLowerCase() === name.toLowerCase() && hasMeaningfulLeadResearch(r))) return true;
    return false;
  }, [leadRefOf, reports]);

  /** Reporte estrictamente por referencia de lead (NO por dominio/nombre). */
  const hasReportStrict = useCallback((e: EnrichedLead) => {
    const ref = leadRefOf(e);
    return !!reports.find(r => (r.meta?.leadRef || '') === ref && hasMeaningfulLeadResearch(r));
  }, [leadRefOf, reports]);

  const canContact = useCallback((lead: EnrichedLead) => hasReport(lead) && !!lead.email, [hasReport]);

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
    () => filtered.filter(e => !!e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)).length,
    [filtered, leadRefOf, hasReportStrict]
  );
  const pendingPhoneCount = useMemo(
    () => enriched.filter((lead) => isPendingEnrichmentStatus(lead.enrichmentStatus)).length,
    [enriched],
  );

  // === Métricas para los "seleccionar todos" ===
  const researchEligiblePage = useMemo(
    // Elegible si: tiene email, NO está marcado investigado y NO tiene reporte por ref (otros leads no bloquean)
    () => pageLeads.filter(e => e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)).length,
    [pageLeads, leadRefOf, hasReportStrict]
  );
  const contactEligiblePage = useMemo(() => pageLeads.filter(canContact).length, [pageLeads, canContact]);

  const allResearchChecked = useMemo(
    () => researchEligiblePage > 0 && pageLeads.filter(e => e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)).every(e => sel[e.id]),
    [pageLeads, sel, researchEligiblePage, leadRefOf, hasReportStrict]
  );
  const allContactChecked = useMemo(
    () => contactEligiblePage > 0 && pageLeads.filter(canContact).every(l => selectedToContact.has(l.id)),
    [pageLeads, selectedToContact, contactEligiblePage, canContact]
  );

  useEffect(() => {
    const visibleIds = filtered.map((lead) => lead.id);
    const nextResearchSelection = retainVisibleSelection(
      Object.keys(sel).filter((id) => sel[id]),
      visibleIds,
    );
    const currentResearchSelection = new Set(Object.keys(sel).filter((id) => sel[id]));
    if (!haveSameSelection(currentResearchSelection, nextResearchSelection)) {
      setSel(Object.fromEntries(Array.from(nextResearchSelection).map((id) => [id, true])));
    }

    const nextContactSelection = retainVisibleSelection(selectedToContact, visibleIds);
    if (!haveSameSelection(selectedToContact, nextContactSelection)) {
      setSelectedToContact(nextContactSelection);
    }
  }, [filtered, sel, selectedToContact]);

  const anyInvestigated = useMemo(
    () => enriched.some(e => isResearched(leadRefOf(e)) || hasReport(e)),
    [enriched, leadRefOf, hasReport]
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
    setSel(prev => {
      const next = { ...prev };
      pageLeads.forEach(e => {
        if (e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)) next[e.id] = true;
      });
      return next;
    });
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

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  /** Obtiene el ID del usuario autenticado en Supabase para acciones del cliente. */
  async function getUserIdOrFail(): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      // Si no hay usuario, redirigir (aunque el middleware ya debería proteger)
      toast({ variant: 'destructive', title: 'Error de sesión', description: 'No se detectó usuario. Recarga la página.' });
      throw new Error('no_identity');
    }
    return user.id;
  }

  async function runOneInvestigation(
    e: EnrichedLead,
    userId: string,
    index: number,
    total: number,
    requestKey: string,
  ) {
    const leadRef = leadRefOf(e);
    const realProfile = await profileService.getCurrentProfile();
    const basePayload = buildN8nPayloadFromLead(e);
    const extendedProfile = realProfile?.signatures?.profile_extended || {};
    const payload = {
      ...basePayload,
      userCompanyProfile: {
        ...basePayload.userCompanyProfile,
        name: realProfile?.company_name || basePayload.userCompanyProfile?.name || null,
        sector: extendedProfile.sector || extendedProfile.industry || extendedProfile.market || basePayload.userCompanyProfile?.sector || null,
        description: extendedProfile.description || basePayload.userCompanyProfile?.description || null,
        services: Array.isArray(extendedProfile.services) ? extendedProfile.services.join('\n') : basePayload.userCompanyProfile?.services || null,
        valueProposition: extendedProfile.valueProposition || extendedProfile.value_proposition || basePayload.userCompanyProfile?.valueProposition || null,
        website: realProfile?.company_domain ? `https://${realProfile.company_domain.replace(/^https?:\/\//, '')}` : basePayload.userCompanyProfile?.website || null,
      },
      userContext: {
        id: userId,
        name: realProfile?.full_name || null,
        jobTitle: realProfile?.job_title || null,
      },
    };

    setResearchUi({
      leadName: e.fullName,
      index,
      total,
      startedAt: Date.now(),
      status: 'preparing',
      reportId: null,
      warning: null,
    });

    const startRes = await fetch('/api/research/n8n', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Env': 'LeadFlowAI',
        'Idempotency-Key': requestKey,
      },
      cache: 'no-store',
      body: JSON.stringify(payload),
    });

    let initial: any = null;
    let raw = '';
    try {
      initial = await startRes.json();
    } catch {
      raw = await startRes.text().catch(() => '');
    }

    if (!startRes.ok) {
      const msg = initial?.message || initial?.error || raw || 'lead-research error';
      throw new Error(msg);
    }

    const initialReport = Array.isArray(initial?.reports) && initial.reports.length ? initial.reports[0] : initial;
    let final = initialReport;
    const normalizedInitial = unwrapLeadResearchResponse(initialReport);
    const reportId = String(initialReport?.id || normalizedInitial?.report_id || '').trim() || null;
    const initialStatus = String(initialReport?.raw?.status || normalizedInitial?.status || 'completed');
    const warnings = getLeadResearchWarnings(normalizedInitial);
    setResearchUi((prev) => ({
      ...prev,
      status: (initialStatus as ResearchLifecycleStatus),
      reportId,
      warning: warnings[0] || null,
    }));

    if (reportId && ['queued', 'in_progress'].includes(String(normalizedInitial?.status || ''))) {
      for (let attempt = 0; attempt < 18; attempt++) {
        await sleep(4000);
        const pollRes = await fetch(`/api/lead-research/${encodeURIComponent(reportId)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        let polled: any = null;
        try {
          polled = await pollRes.json();
        } catch {
          polled = null;
        }

        if (!pollRes.ok) {
          throw new Error(polled?.message || polled?.error || `lead-research poll error ${pollRes.status}`);
        }

        final = polled;
        const normalizedPolled = unwrapLeadResearchResponse(polled);
        const nextWarnings = getLeadResearchWarnings(normalizedPolled);
        setResearchUi((prev) => ({
          ...prev,
          status: (String(normalizedPolled?.status || 'in_progress') as ResearchLifecycleStatus),
          warning: nextWarnings[0] || prev.warning || null,
        }));

        if (['completed', 'partial', 'insufficient_data', 'failed'].includes(String(normalizedPolled?.status || ''))) {
          break;
        }
      }
    }

    // Espejo local de cuota
    Quota.incClientQuota('research');

    const finalReport = Array.isArray(final?.reports) && final.reports.length ? final.reports[0] : final;
    const normalizedFinal = unwrapLeadResearchResponse(finalReport);
    const report = finalReport?.id && finalReport?.company && finalReport?.createdAt && finalReport?.cross
      ? { ...finalReport, meta: { ...finalReport.meta, leadRef: finalReport.meta?.leadRef || leadRef } } as LeadResearchReport
      : adaptLeadResearchResponseToReport(normalizedFinal, leadRef);
    if (!hasMeaningfulLeadResearch(report)) {
      throw new Error('La respuesta de investigacion no contenia informacion util. Puedes volver a intentarlo.');
    }
    upsertLeadReports([report]);
    setReports(getLeadReports());

    setResearchUi((prev) => ({
      ...prev,
      status: (String(finalReport?.raw?.status || normalizedFinal?.status || 'completed') as ResearchLifecycleStatus),
      warning: getLeadResearchWarnings(normalizedFinal)[0] || prev.warning || null,
    }));

    if (hasMeaningfulLeadResearch(report) && ['completed', 'partial'].includes(String(finalReport?.raw?.status || normalizedFinal?.status || 'completed'))) {
      markResearched([leadRef]);
    }

    if (String(finalReport?.raw?.status || normalizedFinal?.status || '') === 'insufficient_data') {
      toast({
        variant: 'destructive',
        title: `Investigacion limitada para ${e.fullName}`,
        description: 'No se encontró suficiente información útil para generar un reporte comercial sólido.',
      });
    } else if (getLeadResearchWarnings(normalizedFinal).length > 0) {
      toast({
        title: `Investigacion completada con advertencias`,
        description: getLeadResearchWarnings(normalizedFinal)[0],
      });
    }
  }

  async function investigateOneByOne() {
    if (seqRunning) return;
    const selectedLeadsForResearch = Object.keys(sel).filter(id => sel[id]);
    const selected = filtered.filter(e => selectedLeadsForResearch.includes(e.id));
    if (selected.length === 0) return;

    // Preflight: verifica que el proxy al motor de research este disponible
    try {
      const health = await fetch('/api/research/n8n', { method: 'GET', cache: 'no-store' }).then(r => r.json());
      if (!health?.hasUrl) {
        toast({
          variant: 'destructive',
          title: 'Investigación no disponible',
          description: 'El servicio de investigación no está disponible ahora. Inténtalo más tarde.',
        });
        return;
      }
    } catch { /* ignoramos si falla el GET, el POST igual reportará */ }

    if (!Quota.canUseClientQuota('research')) {
      toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: `Has llegado al límite de investigaciones por hoy.` });
      return;
    }

    setSeqRunning(true);
    setSeqDone(0);
    setSeqTotal(selected.length);

    try {
      // Obtener identidad UNA vez para toda la cola.
      const userId = await getUserIdOrFail().catch((err) => {
        console.warn('[research] identity error', err);
        toast({
          variant: 'destructive',
          title: 'Sesion no disponible',
          description: 'Recarga la pagina para continuar con la investigación.',
        });
        throw new Error('missing user id');
      });

      for (let idx = 0; idx < selected.length; idx++) {
        const e = selected[idx];
        // NO bloqueamos por dominio/nombre: solo si ya existe reporte para ESTE leadRef
        if (hasReportStrict(e)) {
          setSeqDone(prev => prev + 1);
          continue;
        }

        let lastErr: any = null;
        const requestKey = uuid();
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await runOneInvestigation(e, userId, idx + 1, selected.length, requestKey);
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            if (String(err?.message || '').includes('missing user id')) {
              // No reintentes si no hay identidad
              break;
            }
            await sleep(1500);
          }
        }
        if (lastErr) {
          console.error(`Investigación falló para ${e.companyName}:`, lastErr?.message);
          setResearchUi(prev => ({
            ...prev,
            leadName: e.fullName,
            index: idx + 1,
            total: selected.length,
            status: 'failed',
            warning: lastErr?.message || null,
          }));
          toast({
            variant: "destructive",
            title: `Investigación falló para ${e.companyName}`,
            description: lastErr?.message || 'Error desconocido en el motor de investigación.'
          });
        }
        setSeqDone(prev => prev + 1);
        await sleep(1200);
      }
    } finally {
      setSeqRunning(false);
      setResearchUi(prev => ({ ...prev, status: prev.status === 'failed' ? 'failed' : 'idle' }));
      setResearchPulseMs(0);
      // Refresh credits
      organizationService.getCredits().then(res => {
        if (res) {
          setSocialCredits(res.credits);
          setSocialEnabled(res.enabled);
        }
      });
      toast({ title: 'Investigación completa', description: `Procesados ${selected.length} leads.` });
    }
  }
  function clearInvestigationFor(lead: EnrichedLead) {
    if (!confirm(`¿Borrar investigación para ${lead.fullName}?`)) return;
    const ref = leadRefOf(lead);
    const domain = (lead.companyDomain || '').trim();

    leadResearchStorage.removeWhere(r => {
      const rRef = (r?.meta?.leadRef || '').trim();
      const rDom = (r?.company?.domain || '').trim();
      return Boolean((ref && rRef === ref) || (domain && rDom === domain));
    });

    toast({ title: 'Investigación eliminada', description: `Se borraron los datos de ${lead.fullName}.` });
    setTick(t => t + 1);
  }

  /** Borra reportes de investigación y desmarca "investigado" para TODOS los leads visibles. */
  function clearInvestigations() {
    if (!enriched.length) return;
    const ok = confirm('¿Borrar todos los reportes e investigaciones de los leads listados? Podrás investigarlos nuevamente.');
    if (!ok) return;

    // 1) Construir referencias y dominios objetivo
    const refs = enriched.map(leadRefOf).filter(Boolean);
    const domains = new Set(enriched.map(e => (e.companyDomain || '').trim()).filter(Boolean));

    // 2) Eliminar reportes (cualquier reporte que haga match por leadRef o por dominio)
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim();
      const dom = (r?.company?.domain || '').trim();
      return Boolean((ref && refs.includes(ref)) || (dom && domains.has(dom)));
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
    const domains = new Set(targets.map(e => (e.companyDomain || '').trim()).filter(Boolean));

    const removedCount = leadResearchStorage.removeWhere((r) => {
      const ref = (r?.meta?.leadRef || '').trim();
      const dom = (r?.company?.domain || '').trim();
      return Boolean((ref && refs.includes(ref)) || (dom && domains.has(dom)));
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
    const dom = (lead.companyDomain || '').trim();
    const removedCount = leadResearchStorage.removeWhere((r) => {
      const rref = (r?.meta?.leadRef || '').trim();
      const rdom = (r?.company?.domain || '').trim();
      return (!!ref && rref === ref) || (!!dom && rdom === dom);
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

  function openLinkedinCompose(lead: EnrichedLead) {
    const linkedinUrl = normalizeLinkedinProfileUrl(lead.linkedinUrl);
    if (!linkedinUrl) {
      toast({
        variant: 'destructive',
        title: 'Perfil de LinkedIn no válido',
        description: 'Este lead necesita una URL pública de perfil de LinkedIn antes de contactar.',
      });
      return;
    }
    setLinkedinLead({ ...lead, linkedinUrl });

    const rep = findReportForLead({ leadId: leadRefOf(lead), companyDomain: lead.companyDomain || null, companyName: lead.companyName || null });
    const draft = buildLinkedinDraft(lead, rep);

    setLinkedinMessage(draft.message);
    setLinkedinDraftNote(draft.personalization);
    setLinkedinDraftIsPersonalized(draft.isPersonalized);
    setOpenLinkedin(true);
  }

  async function handleScheduleCampaign() {
    // Get selected leads
    const selectedIds = Array.from(selectedToContact);
    const leadsToSchedule = enriched.filter(e => selectedIds.includes(e.id)).map(e => ({
      id: e.id,
      name: e.fullName,
      company: e.companyName,
      email: e.email, // Assuming email is always present for contacting
      linkedinUrl: e.linkedinUrl,
      role: e.title,
      industry: (e as any).industry // safe cast if property exists in enriched lead,
    }));

    // Validation
    if (scheduleConfig.channel === 'linkedin') {
      const missingUrl = leadsToSchedule.filter(l => !l.linkedinUrl).length;
      if (missingUrl > 0) {
        toast({ variant: 'destructive', title: 'Error', description: `${missingUrl} leads no tienen URL de LinkedIn.` });
        return;
      }
    }

    setScheduling(true);
    try {
      const plan = plannerService.calculateSchedule(leadsToSchedule, scheduleConfig);
      await plannerService.saveSchedule(plan);

      toast({ title: 'Campaña Agendada', description: `Se programaron ${plan.length} envíos.` });
      setOpenSchedule(false);
      router.push('/planner');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setScheduling(false);
    }
  }

  async function handleSendLinkedin() {
    if (!linkedinLead || !linkedinMessage) return;
    setSendingLinkedin(true);

    try {
      // 1. Check Extension
        if (!extensionService.isInstalled) {
          toast({
            variant: 'destructive',
            title: 'Extensión no detectada',
            description: 'Instálala desde la guía de este cuadro y luego recarga Anton.IA.'
          });
        setSendingLinkedin(false);
        return;
      }

      // 2. Send Command
      const res = await extensionService.sendLinkedinDM(linkedinLead.linkedinUrl!, linkedinMessage);

      if (res.success) {
        // 3. Save Log
        await contactedLeadsStorage.add({
          id: uuid(),
          leadId: linkedinLead.id,
          name: linkedinLead.fullName,
          email: linkedinLead.email || '',
          company: linkedinLead.companyName,
          role: linkedinLead.title,
          industry: linkedinLead.industry,
          city: linkedinLead.city,
          country: linkedinLead.country,

          subject: `LinkedIn DM\n\n${linkedinMessage}`,
          status: 'sent',
          provider: 'linkedin', // New provider
          linkedinThreadUrl: res.linkedinThreadUrl || linkedinLead.linkedinUrl,
          linkedinMessageStatus: 'sent',
          sentAt: new Date().toISOString(),

          // Tech fields
          lastUpdateAt: new Date().toISOString()
        });

        toast({ title: 'Mensaje confirmado', description: 'LinkedIn mostró el mensaje en la conversación.' });
        setOpenLinkedin(false);

        // Optional: Remove from enriched?
        // await removeEnrichedLeadById(linkedinLead.id);
      } else {
        console.error('Extension returned error:', res.error);
        toast({ variant: 'destructive', title: 'No se confirmó el mensaje', description: res.error || 'Revisa la conversación de LinkedIn antes de reintentar.' });
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Excepción', description: e.message });
    } finally {
      setSendingLinkedin(false);
    }
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
        const rep = findReportForLead({ leadId: leadRefOf(l), companyDomain: l.companyDomain || null, companyName: l.companyName || null });
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

  async function openBulkCompose() {
    if (bulkOperationId && composeList.length > 0) {
      setOpenCompose(true);
      return;
    }
    try {
      const styleName = selectedStyleName || styleProfiles[0]?.name || '';
      const drafts = await buildComposeDrafts(draftSource, styleName);

      setComposeList(drafts);
      if (!bulkOperationId) setBulkOperationId(uuid());
      if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
      if (!bulkOperationId) setBulkProvider('outlook');
      setOpenCompose(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo preparar el borrador.' });
    }
  }

  async function sendBulk() {
    const items = composeList;
    if (!items?.length) return;

    setSendingBulk(true);
    setSendProgress({ done: 0, total: items.length });
    const removedIds = new Set<string>();
    const failedItems: typeof items = [];
    const operationId = bulkOperationId || uuid();
    if (!bulkOperationId) setBulkOperationId(operationId);

    for (let i = 0; i < items.length; i++) {
      const { lead, subject, body, researchSnapshotId } = items[i];
      try {
        let res: any = null;
        const operation = buildManualEmailOperation(operationId, {
          scope: 'enriched-bulk',
          recipientId: lead.id,
          email: lead.email!,
          subject,
          body,
          provider: bulkProvider,
          deliveryOptions: { pixel: usePixel, links: useLinkTracking, readReceipt: bulkProvider === 'outlook' && useReadReceipt },
        });
        const trackingId = operation.trackingId;
        const finalHtmlBody = body.replace(/\n/g, '<br/>');

        if (bulkProvider === 'outlook') {
          res = await sendEmail({
            to: lead.email!,
            subject,
            htmlBody: finalHtmlBody,
            requestReceipts: useReadReceipt,
            leadId: lead.id,
            researchSnapshotId,
            idempotencyKey: operation.idempotencyKey,
            trackingId,
            tracking: { pixel: usePixel, linkTracking: useLinkTracking },
          });
        } else {
          // Gmail
          res = await sendGmailEmail({
            to: lead.email!,
            subject,
            html: finalHtmlBody,
            leadId: lead.id,
            researchSnapshotId,
            idempotencyKey: operation.idempotencyKey,
            trackingId,
            tracking: { pixel: usePixel, linkTracking: useLinkTracking },
          });
        }
        Quota.incClientQuota('contact');
        await contactedLeadsStorage.add({
          id: trackingId, // Use the same ID
          leadId: lead.id,
          name: lead.fullName,
          email: lead.email!,
          company: lead.companyName,
          role: lead.title,
          industry: lead.industry,
          city: lead.city,
          country: lead.country,
          subject,
          sentAt: new Date().toISOString(),
          status: 'sent',
          provider: bulkProvider,
          // Campos según proveedor
          messageId: bulkProvider === 'outlook' ? res?.messageId : res?.id,
          conversationId: bulkProvider === 'outlook' ? res?.conversationId : undefined,
          internetMessageId: bulkProvider === 'outlook' ? res?.internetMessageId : undefined,
          threadId: bulkProvider === 'gmail' ? res?.threadId : undefined,
          lastUpdateAt: new Date().toISOString(),
        });

        // ✅ mover fuera de Enriquecidos si el envío fue OK
        await removeEnrichedLeadById(lead.id);
        removedIds.add(lead.id);
      } catch (e: any) {
        failedItems.push(items[i]);
        console.error(`send mail error (${bulkProvider})`, lead.email, e?.message);
      }
      setSendProgress(p => ({ ...p, done: p.done + 1 }));
      await new Promise(res => setTimeout(res, 500));
    }

    setSendingBulk(false);
    setComposeList(failedItems);
    // Actualiza UI y selecciones
    if (removedIds.size) {
      setEnriched(prev => prev.filter(x => !removedIds.has(x.id)));
      setSelectedToContact(new Set(Array.from(selectedToContact).filter(id => !removedIds.has(id))));
    }
    const failedCount = items.length - removedIds.size;
    if (failedCount === 0) {
      setOpenCompose(false);
      setBulkOperationId('');
    }
    toast({
      variant: failedCount > 0 ? 'destructive' : undefined,
      title: failedCount > 0 ? 'Envío parcial' : 'Envío completado',
      description: `${removedIds.size} enviados por ${bulkProvider}${failedCount > 0 ? ` · ${failedCount} con error` : ''}.`,
    });
  }

  const goContact = (id: string, subject?: string, body?: string) => {
    const url = new URL(window.location.origin + `/contact/compose`);
    url.searchParams.set('id', id);
    if (subject) url.searchParams.set('subject', subject);
    if (body) url.searchParams.set('body', body);
    router.push(url.toString());
  };

  async function generateEmailFromReportFor(e: EnrichedLead) {
    const report = findReportForLead({ leadId: leadRefOf(e), companyDomain: e.companyDomain, companyName: e.companyName });
    if (!report?.cross?.emailDraft) {
      toast({ title: 'Sin borrador', description: 'Investiga este lead para generar un borrador personalizado.' });
      if (report) openReportFor(e);
      return;
    }
    const company = buildEffectiveCompanyProfile(currentProfile);
    const sender = buildSenderInfo(currentProfile);
    const ctx = buildPersonEmailContext({
      lead: { name: e.fullName, email: e.email!, title: e.title, company: e.companyName },
      company: { name: e.companyName, domain: e.companyDomain },
      sender,
    });
    let subj = renderTemplate(report.cross.emailDraft.subject || '', ctx);
    let body = renderTemplate(report.cross.emailDraft.body || '', ctx);
    body = applySignaturePlaceholders(body, sender);
    subj = ensureSubjectPrefix(subj, ctx.lead.firstName);
    goContact(e.id, subj, body);
  }

  function openReportFor(e: EnrichedLead) {
    const rep = findReportForLead({ leadId: leadRefOf(e), companyDomain: e.companyDomain || null, companyName: e.companyName || null });
    if (!rep?.cross) {
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
  const researchCount = Object.values(sel).filter(Boolean).length;
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
          title={contactCount === 0 ? 'Selecciona leads con reporte y email' : 'Preparar mensajes para la selección'}
        >
          Contactar {contactCount > 0 ? `(${contactCount})` : ''}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm shadow-[0_14px_35px_-32px_rgba(15,23,42,0.28)]">
        <span><strong className="font-semibold tabular-nums">{phoneReadyCount}</strong> <span className="text-muted-foreground">con teléfono</span></span>
        <span><strong className="font-semibold tabular-nums">{researchEligible}</strong> <span className="text-muted-foreground">por investigar</span></span>
        {pendingPhoneCount > 0 ? <span><strong className="font-semibold tabular-nums">{pendingPhoneCount}</strong> <span className="text-muted-foreground">actualizando teléfono</span></span> : null}
        {socialCredits !== null ? (
          <span title={socialEnabled ? 'Investigación avanzada disponible' : 'Se usará investigación estándar'}>
            <strong className="font-semibold tabular-nums">{socialCredits}</strong> <span className="text-muted-foreground">créditos avanzados</span>
          </span>
        ) : null}
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
                <Collapsible open={showFilters} onOpenChange={setShowFilters}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full" aria-expanded={showFilters}>
                      <ListFilter className="h-4 w-4" />
                      Filtros
                      <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
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
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
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
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Incluir · Empresa</div>
                  <Input value={fIncCompany} onChange={e => setFIncCompany(e.target.value)} placeholder="contiene… (separa con comas)" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Incluir · Nombre</div>
                  <Input value={fIncLead} onChange={e => setFIncLead(e.target.value)} placeholder="contiene… (separa con comas)" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Incluir · Cargo</div>
                  <Input value={fIncTitle} onChange={e => setFIncTitle(e.target.value)} placeholder="contiene… (separa con comas)" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Excluir · Empresa</div>
                  <Input value={fExcCompany} onChange={e => setFExcCompany(e.target.value)} placeholder="no contenga… (separa con comas)" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Excluir · Nombre</div>
                  <Input value={fExcLead} onChange={e => setFExcLead(e.target.value)} placeholder="no contenga… (separa con comas)" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Excluir · Cargo</div>
                  <Input value={fExcTitle} onChange={e => setFExcTitle(e.target.value)} placeholder="no contenga… (separa con comas)" />
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
              <div className="text-sm font-medium">
                {researchCount > 0 ? `${researchCount} para investigar` : ''}
                {researchCount > 0 && contactCount > 0 ? ' · ' : ''}
                {contactCount > 0 ? `${contactCount} para contactar` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setSel({}); setSelectedToContact(new Set()); }}>Cancelar</Button>
                {researchCount > 0 ? <Button variant="secondary" size="sm" onClick={investigateOneByOne} disabled={seqRunning}>{seqRunning ? 'Investigando…' : 'Investigar selección'}</Button> : null}
                {contactCount > 0 ? <Button size="sm" onClick={openBulkCompose}>Contactar selección</Button> : null}
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

          {seqRunning && (
            <div className="mb-4 rounded-2xl border border-sky-500/25 bg-sky-500/5 px-4 py-3 dark:border-sky-400/25">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground"><BrainCircuit className="h-4 w-4" />Investigando</span>
                    <span className="text-sm text-muted-foreground">{researchUi.leadName || 'Preparando lead'} · {Math.max(researchUi.index, seqDone + 1)}/{seqTotal}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{getResearchStageCopy(researchUi.status, researchPulseMs)}</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{researchUi.warning || `Estimado: ${Math.max(0, Math.ceil((RESEARCH_STANDARD_ESTIMATE_MS - Math.min(researchPulseMs, RESEARCH_STANDARD_ESTIMATE_MS)) / 1000))} s restantes`}</span>
                    <span>{getResearchProgressValue(researchUi.status, researchPulseMs)}%</span>
                  </div>
                  <Progress value={getResearchProgressValue(researchUi.status, researchPulseMs)} className="h-2" />
                </div>
              </div>
            </div>
          )}

          {loadingLeads ? (
            <div className="overflow-hidden rounded-2xl border border-border/60">
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
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background/60">
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
                  <TableHead className="w-12 text-center" title="Marcar para CONTACTAR por email">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Contact.</span>
                      <Checkbox
                        checked={contactEligiblePage > 0 ? allContactChecked : false}
                        disabled={contactEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllContact(Boolean(v))}
                        aria-label="Seleccionar todos para contactar"
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
                        onCheckedChange={(v) => setSel(prev => ({ ...prev, [e.id]: Boolean(v) }))}
                        disabled={
                          !e.email ||
                          isResearched(leadRefOf(e)) ||
                          hasReportStrict(e)
                        }
                        title={
                          !e.email
                            ? 'Este lead no tiene email revelado'
                            : isResearched(leadRefOf(e)) || hasReportStrict(e)
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
                        aria-label={`Seleccionar ${e.fullName || 'lead'} para contactar`}
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
                                const rep = findReportForLead({ leadId: leadRefOf(e), companyDomain: e.companyDomain, companyName: e.companyName });
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
                      {hasReport(e) ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Investigado</span> : <span className="text-xs text-muted-foreground">Pendiente de investigación</span>}
                      {e.linkedinUrl ? <a className="mt-1 block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" target="_blank" rel="noreferrer" href={e.linkedinUrl}>LinkedIn</a> : null}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex min-w-[180px] items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-8 rounded-full px-3" onClick={() => openReportFor(e)} disabled={!hasReport(e)}>Reporte</Button>
                          <Button size="sm" className="h-8 rounded-full px-3 shadow-none" onClick={() => generateEmailFromReportFor(e)} disabled={!canContact(e)}>Contactar</Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label={`Más acciones para ${e.fullName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openLinkedinCompose(e)} disabled={!e.linkedinUrl}><Linkedin className="mr-2 h-4 w-4" />Contactar por LinkedIn</DropdownMenuItem>
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

      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-[28px] p-0" onEscapeKeyDown={() => setOpenReport(false)}>
          <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Investigación</div>
                <DialogTitle className="mt-1 text-xl">{reportToView?.cross?.company.name || reportLead?.companyName || 'Reporte del lead'}</DialogTitle>
              </div>
              {reportLead && <Button size="sm" onClick={() => { generateEmailFromReportFor(reportLead); setOpenReport(false); }}>Crear email</Button>}
            </div>
          </DialogHeader>
          {reportToView?.cross && reportLead && (
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
          {reportToView?.cross && (
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
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden rounded-[28px] p-0" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Envío en lote</div>
                <DialogTitle className="mt-1 text-xl">Revisa {composeList.length} borradores</DialogTitle>
                <CardDescription className="mt-1">Cada mensaje se personaliza antes de enviarse.</CardDescription>
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
                      const rep = findReportForLead({
                        leadId: leadRefOf(lead),
                        companyDomain: lead.companyDomain || null,
                        companyName: lead.companyName || null
                      });
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
              <Button onClick={sendBulk} disabled={sendingBulk || !composeList?.length}>
                {sendingBulk ? 'Enviando…' : `Enviar todos (${bulkProvider})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

       {/* LinkedIn Compose Modal */}
       <Dialog open={openLinkedin} onOpenChange={setOpenLinkedin}>
         <DialogContent className="max-w-xl rounded-[28px]">
           <DialogHeader className="space-y-2">
             <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"><Linkedin className="h-4 w-4" />Mensaje directo</div>
             <DialogTitle>Revisa el mensaje para {linkedinLead?.fullName}</DialogTitle>
             <CardDescription>Se abrirá el perfil y la extensión solo continuará si LinkedIn confirma el mensaje en la conversación.</CardDescription>
           </DialogHeader>
           <div className="space-y-4">
             <div className={`rounded-xl border p-3 text-sm ${linkedinDraftIsPersonalized ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-950 dark:text-emerald-100' : 'border-amber-500/25 bg-amber-500/5 text-amber-950 dark:text-amber-100'}`}>
               <div className="flex items-center gap-2 font-medium">
                 {linkedinDraftIsPersonalized ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                 {linkedinDraftIsPersonalized ? 'Personalización encontrada' : 'Revisión recomendada'}
               </div>
               <p className="mt-1 text-xs opacity-80">{linkedinDraftNote}</p>
             </div>
             <div className="space-y-2">
               <div className="flex items-center justify-between"><label htmlFor="linkedin-message" className="text-sm font-medium">Mensaje</label><span className={`text-xs ${linkedinMessage.length > 500 ? 'text-destructive' : 'text-muted-foreground'}`}>{linkedinMessage.length}/500</span></div>
               <Textarea id="linkedin-message" value={linkedinMessage} onChange={(e) => setLinkedinMessage(e.target.value)} rows={7} placeholder="Escribe tu mensaje aquí..." />
             </div>
             <div className="rounded-xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground">
               No se enviarán invitaciones de conexión automáticamente. Si LinkedIn no confirma el mensaje, el lead seguirá disponible para revisión.
             </div>
             <div className="rounded-xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground">
               <p className="font-medium text-foreground">¿No tienes la extensión?</p>
               <p className="mt-1">Descárgala, extrae el ZIP y abre <code className="rounded bg-background px-1 py-0.5">chrome://extensions</code>. Activa el modo desarrollador y selecciona <strong>Cargar descomprimida</strong>.</p>
               <a href="/downloads/antonia-linkedin-extension.zip" download className="mt-2 inline-flex font-medium text-primary underline underline-offset-4">Descargar extensión para Chrome (.zip)</a>
             </div>
             <div className="flex justify-end gap-2">
               <Button variant="outline" onClick={() => setOpenLinkedin(false)}>Cancelar</Button>
               <Button onClick={handleSendLinkedin} disabled={sendingLinkedin || !linkedinMessage.trim() || linkedinMessage.length > 500}>
                 {sendingLinkedin ? 'Verificando envío…' : 'Enviar mensaje directo'}
               </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Campaign Scheduler Modal */}
      <Dialog open={openSchedule} onOpenChange={setOpenSchedule}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agendar Campaña Inteligente</DialogTitle>
            <CardDescription>
              Distribuye {selectedToContact.size} leads automáticamente en el calendario.
            </CardDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Canal</Label>
              <Select
                value={scheduleConfig.channel}
                onValueChange={(v: any) => setScheduleConfig({ ...scheduleConfig, channel: v })}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Inicio</Label>
              <div className="col-span-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={`w-full justify-start text-left font-normal ${!scheduleConfig.startDate && "text-muted-foreground"}`}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduleConfig.startDate ? format(scheduleConfig.startDate, "PPP", { locale: es }) : <span>Elegir fecha</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={scheduleConfig.startDate} onSelect={(d) => d && setScheduleConfig({ ...scheduleConfig, startDate: d })} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Ritmo</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Input
                  type="number"
                  value={scheduleConfig.msgsPerDay}
                  onChange={(e) => setScheduleConfig({ ...scheduleConfig, msgsPerDay: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">mensajes / día</span>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Opciones</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Checkbox
                  id="skipWeekends"
                  checked={scheduleConfig.skipWeekends}
                  onCheckedChange={(c) => setScheduleConfig({ ...scheduleConfig, skipWeekends: Boolean(c) })}
                />
                <Label htmlFor="skipWeekends" className="text-sm font-normal">Saltar fines de semana</Label>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenSchedule(false)}>Cancelar</Button>
            <Button onClick={handleScheduleCampaign} disabled={scheduling}>
              {scheduling ? 'Agendando...' : 'Confirmar Agenda'}
            </Button>
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


