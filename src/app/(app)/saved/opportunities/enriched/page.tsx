'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { BackBar } from '@/components/back-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedOppLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { upsertLeadReports, getLeadReports, findReportByRef, removeReportFor, findReportForLead } from '@/lib/lead-research-storage';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { isResearched, markResearched, removeResearched } from '@/lib/researched-leads-storage';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { Linkedin, Eraser, Filter, Trash2, Download, FileSpreadsheet, RotateCw, Phone, Send, Edit } from 'lucide-react';
import { PhoneCallModal } from '@/components/phone-call-modal';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { exportToCsv, exportToXlsx } from '@/lib/sheet-export';
import { buildN8nPayloadFromLead } from '@/lib/n8n-payload';
import { styleProfilesStorage } from '@/lib/style-profiles-storage'; // FIXED IMPORT
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

  // Paginación
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);

  // Contact Selection (Strict Logic: Must be researched)
  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());

  // Mass Compose State
  const [openCompose, setOpenCompose] = useState(false);
  const [composeList, setComposeList] = useState<Array<{ lead: EnrichedOppLead; subject: string; body: string }>>([]);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkProvider, setBulkProvider] = useState<'gmail' | 'outlook'>('outlook');
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);

  // Bulk Editor
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [applyingEdit, setApplyingEdit] = useState(false);

  // Tracking
  const [usePixel, setUsePixel] = useState(true);
  const [useLinkTracking, setUseLinkTracking] = useState(false);
  const [useReadReceipt, setUseReadReceipt] = useState(false);

  // Load Data
  const loadData = async () => {
    const data = await enrichedOpportunitiesStorage.get();
    setEnriched(data);
    setReports(getLeadReports());
    const styles = styleProfilesStorage.list(); // FIXED: use storage.list()
    setStyleProfiles(styles);
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

    // Renamed helpers to avoid collisions
    const checkContainsAny = (value: string | null | undefined, terms: string[]) => {
      if (!terms.length) return true;
      const v = norm(value);
      return terms.some(t => v.includes(t));
    };
    const checkExcludesAll = (value: string | null | undefined, terms: string[]) => {
      if (!terms.length) return true;
      const v = norm(value);
      return terms.every(t => !v.includes(t));
    };

    return enriched.filter(e =>
      checkContainsAny(e.companyName, incCompanies) && checkContainsAny(e.fullName, incLeads) && checkContainsAny(e.title, incTitles) &&
      checkExcludesAll(e.companyName, excCompanies) && checkExcludesAll(e.fullName, excLeads) && checkExcludesAll(e.title, excTitles)
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

  const getReportFor = (e: EnrichedOppLead) => {
    return findReportForLead({ leadId: leadRefOf(e), companyDomain: e.companyDomain, companyName: e.companyName });
  };

  const hasReportStrict = (e: EnrichedOppLead) => !!getReportFor(e)?.cross;
  const isResearchedLead = (e: EnrichedOppLead) => isResearched(leadRefOf(e)) || hasReportStrict(e);

  // Bulk Checks
  const researchEligiblePage = pageLeads.filter(e => e.email && !isResearchedLead(e)).length;
  const allResearchChecked = researchEligiblePage > 0 && pageLeads.filter(e => e.email && !isResearchedLead(e)).every(e => sel[e.id]);

  // CONTACT LOGIC: Must be researched + have email
  const canContact = (e: EnrichedOppLead) => isResearchedLead(e) && !!e.email && e.email !== 'Not Found';
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
    await Promise.all(ids.map(id => enrichedOpportunitiesStorage.removeById(id)));
    setSel({});
    loadData();
    toast({ title: 'Leads borrados' });
  };

  const handleDeleteOne = async (id: string) => {
    if (!confirm('¿Eliminar lead?')) return;
    await enrichedOpportunitiesStorage.removeById(id);
    loadData();
    toast({ title: 'Lead borrado' });
  };

  const clearInvestigations = () => {
    if (!confirm('¿Borrar TODAS las investigaciones y marcas de memoria?')) return;
    enriched.forEach(e => {
      const ref = leadRefOf(e);
      removeReportFor(ref);
      removeResearched([ref]); // FIXED: passed as array
    });
    setReports(getLeadReports());
    toast({ title: 'Investigaciones borradas' });
  };

  const clearInvestigationFor = (lead: EnrichedOppLead) => {
    const ref = leadRefOf(lead);
    removeReportFor(ref);
    removeResearched([ref]); // FIXED: passed as array
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
            upsertLeadReports([{
              id: uuidv4(),
              company: {
                name: t.companyName || '',
                domain: t.companyDomain,
              },
              createdAt: new Date().toISOString(),
              cross: res.report,
              meta: { leadRef: res.leadRef }
            }]);
            markResearched([res.leadRef]); // FIXED: passed as array
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

  // --- BULK CONTACT LOGIC ---
  const handleOpenBulkCompose = () => {
    const ids = Array.from(selectedToContact);
    if (ids.length === 0) return;
    const toCompose: Array<{ lead: EnrichedOppLead; subject: string; body: string }> = [];

    ids.forEach(id => {
      const l = enriched.find(x => x.id === id);
      if (!l || !canContact(l)) return; // Double check
      const rep = getReportFor(l); // Usage updated to use robust lookup
      toCompose.push({
        lead: l,
        subject: rep?.cross?.emailDraft?.subject || `Contacto: ${l.fullName}`,
        body: rep?.cross?.emailDraft?.body || `Hola ${l.fullName}, te contacto desde...`
      });
    });

    setComposeList(toCompose);
    setOpenCompose(true);
  };

  const handleSendBulk = async () => {
    if (!confirm(`¿Enviar ${composeList.length} correos usando ${bulkProvider}?`)) return;
    setSendingBulk(true);
    try {
      const userId = await getUserIdOrFail();
      const payload = {
        userId,
        provider: bulkProvider,
        tracking: { pixel: usePixel, links: useLinkTracking, readReceipt: useReadReceipt }, // Using local state options
        emails: composeList.map(it => ({
          to: [it.lead.email!], // Already validated has email
          subject: it.subject,
          text: it.body,
          html: `<p>${it.body.replace(/\n/g, '<br/>')}</p>`,
          leadId: it.lead.id
        }))
      };

      const res = await fetch('/api/email/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al enviar');
      }

      const j = await res.json();
      toast({ title: 'Envío completado', description: `Enviados: ${j.sentCount || 0}, Fallidos: ${j.failedCount || 0}` });
      setOpenCompose(false);
      setComposeList([]);
      setSelectedToContact(new Set());
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error envío masivo', description: e.message });
    } finally {
      setSendingBulk(false);
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
          <BackBar fallbackHref="/saved/opportunities" />
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
            {selectedToContact.size > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ml-2">
                <Button variant="default" size="sm" onClick={handleOpenBulkCompose}>
                  <Send className="w-4 h-4 mr-2" />
                  Contactar ({selectedToContact.size})
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
                    const report = getReportFor(e)?.cross;
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
                            disabled={!canContact(e)} // Now uses strict check (researched + email)
                            checked={selectedToContact.has(e.id)}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedToContact);
                              if (v) next.add(e.id); else next.delete(e.id);
                              setSelectedToContact(next);
                            }}
                            title={!canContact(e) ? 'Debes investigar el lead antes de contactar' : 'Marcar para contactar'}
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

      {/* MASS CONTACT COMPOSE DIALOG */}
      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader>
            <DialogTitle>Contactar {composeList.length} leads</DialogTitle>
          </DialogHeader>

          <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="col-span-1">
              <Label className="text-xs text-muted-foreground mb-1">Fuente del borrador</Label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="draft-source" value="investigation" checked={draftSource === 'investigation'} onChange={() => setDraftSource('investigation')} />
                  Investigación
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
              <Label className="text-xs text-muted-foreground mb-1">Perfil de estilo</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                disabled={draftSource !== 'style' || styleProfiles.length === 0}
                value={selectedStyleName}
                onChange={(e) => setSelectedStyleName(e.target.value)}
              >
                {styleProfiles.length === 0 ? <option value="">(No hay estilos)</option> :
                  styleProfiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)
                }
              </select>
            </div>
            <div className="col-span-1">
              <Label className="text-xs text-muted-foreground mb-1">Proveedor de envío</Label>
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

          {/* AI EDITOR BAR */}
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">
              Revisa y ajusta los borradores. Proveedor: <strong>{bulkProvider}</strong>
            </div>
            <Button variant="secondary" onClick={() => setShowBulkEditor(v => !v)} disabled={composeList.length === 0}>
              {showBulkEditor ? 'Ocultar editor IA' : 'Editar con IA (todos)'}
            </Button>
          </div>

          {/* BULK EDITOR */}
          {showBulkEditor && (
            <div className="mb-3 border rounded-md p-3 bg-muted/40">
              <div className="text-sm text-muted-foreground mb-1">
                Describe cómo quieres modificar los correos (se aplicará a todos).
              </div>
              <Textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={3}
                placeholder='Ej: "Haz el tono más formal" o "Agrega una posdata sobre..."'
              />
              <div className="mt-2 flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setEditInstruction(''); setShowBulkEditor(false); }}>Cancelar</Button>
                <Button
                  disabled={applyingEdit || !editInstruction.trim()}
                  onClick={async () => {
                    if (!editInstruction.trim() || !composeList.length) return;
                    setApplyingEdit(true);
                    try {
                      const payload = {
                        instruction: editInstruction.trim(),
                        drafts: composeList.map(it => ({
                          subject: it.subject, body: it.body,
                          lead: {
                            id: it.lead.id, fullName: it.lead.fullName, email: it.lead.email,
                            title: it.lead.title, companyName: it.lead.companyName
                          }
                        }))
                      };
                      const r = await fetch('/api/email/bulk-edit', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      const j = await r.json();
                      if (!r.ok) throw new Error(j.error);
                      const edited = j.drafts || [];
                      if (edited.length === composeList.length) {
                        setComposeList(prev => prev.map((it, i) => ({ ...it, subject: edited[i].subject, body: edited[i].body })));
                      }
                      setShowBulkEditor(false);
                      setEditInstruction('');
                      toast({ title: 'Edición aplicada' });
                    } catch (e: any) { toast({ variant: 'destructive', title: 'Error', description: e.message }) }
                    finally { setApplyingEdit(false); }
                  }}
                >
                  {applyingEdit ? 'Aplicando...' : 'Aplicar'}
                </Button>
              </div>
            </div>
          )}

          {/* Tracking Options */}
          <div className="mb-4 border border-border/50 rounded-md p-3 bg-muted/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Inyecta una imagen invisible para detectar apertura en tiempo real">
                  <Checkbox checked={usePixel} onCheckedChange={(c) => setUsePixel(!!c)} />
                  Activar Tracking Pixel
                  <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded ml-1">Recomendado</span>
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Inserta un píxel invisible para detectar aperturas.
                </p>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Reescribe enlaces para saber si el usuario hizo clic">
                  <Checkbox checked={useLinkTracking} onCheckedChange={(c) => setUseLinkTracking(!!c)} />
                  Track Link Clicks
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Hace rastreables los links de tus correos.
                </p>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Solicita confirmación de lectura estándar">
                  <Checkbox checked={useReadReceipt} onCheckedChange={(c) => setUseReadReceipt(!!c)} />
                  Solicitar Confirmación
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Pide confirmación explícita al destinatario.
                </p>
              </div>
            </div>
          </div>

          {/* DRAFTS LIST */}
          <div className="max-h-[50vh] overflow-y-auto space-y-4 p-1">
            {composeList.map((item, idx) => (
              <div key={item.lead.id} className="border rounded-lg p-3">
                <div className="font-semibold text-sm">{item.lead.fullName} &lt;{item.lead.email}&gt;</div>
                <div className="mt-2 text-xs font-semibold">Asunto</div>
                <Input value={item.subject} onChange={e => {
                  const n = [...composeList]; n[idx].subject = e.target.value; setComposeList(n);
                }} className="mb-2 h-8" />
                <div className="text-xs font-semibold">Cuerpo</div>
                <Textarea value={item.body} onChange={e => {
                  const n = [...composeList]; n[idx].body = e.target.value; setComposeList(n);
                }} rows={6} className="text-xs font-mono" />
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenCompose(false)}>Cancelar</Button>
            <Button onClick={handleSendBulk} disabled={sendingBulk}>
              {sendingBulk ? <RotateCw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Enviar Correos
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CALL MODAL */}
      {leadToCall && <PhoneCallModal open={callModalOpen} onOpenChange={setCallModalOpen} lead={leadToCall as any} report={reportToView} onLogCall={(r, n) => console.log('Call logged:', r, n)} />}

      <EnrichmentOptionsDialog open={openEnrichOptions} onOpenChange={setOpenEnrichOptions} onConfirm={() => { }} loading={false} leadCount={0} />

    </div>
  );
}
