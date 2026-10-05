'use client';
import Link from 'next/link';
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
import type { Lead } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertCircle, ArrowRight, ChevronDown, Download, Linkedin, ListFilter, MailSearch, MessageSquare, Search, Trash2, Upload, UserSearch } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
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
import { LeadName } from '@/components/leads/LeadName';
import { retainVisibleSelection } from '@/lib/leads-workspace/selection';
import { v4 as uuid } from 'uuid';
import { safeAvatarUrl } from '@/lib/avatar';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { ActionBar } from '@/components/ui/action-bar';
import { ToastAction } from '@/components/ui/toast';
import { InitialsAvatar } from '@/components/initials-avatar';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { APOLLO_EMAIL_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import {
  SAVED_LOOKUP_LABELS,
  classifyEnrichmentResults,
  savedLeadToEnriched,
  savedLookupState,
  type SavedLookupState,
} from '@/lib/leads-workspace/saved-enrichment';

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, ''); } };
const asHttp = (url: string) => url.startsWith('http') ? url : `https://${url}`;

export default function SavedLeadsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [selLead, setSelLead] = useState<Record<string, boolean>>({});
  const [enriching, setEnriching] = useState(false);
  const [moving, setMoving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | SavedLookupState>('all');
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

  // «Abrir» in the data sheet lands here with ?q=<name>: the search starts with it, so that contact is the one in view.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('q')?.trim();
    if (requested) setSearchTerm(requested.slice(0, 120));
  }, []);

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
        toast({ title: 'Eliminado', description: 'Se quitó el contacto de «Por completar».' });
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
      'Fuente',
      'Encontrado por',
      'Correo buscado',
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
      l.sourceProvider || '',
      l.foundBy?.name || '',
      SAVED_LOOKUP_LABELS[savedLookupState(l)],
    ]));

    const csv = toCsv(rows, headers);
    downloadCsv(`contactos-por-completar-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const industryOptions = useMemo(() => Array.from(new Set(savedLeads.map((lead) => String(lead.industry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [savedLeads]);

  const filteredLeads = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return savedLeads.filter((lead) => {
      if (showOnlyMyLeads && user && lead.userId !== user.id) return false;
      if (statusFilter !== 'all' && savedLookupState(lead) !== statusFilter) return false;
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
      const haystack = [lead.name, lead.company, lead.title, lead.industry, lead.email, lead.foundBy?.name].map((value) => String(value || '').toLowerCase());
      return haystack.some((value) => value.includes(term));
    });
  }, [savedLeads, showOnlyMyLeads, statusFilter, user, searchTerm, companyFilter, titleFilter, industryFilter, createdFrom, createdTo]);

  const statusCounts = useMemo(() => {
    const counts: Record<SavedLookupState, number> = { not_searched: 0, not_found: 0, with_email: 0 };
    for (const lead of savedLeads) counts[savedLookupState(lead)] += 1;
    return counts;
  }, [savedLeads]);

  const pageLeads = filteredLeads;

  const selectedIds = useMemo(
    () => new Set(Object.keys(selLead).filter((id) => selLead[id])),
    [selLead],
  );

  useEffect(() => {
    const visibleSelection = retainVisibleSelection(selectedIds, filteredLeads.map((lead) => lead.id));
    if (visibleSelection.size === selectedIds.size && Array.from(selectedIds).every((id) => visibleSelection.has(id))) return;
    setSelLead(Object.fromEntries(Array.from(visibleSelection).map((id) => [id, true])));
  }, [filteredLeads, selectedIds]);

  const allPageLeadsChecked = pageLeads.length > 0 && pageLeads.every((lead) => selLead[lead.id]);

  const toggleAllLeads = (checked: boolean) => {
    if (!checked) return setSelLead({});
    setSelLead(Object.fromEntries(pageLeads.map((lead) => [lead.id, true])));
  };

  /** Opens the options dialog (email, phone and their cost) for one contact or the selection. */
  function initiateEnrich(leads: Lead[]) {
    const chosen = leads.filter((lead) => savedLookupState(lead) !== 'with_email');
    if (chosen.length === 0) return;
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
    setStatusFilter('all');
  };

  const hasActiveFilters = Boolean(
    searchTerm || companyFilter || titleFilter || industryFilter !== 'all' || createdFrom || createdTo || showOnlyMyLeads || statusFilter !== 'all',
  );

  const formatSavedDate = (lead: Lead) => formatDate((lead as Lead & { createdAt?: string }).createdAt);

  const finderName = (lead: Lead) => {
    if (lead.foundBy?.name) return lead.foundBy.name;
    if (user && lead.userId === user.id) {
      return String(user.user_metadata?.full_name || user.email || 'Tú');
    }
    return 'Miembro del equipo';
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
        title: 'Revisando tu cupo',
        description: `Este navegador marcaba ${used} de ${limit} búsquedas de hoy (quedaban ${remaining}). El servidor confirma el cupo real.`,
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

      if (process.env.NODE_ENV !== 'production' && j?.debug?.serverLogs && Array.isArray(j.debug.serverLogs)) {
        console.groupCollapsed('[Server Logs] Apollo Enrichment');
        j.debug.serverLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
      }

      if (!r.ok) {
        const snippet = (j as any)?.error || (j as any)?.message || (j as any)?.text || 'Error interno';
        throw new Error(`HTTP ${r.status}: ${String(snippet).slice(0, 200)}`);
      }

      if (j.note && typeof j.note === 'string' && j.note.includes('Quota')) {
        toast({ variant: 'destructive', title: 'Llegaste al límite de hoy', description: j.note });
      }

      const ticket = (j as any)?.ticket || r.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);

      const enrichedCountFromServer = Number(j?.usage?.consumed ?? 0);
      if (enrichedCountFromServer > 0) {
        Quota.incClientQuota('enrich', enrichedCountFromServer);
      }

      // Who got an email or a phone (or is still being looked up) moves; a search that found nothing stays here, marked.
      const outcome = classifyEnrichmentResults(chosen, Array.isArray(j.enriched) ? j.enriched : [], { revealPhone });
      if (outcome.toEnriched.length > 0) await enrichedLeadsStorage.addDedup(outcome.toEnriched);
      const moved = new Set(outcome.removeFromSaved);
      if (moved.size > 0) await supabaseService.removeWhere(l => moved.has(l.id));
      const attemptedAt = new Date().toISOString();
      let markedNotFound = true;
      if (outcome.notFound.length > 0) {
        try {
          await supabaseService.markEmailNotFound(outcome.notFound, attemptedAt);
        } catch {
          markedNotFound = false;
        }
      }
      const notFound = new Set(outcome.notFound);
      setSavedLeads(prev => prev
        .filter(l => !moved.has(l.id))
        .map(l => notFound.has(l.id) ? { ...l, emailEnrichment: { ...(l.emailEnrichment || {}), enriched: false, status: 'not_found' as const, attemptedAt } } : l));
      setSelLead({});

      const withEmail = outcome.toEnriched.filter(e => e.email).length;
      const stillLooking = outcome.toEnriched.filter(e => !e.email && String(e.enrichmentStatus || '').startsWith('pending')).length;
      const phoneOnly = outcome.toEnriched.length - withEmail - stillLooking;
      const parts = [
        withEmail ? `${withEmail} con correo ${withEmail === 1 ? 'pasa' : 'pasan'} a «Por escribir»` : '',
        phoneOnly ? `${phoneOnly} con teléfono ${phoneOnly === 1 ? 'pasa' : 'pasan'} a «Por escribir»` : '',
        stillLooking ? `${stillLooking} ${stillLooking === 1 ? 'sigue' : 'siguen'} en búsqueda y ${stillLooking === 1 ? 'aparecerá' : 'aparecerán'} en «Por escribir»` : '',
        outcome.notFound.length ? `${outcome.notFound.length} sin correo: ${outcome.notFound.length === 1 ? 'queda' : 'quedan'} aquí, ${markedNotFound ? 'marcados' : 'aunque no pudimos marcarlos'}` : '',
      ].filter(Boolean);
      toast({
        title: outcome.toEnriched.length > 0 ? 'Búsqueda de correo lista' : 'No encontramos correos',
        description: parts.length > 0 ? `${parts.join('. ')}.` : 'El proveedor no devolvió resultados para estos contactos.',
        action: outcome.toEnriched.length > 0 ? <ToastAction altText="Ver «Por escribir»" onClick={() => router.push('/saved/leads/enriched')}>Ver</ToastAction> : undefined,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No pudimos buscar los correos', description: e.message || 'Intenta de nuevo en unos minutos.' });
    } finally {
      setEnriching(false);
      setEnrichOptionsOpen(false);
      setLeadsToEnrich([]);
    }
  }

  /** Contacts that already have an email go to «Por escribir» as they are: no search, no credits. */
  async function moveToEnriched(leads: Lead[]) {
    const ready = leads.filter((lead) => savedLookupState(lead) === 'with_email');
    if (ready.length === 0) return;
    setMoving(true);
    try {
      await enrichedLeadsStorage.addDedup(ready.map(savedLeadToEnriched));
      const ids = new Set(ready.map((lead) => lead.id));
      await supabaseService.removeWhere((lead) => ids.has(lead.id));
      setSavedLeads((prev) => prev.filter((lead) => !ids.has(lead.id)));
      setSelLead((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
      toast({
        title: `${ready.length === 1 ? 'Pasó' : 'Pasaron'} a «Por escribir»`,
        description: `${ready.length} ${ready.length === 1 ? 'contacto con correo está' : 'contactos con correo están'} listos para investigar y escribirles.`,
        action: <ToastAction altText="Ver «Por escribir»" onClick={() => router.push('/saved/leads/enriched')}>Ver</ToastAction>,
      });
    } catch (error) {
      console.error('[saved/leads] Move to enriched failed:', error);
      toast({ variant: 'destructive', title: 'No pudimos moverlos', description: 'Siguen en «Por completar». Intenta de nuevo en unos segundos.' });
    } finally {
      setMoving(false);
    }
  }

  const stateBadge = (lead: Lead) => {
    const state = savedLookupState(lead);
    if (state === 'with_email') return <Badge variant="success">{SAVED_LOOKUP_LABELS.with_email}</Badge>;
    if (state === 'not_found') {
      const when = lead.emailEnrichment?.attemptedAt ? formatDate(lead.emailEnrichment.attemptedAt) : '';
      return (
        <span className="inline-flex flex-col items-start gap-0.5">
          <Badge variant="warning">{SAVED_LOOKUP_LABELS.not_found}</Badge>
          {when ? <span className="text-xs text-foreground/70">Buscado el {when}</span> : null}
        </span>
      );
    }
    return <Badge variant="neutral">{SAVED_LOOKUP_LABELS.not_searched}</Badge>;
  };

  const rowAction = (lead: Lead) => {
    const state = savedLookupState(lead);
    if (state === 'with_email') {
      return (
        <Button size="sm" variant="outline" disabled={moving} onClick={() => void moveToEnriched([lead])}>
          Pasar a «Por escribir»
        </Button>
      );
    }
    return (
      <Button size="sm" variant={state === 'not_found' ? 'ghost' : 'outline'} disabled={enriching} onClick={() => initiateEnrich([lead])}>
        <MailSearch className="h-4 w-4" aria-hidden="true" />
        {state === 'not_found' ? 'Buscar de nuevo' : 'Buscar correo'}
      </Button>
    );
  };

  const secondaryActions = (lead: Lead) => (
    <>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSelectedLeadForComments(lead)} aria-label={`Abrir comentarios de ${lead.name || 'este contacto'}`} title="Comentarios">
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setLeadPendingDelete(lead)} aria-label={`Eliminar a ${lead.name || 'este contacto'}`} title="Eliminar">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </>
  );

  const leadIdentity = (lead: Lead) => (
    <div className="flex min-w-0 items-center gap-3">
      {safeAvatarUrl(lead.avatar) ? (
        <Avatar className="h-9 w-9">
          <AvatarImage src={safeAvatarUrl(lead.avatar)} alt="" />
          <AvatarFallback>{(lead.name || 'C').charAt(0)}</AvatarFallback>
        </Avatar>
      ) : (
        <InitialsAvatar name={lead.name} />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium"><LeadName name={lead.name} /></span>
          {lead.linkedinUrl ? (
            <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded text-foreground/70 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Perfil de LinkedIn de ${lead.name || 'este contacto'}`}>
              <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="truncate text-xs text-foreground/70">{lead.title || 'Sin cargo'}</div>
      </div>
    </div>
  );

  const companyCell = (lead: Lead) => (
    <>
      <div className="truncate font-medium">{lead.company || 'Empresa no informada'}</div>
      {lead.companyWebsite ? (
        <a className="mt-0.5 block truncate text-xs text-foreground/70 underline underline-offset-4 hover:text-foreground" href={asHttp(lead.companyWebsite)} target="_blank" rel="noreferrer">
          {displayDomain(lead.companyWebsite)}
        </a>
      ) : lead.industry ? (
        <div className="mt-0.5 truncate text-xs text-foreground/70">{lead.industry}</div>
      ) : null}
    </>
  );

  const selectedLeads = filteredLeads.filter((lead) => selLead[lead.id]);
  const selectedToSearch = selectedLeads.filter((lead) => savedLookupState(lead) !== 'with_email');
  const selectedWithEmail = selectedLeads.filter((lead) => savedLookupState(lead) === 'with_email');
  const STATUS_FILTERS: Array<{ value: 'all' | SavedLookupState; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'not_searched', label: SAVED_LOOKUP_LABELS.not_searched },
    { value: 'not_found', label: SAVED_LOOKUP_LABELS.not_found },
    { value: 'with_email', label: SAVED_LOOKUP_LABELS.with_email },
  ];

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Por completar"
        count={savedLeads.length}
        description="Contactos guardados sin correo. Busca su correo: quien lo recibe pasa a «Por escribir» y quien no, queda aquí marcado."
        actions={(
          <>
            {/* Their own list, from Excel or CSV (Plan 11): one click from where the contacts live. */}
            <Button asChild variant="ghost" className="w-full sm:w-auto">
              <Link href="/leads/import?from=por-completar"><Upload className="h-4 w-4" aria-hidden="true" />Importar lista</Link>
            </Button>
            <Button data-tour="saved-enriched-link" variant="outline" className="w-full sm:w-auto" onClick={() => router.push('/saved/leads/enriched')}>
              Ir a «Por escribir»
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado del correo">
        {STATUS_FILTERS.map((option) => {
          const active = statusFilter === option.value;
          const count = option.value === 'all' ? savedLeads.length : statusCounts[option.value];
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(option.value)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/70 bg-card text-foreground/70 hover:text-foreground',
              )}
            >
              {option.label}
              <span className="tabular-nums text-foreground/70">{count}</span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_18px_50px_-44px_rgba(15,23,42,0.28)]">
        <CardContent className="p-0">
          <div className="space-y-3 border-b border-border/60 bg-muted/10 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" aria-hidden="true" />
                <Input
                  className="h-10 rounded-full border-border/70 bg-background/90 pl-10"
                  placeholder="Buscar por nombre, empresa, cargo o correo"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Buscar en «Por completar»"
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
                      <ListFilter className="h-4 w-4" aria-hidden="true" />
                      Filtros
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
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
                  <Download className="h-4 w-4" aria-hidden="true" />
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
                    <Label htmlFor="saved-industry-filter">Industria</Label>
                    <Select value={industryFilter} onValueChange={setIndustryFilter}>
                      <SelectTrigger id="saved-industry-filter"><SelectValue placeholder="Todas" /></SelectTrigger>
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

            <p className="text-xs text-foreground/70" role="status" aria-live="polite">
              {filteredLeads.length} de {savedLeads.length} contactos
            </p>
          </div>

          {/* The tour points here: on a phone the table is hidden and the cards show instead. */}
          <div className="p-4 sm:p-5" data-tour="saved-list">
            {loadError ? (
              <Alert variant="destructive" className="rounded-2xl">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>No pudimos mostrar la lista ahora</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{loadError}</span>
                  <Button variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>Reintentar</Button>
                </AlertDescription>
              </Alert>
            ) : loadingLeads ? (
              <div className="space-y-2" aria-busy="true" aria-label="Cargando contactos">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-3 w-56 max-w-full" /></div>
                    <Skeleton className="hidden h-8 w-28 sm:block" />
                  </div>
                ))}
              </div>
            ) : pageLeads.length === 0 ? (
              <EmptyState
                icon={savedLeads.length === 0 ? UserSearch : Search}
                headingLevel="p"
                title={savedLeads.length === 0 ? 'Aún no tienes contactos por completar' : 'No hay contactos con esos filtros'}
                description={savedLeads.length === 0
                  ? 'Guarda prospectos desde «Buscar prospectos». Los que aún no tienen correo esperan aquí hasta que lo busques.'
                  : 'Prueba quitar algún filtro para volver a ver tus contactos.'}
                action={savedLeads.length === 0
                  ? <Button size="sm" onClick={() => router.push('/search')}>Buscar prospectos</Button>
                  : <Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
              />
            ) : (
              <>
                <ul className="space-y-2 md:hidden" aria-label="Contactos por completar">
                  {pageLeads.map((lead) => (
                    <li key={lead.id} className={cn('rounded-xl border border-border/60 bg-card p-3', selLead[lead.id] && 'border-primary/50 bg-primary/5')}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          className="mt-2.5"
                          checked={!!selLead[lead.id]}
                          onCheckedChange={(value) => setSelLead((prev) => ({ ...prev, [lead.id]: Boolean(value) }))}
                          aria-label={`Seleccionar a ${lead.name || 'este contacto'}`}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            {leadIdentity(lead)}
                            {stateBadge(lead)}
                          </div>
                          <div className="text-sm">{companyCell(lead)}</div>
                          <div className="flex flex-wrap items-center gap-1">
                            {rowAction(lead)}
                            <span className="ml-auto flex">{secondaryActions(lead)}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-background/60 md:block">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allPageLeadsChecked}
                            onCheckedChange={(value) => toggleAllLeads(Boolean(value))}
                            aria-label="Seleccionar todos los contactos visibles"
                          />
                        </TableHead>
                        <TableHead>Contacto</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead>Correo</TableHead>
                        <TableHead className="hidden lg:table-cell">Encontrado por</TableHead>
                        <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageLeads.map((lead) => (
                        <TableRow key={lead.id} data-state={selLead[lead.id] ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={!!selLead[lead.id]}
                              onCheckedChange={(value) => setSelLead((prev) => ({ ...prev, [lead.id]: Boolean(value) }))}
                              aria-label={`Seleccionar a ${lead.name || 'este contacto'}`}
                            />
                          </TableCell>
                          <TableCell className="max-w-[280px]">{leadIdentity(lead)}</TableCell>
                          <TableCell className="max-w-[220px]">{companyCell(lead)}</TableCell>
                          <TableCell>{stateBadge(lead)}</TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <div className="max-w-[180px] truncate text-sm font-medium">{finderName(lead)}</div>
                            <div className="mt-0.5 text-xs text-foreground/70">{formatSavedDate(lead)}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {rowAction(lead)}
                              {secondaryActions(lead)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedLeads.length > 0 ? (
        <ActionBar
          ariaLabel="Acciones con los contactos seleccionados"
          label={`${selectedLeads.length} ${selectedLeads.length === 1 ? 'contacto seleccionado' : 'contactos seleccionados'}`}
          hint={[
            selectedToSearch.length ? `${selectedToSearch.length} sin correo: buscarlo usa ${selectedToSearch.length * APOLLO_EMAIL_ENRICHMENT_CREDITS} ${selectedToSearch.length * APOLLO_EMAIL_ENRICHMENT_CREDITS === 1 ? 'crédito' : 'créditos'}` : '',
            selectedWithEmail.length ? `${selectedWithEmail.length} con correo ${selectedWithEmail.length === 1 ? 'pasa' : 'pasan'} sin costo` : '',
          ].filter(Boolean).join(' · ')}
        >
          <Button type="button" variant="ghost" onClick={() => setSelLead({})}>Quitar selección</Button>
          {selectedWithEmail.length > 0 ? (
            <Button type="button" variant="outline" disabled={moving} onClick={() => void moveToEnriched(selectedWithEmail)}>
              Pasar {selectedWithEmail.length} a «Por escribir»
            </Button>
          ) : null}
          {selectedToSearch.length > 0 ? (
            <Button type="button" disabled={enriching} onClick={() => initiateEnrich(selectedToSearch)}>
              <MailSearch className="h-4 w-4" aria-hidden="true" />
              {enriching ? 'Buscando correos…' : `Buscar correo (${selectedToSearch.length})`}
            </Button>
          ) : null}
        </ActionBar>
      ) : null}

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
            <AlertDialogTitle>Eliminar contacto guardado</AlertDialogTitle>
            <AlertDialogDescription>
              Quitaremos a {leadPendingDelete?.name || 'este contacto'} de «Por completar». No se enviará ningún correo ni cambiarán tus contactos de «Por escribir».
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
