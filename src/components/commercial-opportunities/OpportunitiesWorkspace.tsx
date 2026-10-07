'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Briefcase, Building2, ChevronDown, Copy, ExternalLink, Factory, Gavel, KeyRound, Landmark, Loader2, Pencil, RotateCcw, Search, Sparkles, Star, Upload, Users, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { MercadoPublicoTicketCard, TicketGuide } from '@/components/commercial-opportunities/MercadoPublicoTicket';
import { HiringSearchDialog, type HiringSearchChoice } from '@/components/commercial-opportunities/HiringSearchDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { DECISION_MAKER_TITLES } from '@/lib/commercial-opportunities/pilot';
import type { HiringProfileSuggestion } from '@/lib/commercial-opportunities/profile-suggestion';
import type { HiringOpportunityData, OpportunityStatus, ProjectOpportunityData, TenderOpportunityData } from '@/lib/commercial-opportunities/records';
import { SEIA_SECTORS } from '@/lib/commercial-opportunities/projects';
import { DEFAULT_SCHEDULE, WEEK_DAYS, describeSchedule, type OpportunitySchedule } from '@/lib/commercial-opportunities/schedule';
import { ticketNeedsAction, type TicketStatus } from '@/lib/commercial-opportunities/ticket';
import {
  FILTER_LABELS, OPPORTUNITIES_SEEN_KEY, closesIn, filterOpportunities, formatClp, formatDay, formatUsd, isNewSince, lastSearch, opportunitiesVisit, parseList, relativeTime, seiaReminderDays, sourceLabel, statusCounts,
  type OpportunityFilter,
} from '@/lib/commercial-opportunities/view';
import { companySearchHref } from '@/lib/search/company-prefill';
import { cn } from '@/lib/utils';

type Profile = {
  id: string; name: string; offer: string; roles: string[]; regions: string[]; minAds: number; keywords: string[]; unspscCodes: string[];
  sectors: string[]; minInvestmentUsd: number | null; updatedAt: string;
};
type PlanSource = { source: 'jsearch' | 'linkedin'; label: string; enabled: boolean; requests: number; estimateUsd: number; missing: string | null };
type Opportunity = {
  id: string; company: string; domain: string | null; linkedinUrl: string | null; region: string | null; url: string | null; score: number;
  reasons: string[]; status: OpportunityStatus; mine: boolean; ads: number; firstSeenAt: string; lastSeenAt: string; data: HiringOpportunityData;
};
type Run = { id: string; source: string; status: string; startedAt: string; finishedAt: string | null; fetched: number; created: number; updated: number; costUsd: number; error: string | null };
type TenderOpportunity = {
  id: string; kind: 'tender' | 'compra_agil'; title: string; buyer: string | null; region: string | null; amount: number | null; currency: string | null;
  deadlineAt: string | null; publishedAt: string | null; url: string | null; score: number; reasons: string[]; status: OpportunityStatus; mine: boolean;
  firstSeenAt: string; data: TenderOpportunityData;
};
type ProjectOpportunity = {
  id: string; title: string; owner: string | null; region: string | null; investmentUsd: number | null; presentedAt: string | null; url: string | null;
  score: number; reasons: string[]; status: OpportunityStatus; mine: boolean; firstSeenAt: string; data: ProjectOpportunityData;
};
/** What «Qué buscamos» holds before it is saved: a saved profile, or the suggestion «Define qué buscas» starts from. */
type ProfileDraft = Pick<Profile, 'name' | 'offer' | 'roles' | 'regions' | 'minAds' | 'keywords' | 'unspscCodes' | 'sectors' | 'minInvestmentUsd'>;
type Plan = { sources: PlanSource[]; estimateUsd: number; queries: string[]; left: number };
/** What «Perfil» says today (Plan 15): the offer the search uses and the regions of the ideal customer. */
type Perfil = { offer: string | null; regions: string[] };
type Overview = {
  /** Null until the organization saves «Define qué buscas» (Plan 10): opening the page creates nothing. */
  profile: Profile | null; suggestion?: HiringProfileSuggestion; perfil: Perfil;
  /** What the person marked «Me interesa» (Plan 15). */
  mine: MyOpportunity[];
  /** When the search runs by itself (Plan 15); `available` once its columns exist. Absent without a profile. */
  schedule?: Schedule;
  plan: Plan; month: { spentUsd: number; capUsd: number };
  tenderSearch: { ticket: boolean; ticketStatus?: TicketStatus; keywords: string[]; unspscCodes: string[] };
  opportunities: Opportunity[]; tenders: TenderOpportunity[]; projects: ProjectOpportunity[]; runs: Run[];
};
/** The page once there is a profile: every tab reads it. */
type ReadyOverview = Overview & { profile: Profile };
const hasProfile = (overview: Overview | null): overview is ReadyOverview => Boolean(overview?.profile);
const EMPTY_DRAFT: ProfileDraft = { name: 'Qué buscamos', offer: '', roles: [], regions: [], minAds: 5, keywords: [], unspscCodes: [], sectors: [], minInvestmentUsd: null };
type Tab = 'hiring' | 'tenders' | 'projects' | 'mine';
type Schedule = OpportunitySchedule & { available: boolean };
/** What the person marked «Me interesa», of every kind (Plan 15). */
type MyOpportunity = {
  id: string; kind: 'hiring' | 'tender' | 'compra_agil' | 'project'; title: string; who: string | null; domain: string | null; region: string | null;
  amount: number | null; currency: string | null; deadlineAt: string | null; url: string | null; score: number; reasons: string[]; status: OpportunityStatus;
  ads: number; firstSeenAt: string; markedAt: string; data: Record<string, unknown>;
};
type ProjectResult = { status: 'done'; read: number; skipped: number; matched: number; created: number };
type HiringResult =
  | { status: 'done' | 'partial' | 'failed'; fetched: number; qualifying: number; newQualifying: number; costUsd: number; sources: Array<{ source: string; error: string | null }> }
  | { status: 'capped'; message: string };
type TenderResult = { status: 'done' | 'partial' | 'failed'; found: number; matched: number; created: number; screened?: number; sources: Array<{ source: string; error: string | null }> };
const TAB_SOURCES: Record<Tab, string[]> = { hiring: ['jsearch', 'linkedin'], tenders: ['mercado_publico', 'compra_agil'], projects: ['seia'], mine: [] };
const SEIA_MAP_URL = 'https://sig.sea.gob.cl/mapadeproyectos/';

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || 'No pudimos completar la acción. Intenta de nuevo.');
  return data as T;
}

const FILTERS: OpportunityFilter[] = ['new', 'interested', 'dismissed', 'all'];

