'use client';

// The competitor radar (propuesta 10): who bids for the same public contracts as the company, how much they win and where,
// from ChileCompra's open data (workspace-market.ts). The followed competitors first, with their latest moves; a search by
// name or RUT; and who else to watch, suggested from the company's own bids or, without its RUT, from what it sells.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Plus, Search, Trophy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatRut, moneyLabel, percentLabel, tenderUrl } from '@/lib/public-procurement/market';

type Recent = { code: string; name: string; agency: string | null; publishedOn: string | null; status: string; won: boolean; amount: number | null; currency: string | null };
type Activity = { bids: number; wins: number; awarded: number; recent: Recent[] };
type Supplier = { id: number; rut: string; name: string };
type RadarView = {
  available: boolean; coverage: { to: string | null };
  own?: (Supplier & Activity) | null; ownRutMissing?: boolean;
  followed?: Array<Supplier & Activity>;
  suggestions?: { basis: 'cobidders' | 'keywords' | 'none'; items: Array<Supplier & { shared?: number; wins: number; bids?: number; awarded?: number }> };
};
type Profile = {
  supplier: Supplier; bids: number; wins: number; awarded: number; medianOfferRatio: number | null;
  agencies: Array<{ name: string; bids: number; wins: number }>; categories: Array<{ name: string; bids: number; wins: number }>;
  recent: Array<{ code: string; name: string; agency: string | null; publishedOn: string | null; status: string; estimatedAmount: number | null; currency: string | null; offered: number | null; won: boolean }>;
};
const monthLabel = (value: string | null) => value ? new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : 'Sin fecha';
const rate = (wins: number, bids: number) => bids ? `${Math.round((wins / bids) * 100)} %` : 's/i';

async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }

function Numbers({ value }: { value: Activity }) {
  return <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <div><dt className="sr-only">Ofertas</dt><dd><span className="font-semibold tabular-nums">{value.bids}</span> <span className="text-muted-foreground">{value.bids === 1 ? 'oferta' : 'ofertas'}</span></dd></div>
    <div><dt className="sr-only">Ganadas</dt><dd><span className="font-semibold tabular-nums">{value.wins}</span> <span className="text-muted-foreground">{value.wins === 1 ? 'ganada' : 'ganadas'} ({rate(value.wins, value.bids)})</span></dd></div>
    {value.awarded ? <div><dt className="sr-only">Adjudicado</dt><dd><span className="font-semibold tabular-nums">{moneyLabel(value.awarded)}</span> <span className="text-muted-foreground">adjudicados</span></dd></div> : null}
  </dl>;
}

function Moves({ items }: { items: Recent[] }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">Sin ofertas en los últimos 12 meses.</p>;
  return <ul className="space-y-1.5" aria-label="Últimas ofertas">{items.map(item => <li key={`${item.code}-${item.won}`} className="flex gap-2 text-xs leading-5">
    <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', item.won ? 'bg-primary' : 'bg-muted-foreground/40')} aria-hidden="true" />
    <span className="min-w-0"><span className="font-medium">{item.won ? 'Ganó' : 'Ofertó'}</span> {item.name}<span className="text-muted-foreground"> · {item.agency || 'organismo'} · {monthLabel(item.publishedOn)}{item.amount ? ` · ${moneyLabel(item.amount, item.currency)}` : ''}</span></span>
  </li>)}</ul>;
}

