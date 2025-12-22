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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { isResearched, markResearched, removeResearched } from '@/lib/researched-leads-storage';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { Linkedin, Eraser, Filter, Trash2, Download, FileSpreadsheet, RotateCw, Phone } from 'lucide-react';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import { profileService } from '@/lib/services/profile-service';
import * as Quota from '@/lib/quota-client';

function getClientUserId(): string {
  try {
    const KEY = 'lf.clientUserId';
    let v = localStorage.getItem(KEY);
    if (!v) { v = uuidv4(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return 'anon'; }
}

async function getUserIdOrFail(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('no_identity');
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
  const [reportLead, setReportLead] = useState<EnrichedOppLead | null>(null);
  const [openReport, setOpenReport] = useState(false);

  // Phone Call Modal
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<EnrichedOppLead | null>(null);

  // Enrichment Options
  const [openEnrichOptions, setOpenEnrichOptions] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<EnrichedOppLead[]>([]);

  // Filtros
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

  // Paginación
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);

  // Load Data
  const loadData = async () => {
    const data = await enrichedOpportunitiesStorage.get();
    setEnriched(data);
    setReports(getLeadReports());
  };

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel('enriched-opportunities-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enriched_opportunities' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Normalización
  const norm = (s?: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const splitTerms = (value: string) => value.split(',').map(t => norm(t).trim()).filter(Boolean);

  // Lógica Filtrado
  const filtered = useMemo(() => {
    const incCompanies = splitTerms(applied.incCompany);
    const incLeads = splitTerms(applied.incLead);
    const incTitles = splitTerms(applied.incTitle);
    const excCompanies = splitTerms(applied.excCompany);
    const excLeads = splitTerms(applied.excLead);
    const excTitles = splitTerms(applied.excTitle);

    const containsAny = (value: string | null | undefined, terms: string[]) => {
      if (!terms.length) return true;
      const v = norm(value);
      return terms.some(t => v.includes(t));
    };
    const excludesAll = (value: string | null | undefined, terms: string[]) => {
      if (!terms.length) return true;
      const v = norm(value);
      return terms.every(t => !v.includes(t));
    };

    return enriched.filter(e =>
      containsAny(e.companyName, incCompanies) && containsAny(e.fullName, incLeads) && containsAny(e.title, incTitles) &&
      excludesAll(e.companyName, excCompanies) && excludesAll(e.fullName, excLeads) && excludesAll(e.title, excTitles)
    );
  }, [enriched, applied]);

  // Paginación Efectiva
  useEffect(() => { setPage(1); }, [pageSize, applied]);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageLeads = useMemo(() => filtered.slice(startIdx, endIdx), [filtered, startIdx, endIdx]);

  // Helpers Referencias
  const leadRefOf = (e: EnrichedOppLead) => e.id || e.email || e.linkedinUrl || `${e.fullName}|${e.companyName || ''}`;
  const hasReportStrict = (e: EnrichedOppLead) => !!findReportByRef(leadRefOf(e))?.cross;
  const isResearchedLead = (e: EnrichedOppLead) => isResearched(leadRefOf(e)) || hasReportStrict(e);

  // Bulk Checks
  const researchEligiblePage = pageLeads.filter(e => e.email && !isResearchedLead(e)).length;
  const allResearchChecked = researchEligiblePage > 0 && pageLeads.filter(e => e.email && !isResearchedLead(e)).every(e => sel[e.id]);
  const anyInvestigated = enriched.some(isResearchedLead);

  const toggleAllResearch = (checked: boolean) => {
    setSel(prev => {
      const next = { ...prev };
      if (!checked) {
        pageLeads.forEach(e => delete next[e.id]);
      } else {
        pageLeads.forEach(e => {
          if (e.email && !isResearchedLead(e)) next[e.id] = true;
        });
      }
      return next;
    });
  };

  // Acciones
  const handleExportCsv = () => exportToCsv(enriched, 'oportunidades_enriquecidas');
  const handleExportXlsx = () => exportToXlsx(enriched, 'oportunidades_enriquecidas');

  const handleDeleteSelected = async () => {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (!ids.length || !confirm(`¿Borrar ${ids.length} leads?`)) return;
    await enrichedOpportunitiesStorage.remove(ids);
    setSel({});
    loadData();
    toast({ title: 'Leads borrados' });
  };

  const clearInvestigations = () => {
    if (!confirm('¿Borrar TODAS las investigaciones y marcas de memoria?')) return;
    // Esto requeriría iterar todos. En Leads hay una función específica.
    // Por simplicidad borramos reportes locales.
    // TODO: Implementar borrado masivo real si se requiere.
    enriched.forEach(e => {
      const ref = leadRefOf(e);
      removeReportFor(ref);
      removeResearched(ref);
    });
    setReports(getLeadReports());
    toast({ title: 'Investigaciones borradas' });
  };

  const clearInvestigationsSelected = () => {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (!ids.length) return;
    const targets = enriched.filter(e => ids.includes(e.id));
    targets.forEach(e => {
      const ref = leadRefOf(e);
      removeReportFor(ref);
      removeResearched(ref);
    });
    setReports(getLeadReports());
    toast({ title: 'Investigaciones borradas de seleccionados' });
    setSel({});
  };

  // N8N Research
  const runOneInvestigation = async (e: EnrichedOppLead, userId: string) => {
    const base = buildN8nPayloadFromLead(e as any) as any;
    const leadRef = leadRefOf(e);
    const effectiveCompanyProfile = { name: 'Mi Empresa', website: '' }; // Mock basic profile if needed or fetch
    // Real implementation mimics Client.tsx
    const payload = {
      companies: [{ ...base.companies?.[0], leadRef, meta: { leadRef } }],
      userCompanyProfile: effectiveCompanyProfile,
    };
    const res = await fetch('/api/research/n8n', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Env': 'LeadFlowAI' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    return { leadRef, report: data.report || data };
  };

  const handleRunN8nResearch = async () => {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (!ids.length) return;
    if (!Quota.canUseClientQuota('research', ids.length)) {
      toast({ variant: 'destructive', title: 'Cupo insuficiente' });
      return;
    }
    setResearching(true);
    setResearchProgress({ done: 0, total: ids.length });
    try {
      const userId = await getUserIdOrFail();
      let done = 0;
      for (const id of ids) {
        const t = enriched.find(e => e.id === id);
        if (t) {
          try {
            const res = await runOneInvestigation(t, userId);
            upsertLeadReports([{ leadRef: res.leadRef, companyDomain: t.companyDomain, companyName: t.companyName || '', cross: res.report }]);
            markResearched(res.leadRef);
          } catch (e) { console.error(e); }
        }
        done++;
        setResearchProgress({ done, total: ids.length });
      }
      toast({ title: 'Investigación completa' });
      setReports(getLeadReports());
      setSel({});
    } catch (e: any) { toast({ variant: 'destructive', title: 'Error', description: e.message }); }
    finally { setResearching(false); }
  };

  const handleRetryPhone = async (lead: EnrichedOppLead) => {
    if (enriching) return;
    const clientId = getClientUserId();
    const { data: { user } } = await supabase.auth.getUser();
    const finalUserId = user?.id || clientId;
    setEnriching(true);
    try {
      const payload = {
        leads: [{
          fullName: lead.fullName,
          companyName: lead.companyName,
          companyDomain: lead.companyDomain,
          email: extractPrimaryEmail(lead).email,
          existingRecordId: lead.id
        }],
        revealEmail: false,
        revealPhone: true
      };
      await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': finalUserId },
        body: JSON.stringify(payload),
      });
      toast({ title: 'Solicitud enviada' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setEnriching(false);
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader
        title="Oportunidades Enriquecidas"
        description="Gestiona, investiga y contacta a los leads provenientes de oportunidades."
      >
        <div className="flex gap-2">
          {/* Mostrar SOLO cuota de investigación para cumplir requerimiento de 'barra única' */}
          <DailyQuotaProgress kinds={['research']} compact className="w-[200px]" />
          <BackBar />
        </div>
      </PageHeader>

      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between space-y-2 md:space-y-0 pb-4">
          <div className="space-y-1">
            <CardTitle>Lista de oportunidades enriquecidas ({filtered.length} / {enriched.length})</CardTitle>
            <CardDescription>Solo se investigan los que tienen email revelado.</CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="w-4 h-4 mr-2" />
              {showFilters ? 'Ocultar Filtros' : 'Filtrar'}
            </Button>

            {Object.keys(sel).length > 0 && (
              <>
                <Button variant="secondary" size="sm" onClick={clearInvestigationsSelected}>
                  <Eraser className="w-4 h-4 mr-2" /> Borrar inv. sel.
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
                  <Trash2 className="w-4 h-4 mr-2" /> Eliminar seleccionados
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={clearInvestigations} disabled={!anyInvestigated}>
              <Eraser className="w-4 h-4 mr-2" /> Borrar todas inv.
            </Button>

            <Button
              onClick={handleRunN8nResearch}
              disabled={researching || Object.keys(sel).length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {researching ? <RotateCw className="w-4 h-4 animate-spin mr-2" /> : <RotateCw className="w-4 h-4 mr-2" />}
              Investigar (n8n) ({Object.keys(sel).length})
            </Button>

            <div className="h-4 w-px bg-border mx-1" />

            <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!enriched.length} title="Exportar CSV">
              <Download className="w-4 h-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={!enriched.length} title="Exportar Excel">
              <FileSpreadsheet className="w-4 h-4 mr-2" /> XLSX
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {showFilters && (
            <div className="mb-4 border rounded-md p-3 bg-muted/30 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Incluir Empresa</Label>
                <Input value={fIncCompany} onChange={e => { setFIncCompany(e.target.value); setApplied(prev => ({ ...prev, incCompany: e.target.value })) }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Incluir Nombre</Label>
                <Input value={fIncLead} onChange={e => { setFIncLead(e.target.value); setApplied(prev => ({ ...prev, incLead: e.target.value })) }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Incluir Cargo</Label>
                <Input value={fIncTitle} onChange={e => { setFIncTitle(e.target.value); setApplied(prev => ({ ...prev, incTitle: e.target.value })) }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Excluir Empresa</Label>
                <Input value={fExcCompany} onChange={e => { setFExcCompany(e.target.value); setApplied(prev => ({ ...prev, excCompany: e.target.value })) }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Excluir Nombre</Label>
                <Input value={fExcLead} onChange={e => { setFExcLead(e.target.value); setApplied(prev => ({ ...prev, excLead: e.target.value })) }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Excluir Cargo</Label>
                <Input value={fExcTitle} onChange={e => { setFExcTitle(e.target.value); setApplied(prev => ({ ...prev, excTitle: e.target.value })) }} />
              </div>
              <div className="col-span-full flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => {
                  setFIncCompany(''); setFIncLead(''); setFIncTitle('');
                  setFExcCompany(''); setFExcLead(''); setFExcTitle('');
                  setApplied({ incCompany: '', incLead: '', incTitle: '', excCompany: '', excLead: '', excTitle: '' });
                }}>Limpiar</Button>
              </div>
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] uppercase text-muted-foreground mb-1">Inv.</span>
                      <Checkbox checked={allResearchChecked} onCheckedChange={toggleAllResearch} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No hay leads.</TableCell></TableRow>
                ) : (
                  pageLeads.map((lead) => {
                    const emailData = extractPrimaryEmail(lead);
                    const hasEmail = !!emailData.email;
                    const researched = isResearchedLead(lead);
                    const report = findReportByRef(leadRefOf(lead))?.cross;
                    const pendingPhone = lead.enrichmentStatus === 'pending_phone';

                    return (
                      <TableRow key={lead.id}>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!sel[lead.id]}
                            onCheckedChange={(c) => setSel(prev => {
                              const n = { ...prev };
                              if (c) n[lead.id] = true; else delete n[lead.id];
                              return n;
                            })}
                            disabled={!hasEmail || researched}
                          />
                        </TableCell>
                        <TableCell>
                          <Linkedin
                            className={`w-4 h-4 cursor-pointer mx-auto ${lead.linkedinUrl ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300'}`}
                            onClick={() => lead.linkedinUrl && window.open(lead.linkedinUrl, '_blank')}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{lead.fullName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{lead.title}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{lead.companyName || '—'}</span>
                            <a href={`https://${lead.companyDomain}`} target="_blank" className="text-xs text-blue-500 hover:underline">{lead.companyDomain}</a>
                          </div>
                        </TableCell>
                        <TableCell>
                          {hasEmail ? (
                            <span className={emailData.status === 'verified' ? 'text-green-600' : 'text-yellow-600'}>
                              {emailData.email}
                            </span>
                          ) : <span className="text-xs italic text-muted-foreground">Not Found</span>}
                        </TableCell>
                        <TableCell>
                          {lead.primaryPhone ? (
                            <div className="flex items-center gap-1 text-blue-600 font-mono text-xs cursor-pointer" onClick={() => { setLeadToCall(lead); setCallModalOpen(true); }}>
                              <Phone className="w-3 h-3" /> {lead.primaryPhone}
                            </div>
                          ) : pendingPhone ? (
                            <span className="text-xs animate-pulse text-orange-500">Buscando...</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">—</span>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleRetryPhone(lead)} title="Reintentar">
                                <RotateCw className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {report ? (
                            <span className="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded-full border border-green-200 cursor-pointer hover:bg-green-200"
                              onClick={() => { setReportLead(lead); setReportToView({ leadRef: leadRefOf(lead), cross: report } as any); setOpenReport(true); }}
                            >
                              REPORT
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {report && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                const ref = leadRefOf(lead);
                                removeReportFor(ref);
                                removeResearched(ref);
                                setReports(getLeadReports());
                                toast({ title: 'Investigación eliminada' });
                              }} title="Borrar Investigación">
                                <Eraser className="w-3 h-3 text-orange-500" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                              if (confirm('¿Eliminar lead?')) {
                                enrichedOpportunitiesStorage.remove([lead.id]);
                                loadData();
                              }
                            }} title="Eliminar Lead">
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-muted-foreground">Mostrando {startIdx + 1}-{endIdx} de {total}</div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* REPORT MODAL */}
      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reporte: {reportLead?.companyName}</DialogTitle>
          </DialogHeader>
          {reportToView?.cross && (
            <div className="space-y-4 text-sm">
              <p>{reportToView.cross.overview}</p>
              {reportToView.cross.pains?.length > 0 && <div><strong>Pains:</strong> <ul className="list-disc pl-5">{reportToView.cross.pains.map(p => <li key={p}>{p}</li>)}</ul></div>}
              {reportToView.cross.emailDraft && (
                <div className="bg-muted p-2 rounded">
                  <strong>Email Draft:</strong>
                  <div className="text-xs font-mono whitespace-pre-wrap mt-1">{reportToView.cross.emailDraft.body}</div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CALL MODAL */}
      {leadToCall && <PhoneCallModal open={callModalOpen} onOpenChange={setCallModalOpen} customerName={leadToCall.fullName} customerPhone={leadToCall.primaryPhone || ''} leadIdentifier={leadToCall.id} />}

      <EnrichmentOptionsDialog open={openEnrichOptions} onOpenChange={setOpenEnrichOptions} onConfirm={() => { }} loading={false} />

    </div>
  );
}
