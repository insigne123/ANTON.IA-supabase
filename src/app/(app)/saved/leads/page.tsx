'use client';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import type { Lead, EnrichedLead } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Download, Trash2, MessageSquare } from 'lucide-react';
import { toCsv, downloadCsv } from '@/lib/csv';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import * as Quota from '@/lib/quota-client';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CommentsSection } from '@/components/comments-section';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, ''); } };
const asHttp = (url: string) => url.startsWith('http') ? url : `https://${url}`;

export default function SavedLeadsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [selLead, setSelLead] = useState<Record<string, boolean>>({});
  const [enriching, setEnriching] = useState(false);
  const [showOnlyMyLeads, setShowOnlyMyLeads] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [createdByFilter, setCreatedByFilter] = useState('all');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [selectedLeadForComments, setSelectedLeadForComments] = useState<Lead | null>(null);

  // Dialog state
  const [enrichOptionsOpen, setEnrichOptionsOpen] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<Lead[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadAndMigrateOnce() {
      // Carga inicial desde Supabase
      const saved = await supabaseService.getLeads();
      if (!mounted) return;

      // Migración legacy: si existen leads con email en "Guardados", moverlos a "Enriquecidos".
      // (Se ejecuta una sola vez al cargar la página.)
      const withEmail = saved.filter(l => !!l.email);
      const remaining = saved.filter(l => !l.email);

      if (withEmail.length > 0) {
        try {
          const moved: EnrichedLead[] = withEmail.map<EnrichedLead>(l => ({
            id: l.id,
            fullName: l.name,
            title: l.title,
            email: l.email ?? undefined,
            emailStatus: 'verified',
            linkedinUrl: l.linkedinUrl || undefined,
            companyName: l.company || undefined,
            companyDomain: l.companyWebsite ? displayDomain(l.companyWebsite) : undefined,
            country: l.country || undefined,
            city: l.city || undefined,
            industry: l.industry || undefined,
            createdAt: new Date().toISOString(),
          }));

          const res = await enrichedLeadsStorage.addDedup(moved);

          // Eliminar SOLO los leads que migramos (no todos los que tengan email).
          const ids = new Set(withEmail.map(l => l.id));
          await supabaseService.removeWhere((l: Lead) => ids.has(l.id));

          const addedCount = (res as any)?.addedCount ?? 0;
          if (addedCount > 0) {
            toast({
              title: 'Leads movidos a Enriquecidos',
              description: `Se movieron ${addedCount} lead(s) con email a la sección Enriquecidos.`,
            });
          }
        } catch (e) {
          console.warn('[saved/leads] Migration failed:', e);
        }
      }

      setSavedLeads(remaining);
    }

    loadAndMigrateOnce();
    return () => { mounted = false; };
  }, [toast]);

  async function handleDeleteLead(id: string) {
    const ok = confirm('¿Eliminar este lead de Guardados?');
    if (!ok) return;

    const deletedCount = await supabaseService.removeWhere((l: Lead) => l.id === id);

    if (deletedCount > 0) {
      setSavedLeads(prev => prev.filter(l => l.id !== id));
      toast({ title: 'Eliminado', description: 'Se quitó el lead de Guardados.' });
    } else {
      toast({ variant: 'destructive', title: 'No se pudo eliminar' });
    }
  }

  const handleExportCsv = async () => {
    // Usar estado local o volver a pedir
    const saved = savedLeads;

    // Encabezados como texto (no objetos)
    const headers: string[] = [
      'ID',
      'Nombre',
      'Cargo',
      'Empresa',
      'Email',
      'LinkedIn',
      'Web Empresa',
      'LinkedIn Empresa',
      'Ubicación',
      'Industria',
      'Estado',
    ];

    // Filas como (string | number)[] (no objetos)
    const rows: (string | number)[][] = saved.map((l) => ([
      l.id || '',
      l.name || '',
      l.title || '',
      l.company || '',
      l.email || '',
      (l as any).linkedinUrl || '',
      (l as any).companyWebsite || '',
      (l as any).companyLinkedin || '',
      l.location || '',
      l.industry || '',
      l.status || '',
    ]));

    const csv = toCsv(rows, headers);
    downloadCsv(`leads_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const industryOptions = useMemo(() => Array.from(new Set(savedLeads.map((lead) => String(lead.industry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [savedLeads]);
  const creatorOptions = useMemo(() => Array.from(new Set(savedLeads.map((lead) => String(lead.userId || '').trim()).filter(Boolean))), [savedLeads]);

  const filteredLeads = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return savedLeads.filter((lead) => {
      if (showOnlyMyLeads && user && lead.userId !== user.id) return false;
      if (industryFilter !== 'all' && String(lead.industry || '').trim() !== industryFilter) return false;
      if (createdByFilter !== 'all' && String(lead.userId || '').trim() !== createdByFilter) return false;
      if (companyFilter && !String(lead.company || '').toLowerCase().includes(companyFilter.toLowerCase())) return false;
      if (titleFilter && !String(lead.title || '').toLowerCase().includes(titleFilter.toLowerCase())) return false;

      const leadDate = new Date((lead as any).createdAt || 0);
      if (createdFrom) {
        if (Number.isNaN(leadDate.getTime()) || leadDate < new Date(`${createdFrom}T00:00:00`)) return false;
      }
      if (createdTo) {
        if (Number.isNaN(leadDate.getTime()) || leadDate > new Date(`${createdTo}T23:59:59`)) return false;
      }

      if (!term) return true;
      const haystack = [lead.name, lead.company, lead.title, lead.industry, lead.email, lead.userId].map((value) => String(value || '').toLowerCase());
      return haystack.some((value) => value.includes(term));
    });
  }, [savedLeads, showOnlyMyLeads, user, searchTerm, companyFilter, titleFilter, industryFilter, createdByFilter, createdFrom, createdTo]);

  const pageLeads = filteredLeads;

  const allPageLeadsChecked = useMemo(
    () =>
      pageLeads.length > 0 &&
      pageLeads.filter(l => !l.email).every(l => selLead[l.id]),
    [pageLeads, selLead]
  );

  const toggleAllLeads = (checked: boolean) => {
    if (!checked) return setSelLead({});
    const next: Record<string, boolean> = {};
    pageLeads.filter(l => !l.email).forEach(l => (next[l.id] = true));
    setSelLead(next);
  };

  function initiateEnrichSelected() {
    const chosen = savedLeads.filter(l => selLead[l.id] && !l.email);
    if (chosen.length === 0) {
      toast({ title: 'Nada que enriquecer', description: 'Todos los seleccionados ya tienen email.' });
      return;
    }
    setLeadsToEnrich(chosen);
    setEnrichOptionsOpen(true);
  }

  async function handleConfirmEnrich(opts: { revealEmail: boolean; revealPhone: boolean }) {
    const { revealEmail, revealPhone } = opts;
    const chosen = leadsToEnrich;

    // Validación preventiva de cuota (approx)
    const costPerLead = (revealEmail ? 1 : 0) + (revealPhone ? 1 : 0);
    const totalCost = costPerLead * chosen.length;

    if (!Quota.canUseClientQuota('enrich', totalCost)) {
      const { enrich: used = 0 } = Quota.getClientQuota() as any;
      const limit = Quota.getClientLimit('enrich');
      const remaining = Math.max(0, limit - (used || 0));
      toast({
        title: 'Sincronizando cuota',
        description: `El navegador marcaba ${used}/${limit}. Intento igual y el servidor confirma el cupo real. Quedaba local estimado: ${remaining}.`,
      });
    }

    setEnriching(true);
    try {
      const payloadLeads = chosen.map(l => ({
        fullName: l.name,
        linkedinUrl: l.linkedinUrl || undefined,
        companyName: l.company || undefined,
        companyDomain: l.companyWebsite ? displayDomain(l.companyWebsite) : undefined,
        clientRef: l.id,
        id: l.id,
        apolloId: l.apolloId,
      }));

      const r = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-quota-ticket': getQuotaTicket() || '',
        },
        body: JSON.stringify({ leads: payloadLeads, revealEmail, revealPhone, tableName: 'enriched_leads' }),
      });
      const j = await r.clone().json().catch(async () => ({ nonJson: true, text: await r.text() }));
      console.log('[enrich] Response:', j);

      // Print server-side logs for debugging
      if (j?.debug?.serverLogs && Array.isArray(j.debug.serverLogs)) {
        console.groupCollapsed('[Server Logs] Apollo Enrichment');
        j.debug.serverLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
      }

      if (!r.ok) {
        const snippet = (j as any)?.error || (j as any)?.message || (j as any)?.text || 'Error interno';
        throw new Error(`HTTP ${r.status}: ${String(snippet).slice(0, 200)}`);
      }

      // Check for server-side quota limit note
      if (j.note && typeof j.note === 'string' && j.note.includes('Quota')) {
        toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: j.note });
        // We can still process what resulted (if any), but warn the user.
      }

      // Actualiza quota-ticket si viene
      const ticket = (j as any)?.ticket || r.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);

      // Actualizar Cuota
      const enrichedCountFromServer = Number(j?.usage?.consumed ?? 0);
      if (enrichedCountFromServer > 0) {
        Quota.incClientQuota('enrich', enrichedCountFromServer);
      }

      // Procesar respuesta
      const byRef = new Map(chosen.map(l => [l.id, l]));
      const enrichedNow: EnrichedLead[] = (j.enriched || []).map((e: any) => {
        const sourceLead = byRef.get(e?.clientRef);
        const domainFromEmail = sourceLead?.email?.includes('@')
          ? sourceLead.email!.split('@')[1].toLowerCase()
          : undefined;
        const domainFromWebsite = sourceLead?.companyWebsite
          ? (sourceLead.companyWebsite.startsWith('http')
            ? new URL(sourceLead.companyWebsite).hostname
            : sourceLead.companyWebsite)
            .replace(/^https?:\/\//, '').replace(/^www\./, '')
          : undefined;

        // Aseguramos que phoneNumbers y primaryPhone se pasen
        return {
          id: e.id,
          apolloId: e.apolloId,
          fullName: e.fullName,
          title: e.title,
          email: e.email,
          emailStatus: e.emailStatus || 'unknown',
          linkedinUrl: e.linkedinUrl,
          companyName: e.companyName ?? sourceLead?.company,
          companyDomain: e.companyDomain ?? domainFromWebsite ?? domainFromEmail,
          country: sourceLead?.country,
          city: sourceLead?.city,
          industry: sourceLead?.industry,
          phoneNumbers: e.phoneNumbers,
          primaryPhone: e.primaryPhone,
          enrichmentStatus: e.enrichmentStatus,
        };
      });

      console.log('[enrich] Enriched Now (raw):', enrichedNow);

      // 1) Guardar en Enriquecidos
      // Nota: no persistimos el string "Not Found" en DB; la UI lo representa cuando falta el dato.
      const leadsToSave = enrichedNow.map(e => ({
        ...e,
        email: e.email || undefined,
        primaryPhone: e.primaryPhone || (e.phoneNumbers?.length ? e.phoneNumbers[0].sanitized_number : undefined),
        emailStatus: e.email ? (e.emailStatus || 'verified') : 'not_found',
        enrichmentStatus: e.enrichmentStatus || ((e.primaryPhone || e.phoneNumbers?.length) ? 'completed' : (revealPhone ? 'pending_phone' : 'completed')),
      }));

      let addRes: any = { addedCount: 0 };
      if (leadsToSave.length > 0) {
        addRes = await enrichedLeadsStorage.addDedup(leadsToSave);
      }

      // 2) Remover de Guardados (siempre removemos porque ya se procesó)
      const toRemoveIds = new Set<string>();
      for (let i = 0; i < enrichedNow.length; i++) {
        const src = chosen[i];
        if (src?.id) {
          toRemoveIds.add(src.id);
        }
      }

      const removedCount = toRemoveIds.size > 0
        ? await supabaseService.removeWhere(l => toRemoveIds.has(l.id))
        : 0;

      // 3) Refrescar UI
      setSavedLeads(prev => prev.filter(l => !toRemoveIds.has(l.id)));
      setSelLead({});

      const foundCount = leadsToSave.filter(l => !!l.email || !!l.primaryPhone).length;
      const pendingPhoneCount = leadsToSave.filter(l => l.enrichmentStatus === 'pending_phone').length;

      toast({
        title: 'Enriquecimiento completado',
        description: pendingPhoneCount > 0
          ? `Procesados: ${leadsToSave.length}. Con datos inmediatos: ${foundCount}. Telefonos en proceso: ${pendingPhoneCount}. Movidos a Enriquecidos.`
          : `Procesados: ${leadsToSave.length}. Con datos: ${foundCount}. Movidos a Enriquecidos.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Ocurrió un error' });
    } finally {
      setEnriching(false);
      setEnrichOptionsOpen(false);
      setLeadsToEnrich([]);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guardados · Leads"
        description="Revisa tu base guardada, filtra rápido y enriquece solo lo que realmente vale la pena mover." 
      />

      <div className="mb-4">
        <DailyQuotaProgress kinds={['enrich']} compact />
      </div>

      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/70">
        <CardHeader className="flex flex-col gap-5 border-b border-border/60 bg-muted/10 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Base guardada</div>
            <CardTitle>Leads guardados</CardTitle>
            <CardDescription>Selecciona los que no tienen email para enriquecerlos.</CardDescription>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1">Visibles: {filteredLeads.length}</span>
              <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1">Sin email: {filteredLeads.filter((lead) => !lead.email).length}</span>
              <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1">Creados por ti: {savedLeads.filter((lead) => lead.userId === user?.id).length}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center lg:max-w-[620px] lg:justify-end">
            <div className="flex items-center space-x-2 mr-4">
              <Switch id="my-leads" checked={showOnlyMyLeads} onCheckedChange={setShowOnlyMyLeads} />
              <Label htmlFor="my-leads">Solo mis leads</Label>
            </div>
            <Button variant="outline" className="shadow-none" onClick={handleExportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              className="shadow-none"
              onClick={() => router.push('/saved/leads/enriched')}
            >
              Ver enriquecidos
            </Button>

            <Button
              variant="secondary"
              className="shadow-none"
              disabled={enriching || Object.values(selLead).every(v => !v)}
              onClick={initiateEnrichSelected}
            >
              {enriching ? 'Enriqueciendo…' : 'Enriquecer seleccionados'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-[22px] border border-border/70 bg-muted/15 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Filtros</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input placeholder="Buscar lead, empresa, cargo o email" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <Input placeholder="Filtrar por empresa" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} />
              <Input placeholder="Filtrar por cargo" value={titleFilter} onChange={(e) => setTitleFilter(e.target.value)} />
              <select className="h-10 rounded-md border bg-background px-3 py-2 text-sm" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="all">Todas las industrias</option>
                {industryOptions.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
              </select>
              <select className="h-10 rounded-md border bg-background px-3 py-2 text-sm" value={createdByFilter} onChange={(e) => setCreatedByFilter(e.target.value)}>
                <option value="all">Todas las personas</option>
                {creatorOptions.map((creatorId) => <option key={creatorId} value={creatorId}>{creatorId === user?.id ? 'Yo' : creatorId}</option>)}
              </select>
              <Input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
              <Input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
              <Button variant="ghost" onClick={() => { setSearchTerm(''); setCompanyFilter(''); setTitleFilter(''); setIndustryFilter('all'); setCreatedByFilter('all'); setCreatedFrom(''); setCreatedTo(''); setShowOnlyMyLeads(false); }}>
                Limpiar filtros
              </Button>
            </div>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageLeadsChecked}
                      onCheckedChange={v => toggleAllLeads(Boolean(v))}
                    />
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Industria</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead className="w-20 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.map(l => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Checkbox
                        disabled={!!l.email}
                        checked={!!selLead[l.id]}
                        onCheckedChange={v => setSelLead(prev => ({ ...prev, [l.id]: Boolean(v) }))}
                        title={l.email ? 'Este lead ya tiene email' : ''}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={l.avatar} alt={l.name || 'lead'} />
                          <AvatarFallback>{(l.name || 'L').charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{l.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{l.title || '—'}</TableCell>
                    <TableCell>{l.company || '—'}</TableCell>
                    <TableCell>{l.email || '—'}</TableCell>
                    <TableCell>
                      {l.companyWebsite ? (
                        <a className="underline" href={asHttp(l.companyWebsite)} target="_blank" rel="noreferrer">
                          {displayDomain(l.companyWebsite)}
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {l.linkedinUrl ? (
                        <a className="underline" href={l.linkedinUrl} target="_blank" rel="noreferrer">Perfil</a>
                      ) : (l.companyLinkedin ? <a className="underline" href={l.companyLinkedin} target="_blank" rel="noreferrer">Empresa</a> : '—')}
                    </TableCell>
                    <TableCell>{l.industry || '—'}</TableCell>
                    <TableCell>{l.country || '—'}</TableCell>
                    <TableCell>{l.city || '—'}</TableCell>
                    <TableCell className="text-right flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setSelectedLeadForComments(l)} title="Comentarios">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDeleteLead(l.id)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selectedLeadForComments} onOpenChange={(open) => !open && setSelectedLeadForComments(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Comentarios: {selectedLeadForComments?.name}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 mt-4 overflow-hidden">
            {selectedLeadForComments && (
              <CommentsSection entityType="lead" entityId={selectedLeadForComments.id} />
            )}
          </div>
        </SheetContent>
      </Sheet>
      <EnrichmentOptionsDialog
        open={enrichOptionsOpen}
        onOpenChange={setEnrichOptionsOpen}
        onConfirm={handleConfirmEnrich}
        loading={enriching}
        leadCount={leadsToEnrich.length}
      />
    </div>
  );
}