export function CompetitorRadar({ onProfile }: { onProfile?: () => void }) {
  const [data, setData] = useState<RadarView | null>(null);
  const [problem, setProblem] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Supplier[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try { setData(await json(await fetch('/api/commercial-opportunities/competitors', { cache: 'no-store' }))); setProblem(''); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar el radar.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 3) { setResults(null); return; }
    setSearching(true); setProblem('');
    try { setResults((await json(await fetch(`/api/commercial-opportunities/competitors?${new URLSearchParams({ q: query.trim() })}`, { cache: 'no-store' }))).items); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo buscar.'); }
    finally { setSearching(false); }
  };
  const follow = async (supplierId: number, value: boolean) => {
    setPending(supplierId); setProblem('');
    try {
      await json(await fetch('/api/commercial-opportunities/competitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'follow', supplierId, follow: value }) }));
      await load();
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setPending(null); }
  };
  const openProfile = async (supplierId: number) => {
    setOpening(supplierId); setProblem('');
    try { setProfile(await json(await fetch(`/api/commercial-opportunities/competitors?${new URLSearchParams({ id: String(supplierId) })}`, { cache: 'no-store' }))); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo abrir el perfil.'); }
    finally { setOpening(null); }
  };
  const followedIds = new Set((data?.followed || []).map(item => item.id));

  if (!data && !problem) return <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando el radar de competidores…</div>;

  const followButton = (supplier: Supplier) => followedIds.has(supplier.id)
    ? <span className="text-xs text-muted-foreground">Siguiendo</span>
    : <Button size="sm" variant="outline" className="h-8" disabled={pending !== null} onClick={() => void follow(supplier.id, true)} aria-label={`Seguir a ${supplier.name}`}>
      {pending === supplier.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}Seguir</Button>;
  const profileButton = (supplier: Supplier) => <Button size="sm" variant="ghost" className="h-8" disabled={opening !== null} onClick={() => void openProfile(supplier.id)} aria-label={`Ver perfil de ${supplier.name}`}>
    {opening === supplier.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Ver perfil</Button>;

  return <section aria-labelledby="radar-title" className="space-y-6">
    <header className="max-w-2xl space-y-1">
      <h2 id="radar-title" className="text-lg font-semibold">Competidores</h2>
      <p className="text-sm leading-6 text-muted-foreground">Quién compite contigo en licitaciones públicas, cuánto gana y dónde, en los últimos 12 meses. Sigue a los que te importan para ver cada mes lo que ganan.</p>
    </header>

    {problem ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => void load()}>Reintentar</Button></div> : null}

    {data && !data.available ? <div className="rounded-3xl border p-6 text-sm leading-6 text-muted-foreground">Aún no cargamos el historial de licitaciones de ChileCompra. Cuando esté, verás aquí a tus competidores y lo que ganan.</div> : null}

    {data?.available ? <>
      {data.own ? <div className="space-y-3 rounded-3xl bg-muted/40 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Tu empresa en licitaciones públicas</h3><p className="text-xs text-muted-foreground">{data.own.name} · RUT {formatRut(data.own.rut)}</p></div>
        <Numbers value={data.own} />
      </div> : data.ownRutMissing ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 p-4 text-sm">
        <p className="max-w-xl">Agrega el RUT de tu empresa en la ficha para licitaciones: así sugerimos a quienes compiten contigo en las mismas licitaciones y ves tu propio historial.</p>
        {onProfile ? <Button size="sm" variant="outline" onClick={onProfile}>Abrir ficha</Button> : null}
      </div> : null}

      <form role="search" onSubmit={event => void search(event)} className="flex max-w-xl gap-2">
        <label htmlFor="radar-search" className="sr-only">Buscar proveedor por nombre o RUT</label>
        <Input id="radar-search" ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value.trim()) setResults(null); }} placeholder="Busca un competidor por nombre o RUT" autoComplete="off" />
        <Button type="submit" variant="outline" disabled={searching || query.trim().length < 3}>{searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}Buscar</Button>
      </form>
      {results ? <div className="space-y-2" aria-live="polite">
        {!results.length ? <p className="text-sm text-muted-foreground">No encontramos proveedores con «{query.trim()}» en las licitaciones de los últimos años.</p>
          : <ul className="divide-y rounded-2xl border" aria-label="Resultados de la búsqueda">{results.map(supplier => <li key={supplier.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0"><p className="text-sm font-medium">{supplier.name}</p><p className="text-xs text-muted-foreground">RUT {formatRut(supplier.rut)}</p></div>
            <div className="flex items-center gap-1">{profileButton(supplier)}{followButton(supplier)}</div></li>)}</ul>}
      </div> : null}

      <section aria-labelledby="followed-title" className="space-y-3">
        <h3 id="followed-title" className="font-semibold">Los que sigues{data.followed?.length ? ` · ${data.followed.length}` : ''}</h3>
        {!data.followed?.length ? <p className="rounded-2xl border p-5 text-sm leading-6 text-muted-foreground">Aún no sigues a nadie. {data.suggestions?.items.length ? 'Búscalos por nombre o RUT, o elige entre los sugeridos de abajo.' : 'Búscalos por nombre o RUT: por ejemplo, la empresa que ganó la última licitación a la que postulaste.'}</p>
          : <ul className="grid gap-3 xl:grid-cols-2">{data.followed.map(item => <li key={item.id} className="space-y-3 rounded-2xl border bg-background p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-semibold leading-6">{item.name}</p><p className="text-xs text-muted-foreground">RUT {formatRut(item.rut)}</p></div>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={pending !== null} onClick={() => void follow(item.id, false)} aria-label={`Dejar de seguir a ${item.name}`}>
                {pending === item.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}</Button>
            </div>
            <Numbers value={item} />
            <Moves items={item.recent} />
            <div>{profileButton(item)}</div>
          </li>)}</ul>}
      </section>

      {data.suggestions?.items.length ? <section aria-labelledby="suggested-title" className="space-y-3">
        <div className="space-y-1"><h3 id="suggested-title" className="font-semibold">Para vigilar</h3>
          <p className="text-sm text-muted-foreground">{data.suggestions.basis === 'cobidders' ? 'Ofertaron en las mismas licitaciones que tu empresa en el último año.' : 'Los que más ganan licitaciones de lo que vendes en el último año.'}</p></div>
        <ul className="divide-y rounded-2xl border" aria-label="Competidores sugeridos">{data.suggestions.items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0"><p className="text-sm font-medium">{item.name}</p>
            <p className="text-xs text-muted-foreground">{item.shared !== undefined ? `${item.shared} ${item.shared === 1 ? 'licitación' : 'licitaciones'} contigo · ganó ${item.wins}` : `Ganó ${item.wins} de ${item.bids ?? item.wins}${item.awarded ? ` · ${moneyLabel(item.awarded)}` : ''}`}</p></div>
          <div className="flex items-center gap-1">{profileButton(item)}{followButton(item)}</div></li>)}</ul>
      </section> : null}
      <p className="text-xs leading-5 text-muted-foreground">Fuente: datos abiertos de ChileCompra{data.coverage.to ? ` hasta ${monthLabel(data.coverage.to)}` : ''}. Las ofertas de quienes no ganaron se guardan del último año.</p>
    </> : null}

    <Dialog open={profile !== null} onOpenChange={open => { if (!open) setProfile(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {profile ? <>
          <DialogHeader><DialogTitle>{profile.supplier.name}</DialogTitle><DialogDescription>RUT {formatRut(profile.supplier.rut)} · licitaciones en los datos de ChileCompra</DialogDescription></DialogHeader>
          <div className="space-y-5">
            <Numbers value={{ bids: profile.bids, wins: profile.wins, awarded: profile.awarded, recent: [] }} />
            {profile.medianOfferRatio !== null ? <p className="text-sm">Suele ofertar <span className="font-semibold">{percentLabel(profile.medianOfferRatio)}</span> del monto estimado (mediana).</p> : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2"><h3 className="text-sm font-semibold">Dónde oferta</h3><ul className="space-y-1">{profile.agencies.map(agency => <li key={agency.name} className="text-sm leading-6">{agency.name}<span className="text-xs text-muted-foreground"> · {agency.bids} {agency.bids === 1 ? 'oferta' : 'ofertas'}, {agency.wins} {agency.wins === 1 ? 'ganada' : 'ganadas'}</span></li>)}</ul></div>
              <div className="space-y-2"><h3 className="text-sm font-semibold">Qué vende</h3><ul className="space-y-1">{profile.categories.map(category => <li key={category.name} className="text-sm leading-6">{category.name}<span className="text-xs text-muted-foreground"> · {category.wins} de {category.bids}</span></li>)}</ul></div>
            </div>
            <div className="space-y-2"><h3 className="text-sm font-semibold">Últimas ofertas</h3>
              <ul className="divide-y">{profile.recent.map(item => <li key={`${item.code}-${item.won}`} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1"><p className="text-sm leading-6">{item.won ? <Trophy className="mr-1 inline h-3.5 w-3.5 text-primary" aria-label="Ganó" /> : null}{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.agency || 'Organismo'} · {monthLabel(item.publishedOn)}{item.offered ? ` · ofertó ${moneyLabel(item.offered, item.currency)}` : ''}{item.estimatedAmount ? ` de ${moneyLabel(item.estimatedAmount, item.currency)} estimados` : ''}</p></div>
                <a href={tenderUrl(item.code)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.code}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(abre Mercado Público)</span></a>
              </li>)}</ul></div>
            <div className="flex justify-end">{followedIds.has(profile.supplier.id)
              ? <Button variant="outline" disabled={pending !== null} onClick={() => void follow(profile.supplier.id, false)}>Dejar de seguir</Button>
              : <Button disabled={pending !== null} onClick={() => void follow(profile.supplier.id, true)}>{pending === profile.supplier.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}Seguir</Button>}</div>
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
  </section>;
}
