
'use client';
import { useEffect, useState, useMemo } from 'react';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { upsertLeadReports, findReportForLead, leadResearchStorage, getLeadReports, findReportByRef } from '@/lib/lead-research-storage';
import { BackBar } from '@/components/back-bar';
import { v4 as uuid } from 'uuid';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { removeEnrichedLeadById, getEnrichedLeads as enrichedLeadsStorageGet, enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { Trash2, Download, FileSpreadsheet, RotateCw, Undo2, Save, Eraser, Linkedin, Phone } from 'lucide-react';
import { extensionService } from '@/lib/services/extension-service';
import { supabaseService } from '@/lib/supabase-service';
import { getCompanyProfile } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import { sendEmail } from '@/lib/outlook-email-service';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isResearched, markResearched, unmarkResearched } from '@/lib/researched-leads-storage';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { renderTemplate, buildPersonEmailContext } from '@/lib/template';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import * as Quota from '@/lib/quota-client';
import { generateCompanyOutreachV2, ensureSubjectPrefix } from '@/lib/outreach-templates';
import { emailDraftsStorage } from '@/lib/email-drafts-storage';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getFirstNameSafe } from '@/lib/template';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { profileService } from '@/lib/services/profile-service';
import { generateLinkedinDraft } from '@/lib/ai/linkedin-templates';
import { plannerService, ScheduleConfig } from '@/lib/services/planner-service';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';


const extractDomainFromEmail = (email?: string | null) =>
  email && email.includes('@') ? email.split('@')[1].toLowerCase() : undefined;

import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';

