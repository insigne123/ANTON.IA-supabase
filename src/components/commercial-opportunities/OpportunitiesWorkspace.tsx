'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Briefcase, Building2, ChevronDown, Copy, ExternalLink, Factory, Gavel, KeyRound, Landmark, Loader2, Pencil, RotateCcw, Search, Star, Upload, Users, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { MercadoPublicoTicketCard, TicketGuide } from '@/components/commercial-opportunities/MercadoPublicoTicket';
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
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { DECISION_MAKER_TITLES } from '@/lib/commercial-opportunities/pilot';
import type { HiringOpportunityData, OpportunityStatus, ProjectOpportunityData, TenderOpportunityData } from '@/lib/commercial-opportunities/records';
import { SEIA_SECTORS } from '@/lib/commercial-opportunities/projects';
import { ticketNeedsAction, type TicketStatus } from '@/lib/commercial-opportunities/ticket';
import {
  FILTER_LABELS, closesIn, filterOpportunities, formatClp, formatDay, formatUsd, lastSearch, parseList, relativeTime, sourceLabel, statusCounts,
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
type Overview = {
  profile: Profile; plan: { sources: PlanSource[]; estimateUsd: number }; month: { spentUsd: number; capUsd: number };
  tenderSearch: { ticket: boolean; ticketStatus?: TicketStatus; keywords: string[]; unspscCodes: string[] };
  opportunities: Opportunity[]; tenders: TenderOpportunity[]; projects: ProjectOpportunity[]; runs: Run[];
};
type Tab = 'hiring' | 'tenders' | 'projects';
type ProjectResult = { status: 'done'; read: number; skipped: number; matched: number; created: number };
type HiringResult =
  | { status: 'done' | 'partial' | 'failed'; fetched: number; qualifying: number; newQualifying: number; costUsd: number; sources: Array<{ source: string; error: string | null }> }
  | { status: 'capped'; message: string };
type TenderResult = { status: 'done' | 'partial' | 'failed'; found: number; matched: number; created: number; sources: Array<{ source: string; error: string | null }> };
const TAB_SOURCES: Record<Tab, string[]> = { hiring: ['jsearch', 'linkedin'], tenders: ['mercado_publico', 'compra_agil'], projects: ['seia'] };
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
  // The person's own Mercado Público ticket changed (saved, replaced or removed): tenders follow it without reloading.
  const updateTicket = (status: TicketStatus) => setOverview(current => current && {
    ...current, tenderSearch: { ...current.tenderSearch, ticketStatus: status, ticket: status.connected || status.shared },
  });

  const runSearch = async (kind: Tab) => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const response = await fetch('/api/commercial-opportunities/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }),
      });
      if (kind === 'tenders') {
        const result = await readJson<TenderResult>(response);
        const failed = result.sources.filter(source => source.error).map(source => sourceLabel(source.source));
        toast({
          title: result.status === 'failed' ? 'No se pudo consultar las fuentes' : `${result.status === 'partial' ? 'Búsqueda parcial: ' : ''}${result.matched} ${result.matched === 1 ? 'licitación abierta calza' : 'licitaciones abiertas calzan'}${result.created ? ` (${result.created} nuevas)` : ''}`,
          description: result.status === 'failed' ? 'La búsqueda falló; no significa que no existan licitaciones. Revisa los errores de cada fuente.' : `${result.found} revisadas en Mercado Público y Compra Ágil · sin costo${failed.length ? ` · con problemas en ${failed.join(' y ')}` : ''}.`,
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
    });
    setBusy(current => new Set(current).add(item.id));
    setOverview(patch(overview, status));
    try {
      await readJson(await fetch(`/api/commercial-opportunities/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
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
  const enabledSources = overview?.plan.sources.filter(source => source.enabled) || [];
  const overCap = overview ? overview.month.spentUsd + overview.plan.estimateUsd > overview.month.capUsd : false;
  const hiringDisabled = running || !overview || !enabledSources.length;
  const tendersDisabled = running || !overview || !overview.tenderSearch.ticket
    || (!overview.tenderSearch.keywords.length && !overview.tenderSearch.unspscCodes.length);
  const searchDisabled = tab === 'hiring' ? hiringDisabled : tab === 'tenders' ? tendersDisabled : running || !overview;
  const startSearch = () => (tab === 'hiring' ? setConfirmOpen(true) : tab === 'tenders' ? void runSearch('tenders') : fileInput.current?.click());

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Oportunidades"
        description="Empresas que están contratando para los cargos de tu oferta, licitaciones públicas que calzan con ella y proyectos de inversión por partir, con la evidencia de cada una."
      >
        <Button variant="outline" onClick={() => setEditOpen(true)} disabled={!overview}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar búsqueda
        </Button>
        <Button onClick={startSearch} disabled={searchDisabled}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {running ? (tab === 'projects' ? 'Leyendo…' : 'Buscando…') : tab === 'hiring' ? 'Buscar ahora' : tab === 'tenders' ? 'Buscar licitaciones' : 'Subir archivo del SEIA'}
        </Button>
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

      {loading ? <LoadingState /> : overview ? (
        <>
          <Tabs value={tab} onValueChange={value => { setTab(value as Tab); setFilter('new'); setQuery(''); }}>
            <TabsList className="mb-4 h-auto flex-wrap">
              <TabsTrigger value="hiring" className="gap-1.5"><Building2 className="h-4 w-4" aria-hidden="true" />Empresas contratando
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground/70">{overview.opportunities.length}</span></TabsTrigger>
              <TabsTrigger value="tenders" className="gap-1.5"><Gavel className="h-4 w-4" aria-hidden="true" />Licitaciones y Compra Ágil
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground/70">{overview.tenders.length}</span></TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5"><Factory className="h-4 w-4" aria-hidden="true" />Proyectos de inversión
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground/70">{overview.projects.length}</span></TabsTrigger>
            </TabsList>
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
                          <OpportunityCard item={item} minAds={overview.profile.minAds} busy={busy.has(item.id)} onStatus={status => changeStatus(item, status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ListEmpty overview={overview} filter={filter} query={query} searchDisabled={hiringDisabled} onSearch={() => setConfirmOpen(true)} onEdit={() => setEditOpen(true)} />
                  )) : kind === 'projects' ? (visibleProjects.length ? (
                    <ul className="grid gap-4 lg:grid-cols-2">
                      {visibleProjects.map(item => (
                        <li key={item.id} className="min-w-0">
                          <ProjectCard item={item} busy={busy.has(item.id)} onStatus={status => changeStatus(item, status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ProjectEmpty overview={overview} filter={filter} query={query} disabled={running} onUpload={() => fileInput.current?.click()} />
                  )) : (visibleTenders.length ? (
                    <ul className="grid gap-4 lg:grid-cols-2">
                      {visibleTenders.map(item => (
                        <li key={item.id} className="min-w-0">
                          <TenderCard item={item} busy={busy.has(item.id)} onStatus={status => changeStatus(item, status)} />
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

          <RunDialog open={confirmOpen} onOpenChange={setConfirmOpen} overview={overview} overCap={overCap} onConfirm={() => void runSearch('hiring')} />
          <TicketGuide open={guideOpen} onOpenChange={setGuideOpen} onSaved={updateTicket} />
          <ProfileSheet open={editOpen} onOpenChange={setEditOpen} profile={overview.profile}
            onSaved={next => { setOverview(current => current && { ...current, profile: next.profile, plan: next.plan }); void load(); }} />
        </>
      ) : null}
      <span className="sr-only" aria-live="polite">{running ? (tab === 'hiring' ? 'Buscando empresas que están contratando. Puede tardar hasta 2 minutos.'
        : tab === 'tenders' ? 'Buscando licitaciones y Compra Ágil.' : 'Leyendo el archivo del SEIA.') : ''}</span>
    </div>
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

function SearchSummary({ overview, running }: { overview: Overview; running: boolean }) {
  const { profile, plan, month } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.hiring.includes(run.source)));
  const missing = plan.sources.filter(source => !source.enabled && source.missing);
  const spentShare = month.capUsd > 0 ? Math.min(100, (month.spentUsd / month.capUsd) * 100) : 100;
  return (
    <section aria-label="Qué buscamos" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué buscamos · {profile.name}</p>
        {profile.offer ? <p className="line-clamp-2 text-sm text-foreground">{profile.offer}</p> : null}
        <ul className="flex flex-wrap gap-1.5" aria-label="Cargos">
          {profile.roles.slice(0, 8).map(role => <li key={role} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{role}</li>)}
          {profile.roles.length > 8 ? <li className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/70">+{profile.roles.length - 8} más</li> : null}
        </ul>
        <p className="text-xs text-muted-foreground">
          {profile.minAds} o más avisos en 30 días · {profile.regions.length ? profile.regions.join(', ') : 'todo Chile'}
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

function ScorePill({ score }: { score: number }) {
  return (
    <span className="flex shrink-0 flex-col items-center rounded-lg bg-primary/10 px-2.5 py-1 text-primary" title="Calce de 0 a 100: avisos, ritmo, cargos de tu oferta, región y tamaño">
      <span className="text-lg font-semibold leading-none tabular-nums">{score}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">calce</span>
    </span>
  );
}

function OpportunityCard({ item, minAds, busy, onStatus }: { item: Opportunity; minAds: number; busy: boolean; onStatus: (status: OpportunityStatus) => void }) {
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
  overview: Overview; filter: OpportunityFilter; query: string; searchDisabled: boolean; onSearch: () => void; onEdit: () => void;
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
  overview: Overview; running: boolean; onTicketChange: (status: TicketStatus) => void; onOpenGuide: () => void;
}) {
  const { tenderSearch, profile } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.tenders.includes(run.source)));
  return (
    <section aria-label="Qué buscamos en licitaciones" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué buscamos en Mercado Público y Compra Ágil</p>
        {tenderSearch.keywords.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Palabras">
            {tenderSearch.keywords.slice(0, 10).map(keyword => <li key={keyword} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{keyword}</li>)}
            {tenderSearch.keywords.length > 10 ? <li className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/70">+{tenderSearch.keywords.length - 10} más</li> : null}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Aún no hay palabras para buscar. Agrégalas en «Editar búsqueda».</p>}
        <p className="text-xs text-muted-foreground">
          {tenderSearch.unspscCodes.length ? `Códigos UNSPSC: ${tenderSearch.unspscCodes.join(', ')} · ` : ''}
          Abiertas y publicadas en las últimas dos semanas · {profile.regions.length ? `suman calce ${profile.regions.join(', ')}` : 'todo Chile'}
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
        <p className="text-xs text-muted-foreground">Sin costo: usa tu ticket de Mercado Público. Se actualiza sola cada mañana.</p>
      </div>
    </section>
  );
}

function TenderCard({ item, busy, onStatus }: { item: TenderOpportunity; busy: boolean; onStatus: (status: OpportunityStatus) => void }) {
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
  overview: Overview; filter: OpportunityFilter; query: string; searchDisabled: boolean; onSearch: () => void; onEdit: () => void; onGuide: () => void;
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
        description="Con tu ticket gratuito de Mercado Público buscamos cada mañana las compras abiertas que nombran lo que ofreces."
        action={<Button onClick={onGuide}><KeyRound className="h-4 w-4" aria-hidden="true" />Cómo conseguirlo</Button>} />
    );
  }
  if (!last) {
    return (
      <EmptyState icon={Gavel} headingLevel="h3" title="Aún no hay licitaciones"
        description="Busca en Mercado Público y Compra Ágil las compras abiertas que nombran lo que ofreces. No tiene costo."
        action={<Button onClick={onSearch} disabled={searchDisabled}><Search className="h-4 w-4" aria-hidden="true" />Buscar licitaciones</Button>} />
    );
  }
  return (
    <EmptyState icon={Gavel} headingLevel="h3" title={last.status === 'partial' ? 'Búsqueda incompleta, sin licitaciones para mostrar' : 'Ninguna licitación abierta calza'}
      description={last.status === 'partial' ? 'La búsqueda quedó incompleta. Revisa los errores de las fuentes antes de cambiar tus palabras.' : 'Con tus palabras no hay compras abiertas ahora. Prueba con otras palabras o agrega códigos UNSPSC.'}
      action={<Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Editar búsqueda</Button>} />
  );
}

function ProjectSummary({ overview, running, onUpload }: { overview: Overview; running: boolean; onUpload: () => void }) {
  const { profile } = overview;
  const last = lastSearch(overview.runs.filter(run => TAB_SOURCES.projects.includes(run.source)));
  const sectors = SEIA_SECTORS.filter(sector => profile.sectors.includes(sector.id)).map(sector => sector.label);
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

function ProjectCard({ item, busy, onStatus }: { item: ProjectOpportunity; busy: boolean; onStatus: (status: OpportunityStatus) => void }) {
  const interested = item.status === 'interested' || item.status === 'converted';
  const sector = SEIA_SECTORS.find(entry => entry.id === item.data.sector)?.label;
  return (
    <article className={cn('flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors motion-safe:animate-in motion-safe:fade-in-0',
      interested ? 'border-primary/40' : 'border-border/70', item.status === 'dismissed' && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
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
  overview: Overview; filter: OpportunityFilter; query: string; disabled: boolean; onUpload: () => void;
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

function RunDialog({ open, onOpenChange, overview, overCap, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; overview: Overview; overCap: boolean; onConfirm: () => void;
}) {
  const { plan, month } = overview;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Buscar empresas que están contratando</AlertDialogTitle>
          <AlertDialogDescription>Se buscan los avisos de tus {overview.profile.roles.length} cargos y se agrupan por empresa. Puede tardar hasta 2 minutos.</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-2 text-sm">
          {plan.sources.map(source => (
            <li key={source.source} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
              <div>
                <p className="font-medium text-foreground">{source.label}</p>
                <p className="text-xs text-muted-foreground">
                  {source.enabled ? (source.source === 'jsearch' ? `${source.requests} consultas, avisos del último mes` : `hasta ${source.requests} avisos de los últimos 7 días`) : 'No está conectada'}
                </p>
              </div>
              <span className={cn('shrink-0 tabular-nums', source.enabled ? 'text-foreground' : 'text-muted-foreground')}>{source.enabled ? `hasta ${formatUsd(source.estimateUsd)}` : 'no se usa'}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-foreground">
          Costo máximo: <strong>{formatUsd(plan.estimateUsd)}</strong>. Este mes llevas {formatUsd(month.spentUsd)} de {formatUsd(month.capUsd)}.
        </p>
        {overCap ? <p className="rounded-lg bg-cw-warning-soft px-3 py-2 text-sm text-cw-warning">Esta búsqueda pasaría el tope de gasto del mes. Espera al próximo mes o pide a quien administra ANTON.IA que suba el tope.</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={overCap}>Buscar ahora</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProfileSheet({ open, onOpenChange, profile, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; profile: Profile;
  onSaved: (next: { profile: Profile; plan: Overview['plan'] }) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(profile.name);
  const [offer, setOffer] = useState(profile.offer);
  const [roles, setRoles] = useState(profile.roles.join('\n'));
  const [regions, setRegions] = useState<string[]>(profile.regions);
  const [minAds, setMinAds] = useState(String(profile.minAds));
  const [keywords, setKeywords] = useState(profile.keywords.join('\n'));
  const [codes, setCodes] = useState(profile.unspscCodes.join(', '));
  const [sectors, setSectors] = useState<string[]>(profile.sectors);
  const [minInvestment, setMinInvestment] = useState(profile.minInvestmentUsd ? String(profile.minInvestmentUsd / 1_000_000) : '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(profile.name); setOffer(profile.offer); setRoles(profile.roles.join('\n')); setRegions(profile.regions); setMinAds(String(profile.minAds));
    setKeywords(profile.keywords.join('\n')); setCodes(profile.unspscCodes.join(', ')); setSectors(profile.sectors);
    setMinInvestment(profile.minInvestmentUsd ? String(profile.minInvestmentUsd / 1_000_000) : ''); setProblem('');
  }, [open, profile]);

  const save = async () => {
    const roleList = parseList(roles);
    const keywordList = parseList(keywords);
    const codeList = parseList(codes).map(code => code.replace(/\s/g, ''));
    const minimum = Number(minAds);
    if (!name.trim()) return setProblem('Ponle un nombre a la búsqueda.');
    if (!roleList.length) return setProblem('Agrega al menos un cargo.');
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100) return setProblem('El mínimo de avisos va de 1 a 100.');
    if (codeList.some(code => !/^\d{2,8}$/.test(code))) return setProblem('Los códigos UNSPSC son números de 2 a 8 dígitos, separados por coma.');
    const investment = minInvestment.trim() ? Number(minInvestment.replace(',', '.')) : null;
    if (investment !== null && (!Number.isFinite(investment) || investment < 0)) return setProblem('La inversión mínima es un número de millones de dólares.');
    setSaving(true);
    setProblem('');
    try {
      const next = await readJson<{ profile: Profile; plan: Overview['plan'] }>(await fetch('/api/commercial-opportunities/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), offer: offer.trim(), roles: roleList, regions, minAds: minimum, keywords: keywordList, unspscCodes: codeList,
          sectors, minInvestmentUsd: investment === null ? null : Math.round(investment * 1_000_000) }),
      }));
      onSaved(next);
      onOpenChange(false);
      toast({ title: 'Búsqueda guardada', description: 'La próxima búsqueda usa estos cargos y regiones.' });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Qué buscamos</SheetTitle>
          <SheetDescription>Los cargos definen qué avisos se buscan; las regiones y el tamaño suben el calce.</SheetDescription>
        </SheetHeader>
        <form className="mt-4 flex flex-1 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-name">Nombre</Label>
            <Input id="opportunity-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-offer">Qué ofreces</Label>
            <Textarea id="opportunity-offer" value={offer} maxLength={2000} rows={3} onChange={event => setOffer(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-roles">Cargos que buscan las empresas</Label>
            <Textarea id="opportunity-roles" value={roles} rows={6} onChange={event => setRoles(event.target.value)} aria-describedby="opportunity-roles-hint" />
            <p id="opportunity-roles-hint" className="text-xs text-muted-foreground">Uno por línea o separados por coma. Se consultan los 10 primeros en Google for Jobs.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Regiones que suman calce</legend>
            <p className="text-xs text-muted-foreground">Sin ninguna, se busca en todo Chile sin preferencia.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHILE_REGIONS.map(region => (
                <label key={region} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={regions.includes(region)}
                    onCheckedChange={checked => setRegions(current => checked ? [...current, region] : current.filter(item => item !== region))} />
                  {region}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-keywords">Palabras para licitaciones y Compra Ágil</Label>
            <Textarea id="opportunity-keywords" value={keywords} rows={5} onChange={event => setKeywords(event.target.value)} aria-describedby="opportunity-keywords-hint" />
            <p id="opportunity-keywords-hint" className="text-xs text-muted-foreground">Como las escriben los organismos: «suministro de personal», «outsourcing». Una por línea; se usan las 12 primeras.</p>
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
          <div className="space-y-1.5">
            <Label htmlFor="opportunity-min">Mínimo de avisos en 30 días</Label>
            <Input id="opportunity-min" type="number" inputMode="numeric" min={1} max={100} value={minAds} onChange={event => setMinAds(event.target.value)} className="w-28" />
          </div>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
          <SheetFooter className="mt-auto gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Guardar</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
