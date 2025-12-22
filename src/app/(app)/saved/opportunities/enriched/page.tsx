
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedOppLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { upsertLeadReports, getLeadReports, findReportForLead, findReportByRef, removeReportFor } from '@/lib/lead-research-storage';
import { BackBar } from '@/components/back-bar';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { Dialog, DialogContent, DialogEraser, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { renderTemplate, buildPersonEmailContext } from '@/lib/template';
import { ensureSubjectPrefix, generateCompanyOutreachV2 } from '@/lib/outreach-templates';
import { getCompanyProfile } from '@/lib/data';
import { emailDraftsStorage } from '@/lib/email-drafts-storage';
import { supabase } from '@/lib/supabase';
import { sendEmail } from '@/lib/outlook-email-service';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { v4 as uuidv4 } from 'uuid';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import * as Quota from '@/lib/quota-client';
import { isResearched, markResearched, removeResearched } from '@/lib/researched-leads-storage';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { extractJsonFromMaybeFenced } from '@/lib/extract-json';
import { Linkedin, Eraser, Filter, Trash2, Download, FileSpreadsheet, RotateCw, Undo2, Save, Phone } from 'lucide-react';
import { extensionService } from '@/lib/services/extension-service';
import { generateLinkedinDraft } from '@/lib/ai/linkedin-templates';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import { profileService } from '@/lib/services/profile-service';

function getClientUserId(): string {
  // ID estable por navegador para trazabilidad en n8n; no PII
  try {
    const KEY = 'lf.clientUserId';
    let v = localStorage.getItem(KEY);
    if (!v) { v = uuidv4(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return 'anon'; }
}

async function getUserIdOrFail(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    throw new Error('no_identity');
  }
  return user.id;
}

export default function EnrichedOpportunitiesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [enriched, setEnriched] = useState<EnrichedOppLead[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState({ done: 0, total: 0 });
  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);
  const [openReport, setOpenReport] = useState(false);
  const [reportLead, setReportLead] = useState<EnrichedOppLead | null>(null);

  // Phone Call Modal
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedOppLead | null>(null);

  // Enrichment Options
  const [openEnrichOptions, setOpenEnrichOptions] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<EnrichedOppLead[]>([]);

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

  // Load Data Effect
  const loadData = async () => {
    const data = await enrichedOpportunitiesStorage.get();
    setEnriched(data);
    setReports(getLeadReports());
    // setStyleProfiles(styleProfilesStorage.list()); // Not used implicitly here yet
  };

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

  const handleRetryPhone = async (lead: EnrichedOppLead) => {
    if (enriching) return;
    const clientId = getClientUserId();
    if (!clientId) {
      toast({ variant: 'destructive', title: 'Error', description: 'No ID cliente' });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const finalUserId = user?.id || clientId;

    setEnriching(true);
    toast({ title: 'Reintentando...', description: 'Enviando solicitud para ' + lead.fullName });

    try {
      const payload = {
        leads: [{
          fullName: lead.fullName,
          title: lead.title,
          companyName: lead.companyName,
          companyDomain: lead.companyDomain,
          sourceOpportunityId: lead.sourceOpportunityId,
          linkedinUrl: lead.linkedinUrl,
          email: extractPrimaryEmail(lead).email,
          existingRecordId: lead.id // <--- IMPORTANT: Prevent duplicates
        }],
        revealEmail: false,
        revealPhone: true
      };

      const res = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': finalUserId },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data?.debug?.serverLogs && Array.isArray(data.debug.serverLogs)) {
        console.groupCollapsed('[Server Logs] Apollo Enrichment (Retry)');
        data.debug.serverLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
      }

      // No need to handle response data heavily, the webhook will update the row.
      toast({ title: 'Solicitud enviada', description: 'Espera unos segundos.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al reintentar', description: e.message });
    } finally {
      setEnriching(false);
    }
  };

  useEffect(() => {
    loadData();

    // Realtime Subscription
    const channel = supabase
      .channel('enriched-opportunities-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enriched_opportunities' },
        (payload) => {
          loadData(); // Reload on any change

          if (payload.eventType === 'UPDATE') {
            const newData = payload.new as any;
            const oldData = payload.old as any;
            if (newData.enrichment_status === 'completed' && oldData.enrichment_status === 'pending_phone') {
              toast({
                title: '¡Teléfono encontrado!',
                description: `Se completó el enriquecimiento para ${newData.full_name || 'un contacto'}.`,
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function initiateEnrichment(leads: EnrichedOppLead[]) {
    // Adapter if needed, type matches mostly
    setLeadsToEnrich(leads);
    setOpenEnrichOptions(true);
  }

  async function handleConfirmEnrich(opts: { revealEmail: boolean; revealPhone: boolean }) {
    if (!leadsToEnrich.length) return;
    setEnriching(true);
    try {
      const payloadLeads = leadsToEnrich.map(l => ({
        fullName: l.fullName,
        linkedinUrl: l.linkedinUrl,
        companyName: l.companyName,
        companyDomain: l.companyDomain,
        title: l.title,
        sourceOpportunityId: l.sourceOpportunityId,
        clientRef: l.id
      }));

      const { data: { user } } = await import('@/lib/supabase').then(m => m.supabase.auth.getUser());
      const userId = user?.id || 'anon';

      const res = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          leads: payloadLeads,
          revealEmail: opts.revealEmail,
          revealPhone: opts.revealPhone,
          tableName: 'enriched_opportunities' // Explicitly target opportunities
        }),
      });

      const data = await res.json();
      if (data?.debug?.serverLogs) {
        // console logs...
      }

      toast({ title: 'Enriquecimiento iniciado', description: 'Los resultados aparecerán en breve.' });
      // Reload logic handled by realtime usually, but we can optimistically reload
      setTimeout(loadData, 2000);

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setEnriching(false);
      setLeadsToEnrich([]);
    }
  }

  // --- Utility ---
  function leadRefOf(e: EnrichedOppLead) {
    return e.id || e.email || e.linkedinUrl || `${e.fullName}|${e.companyName || ''}`;
  }
  function hasReport(e: EnrichedOppLead) {
    return !!findReportForLead({
      leadId: leadRefOf(e),
      companyDomain: e.companyDomain || null,
      companyName: e.companyName || null,
    })?.cross;
  }
  function hasReportStrict(e: EnrichedOppLead) {
    return !!findReportByRef(leadRefOf(e))?.cross;
  }

  // --- Bulk Selection ---
  const toggleAllResearch = (checked: boolean) => {
    if (!checked) {
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
        // Only select if not researched and has email
        if (e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e)) next[e.id] = true;
      });
      return next;
    });
  };

  const allResearchChecked = useMemo(() => {
    const eligible = pageLeads.filter(e => e.email && !isResearched(leadRefOf(e)) && !hasReportStrict(e));
    return eligible.length > 0 && eligible.every(e => sel[e.id]);
  }, [pageLeads, sel, reports]);

  const anyInvestigated = useMemo(
    () => enriched.some(e => isResearched(leadRefOf(e)) || hasReport(e)),
    [enriched, reports]
  );


  // --- Investigation Logic (N8N) ---
  async function runOneInvestigation(e: EnrichedOppLead, userId: string) {
    const leadRef = leadRefOf(e);
    // Adapter to EnrichedLead-like structure for n8n payload builder
    // EnrichedOppLead is fully compatible with core fields
    const base = buildN8nPayloadFromLead(e as any) as any;

    const item = base?.companies?.[0] ? { ...base.companies[0] } : {
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
      const msg = data?.error || (text?.startsWith('<') ? 'Error interno API' : (text || 'n8n error'));
      throw new Error(msg);
    }

    Quota.incClientQuota('research');

    // Process potential phone updates from n8n response if needed (similar to EnrichedLeads)
    // For now, we assume just research report
    return { leadRef, report: data.report || data };
  }


  async function handleRunN8nResearch() {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (ids.length === 0) return;

    if (!Quota.canUseClientQuota('research', ids.length)) {
      toast({ variant: 'destructive', title: 'Cupo insuficiente', description: 'No tienes cupo de investigación.' });
      return;
    }

    setResearching(true);
    setResearchProgress({ done: 0, total: ids.length });
    let doneCount = 0;
    let fails = 0;

    try {
      const userId = await getUserIdOrFail();
      // Get full objects
      const targets = enriched.filter(e => ids.includes(e.id));

      for (const t of targets) {
        try {
          const res = await runOneInvestigation(t, userId);
          // Save report
          upsertLeadReports([{
            leadRef: res.leadRef,
            companyDomain: t.companyDomain,
            companyName: t.companyName || 'Unknown',
            cross: res.report
          }]);
          // Mark locally as researched to block re-investigation
          markResearched(res.leadRef);

        } catch (err) {
          console.error(err);
          fails++;
        }
        doneCount++;
        setResearchProgress({ done: doneCount, total: ids.length });
      }

      toast({ title: 'Investigación finalizada', description: `${doneCount - fails} exitosos, ${fails} fallidos.` });
      setSel({}); // clear selection
      setReports(getLeadReports()); // reload reports
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setResearching(false);
    }
  }


  // --- Export ---
  function handleExportCsv() {
    if (enriched.length === 0) return;
    exportToCsv(enriched, 'oportunidades_enriquecidas');
  }
  function handleExportXlsx() {
    if (enriched.length === 0) return;
    exportToXlsx(enriched, 'oportunidades_enriquecidas');
  }

  // --- Deletion ---
  async function handleDeleteSelected() {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (ids.length === 0 && !confirm('¿Borrar seleccionados?')) return;

    try {
      await enrichedOpportunitiesStorage.remove(ids);
      setSel({});
      loadData();
      toast({ title: 'Eliminados', description: `${ids.length} leads borrados.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  }

  // Clear investigation logic (Eraser)
  function clearInvestigationFor(lead: EnrichedOppLead) {
    if (!confirm('¿Borrar SOLO la investigación de este lead?')) return;
    const ref = leadRefOf(lead);
    removeLeadReport(ref); // Custom helper below or inline
    removeResearched(ref);
    setReports(getLeadReports());
    toast({ title: 'Investigación borrada' });
  }

  function removeLeadReport(ref: string) {
    // removeReportFor is imported
    removeReportFor(ref);
  }

  // --- Render Helpers ---

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oportunidades Enriquecidas"
        description="Gestiona, investiga y contacta a los leads provenientes de oportunidades."
      >
        <div className="flex gap-2">
          <DailyQuotaProgress />
          <BackBar />
        </div>
      </PageHeader>

      <EnrichmentOptionsDialog
        open={openEnrichOptions}
        onOpenChange={setOpenEnrichOptions}
        onConfirm={handleConfirmEnrich}
        loading={enriching}
      />

      {/* FILTROS Y ACCIONES SUPERIORES */}
      <div className="flex flex-col gap-4">
        {/* Barra de Filtros Colapsable */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-2" />
            filtros
          </Button>
          {/* Contadores */}
          <span className="text-sm text-muted-foreground ml-2">
            Total: {enriched.length} | Filtrados: {filtered.length} | Selec: {Object.keys(sel).length}
          </span>
          <div className="flex-1" />
          {/* Bulk Actions */}
          {Object.keys(sel).length > 0 && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
              <Button variant="secondary" size="sm" onClick={handleDeleteSelected}>
                <Trash2 className="w-4 h-4 mr-2" /> Borrar
              </Button>
              <Button variant="default" size="sm" onClick={handleRunN8nResearch} disabled={researching}>
                {researching ? <RotateCw className="w-4 h-4 animate-spin mr-2" /> : <RotateCw className="w-4 h-4 mr-2" />}
                Investigar ({Object.keys(sel).length})
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={handleExportCsv} title="Exportar CSV">
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportXlsx} title="Exportar Excel">
            <FileSpreadsheet className="w-4 h-4" />
          </Button>
        </div>

        {showFilters && (
          <Card className="bg-muted/30">
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Incluir Empresa</Label>
                <Input placeholder="Ej: Microsoft, Apple" value={fIncCompany} onChange={e => { setFIncCompany(e.target.value); setApplied(prev => ({ ...prev, incCompany: e.target.value })) }} />
              </div>
              <div className="space-y-2">
                <Label>Excluir Empresa</Label>
                <Input placeholder="Ej: LLC, Inc" value={fExcCompany} onChange={e => { setFExcCompany(e.target.value); setApplied(prev => ({ ...prev, excCompany: e.target.value })) }} />
              </div>

              <div className="space-y-2">
                <Label>Incluir Cargo</Label>
                <Input placeholder="Ej: Manager, CEO" value={fIncTitle} onChange={e => { setFIncTitle(e.target.value); setApplied(prev => ({ ...prev, incTitle: e.target.value })) }} />
              </div>
              <div className="space-y-2">
                <Label>Excluir Cargo</Label>
                <Input placeholder="Ej: Intern, Student" value={fExcTitle} onChange={e => { setFExcTitle(e.target.value); setApplied(prev => ({ ...prev, excTitle: e.target.value })) }} />
              </div>

              <div className="space-y-2">
                <Label>Incluir Nombre</Label>
                <Input placeholder="Ej: John, Doe" value={fIncLead} onChange={e => { setFIncLead(e.target.value); setApplied(prev => ({ ...prev, incLead: e.target.value })) }} />
              </div>
              <div className="space-y-2">
                <Label>Excluir Nombre</Label>
                <Input placeholder="" value={fExcLead} onChange={e => { setFExcLead(e.target.value); setApplied(prev => ({ ...prev, excLead: e.target.value })) }} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>


      {/* TABLA PRINCIPAL */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox checked={allResearchChecked} onCheckedChange={toggleAllResearch} />
                </TableHead>
                <TableHead className="w-[60px]"></TableHead>
                <TableHead>Nombre / Cargo</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    No hay leads enriquecidos.
                  </TableCell>
                </TableRow>
              ) : (
                pageLeads.map((lead) => {
                  const emailData = extractPrimaryEmail(lead);
                  const hasEmail = !!emailData.email;
                  const researched = isResearched(leadRefOf(lead)) || hasReportStrict(lead);
                  const report = findReportByRef(leadRefOf(lead))?.cross;
                  const pendingPhone = lead.enrichmentStatus === 'pending_phone';

                  return (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Checkbox
                          checked={!!sel[lead.id]}
                          onCheckedChange={(c) => {
                            setSel(prev => {
                              const next = { ...prev };
                              if (c) next[lead.id] = true; else delete next[lead.id];
                              return next;
                            });
                          }}
                          disabled={!hasEmail || researched} // Disable if no email or already researched (logic from Leads)
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center">
                          <Linkedin
                            className={`w-4 h-4 cursor-pointer ${lead.linkedinUrl ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300'}`}
                            onClick={() => lead.linkedinUrl && window.open(lead.linkedinUrl, '_blank')}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{lead.fullName}</span>
                          <span className="text-xs text-muted-foreground line-clamp-1" title={lead.title}>{lead.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{lead.companyName || '—'}</span>
                          <a href={`https://${lead.companyDomain}`} target="_blank" className="text-xs text-blue-500 hover:underline">{lead.companyDomain}</a>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm space-y-1">
                          {/* Email */}
                          <div className="flex items-center gap-1">
                            {hasEmail ? (
                              <span className={emailData.status === 'verified' ? 'text-green-600' : 'text-yellow-600'}>
                                {emailData.email}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">Not Found</span>
                            )}
                          </div>
                          {/* Phone */}
                          <div className="flex items-center gap-1">
                            {lead.primaryPhone ? (
                              <div className="flex items-center gap-1 text-blue-600 font-mono tracking-tight cursor-pointer" onClick={() => {
                                setLeadToCall(lead); setCallModalOpen(true);
                              }}>
                                <Phone className="w-3 h-3" />
                                {lead.primaryPhone}
                              </div>
                            ) : pendingPhone ? (
                              <div className="flex items-center gap-1 text-orange-500 animate-pulse text-xs">
                                <RotateCw className="w-3 h-3 animate-spin" /> Buscando...
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground text-xs italic">Not Found</span>
                                {/* Retry Button */}
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleRetryPhone(lead)} title="Reintentar búsqueda telefónica">
                                  <RotateCw className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {report ? (
                          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full border border-green-200 cursor-pointer hover:bg-green-200"
                            onClick={() => { setReportLead(lead); setReportToView({ leadRef: leadRefOf(lead), cross: report } as any); setOpenReport(true); }}
                          >
                            Investigado
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pendiente</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {/* Single Investigation Button if not researched */}
                          {!researched && hasEmail && (
                            <Button variant="ghost" size="icon" onClick={() => {
                              // Quick single investigation select
                              setSel({ [lead.id]: true });
                              // Could trigger immediately or just highlight, logic says use bulk button but let's mimic Leads if needed
                              // Actually logic in Leads is mostly bulk. Let's stick to bulk flow to avoid complexity.
                              // Or simple button:
                            }} title="Seleccionar para investigar">
                              <Filter className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                          {researched && (
                            <Button variant="ghost" size="icon" onClick={() => clearInvestigationFor(lead)} title="Borrar Investigación">
                              <Eraser className="w-4 h-4 text-orange-500" />
                            </Button>
                          )}
                          {/* Action: View Detail (if needed) - usually just report */}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MODALES */}
      {/* Report Modal */}
      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reporte de {reportLead?.fullName}</DialogTitle>
          </DialogHeader>
          {/* Simple JSON dump or nicer format for now */}
          <div className="whitespace-pre-wrap font-mono text-xs bg-slate-50 p-4 rounded border">
            {JSON.stringify(reportToView?.cross, null, 2)}
          </div>
        </DialogContent>
      </Dialog>

      {/* Phone Call Modal */}
      {leadToCall && (
        <PhoneCallModal
          open={callModalOpen}
          onOpenChange={setCallModalOpen}
          customerPhone={leadToCall.primaryPhone || ''}
          customerName={leadToCall.fullName}
          leadIdentifier={leadToCall.id}
        />
      )}

    </div>
  );
}
