'use client';

// «Cómo ganar» (propuesta 9): what this buyer bought before that looks like this tender, who won and at what price, and
// the strategy the AI draws from it (workspace-market.ts). The history is public data from ChileCompra; the strategy is a
// paid job the person asks for, once, with one button.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Landmark, Loader2, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRut, moneyLabel, percentLabel, tenderUrl, type MarketStats, type MarketTender } from '@/lib/public-procurement/market';
import type { WinPlan as WinPlanData } from '@/lib/public-procurement/win-plan';

type Similar = MarketTender & { score: number };
export type MarketView = {
  applicable: boolean;
  history?: {
    available: boolean; agency: { ids: number[]; name: string; sector: string | null } | null; similar: Similar[]; agencyStats: MarketStats | null;
    market: { similar: Similar[]; stats: MarketStats } | null; coverage: { available: boolean; from: string | null; to: string | null; loadedAt: string | null };
  };
  plan?: { jobId: string; createdAt: string; plan: WinPlanData; basis: { agency: string | null; similar: number; market: number } | null } | null;
  job?: { id: string; state: string; error: string | null; createdAt: string } | null;
};
const ACTIVE = ['queued', 'running', 'waiting'];
const STATUS: Record<string, string> = { adjudicada: 'Adjudicada', cerrada: 'En evaluación', desierta: 'Desierta', revocada: 'Revocada', suspendida: 'Suspendida', publicada: 'Publicada', otra: 'Otro estado' };
const CONFIDENCE: Record<string, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };
const monthLabel = (value: string | null) => value ? new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : 'Sin fecha';
const SHOWN = 5;

async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }

/** «8 parecidas · 0 desiertas · 4 oferentes (mediana) · 85 % del estimado», as one line the screen reader reads once. */
function Stats({ stats, own }: { stats: MarketStats; own: boolean }) {
  const items: Array<[string | null, string]> = [
    [`${stats.tenders}`, stats.tenders === 1 ? 'parecida' : 'parecidas'],
    ...(own ? [[`${stats.deserted}`, stats.deserted === 1 ? 'desierta' : 'desiertas'] as [string, string]] : []),
    [stats.medianBidders === null ? null : `${stats.medianBidders}`, 'oferentes (mediana)'],
    stats.medianAwardRatio === null ? [null, 'sin estimado publicado para comparar precios'] : [percentLabel(stats.medianAwardRatio), 'del estimado se adjudicó (mediana)'],
  ];
  const shown = items.filter(([value, label]) => value !== null || label.startsWith('sin'));
  return <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">{shown.map(([value, label]) => <span key={label}>{value !== null ? <span className="font-semibold tabular-nums">{value} </span> : null}<span className="text-muted-foreground">{label}</span></span>)}</p>;
}

// The model writes sentences with or without a final period: the page adds one, once.
const sentence = (text: string) => `${text.trim().replace(/[.\s]+$/, '')}.`;

function TenderRow({ tender, showAgency }: { tender: Similar; showAgency: boolean }) {
  const winner = tender.winners[0];
  return <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0 flex-1 space-y-0.5">
      <p className="text-sm leading-6">{tender.name}</p>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{monthLabel(tender.publishedOn)}</span>
        <span className={cn(tender.status === 'desierta' && 'text-foreground')}>{STATUS[tender.status] ?? tender.status}</span>
        {tender.bidders !== null ? <span className="tabular-nums">{tender.bidders} {tender.bidders === 1 ? 'oferente' : 'oferentes'}</span> : null}
        {showAgency && tender.agency ? <span className="min-w-0 truncate">{tender.agency}</span> : null}
      </p>
      {winner ? <p className="text-xs leading-5"><Trophy className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden="true" />Ganó {winner.name}{winner.amount ? <span className="tabular-nums"> por {moneyLabel(winner.amount, tender.currency)}</span> : null}
        {tender.estimatedAmount && tender.awardedAmount && tender.currency === 'CLP' ? <span className="text-muted-foreground"> · estimado {moneyLabel(tender.estimatedAmount)}</span> : null}</p> : null}
    </div>
    <a href={tenderUrl(tender.code)} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {tender.code}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(abre Mercado Público)</span></a>
  </li>;
}

