'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Briefcase, Building2, ChevronDown, ExternalLink, Loader2, Pencil, RotateCcw, Search, Star, Users, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { DECISION_MAKER_TITLES } from '@/lib/commercial-opportunities/pilot';
import type { HiringOpportunityData, OpportunityStatus } from '@/lib/commercial-opportunities/records';
import {
  FILTER_LABELS, filterOpportunities, formatDay, formatUsd, lastSearch, parseList, relativeTime, sourceLabel, statusCounts, type OpportunityFilter,
} from '@/lib/commercial-opportunities/view';
import { companySearchHref } from '@/lib/search/company-prefill';
import { cn } from '@/lib/utils';

type Profile = { id: string; name: string; offer: string; roles: string[]; regions: string[]; minAds: number; updatedAt: string };
type PlanSource = { source: 'jsearch' | 'linkedin'; label: string; enabled: boolean; requests: number; estimateUsd: number; missing: string | null };
type Opportunity = {
  id: string; company: string; domain: string | null; linkedinUrl: string | null; region: string | null; url: string | null; score: number;
  reasons: string[]; status: OpportunityStatus; mine: boolean; ads: number; firstSeenAt: string; lastSeenAt: string; data: HiringOpportunityData;
};
type Run = { id: string; source: string; status: string; startedAt: string; finishedAt: string | null; fetched: number; created: number; updated: number; costUsd: number; error: string | null };
type Overview = {
  profile: Profile; plan: { sources: PlanSource[]; estimateUsd: number }; month: { spentUsd: number; capUsd: number };
  opportunities: Opportunity[]; runs: Run[];
};
type SyncResult =
  | { status: 'done'; fetched: number; qualifying: number; newQualifying: number; costUsd: number; sources: Array<{ source: string; error: string | null }> }
  | { status: 'capped'; message: string };

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

  const runSearch = async () => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const result = await readJson<SyncResult>(await fetch('/api/commercial-opportunities/runs', { method: 'POST' }));
      if (result.status === 'capped') toast({ title: 'No se buscó: tope mensual', description: result.message, variant: 'destructive' });
      else {
        const failed = result.sources.filter(source => source.error).map(source => sourceLabel(source.source));
        toast({
          title: `${result.qualifying} ${result.qualifying === 1 ? 'empresa contratando' : 'empresas contratando'}${result.newQualifying ? ` (${result.newQualifying} nuevas)` : ''}`,
          description: `${result.fetched} avisos revisados · costo ${formatUsd(result.costUsd)}${failed.length ? ` · con problemas en ${failed.join(' y ')}` : ''}.`,
        });
      }
    } catch (failure) {
      toast({ title: 'No se pudo buscar', description: failure instanceof Error ? failure.message : undefined, variant: 'destructive' });
    } finally {
      setRunning(false);
      void load();
    }
  };

  const changeStatus = async (item: Opportunity, status: OpportunityStatus) => {
    if (!overview) return;
    const previous = item.status;
    setBusy(current => new Set(current).add(item.id));
    setOverview({ ...overview, opportunities: overview.opportunities.map(row => row.id === item.id ? { ...row, status, mine: status === 'interested' } : row) });
    try {
      await readJson(await fetch(`/api/commercial-opportunities/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
    } catch (failure) {
      setOverview(current => current && { ...current, opportunities: current.opportunities.map(row => row.id === item.id ? { ...row, status: previous } : row) });
      toast({ title: 'No se guardó el cambio', description: failure instanceof Error ? failure.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(current => { const next = new Set(current); next.delete(item.id); return next; });
    }
  };

  const counts = useMemo(() => statusCounts(overview?.opportunities || []), [overview]);
  const visible = useMemo(() => filterOpportunities(overview?.opportunities || [], filter, query), [overview, filter, query]);
  const enabledSources = overview?.plan.sources.filter(source => source.enabled) || [];
  const overCap = overview ? overview.month.spentUsd + overview.plan.estimateUsd > overview.month.capUsd : false;
  const searchDisabled = running || !overview || !enabledSources.length;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Oportunidades"
        description="Empresas que están publicando avisos para los cargos de tu oferta: quién contrata, cuánto y dónde, con los avisos que lo muestran."
      >
        <Button variant="outline" onClick={() => setEditOpen(true)} disabled={!overview}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar búsqueda
        </Button>
        <Button onClick={() => setConfirmOpen(true)} disabled={searchDisabled}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {running ? 'Buscando…' : 'Buscar ahora'}
        </Button>
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
          <SearchSummary overview={overview} running={running} />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
              {FILTERS.map(item => (
                <Button key={item} size="sm" variant={filter === item ? 'default' : 'outline'} aria-pressed={filter === item} onClick={() => setFilter(item)}
                  className="h-9 rounded-full">
                  {FILTER_LABELS[item]}
                  <span className={cn('ml-1 rounded-full px-1.5 text-xs tabular-nums', filter === item ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>{counts[item]}</span>
                </Button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa" className="pl-9" />
            </div>
          </div>

          <section aria-label="Empresas contratando" className="mt-4">
            {visible.length ? (
              <ul className="grid gap-4 lg:grid-cols-2">
                {visible.map(item => (
                  <li key={item.id}>
                    <OpportunityCard item={item} minAds={overview.profile.minAds} busy={busy.has(item.id)} onStatus={status => changeStatus(item, status)} />
                  </li>
                ))}
              </ul>
            ) : (
              <ListEmpty overview={overview} filter={filter} query={query} searchDisabled={searchDisabled} onSearch={() => setConfirmOpen(true)} onEdit={() => setEditOpen(true)} />
            )}
          </section>

          <RunDialog open={confirmOpen} onOpenChange={setConfirmOpen} overview={overview} overCap={overCap} onConfirm={runSearch} />
          <ProfileSheet open={editOpen} onOpenChange={setEditOpen} profile={overview.profile}
            onSaved={next => { setOverview(current => current && { ...current, profile: next.profile, plan: next.plan }); void load(); }} />
        </>
      ) : null}
      <span className="sr-only" aria-live="polite">{running ? 'Buscando empresas que están contratando. Puede tardar hasta 2 minutos.' : ''}</span>
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
  const last = lastSearch(overview.runs);
  const missing = plan.sources.filter(source => !source.enabled && source.missing);
  const spentShare = month.capUsd > 0 ? Math.min(100, (month.spentUsd / month.capUsd) * 100) : 100;
  return (
    <section aria-label="Qué buscamos" className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué buscamos · {profile.name}</p>
        {profile.offer ? <p className="line-clamp-2 text-sm text-foreground">{profile.offer}</p> : null}
        <ul className="flex flex-wrap gap-1.5" aria-label="Cargos">
          {profile.roles.slice(0, 8).map(role => <li key={role} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{role}</li>)}
          {profile.roles.length > 8 ? <li className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">+{profile.roles.length - 8} más</li> : null}
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
              {last.status === 'partial' ? ' · una fuente falló' : ''}
            </p>
          ) : <p className="mt-0.5 text-sm text-foreground">Aún no buscas</p>}
          {!running && last?.errors.length ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{last.errors[0]}</p> : null}
        </div>
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-muted-foreground">Gasto del mes</span>
            <span className="tabular-nums text-foreground">{formatUsd(month.spentUsd)} de {formatUsd(month.capUsd)}</span>
          </div>
          <Progress value={spentShare} className="mt-1.5 h-1.5" aria-label={`Gasto del mes: ${formatUsd(month.spentUsd)} de ${formatUsd(month.capUsd)}`} />
        </div>
        {missing.length ? (
          <p className="rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-xs text-cw-warning">
            Sin clave: {missing.map(source => `${source.label} (${source.missing})`).join(' y ')}. La configura el mantenedor.
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
            <li key={entry.role} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{entry.role} <span className="text-muted-foreground">({entry.ads})</span></li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
          data.isClient ? 'bg-cw-success-soft text-cw-success' : data.isContact ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
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
  if (!overview.runs.length) {
    return (
      <EmptyState icon={Briefcase} headingLevel="h3" title="Aún no hay empresas"
        description="Busca en Google for Jobs y LinkedIn las empresas que publican avisos para tus cargos. Antes de buscar verás el costo."
        action={<Button onClick={onSearch} disabled={searchDisabled}><Search className="h-4 w-4" aria-hidden="true" />Buscar ahora</Button>} />
    );
  }
  return (
    <EmptyState icon={Briefcase} headingLevel="h3" title={`Ninguna empresa llega a ${overview.profile.minAds} avisos`}
      description="Con lo encontrado en los últimos 30 días, ninguna empresa nueva publica tantos avisos para tus cargos. Puedes sumar cargos o bajar el mínimo."
      action={<Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Editar búsqueda</Button>} />
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
                  {source.enabled ? (source.source === 'jsearch' ? `${source.requests} consultas, avisos del último mes` : `hasta ${source.requests} avisos de los últimos 7 días`) : `Sin clave (${source.missing})`}
                </p>
              </div>
              <span className={cn('shrink-0 tabular-nums', source.enabled ? 'text-foreground' : 'text-muted-foreground')}>{source.enabled ? `hasta ${formatUsd(source.estimateUsd)}` : 'no se usa'}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-foreground">
          Costo máximo: <strong>{formatUsd(plan.estimateUsd)}</strong>. Este mes llevas {formatUsd(month.spentUsd)} de {formatUsd(month.capUsd)}.
        </p>
        {overCap ? <p className="rounded-lg bg-cw-warning-soft px-3 py-2 text-sm text-cw-warning">Esta búsqueda pasaría el tope del mes. Pide al mantenedor subir OPPORTUNITIES_MONTHLY_USD_CAP o espera al próximo mes.</p> : null}
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
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(profile.name); setOffer(profile.offer); setRoles(profile.roles.join('\n')); setRegions(profile.regions); setMinAds(String(profile.minAds)); setProblem('');
  }, [open, profile]);

  const save = async () => {
    const roleList = parseList(roles);
    const minimum = Number(minAds);
    if (!name.trim()) return setProblem('Ponle un nombre a la búsqueda.');
    if (!roleList.length) return setProblem('Agrega al menos un cargo.');
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100) return setProblem('El mínimo de avisos va de 1 a 100.');
    setSaving(true);
    setProblem('');
    try {
      const next = await readJson<{ profile: Profile; plan: Overview['plan'] }>(await fetch('/api/commercial-opportunities/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), offer: offer.trim(), roles: roleList, regions, minAds: minimum }),
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
