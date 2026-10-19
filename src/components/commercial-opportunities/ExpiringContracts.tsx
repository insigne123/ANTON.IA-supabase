'use client';

// «Contratos por vencer» (propuesta 11): public contracts held by another company, that fit the workspace's offer and end
// in the coming months, when the buyer tenders them again (workspace-market.ts). One card per contract, the nearest end
// first, and «Seguir» turns it into an opportunity of the pipeline to arrive before the new tender.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRut, moneyLabel, tenderUrl } from '@/lib/public-procurement/market';
import type { ExpiringContract } from '@/lib/public-procurement/contracts';

type ContractsView = {
  available: boolean; coverage: { available: boolean; to: string | null }; updatedAt: string | null; read: number;
  contracts: ExpiringContract[]; job: { id: string; state: string; error: string | null; createdAt: string; updatedAt: string } | null;
};
const ACTIVE = ['queued', 'running', 'waiting'];
const DAY = 86_400_000;
const readDate = (at: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(new Date(at));
const endLabel = (endsOn: string, now: number) => {
  const days = Math.round((Date.parse(`${endsOn}T12:00:00Z`) - now) / DAY);
  const when = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${endsOn}T12:00:00Z`));
  if (days < 0) return { text: `Venció en ${when}`, soon: true };
  if (days <= 90) return { text: `Vence en ${days} ${days === 1 ? 'día' : 'días'}`, soon: true };
  return { text: `Vence en ${when}`, soon: false };
};

async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }

export function ExpiringContracts({ onOpen, onCriteria }: { onOpen: (id: string) => void; onCriteria?: () => void }) {
  const [data, setData] = useState<ContractsView | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState<number | null>(null);
  const [scope, setScope] = useState<'soon' | 'all'>('soon');
  // «Vence en 45 días» counts from when the list was read.
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try { setData(await json(await fetch('/api/commercial-opportunities/contracts', { cache: 'no-store' }))); setNow(Date.now()); setProblem(''); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudieron cargar los contratos.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const reading = Boolean(data?.job && ACTIVE.includes(data.job.state));
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => clearInterval(timer);
  }, [reading, load]);
  const refresh = async () => {
    setBusy(true); setProblem('');
    try { await json(await fetch('/api/commercial-opportunities/contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) })); await load(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };
  const follow = async (contract: ExpiringContract) => {
    setFollowing(contract.tenderId); setProblem('');
    try {
      const result = await json(await fetch('/api/commercial-opportunities/contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'follow', tenderId: contract.tenderId }) }));
      onOpen(result.id);
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo crear la oportunidad.'); }
    finally { setFollowing(null); }
  };
  const shown = useMemo(() => {
    const items = [...(data?.contracts || [])].sort((a, b) => String(a.endsOn).localeCompare(String(b.endsOn)));
    return scope === 'all' ? items : items.filter(item => !item.endsOn || Date.parse(`${item.endsOn}T12:00:00Z`) - now <= 183 * DAY);
  }, [data, scope, now]);
  const failed = data?.job && ['failed', 'blocked'].includes(data.job.state) ? data.job : null;

  if (!data && !problem) return <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando los contratos por vencer…</div>;

  return <section aria-labelledby="contracts-title" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-1">
        <h2 id="contracts-title" className="text-lg font-semibold">Contratos por vencer</h2>
        <p className="text-sm leading-6 text-muted-foreground">Contratos públicos que hoy tiene otra empresa, calzan con tu oferta y terminan pronto: el organismo volverá a licitarlos. Sirve para preparar la oferta y conversar con el área antes de que publique.</p>
      </div>
      {data?.available && (data.contracts.length || failed) && !reading ? <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Actualizar</Button> : null}
    </header>

    {problem ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => void load()}>Reintentar</Button></div> : null}

    {data && !data.available ? <div className="rounded-3xl border p-6 text-sm leading-6 text-muted-foreground">Aún no cargamos el historial de licitaciones de ChileCompra. Cuando esté, verás aquí los contratos que vencen y calzan con tu oferta.</div> : null}

    {data?.available && reading ? <p role="status" className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Revisando los contratos que vencen y eligiendo los que calzan con tu oferta. Tarda unos minutos.</p> : null}

    {failed && !reading ? <p role="alert" className="flex gap-2 rounded-2xl bg-destructive/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      {data?.contracts.length ? `La última revisión no terminó: ${failed.error || 'intenta de nuevo.'} Sigues viendo la anterior${data.updatedAt ? `, del ${readDate(data.updatedAt)}` : ''}.` : failed.error || 'La revisión no terminó. Intenta de nuevo.'}</p> : null}

    {data?.available && !data.contracts.length && !reading ? <div className="space-y-3 rounded-3xl border p-6">
      {data.updatedAt
        ? <><h3 className="font-semibold">No hay contratos por vencer que calcen con tu oferta</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Revisamos {data.read} {data.read === 1 ? 'contrato' : 'contratos'} que vencen en los próximos 15 meses con tus palabras para compras públicas. Si faltan formas de nombrar lo que vendes, agrégalas y vuelve a buscar.</p>
          <div className="flex flex-wrap gap-2">{onCriteria ? <Button variant="outline" onClick={onCriteria}>Revisar «Qué buscamos»</Button> : null}<Button variant="ghost" onClick={() => void refresh()} disabled={busy}>Buscar de nuevo</Button></div></>
        : <><h3 className="font-semibold">Descubre qué contratos se van a licitar de nuevo</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Buscamos en los contratos adjudicados de los últimos 4 años los que terminan en los próximos meses, y la IA deja los que podrías ganar cuando se liciten otra vez, con quién los tiene y por cuánto. Se actualiza solo cada mes.</p>
          <Button onClick={() => void refresh()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Buscar contratos por vencer</Button></>}
    </div> : null}

    {data?.contracts.length ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><span className="font-semibold tabular-nums">{shown.length}</span> {shown.length === 1 ? 'contrato' : 'contratos'}{scope === 'soon' ? ' vencen en los próximos 6 meses' : ' por vencer'}</p>
        <div role="group" aria-label="Período" className="inline-flex rounded-xl bg-muted p-1">{([['soon', 'Próximos 6 meses'], ['all', 'Todos']] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)} className={cn('rounded-lg px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', scope === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}</div>
      </div>
      {!shown.length ? <p className="rounded-2xl border p-5 text-sm text-muted-foreground">Ninguno vence en los próximos 6 meses. Mira «Todos» para ver los que vienen después.</p> : null}
      <ul className="grid gap-3 xl:grid-cols-2">
        {shown.map(contract => {
          const end = contract.endsOn ? endLabel(contract.endsOn, now) : null;
          const amount = moneyLabel(contract.amount, contract.currency);
          return <li key={contract.tenderId} className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {end ? <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', end.soon ? 'bg-cw-warning-soft text-foreground' : 'bg-muted text-muted-foreground')}><CalendarClock className="h-3 w-3" aria-hidden="true" />{end.text}</span> : null}
              {contract.fit === 'alta' ? <span className="rounded-full bg-cw-success-soft px-2 py-0.5 text-foreground">Calce alto</span> : null}
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold leading-6">{contract.name}</h3>
              <p className="text-sm text-muted-foreground">{contract.agency || 'Organismo sin nombre'}{contract.region ? ` · ${contract.region}` : ''}</p>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Lo tiene</dt><dd>{contract.winnerName || 'Sin dato'}{contract.winners > 1 ? ` y ${contract.winners - 1} más` : ''}{contract.winnerRut ? <span className="block text-xs text-muted-foreground">RUT {formatRut(contract.winnerRut)}</span> : null}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Monto y plazo</dt><dd className="tabular-nums">{amount || 'Sin monto'}{contract.durationMonths ? <span className="text-muted-foreground"> · {contract.durationMonths} meses</span> : null}</dd></div>
            </dl>
            {contract.reason ? <p className="text-xs leading-5 text-muted-foreground">{contract.reason}</p> : null}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={following !== null} onClick={() => void follow(contract)} aria-label={`Seguir: ${contract.name}`}>
                {following === contract.tenderId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}Seguir
              </Button>
              <a href={tenderUrl(contract.code)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Ver licitación {contract.code}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(abre Mercado Público)</span></a>
            </div>
          </li>;
        })}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">Fuente: datos abiertos de ChileCompra{data.coverage.to ? ` hasta ${new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.coverage.to}T12:00:00Z`))}` : ''}. El término es estimado (adjudicación más duración del contrato): una prórroga o un trato directo pueden moverlo. «Seguir» lo agrega a tus oportunidades para prepararte.</p>
    </> : null}
  </section>;
}