export default function EnrichedLeadsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [enriched, setEnriched] = useState<EnrichedLead[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});           // selección para INVESTIGAR
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [openReport, setOpenReport] = useState(false);
  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [reportLead, setReportLead] = useState<EnrichedLead | null>(null);

  const [seqRunning, setSeqRunning] = useState(false);
  const [seqDone, setSeqDone] = useState(0);
  const [seqTotal, setSeqTotal] = useState(0);

  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());
  const [openCompose, setOpenCompose] = useState(false);
  const [composeList, setComposeList] = useState<Array<{ lead: EnrichedLead; subject: string; body: string }>>([]);
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
      const userId = await getUserIdOrFail();

      // Map to minimal payload
      const payloadLeads = leadsToEnrich.map(l => ({
        fullName: l.fullName,
        linkedinUrl: l.linkedinUrl,
        companyName: l.companyName,
        companyDomain: l.companyDomain,
        title: l.title,
        sourceOpportunityId: l.sourceOpportunityId,
        clientRef: l.id
      }));

      const res = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          leads: payloadLeads,
          revealEmail: opts.revealEmail,
          revealPhone: opts.revealPhone
        }),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      const { enriched: newEnriched } = data;

      if (Array.isArray(newEnriched) && newEnriched.length) {
        const toUpdate: EnrichedLead[] = [];
        const toAdd: EnrichedLead[] = [];

        newEnriched.forEach((incoming: EnrichedLead & { clientRef?: string }) => {
          // Match with existing
          const existing = enriched.find(e => e.id === incoming.clientRef);
          if (existing) {
            // Merge important fields, keep ID
            toUpdate.push({
              ...existing, // Keep original creation date, etc
              email: incoming.email || existing.email,
              emailStatus: incoming.emailStatus || existing.emailStatus,
              phoneNumbers: incoming.phoneNumbers,
              primaryPhone: incoming.primaryPhone,
              // If unlocked new info
              linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
              companyName: incoming.companyName || existing.companyName,
              title: incoming.title || existing.title,
              // Ensure we use the proper ID for the update
              id: existing.id
            });
          } else {
            toAdd.push(incoming);
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
  const [sendingLinkedin, setSendingLinkedin] = useState(false);

  // --- Campaign Schedule Modal ---
  const [openSchedule, setOpenSchedule] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({
    startDate: new Date(),
    msgsPerDay: 50,
    skipWeekends: true,
    channel: 'linkedin'
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

  // --- FILTROS ---
  const [companyFilter, setCompanyFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');

  useEffect(() => {
    async function loadData() {
      const e = await enrichedLeadsStorageGet();
      const saved = await supabaseService.getLeads();

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
    }
    loadData();

    // Realtime Subscription
    const channel = supabase
      .channel('enriched-leads-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enriched_leads' },
        () => {
          // Simplest strategy: reload full list on any change to ensure consistency
          // This handles INSERT (new), DELETE (removed), UPDATE (edited)
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Listen for Auth Changes to reload data if session restores late
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
        // Force reload when we are sure we have a user
        enrichedLeadsStorageGet().then((e) => {
          supabaseService.getLeads().then((saved) => {
            const patched = e.map((x) => {
              if (x.companyName && x.companyDomain) return x;
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
          });
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

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
  function leadRefOf(e: EnrichedLead) {
    return e.id || e.email || e.linkedinUrl || `${e.fullName}|${e.companyName || ''}`;
  }

  /** Reporte (cualquier fuente: por ref, por dominio o por nombre). */
  function hasReport(e: EnrichedLead) {
    return !!findReportForLead({
      leadId: leadRefOf(e),
      companyDomain: e.companyDomain || null,
      companyName: e.companyName || null,
    })?.cross;
  }

  /** Reporte estrictamente por referencia de lead (NO por dominio/nombre). */
  function hasReportStrict(e: EnrichedLead) {
    return !!findReportByRef(leadRefOf(e))?.cross;
  }

  // Helper to inject link tracking (duplicated from compose, should be util but ok for now)
  function rewriteLinksForTracking(html: string, trackingId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Unify regex with the robust one from EmailTestPage
    return html.replace(/href=(["'])(http[^"']+)\1/gi, (match: string, quote: string, url: string) => {
      if (url.includes('/api/tracking/click')) return match;
      const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
      return `href=${quote}${trackingUrl}${quote}`;
    });
  }

  const canContact = (lead: EnrichedLead) => hasReport(lead) && !!lead.email;

  // Normaliza cadenas (quita acentos y pasa a minúsculas)
  const norm = (s?: string | null) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const splitTerms = (value: string) =>
    value
      .split(',')
      .map(t => norm(t).trim())
      .filter(Boolean);

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
      // INCLUIR: debe cumplir todos los grupos que el usuario haya escrito
      containsAny(e.companyName, incCompanies) &&
      containsAny(e.fullName, incLeads) &&
      containsAny(e.title, incTitles) &&

      // EXCLUIR: si alguno matchea, se descarta
      excludesAll(e.companyName, excCompanies) &&
      excludesAll(e.fullName, excLeads) &&
      excludesAll(e.title, excTitles)
    );
  }, [enriched, applied]);

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
    [filtered, reports]
  );

  // === Métricas para los "seleccionar todos" ===
  const researchEligiblePage = useMemo(
    // Elegible si: tiene email, NO está marcado investigado y NO tiene reporte por ref (otros leads no bloquean)
    () => pageLeads.filter(e => e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)).length,
    [pageLeads, reports]
  );
  const contactEligiblePage = useMemo(() => pageLeads.filter(canContact).length, [pageLeads, reports]);

  const allResearchChecked = useMemo(
    () => researchEligiblePage > 0 && pageLeads.filter(e => e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)).every(e => sel[e.id]),
    [pageLeads, sel, researchEligiblePage]
  );
  const allContactChecked = useMemo(
    () => contactEligiblePage > 0 && pageLeads.filter(canContact).every(l => selectedToContact.has(l.id)),
    [pageLeads, selectedToContact, contactEligiblePage]
  );

  const anyInvestigated = useMemo(
    () => enriched.some(e => isResearched(leadRefOf(e)) || hasReport(e)),
    [enriched, reports]
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

  /** Obtiene/crea sesión MSAL y devuelve email/uid para cabecera X-User-Id. */
  /** Obtiene ID de usuario autenticado de Supabase para headers. */
  async function getUserIdOrFail(): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      // Si no hay usuario, redirigir (aunque el middleware ya debería proteger)
      toast({ variant: 'destructive', title: 'Error de sesión', description: 'No se detectó usuario. Recarga la página.' });
      throw new Error('no_identity');
    }
    return user.id;
  }

  async function runOneInvestigation(e: EnrichedLead, userId: string) {
    const leadRef = leadRefOf(e);

    // Usa tu builder (ya arma targetCompany/lead/userCompanyProfile)
    const base = buildN8nPayloadFromLead(e) as any;

    // Normaliza y asegura meta.leadRef dentro de companies[0]
    const item = base?.companies?.[0]
      ? { ...base.companies[0] }
      : {
        leadRef,
        targetCompany: {
          name: e.companyName || null,
          domain: e.companyDomain || null,
          linkedin: (e as any).companyLinkedinUrl || null,
          country: (e as any).country || null,
          industry: (e as any).industry || null,
          website: e.companyDomain ? `https://${e.companyDomain}` : null,
        },
        lead: {
          id: e.id,
          fullName: e.fullName,
          title: e.title,
          email: e.email,
          linkedinUrl: e.linkedinUrl,
        },
      };

    if (!item.meta) item.meta = {};
    if (!item.meta.leadRef) item.meta.leadRef = leadRef;
    if (!item.leadRef) item.leadRef = leadRef;

    // Obtener perfil real de la empresa desde Supabase
    const realProfile = await profileService.getCurrentProfile();
    // Mapear campos de profiles -> n8n structure
    const extended = realProfile?.signatures?.['profile_extended'] || {};
    const effectiveCompanyProfile = {
      name: realProfile?.company_name || realProfile?.full_name || 'Mi Empresa',
      sector: extended.sector || '',
      description: extended.description || '',
      services: extended.services || '',
      valueProposition: extended.valueProposition || '',
      website: realProfile?.company_domain || '',
    };

    const payload = {
      companies: [item],
      userCompanyProfile: effectiveCompanyProfile,
    };

    // Enviamos el shape ANIDADO que n8n espera + trazabilidad
    const res = await fetch('/api/research/n8n', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-App-Env': 'LeadFlowAI',
      },
      cache: 'no-store',
      body: JSON.stringify(payload),
    });

    let data: any = null;
    let text = '';
    try { data = await res.json(); } catch { text = await res.text().catch(() => ''); }

    if (!res.ok) {
      const msg = data?.error
        || (text?.startsWith('<') ? 'El backend devolvió HTML (error interno). Revisa /api/research/n8n.' : (text || 'n8n error'));
      throw new Error(msg);
    }

    // Espejo local de cuota
    Quota.incClientQuota('research');

    // Normalización de reports (cross/meta.leadRef), igual que en Oportunidades
    if (Array.isArray(data?.reports) && data.reports.length) {
      const normalized = data.reports.map((r: any) => {
        const out: any = { ...r };
        if (!out.cross) out.cross = out.report || out.data || null;
        if (!out.meta) out.meta = {};
        if (!out.meta.leadRef) out.meta.leadRef = leadRef;
        return out;
      });

      upsertLeadReports(normalized);
      setReports(getLeadReports());

      const refs = normalized.map((r: any) => r?.meta?.leadRef).filter(Boolean);
      if (refs.length) markResearched(refs); else markResearched([leadRef]);
    }

    if (Array.isArray(data?.skipped) && data.skipped.length) {
      markResearched(data.skipped);
    }
  }

  async function investigateOneByOne() {
    if (seqRunning) return;
    const selectedLeadsForResearch = Object.keys(sel).filter(id => sel[id]);
    const selected = enriched.filter(e => selectedLeadsForResearch.includes(e.id));
    if (selected.length === 0) return;

    // 🔎 Preflight: verifica que el backend tenga N8N_WEBHOOK_URL configurado
    try {
      const health = await fetch('/api/research/n8n', { method: 'GET', cache: 'no-store' }).then(r => r.json());
      if (!health?.hasUrl) {
        toast({
          variant: 'destructive',
          title: 'Backend sin N8N_WEBHOOK_URL',
          description: 'Configura el secreto N8N_WEBHOOK_URL en App Hosting y vuelve a publicar.',
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
          title: 'Conecta Outlook',
          description: 'Inicia sesión en Outlook para continuar con la investigación.',
        });
        throw new Error('missing user id');
      });

      for (const e of selected) {
        // NO bloqueamos por dominio/nombre: solo si ya existe reporte para ESTE leadRef
        if (hasReportStrict(e)) {
          setSeqDone(prev => prev + 1);
          continue;
        }

        let lastErr: any = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await runOneInvestigation(e, userId);
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
          toast({
            variant: "destructive",
            title: `Investigación falló para ${e.companyName}`,
            description: lastErr?.message || "Error desconocido. Revisa la consola o el webhook de n8n."
          });
        }
        setSeqDone(prev => prev + 1);
        await sleep(1200);
      }
    } finally {
      setSeqRunning(false);
      toast({ title: 'Investigación completa', description: `Procesados ${selected.length} leads.` });
    }
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
    if (!selectedToContact.size) return;
    const targets = enriched.filter(e => selectedToContact.has(e.id));
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
  function clearInvestigationFor(lead: EnrichedLead) {
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
    if (!lead.linkedinUrl) return;
    setLinkedinLead(lead);

    // Contextual AI Generation
    const rep = findReportForLead({ leadId: leadRefOf(lead), companyDomain: lead.companyDomain || null, companyName: lead.companyName || null });
    const draft = generateLinkedinDraft(lead, rep);

    setLinkedinMessage(draft);
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
          description: 'Instala la extensión de Chrome de Anton.IA para enviar DMs.'
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

          subject: 'LinkedIn DM',
          status: 'sent',
          provider: 'linkedin', // New provider
          linkedinThreadUrl: linkedinLead.linkedinUrl, // Best proxy for now
          linkedinMessageStatus: 'sent',
          sentAt: new Date().toISOString(),

          // Tech fields
          lastUpdateAt: new Date().toISOString()
        });

        toast({ title: 'Mensaje Enviado', description: 'La extensión procesó el envío correctamente.' });
        setOpenLinkedin(false);

        // Optional: Remove from enriched?
        // await removeEnrichedLeadById(linkedinLead.id);
      } else {
        toast({ variant: 'destructive', title: 'Error en Envío', description: res.error });
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Excepción', description: e.message });
    } finally {
      setSendingLinkedin(false);
    }
  }

  function openBulkCompose() {
    const company = getCompanyProfile() || {};
    const sender = buildSenderInfo();
    const overrides = emailDraftsStorage.getMap();

    const drafts = enriched
      .filter(l => selectedToContact.has(l.id))
      .map(l => {
        const rep = findReportForLead({ leadId: leadRefOf(l), companyDomain: l.companyDomain || null, companyName: l.companyName || null });
        let subj = '';
        let body = '';
        if (draftSource === 'style' && styleProfiles.length) {
          const prof = styleProfiles.find(p => p.name === selectedStyleName) || styleProfiles[0];
          const gen = generateMailFromStyle(
            prof,
            rep?.cross || null,
            { id: l.id, fullName: l.fullName, email: l.email!, title: l.title, companyName: l.companyName, companyDomain: l.companyDomain, linkedinUrl: l.linkedinUrl }
          );
          subj = gen.subject; body = gen.body;
        } else {
          // Investigación (comportamiento actual)
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
          subj = seed.subject || ''; body = seed.body || '';
        }

        const ctx = buildPersonEmailContext({
          lead: { name: l.fullName, email: l.email!, title: l.title, company: l.companyName },
          company: { name: l.companyName, domain: l.companyDomain },
          sender,
        });
        subj = renderTemplate(subj, ctx);
        body = renderTemplate(body, ctx);
        body = applySignaturePlaceholders(body, sender);

        // Asegurar prefijo con el nombre SOLO en el asunto
        subj = ensureSubjectPrefix(subj, ctx.lead.firstName);

        // Aplicar override guardado, si existe
        const ov = overrides[l.id];
        if (ov?.subject || ov?.body) {
          subj = ov.subject || subj;
          body = ov.body || body;
        }

        return { lead: l, subject: subj, body };
      });

    setComposeList(drafts);
    if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
    setBulkProvider('outlook');
    setOpenCompose(true);
  }

  async function sendBulk() {
    const items = composeList;
    if (!items?.length) return;

    setSendingBulk(true);
    setSendProgress({ done: 0, total: items.length });
    const removedIds = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const { lead, subject, body } = items[i];
      try {
        let res: any = null;
        const trackingId = uuid(); // Pre-generate ID for tracking
        let finalHtmlBody = body.replace(/\n/g, '<br/>');

        // 2. Rewrite Links if enabled
        if (useLinkTracking) {
          finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
        }

        // 3. Inject Pixel if enabled
        if (usePixel) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          let pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
          const profile = getCompanyProfile();
          if (profile?.logo && profile.logo.startsWith('http')) {
            pixelUrl += `&redirect=${encodeURIComponent(profile.logo)}`;
          }
          // FIX: Removed display:none to prevent blocking by email clients
          const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
          finalHtmlBody += `\n<br>${trackingPixel}`;
        }

        if (bulkProvider === 'outlook') {
          res = await sendEmail({
            to: lead.email!,
            subject,
            htmlBody: finalHtmlBody,
            requestReceipts: useReadReceipt,
          });
        } else {
          // Gmail
          res = await sendGmailEmail({
            to: lead.email!,
            subject,
            html: finalHtmlBody,
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
        console.error(`send mail error (${bulkProvider})`, lead.email, e?.message);
      }
      setSendProgress(p => ({ ...p, done: p.done + 1 }));
      await new Promise(res => setTimeout(res, 500));
    }

    setSendingBulk(false);
    setOpenCompose(false);
    // Actualiza UI y selecciones
    if (removedIds.size) {
      setEnriched(prev => prev.filter(x => !removedIds.has(x.id)));
      setSelectedToContact(new Set(Array.from(selectedToContact).filter(id => !removedIds.has(id))));
    }
    toast({
      title: 'Listo',
      description: `Enviados por ${bulkProvider}: ${items.length}. Quitados de Enriquecidos: ${removedIds.size}`,
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
      toast({ title: 'Sin borrador de IA', description: 'Investiga con n8n y asegúrate de que el flujo genere un borrador de correo.' });
      if (report) openReportFor(e);
      return;
    }
    const company = getCompanyProfile() || {};
    const sender = buildSenderInfo();
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
      toast({ title: 'Sin reporte', description: 'Investiga con n8n antes de ver el reporte cruzado.' });
      return;
    }
    setReportToView(rep);
    setReportLead(e);
    setOpenReport(true);
  }

  async function handleDeleteEnriched(id: string) {
    const ok = confirm('¿Eliminar este lead de Enriquecidos?');
    if (!ok) return;
    const next = await removeEnrichedLeadById(id);
    setEnriched(next);
    // limpia selecciones
    setSel(prev => { const p = { ...prev }; delete p[id]; return p; });
    const s = new Set(selectedToContact); s.delete(id); setSelectedToContact(s);
    toast({ title: 'Eliminado', description: 'Se quitó el lead de Enriquecidos.' });
  }

  // Contadores para toda la selección (no solo la página actual)
  const researchCount = Object.values(sel).filter(Boolean).length;
  const contactCount = selectedToContact.size;

  // ---------- Export helpers ----------
  const exportHeaders = ['Nombre', 'Cargo', 'Empresa', 'Email', 'LinkedIn', 'Dominio'];
  const toRow = (e: EnrichedLead): (string | number)[] => ([
    e.fullName || '',
    e.title || '',
    e.companyName || '',
    e.email || (e.emailStatus === 'locked' ? '(locked)' : ''),
    e.linkedinUrl || '',
    e.companyDomain || '',
  ]);
  const buildRows = (list: EnrichedLead[]) => list.map(toRow);
  const handleExportCsv = () => {
    if (!enriched.length) return;
    exportToCsv(exportHeaders, buildRows(enriched), 'enriched-leads.csv');
  };
  const handleExportXlsx = async () => {
    if (!enriched.length) return;
    await exportToXlsx(exportHeaders, buildRows(enriched), 'enriched-leads.xlsx');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads enriquecidos"
        description="Selecciona, investiga con n8n y luego contacta."
      />
      <BackBar fallbackHref="/saved/leads" className="mb-2" />

      <div className="mb-4">
        <DailyQuotaProgress kinds={['research']} compact />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Lista de leads enriquecidos ({filtered.length} / {enriched.length})</CardTitle>
            <CardDescription>
              {researchEligible === 0
                ? 'No hay leads con email para investigar.'
                : 'Solo se investigan los que tienen email revelado.'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters(v => !v)}
              title="Mostrar/Ocultar filtros"
            >
              Filtrar
            </Button>
            <Button
              variant="secondary"
              onClick={clearInvestigationsSelected}
              disabled={selectedToContact.size === 0}
              title={selectedToContact.size === 0 ? 'Selecciona leads para contactar' : 'Borrar investigaciones de los seleccionados para contactar'}
            >
              <Eraser className="mr-2 h-4 w-4" />
              Borrar investigaciones de seleccionados
            </Button>
            <Button
              variant="destructive"
              onClick={clearInvestigations}
              disabled={!anyInvestigated}
              title={anyInvestigated ? 'Borrar todos los reportes y marcas de investigación' : 'No hay investigaciones que borrar'}
            >
              <Eraser className="mr-2 h-4 w-4" />
              Borrar investigaciones
            </Button>
            <Button onClick={openBulkCompose} disabled={selectedToContact.size === 0}>
              Contactar seleccionados ({selectedToContact.size})
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpenSchedule(true)}
              disabled={selectedToContact.size === 0}
            >
              Agendar Campaña
            </Button>
            <Button
              onClick={() => investigateOneByOne()}
              disabled={seqRunning || researchCount === 0}
            >
              {seqRunning ? 'Investigando...' : `Investigar (n8n) (${researchCount})`}
            </Button>
            {/* NUEVO: exportaciones */}
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={enriched.length === 0}
              title={enriched.length === 0 ? 'No hay datos para exportar' : 'Exportar CSV'}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              onClick={handleExportXlsx}
              disabled={enriched.length === 0}
              title={enriched.length === 0 ? 'No hay datos para exportar' : 'Exportar XLSX'}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              XLSX
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Panel de filtros (colapsable) */}
          {showFilters && (
            <div className="mb-4 border rounded-md p-3 bg-muted/30">
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
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFIncCompany(''); setFIncLead(''); setFIncTitle('');
                    setFExcCompany(''); setFExcLead(''); setFExcTitle('');
                    setApplied({ incCompany: '', incLead: '', incTitle: '', excCompany: '', excLead: '', excTitle: '' });
                  }}
                >
                  Limpiar
                </Button>

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
                  Filtrar
                </Button>

                <Button variant="outline" onClick={() => setShowFilters(false)}>Ocultar</Button>
              </div>
            </div>
          )}

          {seqRunning && (
            <div className="mb-4 border rounded p-3 text-sm text-muted-foreground">
              Progreso: {seqDone}/{seqTotal}
            </div>
          )}
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center" title="Marcar para INVESTIGAR con n8n">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Inv.</span>
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
                      <span className="text-[10px] uppercase text-muted-foreground">Cont.</span>
                      <Checkbox
                        checked={contactEligiblePage > 0 ? allContactChecked : false}
                        disabled={contactEligiblePage === 0}
                        onCheckedChange={(v) => toggleAllContact(Boolean(v))}
                        aria-label="Seleccionar todos para contactar"
                      />
                    </div>
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead className="w-64 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-center">
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
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        disabled={!canContact(e)}
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selectedToContact);
                          if (v) next.add(e.id);
                          else next.delete(e.id);
                          setSelectedToContact(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>{e.fullName}</TableCell>
                    <TableCell>{e.title || '—'}</TableCell>
                    <TableCell>{e.companyName || '—'}</TableCell>
                    <TableCell>{e.email || (e.emailStatus === 'locked' ? '(locked)' : '—')}</TableCell>
                    <TableCell>{e.linkedinUrl ? <a className="underline" target="_blank" href={e.linkedinUrl}>Perfil</a> : '—'}</TableCell>
                    <TableCell>{e.companyDomain || '—'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => openReportFor(e)}>Ver reporte</Button>
                      <Button size="sm" onClick={() => generateEmailFromReportFor(e)} disabled={!canContact(e)}>Contactar</Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openLinkedinCompose(e)}
                        disabled={!e.linkedinUrl}
                        title="Contactar por LinkedIn"
                      >
                        <Linkedin className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDeleteEnriched(e.id)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Paginador inferior (igual al superior) */}
          <div className="flex items-center justify-between mt-3 text-sm">
            <div className="text-muted-foreground">
              Mostrando {total === 0 ? 0 : startIdx + 1}–{endIdx} de {total}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => { setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>«</Button>
              <Button variant="outline" size="sm" onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === 1}>‹</Button>
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
              <Button variant="outline" size="sm" onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>›</Button>
              <Button variant="outline" size="sm" onClick={() => { setPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={page === totalPages}>»</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="max-w-4xl" onEscapeKeyDown={() => setOpenReport(false)}>
          <DialogHeader>
            <DialogTitle>Reporte · {reportToView?.cross?.company.name}</DialogTitle>
          </DialogHeader>
          {reportToView?.cross && reportLead && (
            <div className="w-full flex justify-end mb-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => clearInvestigationFor(reportLead)}
                title="Eliminar investigación de este lead"
              >
                <Eraser className="h-4 w-4 mr-1" /> Eliminar investigación de este lead
              </Button>
            </div>
          )}
          {reportToView?.cross && (
            <div className="space-y-4 text-sm leading-relaxed max-h-[70vh] overflow-y-auto pr-4">
              <div className="text-lg font-semibold">{reportToView.cross.company.name}</div>
              {reportToView.cross.overview && <p>{reportToView.cross.overview}</p>}

              {reportToView.cross.pains?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Pains</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.pains.map((x, i) => <li key={i}>{x}</li>)}
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
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="max-w-4xl" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader><DialogTitle>Contactar {composeList.length} leads</DialogTitle></DialogHeader>
          {/* Fuente del borrador + Perfil de estilo + Proveedor */}
          <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="col-span-1">
              <div className="text-xs text-muted-foreground mb-1">Fuente del borrador</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="draft-source" value="investigation" checked={draftSource === 'investigation'} onChange={() => setDraftSource('investigation')} />
                  Investigación (n8n)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="draft-source" value="style" checked={draftSource === 'style'} onChange={() => {
                    setDraftSource('style');
                    if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
                  }} />
                  Estilo (Email Studio)
                </label>
              </div>
            </div>
            <div className="col-span-1">
              <div className="text-xs text-muted-foreground mb-1">Perfil de estilo</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                disabled={draftSource !== 'style' || styleProfiles.length === 0}
                value={selectedStyleName}
                onChange={(e) => setSelectedStyleName(e.target.value)}
              >
                {styleProfiles.length === 0 ? <option value="">(No hay estilos guardados)</option> :
                  styleProfiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)
                }
              </select>
            </div>
            <div className="col-span-1">
              <div className="text-xs text-muted-foreground mb-1">Proveedor de envío</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="bulk-provider" value="outlook" checked={bulkProvider === 'outlook'} onChange={() => setBulkProvider('outlook')} />
                  Outlook
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="bulk-provider" value="gmail" checked={bulkProvider === 'gmail'} onChange={() => setBulkProvider('gmail')} />
                  Gmail
                </label>
              </div>
            </div>
          </div>
          {/* Barra superior del modal: ayuda y botón de edición IA */}
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">
              Revisa y ajusta los borradores antes de enviar. Proveedor: <strong>{bulkProvider}</strong>
            </div>
            <Button variant="secondary" onClick={() => setShowBulkEditor(v => !v)} disabled={composeList.length === 0}>
              {showBulkEditor ? 'Ocultar editor IA' : 'Editar con IA (todos)'}
            </Button>
          </div>

          {/* Editor IA masivo inline */}
          {showBulkEditor && (
            <div className="mb-3 border rounded-md p-3 bg-muted/40">
              <div className="text-sm text-muted-foreground mb-1">
                Describe cómo quieres modificar los correos (se aplicará a todos). Ejemplos:
                <ul className="list-disc pl-5 mt-1">
                  <li>Agrega una línea: "Hemos trabajado con empresas relacionadas al outsourcing".</li>
                  <li>Añade al asunto "Piloto gratis".</li>
                  <li>
                    Menciona colaboración con <code>{'{{company.name}}'}</code> si aplica.
                  </li>
                </ul>
              </div>
              <Textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={5}
                placeholder='Ej: Agrega una línea: "Hemos trabajado con empresas relacionadas al outsourcing".'
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


          {/* Tracking Options (NEW) */}
          <div className="mb-4 border border-border/50 rounded-md p-3 bg-muted/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Inyecta una imagen invisible para detectar apertura en tiempo real">
                  <input
                    type="checkbox"
                    checked={usePixel}
                    onChange={(e) => setUsePixel(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Activar Tracking Pixel
                  <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded ml-1">Recomendado</span>
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Inserta un píxel invisible para detectar aperturas.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Reescribe enlaces para saber si el usuario hizo clic">
                  <input
                    type="checkbox"
                    checked={useLinkTracking}
                    onChange={(e) => setUseLinkTracking(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Track Link Clicks
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Hace rastreables los links de tus correos.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Solicita confirmación de lectura estándar">
                  <input
                    type="checkbox"
                    checked={useReadReceipt}
                    onChange={(e) => setUseReadReceipt(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Solicitar Confirmación
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Pide confirmación explícita al destinatario.
                </p>
              </div>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-4 p-1">
            {composeList.map(({ lead, subject, body }, i) => (
              <div key={lead.id} className="border rounded-lg p-3">
                <div className="font-semibold text-sm">{lead.fullName} &lt;{lead.email}&gt;</div>
                <div className="text-xs text-muted-foreground">{lead.title} @ {lead.companyName}</div>

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
                  rows={10}
                  aria-label={`Cuerpo para ${lead.fullName}`}
                  className="font-mono"
                />

                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Regenerar orientado a persona con datos actuales
                      const company = getCompanyProfile() || {};
                      const sender = buildSenderInfo();
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
          <div className="mt-4 flex items-center justify-between">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contactar por LinkedIn</DialogTitle>
            <CardDescription>
              Se abrirá una pestaña de LinkedIn y la extensión escribirá por ti.
            </CardDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm">
              <strong>Para:</strong> {linkedinLead?.fullName}
            </div>
            <Textarea
              value={linkedinMessage}
              onChange={(e) => setLinkedinMessage(e.target.value)}
              rows={6}
              placeholder="Escribe tu mensaje aquí..."
            />
            <div className="text-xs text-muted-foreground">
              * Antón.IA simulará escritura humana. No cierres la nueva pestaña inmediatamente.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpenLinkedin(false)}>Cancelar</Button>
              <Button onClick={handleSendLinkedin} disabled={sendingLinkedin}>
                {sendingLinkedin ? 'Enviando...' : 'Enviar con Extensión'}
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
                  <SelectItem value="linkedin">LinkedIn DM</SelectItem>
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

    </div>
  );
}