function TenderList({ tenders, label, showAgency = true }: { tenders: Similar[]; label: string; showAgency?: boolean }) {
  const [all, setAll] = useState(false);
  return <>
    <ul aria-label={label} className="divide-y">{(all ? tenders : tenders.slice(0, SHOWN)).map(tender => <TenderRow key={tender.id} tender={tender} showAgency={showAgency} />)}</ul>
    {tenders.length > SHOWN ? <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? 'Ver menos' : `Ver ${tenders.length - SHOWN} más`}</Button> : null}
  </>;
}

function Strategy({ data, onPrepare, busy }: { data: NonNullable<MarketView['plan']>; onPrepare: () => void; busy: boolean }) {
  const { plan } = data;
  const range = plan.price.low !== null && plan.price.high !== null ? `${moneyLabel(plan.price.low)} a ${moneyLabel(plan.price.high)}` : null;
  return <section aria-labelledby="winplan-title" className="space-y-5 rounded-3xl border bg-background p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h3 id="winplan-title" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />Estrategia sugerida</h3>
        <p className="text-xs text-muted-foreground">{CONFIDENCE[plan.confidence]} · basada en {plan.evidence.similar} {plan.evidence.similar === 1 ? 'licitación parecida' : 'licitaciones parecidas'} del organismo y {plan.evidence.market} del mercado</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onPrepare} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Preparar de nuevo</Button>
    </div>
    <p className="max-w-3xl text-sm leading-6">{sentence(plan.summary)}</p>
    <div className="rounded-2xl bg-muted/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rango de precio</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{range ?? 'Sin rango con estos datos'}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{sentence(plan.price.basis)}</p>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      {plan.highlights.length ? <div className="space-y-2"><h4 className="text-sm font-semibold">Qué destacar en tu oferta</h4>
        <ul className="space-y-2">{plan.highlights.map(item => <li key={item.text} className="text-sm leading-6"><span className="font-medium">{sentence(item.text)}</span> <span className="text-muted-foreground">{sentence(item.why)}</span></li>)}</ul></div> : null}
      {plan.risks.length ? <div className="space-y-2"><h4 className="text-sm font-semibold">Riesgos</h4>
        <ul className="space-y-2">{plan.risks.map(risk => <li key={risk} className="flex gap-2 text-sm leading-6"><AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{sentence(risk)}</li>)}</ul></div> : null}
    </div>
    {plan.competitors.length ? <div className="space-y-2"><h4 className="text-sm font-semibold">A quién tendrás enfrente</h4>
      <ul className="space-y-2">{plan.competitors.map(item => <li key={item.rut} className="text-sm leading-6"><span className="font-medium">{item.name}</span> <span className="text-xs text-muted-foreground">RUT {formatRut(item.rut)}{item.wins ? ` · ganó ${item.wins} de las parecidas` : ''}</span><br /><span className="text-muted-foreground">{sentence(item.why)}</span></li>)}</ul></div> : null}
    <p className="text-xs leading-5 text-muted-foreground">Preparada el {new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(new Date(data.createdAt))}. Es una sugerencia sobre datos históricos: revisa las bases antes de decidir el precio.</p>
  </section>;
}

