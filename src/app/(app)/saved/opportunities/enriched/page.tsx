'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedOppLead, LeadResearchReport } from '@/lib/types';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { upsertLeadReports, getLeadReports, findReportByRef, removeReportFor, findReportForLead } from '@/lib/lead-research-storage';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { isResearched, markResearched, removeResearched } from '@/lib/researched-leads-storage';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { Linkedin, Eraser, Filter, Trash2, Download, FileSpreadsheet, RotateCw, Phone } from 'lucide-react';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import * as Quota from '@/lib/quota-client';
import { Switch } from '@/components/ui/switch';

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

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, ''); } };
const asHttp = (url: string) => url.startsWith('http') ? url : `https://${url}`;

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

  // Filtros
  const [showFilters, setShowFilters] = useState(false);
  const [fIncCompany, setFIncCompany] = useState('');
  const [fIncLead, setFIncLead] = useState('');
  const [fIncTitle, setFIncTitle] = useState('');
  const [fExcCompany, setFExcCompany] = useState('');
  const [fExcLead, setFExcLead] = useState('');
  const [fExcTitle, setFExcTitle] = useState('');
  const [applied, setApplied] = useState({ incCompany: '', incLead: '', incTitle: '', excCompany: '', excLead: '', excTitle: '' });

  // Show only my leads toggle (mock functionality if userId is present)
  const [showOnlyMyLeads, setShowOnlyMyLeads] = useState(false);

  // Paginación
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);

  // Contact Selection (Mock for compatibility with EnrichedLeads logic)
  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());

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

  const canContact = (e: EnrichedOppLead) => !!e.email && e.email !== 'Not Found';
  const toggleAllContact = (checked: boolean) => {
    const next = new Set(selectedToContact);
    pageLeads.forEach(e => {
      if (canContact(e)) {
        if (checked) next.add(e.id); else next.delete(e.id);
      }
    });
    setSelectedToContact(next);
  };
  const contactEligiblePage = pageLeads.filter(canContact).length;
  const allContactChecked = contactEligiblePage > 0 && pageLeads.filter(canContact).every(e => selectedToContact.has(e.id));


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

  const handleDeleteOne = async (id: string) => {
    if (!confirm('¿Eliminar lead?')) return;
    await enrichedOpportunitiesStorage.remove([id]);
    loadData();
    toast({ title: 'Lead borrado' });
  };

  const clearInvestigations = () => {
    if (!confirm('¿Borrar TODAS las investigaciones y marcas de memoria?')) return;
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

  const clearInvestigationFor = (lead: EnrichedOppLead) => {
    const ref = leadRefOf(lead);
    removeReportFor(ref);
    removeResearched(ref);
    setReports(getLeadReports());
    toast({ title: 'Investigación eliminada' });
    if (reportLead?.id === lead.id) setOpenReport(false);
  }

  // N8N Research
  const runOneInvestigation = async (e: EnrichedOppLead, userId: string) => {
    const base = buildN8nPayloadFromLead(e as any) as any;
    const leadRef = leadRefOf(e);
    const effectiveCompanyProfile = { name: 'Mi Empresa', website: '' };
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
          <DailyQuotaProgress kinds={['research']} compact className="w-[200px]" />
          <BackBar />
        </div>
      </PageHeader>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Leads enriquecidos (Oportunidades)</CardTitle>
            <CardDescription>Gestiona, investiga y contacta tus leads de oportunidades.</CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="w-4 h-4 mr-2" />
              filtros
            </Button>
            {/* Bulk Actions Only if Selected */}
            {Object.keys(sel).length > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <Button variant="secondary" size="sm" onClick={handleDeleteSelected}>
                  <Trash2 className="w-4 h-4 mr-1" /> Borrar seleccionados
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
                  <TableHead className="w-12 text-center" title="Marcar para INVESTIGAR con n8n">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Inv.</span>
                      <Checkbox
                        checked={allResearchChecked}
                        onCheckedChange={(v) => toggleAllResearch(Boolean(v))}
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
                      />
                    </div>
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead className="w-64 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No hay leads.</TableCell></TableRow>
                ) : (
                  pageLeads.map((e) => {
                    const emailData = extractPrimaryEmail(e);
                    const hasEmail = !!emailData.email;
                    const researched = isResearchedLead(e);
                    const report = findReportByRef(leadRefOf(e))?.cross;
                    const pendingPhone = e.enrichmentStatus === 'pending_phone';

                    return (
                      <TableRow key={e.id}>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!sel[e.id]}
                            onCheckedChange={(v) => setSel(prev => ({ ...prev, [e.id]: Boolean(v) }))}
                            disabled={!hasEmail || researched}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            disabled={!canContact(e)}
                            checked={selectedToContact.has(e.id)}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedToContact);
                              if (v) next.add(e.id); else next.delete(e.id);
                              setSelectedToContact(next);
                            }}
                          />
                        </TableCell>
                        <TableCell>{e.fullName}</TableCell>
                        <TableCell>{e.title || '—'}</TableCell>
                        <TableCell>{e.companyName || '—'}</TableCell>
                        <TableCell>
                          {hasEmail ? (
                            <span className={emailData.status === 'verified' ? 'text-green-600' : 'text-yellow-600'}>
                              {emailData.email}
                            </span>
                          ) : <span className="text-xs italic text-muted-foreground">Not Found</span>}
                        </TableCell>
                        <TableCell>
                          {e.primaryPhone ? (
                            <div className="flex flex-col gap-1 cursor-pointer hover:bg-muted/50 p-1 rounded transition-colors group" onClick={() => { setLeadToCall(e); setCallModalOpen(true); }}>
                              <div className="flex items-center gap-1 text-sm font-medium text-blue-600 group-hover:text-blue-800">
                                <Phone className="h-3 w-3" />
                                <span>{e.primaryPhone}</span>
                              </div>
                            </div>
                          ) : pendingPhone ? (
                            <span className="text-xs animate-pulse text-orange-500">Buscando...</span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">—</span>
                          )}
                        </TableCell>
                        <TableCell>{e.linkedinUrl ? <a className="underline" target="_blank" href={e.linkedinUrl}>Perfil</a> : '—'}</TableCell>
                        <TableCell>{e.companyDomain || '—'}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="outline" onClick={() => { setReportLead(e); setReportToView(report ? { leadRef: leadRefOf(e), cross: report } as any : null); setOpenReport(true); }}>
                            {report ? 'Ver reporte' : 'Sin reporte'}
                          </Button>
                          <Button size="sm" disabled={!canContact(e)}>Contactar</Button>
                          <Button size="icon" variant="ghost" disabled={!e.linkedinUrl} onClick={() => e.linkedinUrl && window.open(e.linkedinUrl, '_blank')}>
                            <Linkedin className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDeleteOne(e.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
          {reportToView?.cross && reportLead && (
            <div className="w-full flex justify-end mb-2">
              <Button variant="destructive" size="sm" onClick={() => clearInvestigationFor(reportLead)}>
                <Eraser className="h-4 w-4 mr-1" /> Eliminar investigación de este lead
              </Button>
            </div>
          )}
          {reportToView?.cross ? (
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
          ) : (
            <div className="p-4 text-center text-muted-foreground">
              No hay reporte generado para este lead. Selecciónalo en la lista y pulsa "Investigar (n8n)".
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
