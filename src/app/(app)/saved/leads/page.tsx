'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import type { Lead, EnrichedLead } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertCircle, ArrowRight, ChevronDown, Download, ListFilter, MessageSquare, Search, Trash2 } from 'lucide-react';
import { toCsv, downloadCsv } from '@/lib/csv';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import * as Quota from '@/lib/quota-client';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CommentsSection } from '@/components/comments-section';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { retainVisibleSelection } from '@/lib/leads-workspace/selection';
import { v4 as uuid } from 'uuid';

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
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [selectedLeadForComments, setSelectedLeadForComments] = useState<Lead | null>(null);
  const [leadPendingDelete, setLeadPendingDelete] = useState<Lead | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Dialog state
  const [enrichOptionsOpen, setEnrichOptionsOpen] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<Lead[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadLeads() {
      setLoadingLeads(true);
      setLoadError('');

      try {
        const saved = await supabaseService.getLeads();
        if (!mounted) return;
        setSavedLeads(saved);
      } catch (e) {
        console.error('[saved/leads] Load failed:', e);
        if (!mounted) return;
        setSavedLeads([]);
        setLoadError('No pudimos cargar tus leads guardados. Intenta actualizar la vista en unos segundos.');
      } finally {
        if (mounted) setLoadingLeads(false);
      }
    }

    loadLeads();
    return () => { mounted = false; };
  }, [reloadKey]);

  async function handleDeleteLead(id: string) {
    try {
      const deletedCount = await supabaseService.removeWhere((l: Lead) => l.id === id);

      if (deletedCount > 0) {
        setSavedLeads(prev => prev.filter(l => l.id !== id));
        toast({ title: 'Eliminado', description: 'Se quito el lead de Guardados.' });
      } else {
        toast({ title: 'No se pudo eliminar', description: 'El lead sigue en tu lista. Intenta nuevamente en unos segundos.' });
      }
    } catch (error) {
      console.error('[saved/leads] Delete failed:', error);
      toast({ title: 'No se pudo eliminar', description: 'El lead sigue en tu lista. Intenta nuevamente en unos segundos.' });
    }
    setLeadPendingDelete(null);
  }

  const handleExportCsv = async () => {
    // Usar estado local o volver a pedir
    const saved = filteredLeads;

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

  const filteredLeads = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return savedLeads.filter((lead) => {
      if (showOnlyMyLeads && user && lead.userId !== user.id) return false;
      if (industryFilter !== 'all' && String(lead.industry || '').trim() !== industryFilter) return false;
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
      const haystack = [lead.name, lead.company, lead.title, lead.industry, lead.email].map((value) => String(value || '').toLowerCase());
      return haystack.some((value) => value.includes(term));
    });
  }, [savedLeads, showOnlyMyLeads, user, searchTerm, companyFilter, titleFilter, industryFilter, createdFrom, createdTo]);

  const pageLeads = filteredLeads;

  const selectedIds = useMemo(
    () => new Set(Object.keys(selLead).filter((id) => selLead[id])),
    [selLead],
  );
  const selectedCount = selectedIds.size;

  useEffect(() => {
    const visibleSelection = retainVisibleSelection(selectedIds, filteredLeads.map((lead) => lead.id));
    if (visibleSelection.size === selectedIds.size && Array.from(selectedIds).every((id) => visibleSelection.has(id))) return;
    setSelLead(Object.fromEntries(Array.from(visibleSelection).map((id) => [id, true])));
  }, [filteredLeads, selectedIds]);

  const allPageLeadsChecked = useMemo(
    () => {
      const selectableLeads = pageLeads.filter((lead) => !lead.email);
      return selectableLeads.length > 0 && selectableLeads.every((lead) => selLead[lead.id]);
    },
    [pageLeads, selLead]
  );

  const toggleAllLeads = (checked: boolean) => {
    if (!checked) return setSelLead({});
    const next: Record<string, boolean> = {};
    pageLeads.filter(l => !l.email).forEach(l => (next[l.id] = true));
    setSelLead(next);
  };

  function initiateEnrichSelected() {
    const chosen = filteredLeads.filter(l => selLead[l.id] && !l.email);
    if (chosen.length === 0) {
      toast({ title: 'Nada que enriquecer', description: 'Todos los seleccionados ya tienen email.' });
      return;
    }
    setLeadsToEnrich(chosen);
    setEnrichOptionsOpen(true);
  }

  const clearFilters = () => {
    setSearchTerm('');
    setCompanyFilter('');
    setTitleFilter('');
    setIndustryFilter('all');
    setCreatedFrom('');
    setCreatedTo('');
    setShowOnlyMyLeads(false);
  };

  const hasActiveFilters = Boolean(
    searchTerm || companyFilter || titleFilter || industryFilter !== 'all' || createdFrom || createdTo || showOnlyMyLeads,
  );

  const formatSavedDate = (lead: Lead) => {
    const value = (lead as Lead & { createdAt?: string }).createdAt;
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };

  async function handleConfirmEnrich(opts: { revealEmail: boolean; revealPhone: boolean }) {
    const { revealEmail, revealPhone } = opts;
    const chosen = leadsToEnrich;

    // La cuota diaria interna cuenta los leads enviados a enriquecimiento.
    const totalCost = chosen.length;

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
        sourceProviderId: l.sourceProvider === 'apollo' ? l.sourceProviderId : undefined,
      }));
      const operationId = uuid();

      const r = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
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
          sourceProvider: e.sourceProvider,
          sourceProviderId: e.sourceProviderId,
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
      const processedRefs = new Set<string>(
        ((j.enriched || []) as any[])
          .map((entry: any) => String(entry?.clientRef || '').trim())
          .filter(Boolean)
      );

      console.log('[enrich] Enriched Now (raw):', enrichedNow);

      // 1) Guardar en Enriquecidos
      // Nota: no persistimos el string "Not Found" en DB; la UI lo representa cuando falta el dato.
      const leadsToSave = enrichedNow.map(e => ({
        ...e,
        email: e.email || undefined,
        primaryPhone: e.primaryPhone || (e.phoneNumbers?.length ? e.phoneNumbers[0].sanitized_number : undefined),
        emailStatus: e.email
          ? (e.emailStatus || 'verified')
          : String(e.enrichmentStatus || '').startsWith('pending') ? 'unknown' : 'not_found',
        enrichmentStatus: e.enrichmentStatus || ((e.primaryPhone || e.phoneNumbers?.length) ? 'completed' : (revealPhone ? 'pending_phone' : 'completed')),
      }));

      if (leadsToSave.length > 0) {
        await enrichedLeadsStorage.addDedup(leadsToSave);
      }

      // 2) Remover de Guardados (siempre removemos porque ya se procesó)
      const toRemoveIds = new Set<string>(Array.from(processedRefs));

      if (toRemoveIds.size > 0) {
        await supabaseService.removeWhere(l => toRemoveIds.has(l.id));
      }

      // 3) Refrescar UI
      setSavedLeads(prev => prev.filter(l => !toRemoveIds.has(l.id)));
      setSelLead({});

      toast({
        title: 'Enriquecimiento en curso',
        description: `${leadsToSave.length} lead(s) enviados a Enriquecidos. Los datos aparecerán al finalizar.`,
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
    <div className="space-y-4 pb-8">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[2rem]">Leads guardados</h1>
            <span className="text-sm tabular-nums text-muted-foreground">{savedLeads.length}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Filtra, selecciona y enriquece los contactos que quieras trabajar.</p>
        </div>
        <Button className="w-full rounded-full sm:w-auto" onClick={() => router.push('/saved/leads/enriched')}>
          Ver enriquecidos
          <ArrowRight className="h-4 w-4" />
        </Button>
      </header>

      <Card className="overflow-hidden rounded-3xl border-border/60 bg-card/85 shadow-[0_18px_50px_-44px_rgba(15,23,42,0.28)] dark:bg-card/70">
        <CardContent className="p-0">
          <div className="space-y-3 border-b border-border/60 bg-muted/10 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-10 rounded-full border-border/70 bg-background/90 pl-10"
                  placeholder="Buscar por lead, empresa, cargo o email"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Buscar leads guardados"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={showOnlyMyLeads ? 'secondary' : 'outline'}
                  className="rounded-full"
                  onClick={() => setShowOnlyMyLeads((value) => !value)}
                  aria-pressed={showOnlyMyLeads}
                >
                  Solo míos
                </Button>
                <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" size="sm" variant="outline" className="rounded-full" aria-expanded={advancedFiltersOpen}>
                      <ListFilter className="h-4 w-4" />
                      Filtros
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={handleExportCsv}
                  disabled={filteredLeads.length === 0 || loadingLeads}
                  title="Exportar las filas visibles"
                >
                  <Download className="h-4 w-4" />
                  Exportar {filteredLeads.length > 0 ? `(${filteredLeads.length})` : ''}
                </Button>
              </div>
            </div>

            <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
              <CollapsibleContent>
                <div className="grid gap-3 rounded-2xl border border-border/60 bg-background/60 p-3 pt-4 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="saved-company-filter">Empresa</Label>
                    <Input id="saved-company-filter" placeholder="Contiene…" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="saved-title-filter">Cargo</Label>
                    <Input id="saved-title-filter" placeholder="Contiene…" value={titleFilter} onChange={(e) => setTitleFilter(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Industria</Label>
                    <Select value={industryFilter} onValueChange={setIndustryFilter}>
                      <SelectTrigger aria-label="Filtrar por industria"><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {industryOptions.map((industry) => <SelectItem key={industry} value={industry}>{industry}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="saved-created-from">Guardado desde</Label>
                    <Input id="saved-created-from" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="saved-created-to">Guardado hasta</Label>
                    <Input id="saved-created-to" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
                  </div>
                  <div className="flex items-end sm:col-span-2 xl:col-span-5 xl:justify-end">
                    <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasActiveFilters}>Limpiar filtros</Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{filteredLeads.length} de {savedLeads.length} leads</span>
              <span>{filteredLeads.filter((lead) => !lead.email).length} disponibles para enriquecer</span>
            </div>
          </div>

          <div className="p-4 sm:p-5">
          {selectedCount > 0 ? (
            <div className="sticky top-14 z-20 mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-lg shadow-black/5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium">{selectedCount} {selectedCount === 1 ? 'lead seleccionado' : 'leads seleccionados'}</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelLead({})}>Cancelar</Button>
                <Button size="sm" disabled={enriching} onClick={initiateEnrichSelected}>
                  {enriching ? 'Enriqueciendo…' : 'Enriquecer selección'}
                </Button>
              </div>
            </div>
          ) : null}
          {loadError ? (
            <Alert className="rounded-2xl border-destructive/25 bg-destructive/5 text-foreground">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <AlertTitle>No pudimos mostrar la lista ahora</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{loadError}</span>
                <Button variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>Reintentar</Button>
              </AlertDescription>
            </Alert>
          ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background/60">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageLeadsChecked}
                      onCheckedChange={v => toggleAllLeads(Boolean(v))}
                      aria-label="Seleccionar todos los leads visibles"
                    />
                  </TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead className="hidden lg:table-cell">Contexto</TableHead>
                  <TableHead className="hidden xl:table-cell">Guardado</TableHead>
                  <TableHead className="w-24 text-right"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLeads ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden xl:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="ml-auto h-8 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : pageLeads.length > 0 ? pageLeads.map(l => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Checkbox
                        disabled={!!l.email}
                        checked={!!selLead[l.id]}
                        onCheckedChange={v => setSelLead(prev => ({ ...prev, [l.id]: Boolean(v) }))}
                        title={l.email ? 'Este lead ya tiene email' : ''}
                        aria-label={`Seleccionar ${l.name || 'lead'} para enriquecer`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={l.avatar} alt={l.name || 'lead'} />
                          <AvatarFallback>{(l.name || 'L').charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="max-w-[210px] truncate font-medium">{l.name}</div>
                          <div className="max-w-[220px] truncate text-xs text-muted-foreground">{l.title || 'Sin cargo'}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[180px] truncate font-medium">{l.company || '—'}</div>
                      {l.companyWebsite ? (
                        <a className="mt-0.5 block max-w-[180px] truncate text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={asHttp(l.companyWebsite)} target="_blank" rel="noreferrer">
                          {displayDomain(l.companyWebsite)}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate text-sm">{l.email || 'Sin email'}</div>
                      {l.linkedinUrl ? (
                        <a className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={l.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="max-w-[180px] truncate text-sm">{l.industry || 'Sin industria'}</div>
                      <div className="max-w-[180px] truncate text-xs text-muted-foreground">{[l.city, l.country].filter(Boolean).join(', ') || 'Sin ubicación'}</div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">{formatSavedDate(l)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setSelectedLeadForComments(l)} aria-label={`Abrir comentarios de ${l.name || 'lead'}`} title="Comentarios">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setLeadPendingDelete(l)} aria-label={`Eliminar lead ${l.name || 'guardado'}`} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-52 text-center">
                      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/40">
                          <Search className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{savedLeads.length === 0 ? 'Aun no hay leads guardados' : 'No hay leads con esos filtros'}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {savedLeads.length === 0
                              ? 'Guarda leads desde la busqueda para revisarlos y enriquecerlos despues.'
                              : 'Prueba limpiar algun filtro para volver a ver tu base guardada.'}
                          </p>
                        </div>
                        {savedLeads.length === 0 ? (
                          <Button size="sm" onClick={() => router.push('/search')}>Buscar leads</Button>
                        ) : <Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selectedLeadForComments} onOpenChange={(open) => !open && setSelectedLeadForComments(null)}>
        <SheetContent className="flex w-full flex-col sm:w-[540px]">
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
      <AlertDialog open={!!leadPendingDelete} onOpenChange={(open) => !open && setLeadPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar lead guardado</AlertDialogTitle>
            <AlertDialogDescription>
              Quitaremos {leadPendingDelete?.name || 'este lead'} de Guardados. No se enviara ningun correo ni afectara tus leads ya enriquecidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => leadPendingDelete && handleDeleteLead(leadPendingDelete.id)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