export function WinPlan({ id }: { id: string }) {
  const [data, setData] = useState<MarketView | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const value = await json(await fetch(`/api/commercial-opportunities/${id}/market`, { cache: 'no-store', signal })); if (!signal?.aborted) { setData(value); setProblem(''); } }
    catch (e) { if (!signal?.aborted) setProblem(e instanceof Error ? e.message : 'No se pudo cargar el historial.'); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const preparing = Boolean(data?.job && ACTIVE.includes(data.job.state));
  // While the strategy is written (about a minute), the tab asks again every 8 s, never in a hidden tab.
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 8000);
    return () => clearInterval(timer);
  }, [preparing, load]);
  const prepare = async () => {
    setBusy(true); setProblem('');
    try { await json(await fetch(`/api/commercial-opportunities/${id}/market`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'winplan', requestId: crypto.randomUUID() }) })); await load(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo preparar la estrategia.'); }
    finally { setBusy(false); }
  };

  if (!data && !problem) return <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Buscando el historial de este organismo…</div>;
  const history = data?.history;
  const failed = data?.job && ['failed', 'blocked'].includes(data.job.state) && data.job.id !== data.plan?.jobId ? data.job : null;
  const comparable = Boolean(history?.similar.length || history?.market?.similar.length);

  return <section aria-labelledby="market-title" className="space-y-6">
    <header className="max-w-3xl space-y-1">
      <h2 id="market-title" className="text-lg font-semibold">Cómo ganar</h2>
      <p className="text-sm leading-6 text-muted-foreground">Lo que este organismo compró antes, quién ganó y a qué precio, y una estrategia para tu oferta. Datos abiertos de ChileCompra{history?.coverage.to ? ` hasta ${monthLabel(history.coverage.to)}` : ''}.</p>
    </header>

    {problem ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => void load()}>Reintentar</Button></div> : null}

    {history && !history.available ? <div className="rounded-3xl border p-6 text-sm leading-6 text-muted-foreground">Aún no cargamos el historial de licitaciones de ChileCompra. Cuando esté, verás aquí qué compró este organismo, quién ganó y a qué precio.</div> : null}

    {history?.available ? <>
      {data?.plan ? <Strategy data={data.plan} onPrepare={() => void prepare()} busy={busy || preparing} /> : null}
      {preparing ? <p role="status" className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />La IA cruza el historial con las bases y tu ficha. Tarda cerca de un minuto.</p> : null}
      {failed && !preparing ? <p role="alert" className="flex gap-2 rounded-2xl bg-destructive/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />{failed.error || 'La estrategia no terminó. Intenta de nuevo.'}</p> : null}
      {!data?.plan && !preparing ? <div className="space-y-3 rounded-3xl border p-5 sm:p-6">
        <h3 className="font-semibold">{comparable ? 'Prepara la estrategia para esta licitación' : 'No hay licitaciones parecidas para comparar'}</h3>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{comparable
          ? 'La IA cruza este historial con las bases y tu ficha para licitaciones: un rango de precio apoyado en lo que realmente se pagó, qué destacar, los riesgos y a quién tendrás enfrente.'
          : 'No encontramos compras parecidas de este organismo ni de otros en los datos de ChileCompra. Sin historial, la estrategia no tendría en qué apoyarse.'}</p>
        {comparable ? <Button onClick={() => void prepare()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}Preparar estrategia</Button> : null}
      </div> : null}

      <section aria-labelledby="agency-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="agency-title" className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Este organismo</h3>
          {history.agency ? <p className="text-xs text-muted-foreground">{history.agency.name}</p> : null}
        </div>
        {!history.agency ? <p className="rounded-2xl border p-5 text-sm text-muted-foreground">No encontramos a este comprador en los datos de ChileCompra con ese nombre. Abajo ves lo que pagaron otros organismos por lo mismo.</p>
          : !history.similar.length ? <p className="rounded-2xl border p-5 text-sm text-muted-foreground">En los últimos 3 años este organismo no licitó algo parecido. Abajo ves lo que pagaron otros por lo mismo.</p>
            : <div className="space-y-4 rounded-2xl border p-5">{history.agencyStats ? <Stats stats={history.agencyStats} own /> : null}<TenderList tenders={history.similar} label="Licitaciones parecidas de este organismo" showAgency={false} /></div>}
      </section>

      {history.market ? <section aria-labelledby="others-title" className="space-y-3">
        <h3 id="others-title" className="font-semibold">Otros organismos, último año</h3>
        <div className="space-y-4 rounded-2xl border p-5">
          <Stats stats={history.market.stats} own={false} />
          {history.market.stats.winners.filter(winner => winner.wins >= 2).length ? <p className="text-sm leading-6"><span className="text-muted-foreground">Ganan seguido: </span>{history.market.stats.winners.filter(winner => winner.wins >= 2).slice(0, 3).map(winner => `${winner.name} (${winner.wins})`).join(', ')}</p> : null}
          <TenderList tenders={history.market.similar} label="Licitaciones parecidas de otros organismos" />
        </div>
      </section> : null}
    </> : null}
  </section>;
}