export function OpportunitiesWorkspace() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<OpportunityFilter>('new');
  const [query, setQuery] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('hiring');
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setOverview(await readJson<Overview>(await fetch('/api/commercial-opportunities', { cache: 'no-store' })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos cargar las oportunidades.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // «Nueva»: what appeared since the previous visit, kept in this browser (Plan 15). Without storage, the last two days.
  const [newSince, setNewSince] = useState<string | null>(null);
  useEffect(() => {
    let stored: unknown = null;
    try { stored = JSON.parse(window.localStorage.getItem(OPPORTUNITIES_SEEN_KEY) || 'null'); } catch { /* no storage */ }
    const visit = opportunitiesVisit(stored);
    setNewSince(visit.newSince);
    try { window.localStorage.setItem(OPPORTUNITIES_SEEN_KEY, JSON.stringify(visit.next)); } catch { /* no storage */ }
  }, []);
  // The person's own Mercado Público ticket changed (saved, replaced or removed): tenders follow it without reloading.
  const updateTicket = (status: TicketStatus) => setOverview(current => current && {
    ...current, tenderSearch: { ...current.tenderSearch, ticketStatus: status, ticket: status.connected || status.shared },
  });

  const runSearch = async (kind: Tab, choice?: HiringSearchChoice) => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const response = await fetch('/api/commercial-opportunities/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...(choice || {}) }),
      });
      if (kind === 'tenders') {
        const result = await readJson<TenderResult>(response);
        const failed = result.sources.filter(source => source.error).map(source => sourceLabel(source.source));
        toast({
          title: result.status === 'failed' ? 'No se pudo consultar las fuentes' : `${result.status === 'partial' ? 'Búsqueda parcial: ' : ''}${result.matched} ${result.matched === 1 ? 'licitación abierta calza' : 'licitaciones abiertas calzan'}${result.created ? ` (${result.created} nuevas)` : ''}`,
          description: result.status === 'failed' ? 'La búsqueda falló; no significa que no existan licitaciones. Revisa los errores de cada fuente.'
            : `${result.found} abiertas en Mercado Público y Compra Ágil${result.screened ? `; la IA leyó ${result.screened} y dejó las que sirven a lo que vendes` : ''}${failed.length ? ` · con problemas en ${failed.join(' y ')}` : ''}.`,
          variant: result.status === 'failed' ? 'destructive' : 'default',
        });
      } else {
        const result = await readJson<HiringResult>(response);
        if (result.status === 'capped') toast({ title: 'No se buscó: tope mensual', description: result.message, variant: 'destructive' });
        else {
          const failed = result.sources.filter(source => source.error).map(source => sourceLabel(source.source));
          toast({
            title: result.status === 'failed' ? 'No se pudo consultar las fuentes' : `${result.status === 'partial' ? 'Búsqueda parcial: ' : ''}${result.qualifying} ${result.qualifying === 1 ? 'empresa contratando' : 'empresas contratando'}${result.newQualifying ? ` (${result.newQualifying} nuevas)` : ''}`,
            description: result.status === 'failed' ? `La búsqueda falló; no confirma que no haya empresas contratando. Costo estimado o reservado: ${formatUsd(result.costUsd)}. Revisa el estado de las fuentes.` : `${result.fetched} avisos revisados · costo estimado ${formatUsd(result.costUsd)}${failed.length ? ` · con problemas en ${failed.join(' y ')}` : ''}.`,
            variant: result.status === 'failed' ? 'destructive' : 'default',
          });
        }
      }
    } catch (failure) {
      toast({ title: 'No se pudo buscar', description: failure instanceof Error ? failure.message : undefined, variant: 'destructive' });
    } finally {
      setRunning(false);
      void load();
    }
  };

  const uploadProjects = async (file: File) => {
    setRunning(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const result = await readJson<ProjectResult>(await fetch('/api/commercial-opportunities/projects', { method: 'POST', body: form }));
      toast({
        title: `${result.matched} ${result.matched === 1 ? 'proyecto calza' : 'proyectos calzan'}${result.created ? ` (${result.created} nuevos)` : ''}`,
        description: `${result.read} proyectos leídos del archivo${result.skipped ? `, ${result.skipped} filas sin nombre` : ''}. El archivo no se guarda.`,
      });
    } catch (failure) {
      toast({ title: 'No se pudo leer el archivo', description: failure instanceof Error ? failure.message : undefined, variant: 'destructive' });
    } finally {
      setRunning(false);
      void load();
    }
  };

  const changeStatus = async (item: { id: string; status: OpportunityStatus }, status: OpportunityStatus) => {
    if (!overview) return;
    const previous = item.status;
    const patch = (current: Overview, value: OpportunityStatus) => ({
      ...current,
      opportunities: current.opportunities.map(row => row.id === item.id ? { ...row, status: value, mine: value === 'interested' } : row),
      tenders: current.tenders.map(row => row.id === item.id ? { ...row, status: value, mine: value === 'interested' } : row),
      projects: current.projects.map(row => row.id === item.id ? { ...row, status: value, mine: value === 'interested' } : row),
      mine: value === 'interested' || value === 'converted' ? current.mine : current.mine.filter(row => row.id !== item.id),
    });
    setBusy(current => new Set(current).add(item.id));
    setOverview(patch(overview, status));
    try {
      await readJson(await fetch(`/api/commercial-opportunities/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
      // «Mis oportunidades» follows what the person marks or unmarks.
      if (status === 'interested' || previous === 'interested' || previous === 'converted') void load();
    } catch (failure) {
      setOverview(current => current && patch(current, previous));
      toast({ title: 'No se guardó el cambio', description: failure instanceof Error ? failure.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(current => { const next = new Set(current); next.delete(item.id); return next; });
    }
  };

  // The tenders are filtered by their title and buyer, as the companies are by their name.
  const tenderItems = useMemo(() => (overview?.tenders || []).map(item => ({ ...item, company: [item.title, item.buyer].filter(Boolean).join(' · ') })), [overview]);
  const projectItems = useMemo(() => (overview?.projects || []).map(item => ({ ...item, company: [item.title, item.owner].filter(Boolean).join(' · ') })), [overview]);
  const counts = useMemo(() => statusCounts(tab === 'hiring' ? overview?.opportunities || [] : tab === 'tenders' ? tenderItems : projectItems),
    [overview, tab, tenderItems, projectItems]);
  const visible = useMemo(() => filterOpportunities(overview?.opportunities || [], filter, query), [overview, filter, query]);
  const visibleTenders = useMemo(() => filterOpportunities(tenderItems, filter, query), [tenderItems, filter, query]);
  const visibleProjects = useMemo(() => filterOpportunities(projectItems, filter, query), [projectItems, filter, query]);
  const fileInput = useRef<HTMLInputElement>(null);
  // The roles are chosen in the dialog (Plan 15): it opens whenever a source of job ads is connected.
  const hiringDisabled = running || !overview || overview.plan.sources.every(source => Boolean(source.missing));
  // Without words yet, the search generates them from the offer in «Perfil».
  const tendersDisabled = running || !overview || !overview.tenderSearch.ticket
    || (!overview.tenderSearch.keywords.length && !overview.tenderSearch.unspscCodes.length && !overview.perfil?.offer);
  const searchDisabled = tab === 'hiring' ? hiringDisabled : tab === 'tenders' ? tendersDisabled : running || !overview;
  const newCount = (items: Array<{ firstSeenAt: string }>) => items.filter(item => isNewSince(item.firstSeenAt, newSince)).length;
  const visibleMine = useMemo(() => {
    const wanted = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    return (overview?.mine || []).filter(item => !wanted || [item.title, item.who].filter(Boolean).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(wanted));
  }, [overview, query]);
  const startSearch = () => (tab === 'hiring' ? setConfirmOpen(true) : tab === 'tenders' ? void runSearch('tenders') : fileInput.current?.click());

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Oportunidades"
        description="Empresas que están contratando para los cargos de tu oferta, licitaciones públicas que calzan con ella y proyectos de inversión por partir, con la evidencia de cada una."
      >
        {/* Without a profile the only action is «Definir búsqueda», in the welcome below. */}
        {(overview && !overview.profile) || tab === 'mine' ? null : (
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)} disabled={!overview}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar búsqueda
            </Button>
            <Button onClick={startSearch} disabled={searchDisabled}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              {running ? (tab === 'projects' ? 'Leyendo…' : 'Buscando…') : tab === 'hiring' ? 'Buscar ahora' : tab === 'tenders' ? 'Buscar licitaciones' : 'Subir archivo del SEIA'}
            </Button>
          </>
        )}
        <input ref={fileInput} type="file" accept=".csv,.xlsx,text/csv" className="hidden" aria-hidden="true" tabIndex={-1}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadProjects(file); }} />
      </PageHeader>

      {error ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No pudimos cargar las oportunidades</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {error}
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); void load(); }}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? <LoadingState /> : overview && !hasProfile(overview) ? (
        <>
          <Welcome overview={overview} onStart={() => setEditOpen(true)} onGuide={() => setGuideOpen(true)} />
          <TicketGuide open={guideOpen} onOpenChange={setGuideOpen} onSaved={updateTicket} />
          <ProfileSheet open={editOpen} onOpenChange={setEditOpen} profile={overview.suggestion || EMPTY_DRAFT} perfil={overview.perfil} firstTime pilot={Boolean(overview.suggestion?.pilot)}
            onSaved={next => {
              setOverview(current => current && { ...current, profile: next.profile, plan: next.plan, schedule: next.schedule });
              void load();
              // «Guardar y buscar»: the search of companies costs money, so it goes through the same dialog as «Buscar ahora».
              if (next.plan.sources.some(source => !source.missing)) setConfirmOpen(true);
            }} />
        </>
      ) : hasProfile(overview) ? (
        <>
          <Tabs value={tab} onValueChange={value => { setTab(value as Tab); setFilter('new'); setQuery(''); }}>
            <TabsList className="mb-4 h-auto flex-wrap">
              <TabsTrigger value="hiring" className="gap-1.5"><Building2 className="h-4 w-4" aria-hidden="true" />Empresas contratando
                <TabCount total={overview.opportunities.length} fresh={newCount(overview.opportunities)} /></TabsTrigger>
              <TabsTrigger value="tenders" className="gap-1.5"><Gavel className="h-4 w-4" aria-hidden="true" />Licitaciones y Compra Ágil
                <TabCount total={overview.tenders.length} fresh={newCount(overview.tenders)} /></TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5"><Factory className="h-4 w-4" aria-hidden="true" />Proyectos de inversión
                <TabCount total={overview.projects.length} fresh={newCount(overview.projects)} /></TabsTrigger>
              <TabsTrigger value="mine" className="gap-1.5"><Star className="h-4 w-4" aria-hidden="true" />Mis oportunidades
                <TabCount total={overview.mine.length} fresh={0} /></TabsTrigger>
            </TabsList>
            <TabsContent value="mine" className="mt-0">
              <MineSection items={visibleMine} total={overview.mine.length} query={query} onQuery={setQuery} busy={busy}
                onRemove={item => changeStatus(item, 'new')} />
            </TabsContent>
            {(['hiring', 'tenders', 'projects'] as Tab[]).map(kind => (
              <TabsContent key={kind} value={kind} className="mt-0">
                {kind === 'hiring' ? <SearchSummary overview={overview} running={running} />
                  : kind === 'tenders' ? (
                    <>
                      {ticketNeedsAction(overview.tenderSearch.ticketStatus) ? (
                        <MercadoPublicoTicketCard status={overview.tenderSearch.ticketStatus} onChange={updateTicket} onOpenGuide={() => setGuideOpen(true)} className="mb-4" />
                      ) : null}
                      <TenderSummary overview={overview} running={running} onTicketChange={updateTicket} onOpenGuide={() => setGuideOpen(true)} />
                    </>
                  )
                    : <ProjectSummary overview={overview} running={running} onUpload={() => fileInput.current?.click()} />}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
                    {FILTERS.map(item => (
                      <Button key={item} size="sm" variant={filter === item ? 'default' : 'outline'} aria-pressed={filter === item} onClick={() => setFilter(item)}
                        className="h-9 rounded-full">
                        {FILTER_LABELS[item]}
                        <span className={cn('ml-1 rounded-full px-1.5 text-xs tabular-nums', filter === item ? 'bg-primary-foreground/20' : 'bg-muted text-foreground/70')}>{counts[item]}</span>
                      </Button>
                    ))}
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={query} onChange={event => setQuery(event.target.value)}
                      placeholder={kind === 'hiring' ? 'Buscar empresa' : kind === 'tenders' ? 'Buscar licitación u organismo' : 'Buscar proyecto o titular'}
                      aria-label={kind === 'hiring' ? 'Buscar empresa' : kind === 'tenders' ? 'Buscar licitación' : 'Buscar proyecto'} className="pl-9" />
                  </div>
                </div>

                <section aria-label={kind === 'hiring' ? 'Empresas contratando' : kind === 'tenders' ? 'Licitaciones y Compra Ágil' : 'Proyectos de inversión'} className="mt-4">
                  {kind === 'hiring' ? (visible.length ? (
                    <ul className="grid gap-4 lg:grid-cols-2">
                      {visible.map(item => (
                        <li key={item.id} className="min-w-0">
                          <OpportunityCard item={item} minAds={overview.profile.minAds} busy={busy.has(item.id)} isNew={isNewSince(item.firstSeenAt, newSince)} onStatus={status => changeStatus(item, status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ListEmpty overview={overview} filter={filter} query={query} searchDisabled={hiringDisabled} onSearch={() => setConfirmOpen(true)} onEdit={() => setEditOpen(true)} />
                  )) : kind === 'projects' ? (visibleProjects.length ? (
                    <ul className="grid gap-4 lg:grid-cols-2">
                      {visibleProjects.map(item => (
                        <li key={item.id} className="min-w-0">
                          <ProjectCard item={item} busy={busy.has(item.id)} isNew={isNewSince(item.firstSeenAt, newSince)} onStatus={status => changeStatus(item, status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ProjectEmpty overview={overview} filter={filter} query={query} disabled={running} onUpload={() => fileInput.current?.click()} />
                  )) : (visibleTenders.length ? (
                    <ul className="grid gap-4 lg:grid-cols-2">
                      {visibleTenders.map(item => (
                        <li key={item.id} className="min-w-0">
                          <TenderCard item={item} busy={busy.has(item.id)} isNew={isNewSince(item.firstSeenAt, newSince)} onStatus={status => changeStatus(item, status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <TenderEmpty overview={overview} filter={filter} query={query} searchDisabled={tendersDisabled} onSearch={() => void runSearch('tenders')} onEdit={() => setEditOpen(true)}
                      onGuide={() => setGuideOpen(true)} />
                  ))}
                </section>
              </TabsContent>
            ))}
          </Tabs>

          <HiringSearchDialog open={confirmOpen} onOpenChange={setConfirmOpen} initialRoles={overview.profile.roles} initialRegions={overview.profile.regions}
            month={overview.month} onConfirm={choice => void runSearch('hiring', choice)} />
          <TicketGuide open={guideOpen} onOpenChange={setGuideOpen} onSaved={updateTicket} />
          <ProfileSheet open={editOpen} onOpenChange={setEditOpen} profile={overview.profile} perfil={overview.perfil} schedule={overview.schedule}
            onSaved={next => { setOverview(current => current && { ...current, profile: next.profile, plan: next.plan, schedule: next.schedule }); void load(); }} />
        </>
      ) : null}
      <span className="sr-only" aria-live="polite">{running ? (tab === 'hiring' ? 'Buscando empresas que están contratando. Puede tardar hasta 2 minutos.'
        : tab === 'tenders' ? 'Buscando licitaciones y Compra Ágil.' : 'Leyendo el archivo del SEIA.') : ''}</span>
    </div>
  );
}

/**
 * The page before the organization says what it looks for (Plan 10): what each source brings and one action, «Definir
 * búsqueda». Tenders also need the person's own ticket, so its guide is one click away when it is missing.
 */
function Welcome({ overview, onStart, onGuide }: { overview: Overview; onStart: () => void; onGuide: () => void }) {
  const needsTicket = ticketNeedsAction(overview.tenderSearch.ticketStatus);
  const sources = [
    { icon: Building2, title: 'Empresas contratando', body: 'Las que publican avisos para los cargos que cubres, con la evidencia de cada aviso.' },
    { icon: Gavel, title: 'Licitaciones y Compra Ágil', body: 'Todas las compras públicas abiertas, y la IA deja las que sirven a lo que vendes. Con tu ticket gratuito de Mercado Público.' },
    { icon: Factory, title: 'Proyectos de inversión', body: 'Proyectos del SEIA por partir, con la empresa titular. Subes el archivo una vez al mes.' },
  ];
  const origin = overview.suggestion?.pilot ? 'Parte con valores sugeridos para tu organización, que revisas antes de guardar.'
    : overview.perfil?.offer ? 'Lo que vendes sale de tu Perfil.' : 'Antes, completa en Perfil qué vendes: de ahí salen las palabras para licitaciones.';
  return (
    <section aria-labelledby="opportunities-welcome-title" className="rounded-xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <h2 id="opportunities-welcome-title" className="text-lg font-semibold text-foreground">Define qué buscas</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Tomamos lo que vendes de tu Perfil y con eso armamos la búsqueda: las palabras para licitaciones y los sectores de proyectos se generan solos. Tú eliges los cargos y las regiones cuando buscas.
      </p>
      <ul className="mt-5 grid gap-3 md:grid-cols-3">
        {sources.map(source => (
          <li key={source.title} className="rounded-lg border border-border/60 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground"><source.icon className="h-4 w-4 text-primary" aria-hidden="true" />{source.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{source.body}</p>
            {source.icon === Gavel && needsTicket ? (
              <button type="button" onClick={onGuide}
                className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />Cómo conseguir tu ticket
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button onClick={onStart}><Search className="h-4 w-4" aria-hidden="true" />Definir búsqueda</Button>
        <p className="text-xs text-muted-foreground">{origin} Nada se guarda hasta que lo confirmes.</p>
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Cargando oportunidades">
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="mt-6 flex gap-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-9 w-28 rounded-full" />)}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-56 w-full rounded-xl" />)}</div>
    </div>
  );
}

function SearchSummary({ overview, running }: { overview: ReadyOverview; running: boolean }) {
  const { profile, plan, month } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.hiring.includes(run.source)));
  const missing = plan.sources.filter(source => !source.enabled && source.missing);
  const spentShare = month.capUsd > 0 ? Math.min(100, (month.spentUsd / month.capUsd) * 100) : 100;
  return (
    <section aria-label="Qué buscamos" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Búsqueda programada · {describeSchedule(overview.schedule ?? DEFAULT_SCHEDULE)}</p>
        <OfferFromPerfil offer={overview.perfil?.offer || profile.offer} />
        {profile.roles.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Cargos de la búsqueda diaria">
            {profile.roles.slice(0, 8).map(role => <li key={role} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{role}</li>)}
            {profile.roles.length > 8 ? <li className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/70">+{profile.roles.length - 8} más</li> : null}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Sin cargos guardados: elígelos al pulsar «Buscar ahora».</p>}
        <p className="text-xs text-muted-foreground">
          {profile.minAds} o más avisos en 30 días · {profile.regions.length ? profile.regions.join(', ') : 'todo Chile'} · con otras formas de escribir cada cargo
        </p>
      </div>
      <div className="space-y-3 border-t border-border/60 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Última búsqueda</p>
          {running ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Buscando… puede tardar hasta 2 minutos</p>
          ) : last ? (
            <p className="mt-0.5 text-sm text-foreground">
              {relativeTime(last.at)} · {last.status === 'skipped' ? 'no se buscó (tope mensual)' : last.status === 'failed' ? 'falló' : `${last.fetched} avisos`}
              {last.status === 'partial' ? ' · búsqueda incompleta' : ''}
            </p>
          ) : <p className="mt-0.5 text-sm text-foreground">Aún no buscas</p>}
          {!running && last?.errors.length ? <ul className="mt-2 space-y-1 break-words text-xs text-cw-warning" aria-label="Problemas de las fuentes">{last.errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
        </div>
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-muted-foreground">Gasto estimado del mes</span>
            <span className="tabular-nums text-foreground">{formatUsd(month.spentUsd)} de {formatUsd(month.capUsd)}</span>
          </div>
          <Progress value={spentShare} className="mt-1.5 h-1.5" aria-label={`Gasto del mes: ${formatUsd(month.spentUsd)} de ${formatUsd(month.capUsd)}`} />
        </div>
        {missing.length ? (
          <p className="rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-xs text-cw-warning">
            {missing.map(source => source.label).join(' y ')} {missing.length === 1 ? 'no está conectado' : 'no están conectados'}. Pide a quien administra ANTON.IA que {missing.length === 1 ? 'lo active' : 'los active'}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** What the person sells, read from «Perfil» (Plan 15): shown, never edited here. */
function OfferFromPerfil({ offer }: { offer: string | null | undefined }) {
  if (!offer) {
    return (
      <p className="rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-xs text-cw-warning">
        Tu Perfil no dice qué vendes. <Link href="/profile" className="font-medium underline underline-offset-4">Complétalo</Link> para generar las palabras de licitaciones.
      </p>
    );
  }
  return (
    <p className="text-sm text-foreground">
      <span className="line-clamp-2">{offer}</span>
      <Link href="/profile" className="mt-0.5 inline-block rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        De tu Perfil · editar
      </Link>
    </p>
  );
}

/** «Nueva»: appeared since the person's previous visit (Plan 15). */
function NewBadge() {
  return <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground" title="Apareció desde tu última visita">Nueva</span>;
}

/** The count of a tab, with how many are new since the last visit. */
function TabCount({ total, fresh }: { total: number; fresh: number }) {
  return (
    <>
      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground/70">{total}</span>
      {fresh ? <span className="rounded-full bg-primary px-1.5 text-xs font-medium tabular-nums text-primary-foreground">{fresh} {fresh === 1 ? 'nueva' : 'nuevas'}</span> : null}
    </>
  );
}

const MINE_KIND: Record<MyOpportunity['kind'], string> = {
  hiring: 'Empresa contratando', tender: 'Licitación', compra_agil: 'Compra Ágil', project: 'Proyecto de inversión',
};

/**
 * «Mis oportunidades» (Plan 15): everything the person marked «Me interesa», newest mark first, in one place. A closed tender
 * or a company out of the 30-day window stays, marked as such, until the person takes it out.
 */
function MineSection({ items, total, query, onQuery, busy, onRemove }: {
  items: MyOpportunity[]; total: number; query: string; onQuery: (value: string) => void; busy: Set<string>; onRemove: (item: MyOpportunity) => void;
}) {
  if (!total) {
    return <EmptyState icon={Star} headingLevel="h3" title="Aún no marcas ninguna"
      description="Usa «Me interesa» en una empresa, licitación o proyecto: queda aquí, a tu nombre, aunque cierre o salga de la búsqueda." />;
  }
  return (
    <section aria-label="Mis oportunidades" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{total} {total === 1 ? 'oportunidad marcada' : 'oportunidades marcadas'} por ti, la última primero.</p>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={event => onQuery(event.target.value)} placeholder="Buscar en tus oportunidades" aria-label="Buscar en tus oportunidades" className="pl-9" />
        </div>
      </div>
      {items.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map(item => <li key={item.id} className="min-w-0"><MyOpportunityCard item={item} busy={busy.has(item.id)} onRemove={() => onRemove(item)} /></li>)}
        </ul>
      ) : <EmptyState icon={Search} headingLevel="h3" title="Ninguna con ese texto" description="Prueba con otra parte del nombre." />}
    </section>
  );
}

function MyOpportunityCard({ item, busy, onRemove }: { item: MyOpportunity; busy: boolean; onRemove: () => void }) {
  const { toast } = useToast();
  const closed = Boolean(item.deadlineAt && Date.parse(item.deadlineAt) < Date.now());
  const ai = item.data.ai && typeof item.data.ai === 'object' ? (item.data.ai as { reason?: unknown }).reason : null;
  const reason = typeof ai === 'string' && ai ? ai : item.reasons[0] || null;
  const code = typeof item.data.code === 'string' ? item.data.code : null;
  const investment = typeof item.data.investmentMusd === 'number' ? item.data.investmentMusd : null;
  const detail = item.kind === 'hiring' ? `${item.ads} avisos en 30 días`
    : item.kind === 'project' ? (investment !== null ? `Inversión de US$${investment.toLocaleString('es-CL')} millones` : 'Inversión no informada')
      : `${formatClp(item.amount, item.currency)} · ${closed ? 'cerrada' : closesIn(item.deadlineAt)}`;
  const copyCode = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); toast({ title: 'Código copiado', description: `${code}: búscalo en Mercado Público.` }); }
    catch { toast({ title: 'No se pudo copiar', description: code }); }
  };
  return (
    <article className={cn('flex h-full flex-col rounded-xl border border-primary/40 bg-card p-4 shadow-sm', closed && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{MINE_KIND[item.kind]}</span>
            {closed ? <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/70">Cerrada</span> : null}
            <span className="text-muted-foreground">Marcada {relativeTime(item.markedAt)}</span>
          </p>
          <h3 className="line-clamp-2 text-base font-semibold text-foreground">{item.title}</h3>
          {item.who || item.region ? <p className="mt-1 truncate text-xs text-muted-foreground">{[item.who, item.region].filter(Boolean).join(' · ')}</p> : null}
        </div>
        <ScorePill score={item.score} />
      </div>
      <p className="mt-3 text-sm text-foreground">{detail}</p>
      {reason ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{reason}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          <X className="h-4 w-4" aria-hidden="true" />Quitar de mis oportunidades
        </Button>
        {item.kind === 'hiring' ? (
          <Button size="sm" variant="secondary" asChild className="sm:ml-auto">
            <Link href={companySearchHref({ company: item.title, domain: item.domain, titles: DECISION_MAKER_TITLES })}>
              <Users className="h-4 w-4" aria-hidden="true" />Buscar decisores
            </Link>
          </Button>
        ) : item.url ? (
          <Button size="sm" variant="secondary" asChild className="sm:ml-auto">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />{item.kind === 'project' ? 'Ver ficha' : 'Ver en Mercado Público'}<span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </Button>
        ) : code ? (
          <Button size="sm" variant="secondary" className="sm:ml-auto" onClick={() => void copyCode()}>
            <Copy className="h-4 w-4" aria-hidden="true" />Copiar código
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className="flex shrink-0 flex-col items-center rounded-lg bg-primary/10 px-2.5 py-1 text-primary" title="Calce de 0 a 100: avisos, ritmo, cargos de tu oferta, región y tamaño">
      <span className="text-lg font-semibold leading-none tabular-nums">{score}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">calce</span>
    </span>
  );
}

function OpportunityCard({ item, minAds, busy, isNew = false, onStatus }: { item: Opportunity; minAds: number; busy: boolean; isNew?: boolean; onStatus: (status: OpportunityStatus) => void }) {
  const { data } = item;
  const regions = data.regions.slice(0, 2).map(entry => entry.region);
  const interested = item.status === 'interested' || item.status === 'converted';
  const external = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {label}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  );
  return (
    <article className={cn('flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors motion-safe:animate-in motion-safe:fade-in-0',
      interested ? 'border-primary/40' : 'border-border/70', item.status === 'dismissed' && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{item.company}</span>
            {isNew ? <NewBadge /> : null}
          </h3>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.domain ? external(`https://${item.domain}`, item.domain) : null}
            {item.linkedinUrl ? external(item.linkedinUrl, 'LinkedIn') : null}
            {data.industry ? <span>{data.industry}</span> : null}
            {data.size ? <span>{data.size} empleados</span> : null}
          </p>
        </div>
        <ScorePill score={item.score} />
      </div>

      <p className="mt-3 text-sm text-foreground">
        <strong className="font-semibold">{item.ads} avisos</strong> en 30 días
        {data.adsLastWeek ? <>, <strong className="font-semibold">{data.adsLastWeek}</strong> en la última semana</> : null}
        {regions.length ? <> · {regions.join(' y ')}</> : null}
      </p>
      {data.roles.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Cargos que busca">
          {data.roles.slice(0, 5).map(entry => (
            <li key={entry.role} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{entry.role} <span className="text-foreground/70">({entry.ads})</span></li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
          data.isClient ? 'bg-cw-success-soft text-cw-success' : data.isContact ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground/70')}>
          {data.isClient ? 'Ya es cliente' : data.isContact ? 'Ya tienes contactos ahí' : 'Aún no es contacto'}
        </span>
      </p>

      <Collapsible className="mt-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group h-8 px-2 text-xs text-muted-foreground">
            Ver los avisos ({data.evidence.length} de {item.ads})
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-1 divide-y divide-border/60 rounded-lg border border-border/60">
            {data.evidence.map(ad => (
              <li key={`${ad.source}:${ad.title}:${ad.postedAt}`} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{ad.title}</p>
                  <p className="text-muted-foreground">{[ad.location, ad.publisher || sourceLabel(ad.source), formatDay(ad.postedAt)].filter(Boolean).join(' · ')}</p>
                </div>
                {ad.url ? <span className="shrink-0 text-muted-foreground">{external(ad.url, 'Ver aviso')}</span> : null}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {item.status === 'dismissed' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('new')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Recuperar
          </Button>
        ) : (
          <>
            <Button size="sm" variant={interested ? 'default' : 'outline'} aria-pressed={interested} disabled={busy}
              onClick={() => onStatus(interested ? 'new' : 'interested')}>
              <Star className={cn('h-4 w-4', interested && 'fill-current')} aria-hidden="true" />{interested ? 'Te interesa' : 'Me interesa'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('dismissed')}>
              <X className="h-4 w-4" aria-hidden="true" />Descartar
            </Button>
          </>
        )}
        <Button size="sm" variant="secondary" asChild className="sm:ml-auto">
          <Link href={companySearchHref({ company: item.company, domain: item.domain, titles: DECISION_MAKER_TITLES })}>
            <Users className="h-4 w-4" aria-hidden="true" />Buscar decisores
          </Link>
        </Button>
      </div>
      {item.ads < minAds ? <p className="mt-2 text-xs text-muted-foreground">Bajó de {minAds} avisos en la ventana.</p> : null}
    </article>
  );
}

function ListEmpty({ overview, filter, query, searchDisabled, onSearch, onEdit }: {
  overview: ReadyOverview; filter: OpportunityFilter; query: string; searchDisabled: boolean; onSearch: () => void; onEdit: () => void;
}) {
  if (query.trim()) return <EmptyState icon={Search} headingLevel="h3" title="Sin empresas con ese nombre" description="Prueba con otra parte del nombre o cambia de pestaña." />;
  if (filter === 'interested') return <EmptyState icon={Star} headingLevel="h3" title="Aún no marcas ninguna" description="Usa «Me interesa» en las empresas que quieras trabajar: quedan a tu nombre y aparecen aquí." />;
  if (filter === 'dismissed') return <EmptyState icon={X} headingLevel="h3" title="No hay descartadas" description="Las empresas que descartes quedan aquí y las puedes recuperar." />;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.hiring.includes(run.source)));
  if (last?.status === 'failed') return <EmptyState icon={AlertCircle} headingLevel="h3" title="La búsqueda no se pudo completar"
    description="Las fuentes fallaron. Revisa sus errores arriba antes de reintentar; bajar el mínimo de avisos no resuelve una búsqueda fallida."
    action={<Button onClick={onSearch} disabled={searchDisabled}><RotateCcw className="h-4 w-4" aria-hidden="true" />Revisar y reintentar</Button>} />;
  if (last?.status === 'running') return <EmptyState icon={Loader2} headingLevel="h3" title="La búsqueda sigue en curso" description="Esperamos el resultado de las fuentes. Los datos guardados se conservarán." />;
  if (last?.status === 'skipped') return <EmptyState icon={AlertCircle} headingLevel="h3" title="No se buscó: tope mensual" description="El saldo estimado no alcanza para esta búsqueda. No se consultaron las fuentes." />;
  if (!last) {
    return (
      <EmptyState icon={Briefcase} headingLevel="h3" title="Aún no hay empresas"
        description="Busca en Google for Jobs y LinkedIn las empresas que publican avisos para tus cargos. Antes de buscar verás el costo."
        action={<Button onClick={onSearch} disabled={searchDisabled}><Search className="h-4 w-4" aria-hidden="true" />Buscar ahora</Button>} />
    );
  }
  return (
    <EmptyState icon={Briefcase} headingLevel="h3" title={last.status === 'partial' ? 'Búsqueda incompleta, sin empresas para mostrar' : `Ninguna empresa llega a ${overview.profile.minAds} avisos`}
      description={last.status === 'partial' ? 'Solo se consultó parte de las fuentes. Revisa sus errores antes de cambiar los criterios; los resultados están incompletos.' : 'Con lo encontrado en los últimos 30 días, ninguna empresa nueva publica tantos avisos para tus cargos. Puedes sumar cargos o bajar el mínimo.'}
      action={<Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Editar búsqueda</Button>} />
  );
}

function TenderSummary({ overview, running, onTicketChange, onOpenGuide }: {
  overview: ReadyOverview; running: boolean; onTicketChange: (status: TicketStatus) => void; onOpenGuide: () => void;
}) {
  const { tenderSearch, profile } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.tenders.includes(run.source)));
  return (
    <section aria-label="Qué buscamos en licitaciones" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué buscamos en Mercado Público y Compra Ágil</p>
        <p className="text-sm text-foreground">
          Revisamos todas las licitaciones abiertas de Mercado Público y la IA deja solo las que sirven a lo que vendes. En Compra Ágil
          buscamos con estas palabras, generadas de tu Perfil, y la IA filtra igual.
        </p>
        {tenderSearch.keywords.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Palabras">
            {tenderSearch.keywords.slice(0, 10).map(keyword => <li key={keyword} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{keyword}</li>)}
            {tenderSearch.keywords.length > 10 ? <li className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/70">+{tenderSearch.keywords.length - 10} más</li> : null}
          </ul>
        ) : overview.perfil?.offer ? <p className="text-sm text-muted-foreground">Se generan en tu primera búsqueda.</p>
          : <OfferFromPerfil offer={null} />}
        <p className="text-xs text-muted-foreground">
          {tenderSearch.unspscCodes.length ? `Códigos UNSPSC: ${tenderSearch.unspscCodes.join(', ')} · ` : ''}
          Abiertas · Compra Ágil de las últimas dos semanas · {profile.regions.length ? `suman calce ${profile.regions.join(', ')}` : 'todo Chile'}
        </p>
      </div>
      <div className="space-y-3 border-t border-border/60 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Última búsqueda</p>
          {running ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Buscando…</p>
          ) : last ? (
            <p className="mt-0.5 text-sm text-foreground">
              {relativeTime(last.at)} · {last.status === 'failed' ? 'falló' : `${last.fetched} revisadas`}{last.status === 'partial' ? ' · búsqueda incompleta' : ''}
            </p>
          ) : <p className="mt-0.5 text-sm text-foreground">Aún no buscas</p>}
          {!running && last?.errors.length ? <ul className="mt-2 space-y-1 break-words text-xs text-cw-warning" aria-label="Problemas de las fuentes">{last.errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
        </div>
        {/* Without a ticket, the card above the summary asks for it; here only the connected one is shown. */}
        {!ticketNeedsAction(tenderSearch.ticketStatus) ? (
          <MercadoPublicoTicketCard status={tenderSearch.ticketStatus} onChange={onTicketChange} onOpenGuide={onOpenGuide} />
        ) : null}
        <p className="text-xs text-muted-foreground">Sin costo: usa tu ticket de Mercado Público. Se actualiza sola: {describeSchedule(overview.schedule ?? DEFAULT_SCHEDULE).toLowerCase()}.</p>
      </div>
    </section>
  );
}

function TenderCard({ item, busy, isNew = false, onStatus }: { item: TenderOpportunity; busy: boolean; isNew?: boolean; onStatus: (status: OpportunityStatus) => void }) {
  const { toast } = useToast();
  // `data` is stored JSON: a row written before a field existed must not take the whole tab down.
  const keywords = Array.isArray(item.data?.keywords) ? item.data.keywords : [];
  const interested = item.status === 'interested' || item.status === 'converted';
  const isCompraAgil = item.kind === 'compra_agil';
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(item.data.code); toast({ title: 'Código copiado', description: `${item.data.code}: búscalo en Mercado Público.` }); }
    catch { toast({ title: 'No se pudo copiar', description: item.data.code }); }
  };
  return (
    <article className={cn('flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors motion-safe:animate-in motion-safe:fade-in-0',
      interested ? 'border-primary/40' : 'border-border/70', item.status === 'dismissed' && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn('rounded-full px-2 py-0.5 font-medium', isCompraAgil ? 'bg-cw-success-soft text-cw-success' : 'bg-primary/10 text-primary')}>
              {isCompraAgil ? 'Compra Ágil' : 'Licitación'}
            </span>
            {isNew ? <NewBadge /> : null}
            <span className="text-muted-foreground">{item.data.code}</span>
          </p>
          <h3 className="line-clamp-2 text-base font-semibold text-foreground">{item.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{[item.buyer, item.region].filter(Boolean).join(' · ') || 'Organismo no informado'}</span>
          </p>
        </div>
        <ScorePill score={item.score} />
      </div>
      {item.data?.ai?.reason ? (
        <p className="mt-3 flex gap-2 rounded-lg bg-primary/5 px-2.5 py-2 text-sm text-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span><span className="font-medium">{item.data.ai.fit === 'alta' ? 'Muy afín' : 'Afín'}:</span> {item.data.ai.reason}</span>
        </p>
      ) : null}
      <p className="mt-3 text-sm text-foreground">
        <strong className="font-semibold">{formatClp(item.amount, item.currency)}</strong> · {closesIn(item.deadlineAt)}
      </p>
      {keywords.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Palabras que calzan">
          {keywords.slice(0, 4).map(keyword => <li key={keyword} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{keyword}</li>)}
        </ul>
      ) : null}
      {item.data.description ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.data.description}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {item.status === 'dismissed' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('new')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Recuperar
          </Button>
        ) : (
          <>
            <Button size="sm" variant={interested ? 'default' : 'outline'} aria-pressed={interested} disabled={busy}
              onClick={() => onStatus(interested ? 'new' : 'interested')}>
              <Star className={cn('h-4 w-4', interested && 'fill-current')} aria-hidden="true" />{interested ? 'Te interesa' : 'Me interesa'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('dismissed')}>
              <X className="h-4 w-4" aria-hidden="true" />Descartar
            </Button>
          </>
        )}
        {item.url ? (
          <Button size="sm" variant="secondary" asChild className="sm:ml-auto">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />Ver en Mercado Público<span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className="sm:ml-auto" onClick={() => void copyCode()}>
            <Copy className="h-4 w-4" aria-hidden="true" />Copiar código
          </Button>
        )}
      </div>
    </article>
  );
}

function TenderEmpty({ overview, filter, query, searchDisabled, onSearch, onEdit, onGuide }: {
  overview: ReadyOverview; filter: OpportunityFilter; query: string; searchDisabled: boolean; onSearch: () => void; onEdit: () => void; onGuide: () => void;
}) {
  if (query.trim()) return <EmptyState icon={Search} headingLevel="h3" title="Sin licitaciones con ese texto" description="Prueba con otra palabra del nombre o del organismo." />;
  if (filter === 'interested') return <EmptyState icon={Star} headingLevel="h3" title="Aún no marcas ninguna" description="Usa «Me interesa» en las licitaciones que quieras preparar: quedan a tu nombre y aparecen aquí." />;
  if (filter === 'dismissed') return <EmptyState icon={X} headingLevel="h3" title="No hay descartadas" description="Las licitaciones que descartes quedan aquí y las puedes recuperar." />;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.tenders.includes(run.source)));
  if (last?.status === 'failed') return <EmptyState icon={AlertCircle} headingLevel="h3" title="No se pudo consultar las licitaciones"
    description="Las fuentes fallaron. Revisa sus errores arriba; esto no confirma que no existan compras abiertas."
    action={<Button onClick={onSearch} disabled={searchDisabled}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reintentar búsqueda</Button>} />;
  if (last?.status === 'running') return <EmptyState icon={Loader2} headingLevel="h3" title="La búsqueda sigue en curso" description="Esperamos las respuestas de Mercado Público y Compra Ágil." />;
  if (!last && !overview.tenderSearch.ticket) {
    return (
      <EmptyState icon={KeyRound} headingLevel="h3" title="Conecta tu ticket para buscar licitaciones"
        description="Con tu ticket gratuito de Mercado Público revisamos cada mañana todas las compras abiertas y la IA deja las que sirven a lo que vendes."
        action={<Button onClick={onGuide}><KeyRound className="h-4 w-4" aria-hidden="true" />Cómo conseguirlo</Button>} />
    );
  }
  if (!last) {
    return (
      <EmptyState icon={Gavel} headingLevel="h3" title="Aún no hay licitaciones"
        description="Revisamos todas las compras abiertas de Mercado Público y Compra Ágil, y la IA deja las que sirven a lo que vendes."
        action={<Button onClick={onSearch} disabled={searchDisabled}><Search className="h-4 w-4" aria-hidden="true" />Buscar licitaciones</Button>} />
    );
  }
  return (
    <EmptyState icon={Gavel} headingLevel="h3" title={last.status === 'partial' ? 'Búsqueda incompleta, sin licitaciones para mostrar' : 'Ninguna licitación abierta calza'}
      description={last.status === 'partial' ? 'La búsqueda quedó incompleta. Revisa los errores de las fuentes antes de cambiar tus palabras.' : 'Revisamos todas las compras abiertas y ninguna sirve hoy a lo que vendes. Si tu oferta cambió, actualízala en Perfil.'}
      action={<Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Editar búsqueda</Button>} />
  );
}

function ProjectSummary({ overview, running, onUpload }: { overview: ReadyOverview; running: boolean; onUpload: () => void }) {
  const { profile } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.projects.includes(run.source)));
  const sectors = SEIA_SECTORS.filter(sector => profile.sectors.includes(sector.id)).map(sector => sector.label);
  const reminderDays = last ? seiaReminderDays(last.at) : null;
  return (
    <section aria-label="Qué buscamos en el SEIA" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué buscamos en los proyectos del SEIA</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Sectores">
          {(sectors.length ? sectors : ['Todos los sectores']).map(sector => <li key={sector} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{sector}</li>)}
        </ul>
        <p className="text-xs text-muted-foreground">
          En calificación o aprobados, presentados en los últimos dos años
          {profile.minInvestmentUsd ? ` · desde US$ ${(profile.minInvestmentUsd / 1_000_000).toLocaleString('es-CL')} millones` : ''}
          {profile.regions.length ? ` · suman calce ${profile.regions.join(', ')}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">El titular de cada proyecto es la empresa a contactar: construir y operar un proyecto grande pide personal.</p>
      </div>
      <div className="space-y-3 border-t border-border/60 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Último archivo</p>
          {running ? <p className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Leyendo…</p>
            : last ? <p className="mt-0.5 text-sm text-foreground">{relativeTime(last.at)} · {last.status === 'failed' ? 'falló' : `${last.fetched.toLocaleString('es-CL')} proyectos leídos`}</p>
              : <p className="mt-0.5 text-sm text-foreground">Aún no subes uno</p>}
          {!running && reminderDays !== null ? (
            <p className="mt-2 rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-xs text-cw-warning">
              Hace {reminderDays} días que no subes proyectos del SEIA. Descarga el archivo del mes y súbelo para ver los proyectos nuevos.
            </p>
          ) : null}
        </div>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Abre el <a href={SEIA_MAP_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">mapa de proyectos del SEIA<span className="sr-only"> (se abre en otra pestaña)</span></a> y filtra si quieres.</li>
          <li>Exporta el resultado en CSV.</li>
          <li>
            <button type="button" onClick={onUpload} className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Súbelo aquí</button>.
            {' '}Se lee y no se guarda; conviene repetirlo cada mes.
          </li>
        </ol>
      </div>
    </section>
  );
}

function ProjectCard({ item, busy, isNew = false, onStatus }: { item: ProjectOpportunity; busy: boolean; isNew?: boolean; onStatus: (status: OpportunityStatus) => void }) {
  const interested = item.status === 'interested' || item.status === 'converted';
  const sector = SEIA_SECTORS.find(entry => entry.id === item.data.sector)?.label;
  return (
    <article className={cn('flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors motion-safe:animate-in motion-safe:fade-in-0',
      interested ? 'border-primary/40' : 'border-border/70', item.status === 'dismissed' && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            {isNew ? <NewBadge /> : null}
            {item.data.presentation ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{item.data.presentation}</span> : null}
            {item.data.state ? <span className="text-muted-foreground">{item.data.state}</span> : null}
          </p>
          <h3 className="line-clamp-2 text-base font-semibold text-foreground">{item.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{[item.owner || 'Titular no informado', item.region].filter(Boolean).join(' · ')}</span>
          </p>
        </div>
        <ScorePill score={item.score} />
      </div>
      <p className="mt-3 text-sm text-foreground">
        <strong className="font-semibold">
          {typeof item.data.investmentMusd === 'number' ? `US$ ${item.data.investmentMusd.toLocaleString('es-CL', { maximumFractionDigits: 1 })} millones` : 'Inversión no informada'}
        </strong>
        {item.presentedAt ? <> · presentado el {formatDay(item.presentedAt)}</> : null}
      </p>
      {sector || item.data.communes ? <p className="mt-1 text-xs text-muted-foreground">{[sector, item.data.communes].filter(Boolean).join(' · ')}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {item.status === 'dismissed' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('new')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Recuperar
          </Button>
        ) : (
          <>
            <Button size="sm" variant={interested ? 'default' : 'outline'} aria-pressed={interested} disabled={busy} onClick={() => onStatus(interested ? 'new' : 'interested')}>
              <Star className={cn('h-4 w-4', interested && 'fill-current')} aria-hidden="true" />{interested ? 'Te interesa' : 'Me interesa'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('dismissed')}>
              <X className="h-4 w-4" aria-hidden="true" />Descartar
            </Button>
          </>
        )}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {item.url ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />Expediente<span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </Button>
          ) : null}
          {item.owner ? (
            <Button size="sm" variant="secondary" asChild>
              <Link href={companySearchHref({ company: item.owner, titles: DECISION_MAKER_TITLES })}><Users className="h-4 w-4" aria-hidden="true" />Buscar decisores</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ProjectEmpty({ overview, filter, query, disabled, onUpload }: {
  overview: ReadyOverview; filter: OpportunityFilter; query: string; disabled: boolean; onUpload: () => void;
}) {
  if (query.trim()) return <EmptyState icon={Search} headingLevel="h3" title="Sin proyectos con ese texto" description="Prueba con otra palabra del nombre o del titular." />;
  if (filter === 'interested') return <EmptyState icon={Star} headingLevel="h3" title="Aún no marcas ninguno" description="Usa «Me interesa» en los proyectos que quieras seguir: quedan a tu nombre y aparecen aquí." />;
  if (filter === 'dismissed') return <EmptyState icon={X} headingLevel="h3" title="No hay descartados" description="Los proyectos que descartes quedan aquí y los puedes recuperar." />;
  const uploaded = overview.runs.some(run => TAB_SOURCES.projects.includes(run.source));
  return (
    <EmptyState icon={Factory} headingLevel="h3" title={uploaded ? 'Ningún proyecto del archivo calza' : 'Aún no hay proyectos'}
      description={uploaded ? 'Con tus sectores e inversión mínima no quedó ninguno. Ajusta la búsqueda o sube un archivo con más regiones.'
        : 'Exporta en CSV el mapa de proyectos del SEIA y súbelo: verás los proyectos en evaluación o aprobados de tus sectores, con su titular.'}
      action={<Button onClick={onUpload} disabled={disabled}><Upload className="h-4 w-4" aria-hidden="true" />Subir archivo del SEIA</Button>} />
  );
}

function ProfileSheet({ open, onOpenChange, profile, perfil, schedule, firstTime = false, pilot = false, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; profile: ProfileDraft;
  /** What «Perfil» says today (Plan 15): the offer comes from there and is never edited here. */
  perfil: Perfil;
  /** «Define qué buscas»: the first save creates the profile and goes on to search. */
  firstTime?: boolean;
  /** The values come from the pilot's suggestion, to be reviewed before saving. */
  pilot?: boolean;
  /** When the search runs by itself (Plan 15): editable once its columns exist. */
  schedule?: Schedule;
  onSaved: (next: { profile: Profile; plan: Plan; schedule?: Schedule }) => void;
}) {
  const { toast } = useToast();
  const [roles, setRoles] = useState(profile.roles.join('\n'));
  const [regions, setRegions] = useState<string[]>(profile.regions);
  const [minAds, setMinAds] = useState(String(profile.minAds));
  const [keywords, setKeywords] = useState(profile.keywords.join('\n'));
  const [codes, setCodes] = useState(profile.unspscCodes.join(', '));
  const [sectors, setSectors] = useState<string[]>(profile.sectors);
  const [minInvestment, setMinInvestment] = useState(profile.minInvestmentUsd ? String(profile.minInvestmentUsd / 1_000_000) : '');
  const [when, setWhen] = useState<OpportunitySchedule>(schedule ?? DEFAULT_SCHEDULE);
  const [saving, setSaving] = useState<'save' | 'regenerate' | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!open) return;
    setRoles(profile.roles.join('\n')); setRegions(profile.regions); setMinAds(String(profile.minAds));
    setKeywords(profile.keywords.join('\n')); setCodes(profile.unspscCodes.join(', ')); setSectors(profile.sectors);
    setMinInvestment(profile.minInvestmentUsd ? String(profile.minInvestmentUsd / 1_000_000) : ''); setProblem('');
    setWhen(schedule ?? DEFAULT_SCHEDULE);
  }, [open, profile, schedule]);

  const save = async (regenerate = false) => {
    const roleList = parseList(roles);
    const keywordList = parseList(keywords);
    const codeList = parseList(codes).map(code => code.replace(/\s/g, ''));
    const minimum = Number(minAds);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100) return setProblem('El mínimo de avisos va de 1 a 100.');
    if (codeList.some(code => !/^\d{2,8}$/.test(code))) return setProblem('Los códigos UNSPSC son números de 2 a 8 dígitos, separados por coma.');
    if (schedule?.available && !when.days.length) return setProblem('Elige al menos un día para la búsqueda programada.');
    const investment = minInvestment.trim() ? Number(minInvestment.replace(',', '.')) : null;
    if (investment !== null && (!Number.isFinite(investment) || investment < 0)) return setProblem('La inversión mínima es un número de millones de dólares.');
    setSaving(regenerate ? 'regenerate' : 'save');
    setProblem('');
    try {
      const next = await readJson<{ profile: Profile; plan: Plan; schedule?: Schedule }>(await fetch('/api/commercial-opportunities/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, roles: roleList, regions, minAds: minimum, keywords: keywordList, unspscCodes: codeList,
          sectors, minInvestmentUsd: investment === null ? null : Math.round(investment * 1_000_000), ...(regenerate ? { regenerate: true } : {}),
          ...(schedule?.available ? { schedule: { enabled: when.enabled, days: when.days, hour: when.hour } } : {}) }),
      }));
      onSaved(next);
      if (regenerate) {
        setKeywords(next.profile.keywords.join('\n')); setSectors(next.profile.sectors);
        toast({ title: 'Palabras generadas de tu Perfil', description: `${next.profile.keywords.length} palabras para licitaciones y Compra Ágil.` });
        return;
      }
      onOpenChange(false);
      toast({ title: 'Búsqueda guardada', description: firstTime ? 'Desde mañana se busca sola cada mañana con estos criterios.' : 'La búsqueda diaria usa estos cargos y regiones.' });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{firstTime ? 'Define qué buscas' : 'Ajustes de la búsqueda'}</SheetTitle>
          <SheetDescription>
            {pilot ? 'Partimos de valores sugeridos para tu organización. Revísalos: nada se guarda hasta que pulses «Guardar y buscar».'
              : 'Lo que vendes sale de tu Perfil y con eso generamos las palabras para licitaciones. Aquí eliges los cargos y regiones de la búsqueda diaria; al buscar puedes elegir otros.'}
          </SheetDescription>
        </SheetHeader>
        <form className="mt-4 flex flex-1 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <section aria-labelledby="opportunity-offer" className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3">
            <h3 id="opportunity-offer" className="text-sm font-medium text-foreground">Lo que vendes</h3>
            <OfferFromPerfil offer={perfil.offer || profile.offer} />
          </section>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-roles">Cargos de la búsqueda diaria</Label>
            <Textarea id="opportunity-roles" value={roles} rows={5} onChange={event => setRoles(event.target.value)} aria-describedby="opportunity-roles-hint" />
            <p id="opportunity-roles-hint" className="text-xs text-muted-foreground">Los que publican las empresas que te sirven, uno por línea o separados por coma. Buscamos también sus variantes, en español e inglés.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Regiones de la búsqueda diaria</legend>
            <p className="text-xs text-muted-foreground">
              Sin ninguna, se busca en todo Chile.{perfil.regions.length && !regions.length ? ' ' : ''}
              {perfil.regions.length && !regions.length ? (
                <button type="button" onClick={() => setRegions(perfil.regions)} className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Usar las de tu Perfil ({perfil.regions.join(', ')})
                </button>
              ) : null}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHILE_REGIONS.map(region => (
                <label key={region} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={regions.includes(region)}
                    onCheckedChange={checked => setRegions(current => checked ? CHILE_REGIONS.filter(item => item === region || current.includes(item)) : current.filter(item => item !== region))} />
                  {region}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-min">Mínimo de avisos en 30 días</Label>
            <Input id="opportunity-min" type="number" inputMode="numeric" min={1} max={100} value={minAds} onChange={event => setMinAds(event.target.value)} className="w-28" />
          </div>
          {schedule?.available ? (
            <fieldset className="space-y-3 rounded-lg border border-border/60 p-3">
              <legend className="px-1 text-sm font-medium text-foreground">Cuándo se busca sola</legend>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="opportunity-schedule-on" className="font-normal">Búsqueda programada</Label>
                <Switch id="opportunity-schedule-on" checked={when.enabled} onCheckedChange={enabled => setWhen(current => ({ ...current, enabled }))} />
              </div>
              <div className={cn('space-y-3', !when.enabled && 'opacity-60')}>
                <div role="group" aria-label="Días de la búsqueda" className="flex flex-wrap gap-1.5">
                  {WEEK_DAYS.map(item => {
                    const on = when.days.includes(item.day);
                    return (
                      <button key={item.day} type="button" aria-pressed={on} aria-label={item.label} title={item.label} disabled={!when.enabled}
                        onClick={() => setWhen(current => ({ ...current, days: on ? current.days.filter(day => day !== item.day) : [...current.days, item.day].sort() }))}
                        className={cn('h-9 w-9 rounded-full text-sm font-medium ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                          on ? 'bg-primary text-primary-foreground ring-primary' : 'bg-background text-foreground ring-border hover:bg-muted')}>
                        {item.short}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="opportunity-schedule-hour" className="font-normal">A las</Label>
                  <Select value={String(when.hour)} onValueChange={value => setWhen(current => ({ ...current, hour: Number(value) }))} disabled={!when.enabled}>
                    <SelectTrigger id="opportunity-schedule-hour" className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{Array.from({ length: 24 }, (_, hour) => <SelectItem key={hour} value={String(hour)}>{`${String(hour).padStart(2, '0')}:00`}</SelectItem>)}</SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">hora de Chile</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {describeSchedule(when)}. Busca licitaciones, Compra Ágil y Google for Jobs; LinkedIn solo cuando buscas tú, porque antes ves su costo.
              </p>
            </fieldset>
          ) : null}
          <Collapsible defaultOpen={pilot} className="rounded-lg border border-border/60">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="group flex h-auto w-full items-center justify-between px-3 py-2.5 text-left">
                <span>
                  <span className="block text-sm font-medium text-foreground">Licitaciones y proyectos</span>
                  <span className="block text-xs font-normal text-muted-foreground">Automático desde tu Perfil · {profile.keywords.length ? `${profile.keywords.length} palabras` : 'se generan al guardar'}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t border-border/60 p-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="opportunity-keywords">Palabras para licitaciones y Compra Ágil</Label>
                  {/* The first save generates them; afterwards they can be asked for again. */}
                  {!firstTime ? (
                    <Button type="button" size="sm" variant="ghost" className="h-8" disabled={Boolean(saving) || !(perfil.offer || profile.offer)} onClick={() => void save(true)}>
                      {saving === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                      Volver a generar
                    </Button>
                  ) : null}
                </div>
                <Textarea id="opportunity-keywords" value={keywords} rows={5} onChange={event => setKeywords(event.target.value)} aria-describedby="opportunity-keywords-hint" />
                <p id="opportunity-keywords-hint" className="text-xs text-muted-foreground">Como las escriben los organismos públicos. Las generamos de tu Perfil y se actualizan cuando cambias tu oferta; puedes ajustarlas.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="opportunity-codes">Códigos UNSPSC (opcional)</Label>
                <Input id="opportunity-codes" value={codes} inputMode="numeric" onChange={event => setCodes(event.target.value)} placeholder="Ej. 80111600, 801116" aria-describedby="opportunity-codes-hint" />
                <p id="opportunity-codes-hint" className="text-xs text-muted-foreground">Del catálogo de Mercado Público. Un código corto incluye a toda su familia.</p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Sectores de proyectos del SEIA</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SEIA_SECTORS.map(sector => (
                    <label key={sector.id} className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={sectors.includes(sector.id)}
                        onCheckedChange={checked => setSectors(current => checked ? [...current, sector.id] : current.filter(item => item !== sector.id))} />
                      {sector.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor="opportunity-investment">Inversión mínima de un proyecto (millones de US$)</Label>
                <Input id="opportunity-investment" value={minInvestment} inputMode="decimal" onChange={event => setMinInvestment(event.target.value)} placeholder="Ej. 10" className="w-32" />
              </div>
            </CollapsibleContent>
          </Collapsible>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
          <SheetFooter className="mt-auto gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={Boolean(saving)}>{saving === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{firstTime ? 'Guardar y buscar' : 'Guardar'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
