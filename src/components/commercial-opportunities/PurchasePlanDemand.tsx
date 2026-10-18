'use client';

// «Demanda futura»: what public bodies plan to buy this year that fits the workspace's offer, from their Plan Anual de
// Compras (purchase-plan.ts). A third view of the admin, next to «Embudo» and «Lista»: one body per card, what is still to
// buy first, and «Seguir» turns a line into an opportunity of the pipeline.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Landmark, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PURCHASE_PLAN_SOURCE, groupPlanDemand, planMonthLabel, type PurchasePlanMatch } from '@/lib/commercial-opportunities/purchase-plan';

export type DemandView = {
  available: boolean; year: number | null; updatedAt: string | null; matches: PurchasePlanMatch[]; keywords: string[];
  job: { id: string; state: string; error: string | null; createdAt: string; updatedAt: string; result: any } | null;
};
const ACTIVE = ['queued', 'running', 'waiting'];
const money = (n: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))}`;
const short = (n: number) => n >= 1e9 ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n / 1e9)} mil millones`
  : n >= 1e6 ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n / 1e6)} millones` : money(n);
const LINES_SHOWN = 4;

async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }

export function PurchasePlanDemand({ onOpen, onCriteria }: { onOpen: (id: string) => void; onCriteria?: () => void }) {
  const [data, setData] = useState<DemandView | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState<string | null>(null);
  const [scope, setScope] = useState<'ahead' | 'all'>('ahead');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    try { setData(await json(await fetch('/api/commercial-opportunities/demand', { cache: 'no-store' }))); setProblem(''); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar la demanda futura.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const reading = Boolean(data?.job && ACTIVE.includes(data.job.state));
  // While ChileCompra's file is read (a few minutes), the view asks again every 10 s, never in a hidden tab.
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => clearInterval(timer);
  }, [reading, load]);
  const refresh = async () => {
    setBusy(true); setProblem('');
    try { await json(await fetch('/api/commercial-opportunities/demand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) })); await load(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };
  const follow = async (line: PurchasePlanMatch) => {
    if (!data?.year) return;
    setFollowing(line.lineId); setProblem('');
    try {
      const result = await json(await fetch('/api/commercial-opportunities/demand', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'follow', year: data.year, lineId: line.lineId }) }));
      onOpen(result.id);
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo crear la oportunidad.'); }
    finally { setFollowing(null); }
  };
  const view = useMemo(() => data?.year ? groupPlanDemand(data.matches, new Date(), data.year) : null, [data]);
  const groups = useMemo(() => !view ? [] : scope === 'all' ? view.groups
    : view.groups.map(group => ({ ...group, lines: group.lines.filter(view.isAhead) })).filter(group => group.lines.length), [view, scope]);
  const failed = data?.job && ['failed', 'blocked'].includes(data.job.state) ? data.job : null;

  if (!data && !problem) return <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando la demanda futura…</div>;

  return <section aria-labelledby="demand-title" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-1">
        <h2 id="demand-title" className="text-lg font-semibold">Demanda futura{data?.year ? ` ${data.year}` : ''}</h2>
        <p className="text-sm leading-6 text-muted-foreground">Lo que los organismos públicos planean comprar este año y calza con tu oferta, según el Plan Anual de Compras que cada uno publica. Sirve para llegar antes de que liciten.</p>
      </div>
      {data?.available && (data.matches.length || failed) && !reading ? <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Actualizar</Button> : null}
    </header>

    {problem ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => void load()}>Reintentar</Button></div> : null}

    {data && !data.available ? <div className="rounded-3xl border p-6 text-sm text-muted-foreground">La demanda futura estará disponible en cuanto terminemos de preparar esta función en tu workspace.</div> : null}

    {data?.available && reading ? <p role="status" className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Leyendo el Plan Anual de Compras de ChileCompra y eligiendo lo que calza con tu oferta. Tarda unos minutos.</p> : null}

    {failed && !reading ? <p role="alert" className="flex gap-2 rounded-2xl bg-destructive/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />{failed.error || 'La lectura no terminó. Intenta de nuevo.'}</p> : null}

    {data?.available && !data.matches.length && !reading ? <div className="space-y-3 rounded-3xl border p-6">
      {data.job?.state === 'ready'
        ? <><h3 className="font-semibold">El plan de este año no tiene compras que calcen con tu oferta</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Buscamos con tus palabras para compras públicas{data.keywords.length ? ` (${data.keywords.slice(0, 6).join(', ')}${data.keywords.length > 6 ? '…' : ''})` : ''}. Si faltan formas de nombrar lo que vendes, agrégalas y vuelve a buscar.</p>
          <div className="flex flex-wrap gap-2">{onCriteria ? <Button variant="outline" onClick={onCriteria}>Revisar «Qué buscamos»</Button> : null}<Button variant="ghost" onClick={() => void refresh()} disabled={busy}>Buscar de nuevo</Button></div></>
        : <><h3 className="font-semibold">Descubre qué planea comprar el Estado</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Revisamos el Plan Anual de Compras de los cerca de mil organismos que lo publican y la IA deja las compras que podrías venderles, con el monto y el mes estimados. Se actualiza solo cada mes.</p>
          <Button onClick={() => void refresh()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Buscar demanda futura</Button></>}
    </div> : null}

    {view && data?.matches.length ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><span className="font-semibold tabular-nums">{view.groups.length}</span> organismos · <span className="font-semibold tabular-nums">{short(view.upcoming)}</span> por comprar de aquí a fin de año<span className="text-muted-foreground"> · {short(view.total)} en todo el plan</span></p>
        <div role="group" aria-label="Período" className="inline-flex rounded-xl bg-muted p-1">{([['ahead', 'Lo que viene'], ['all', 'Todo el año']] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)} className={cn('rounded-lg px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', scope === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}</div>
      </div>
      {!groups.length ? <p className="rounded-2xl border p-5 text-sm text-muted-foreground">Las compras que calzan ya estaban planificadas para meses anteriores. Mira «Todo el año» para ver a quién le compran y prepararte para el próximo plan.</p> : null}
      <ul className="grid gap-3 xl:grid-cols-2">
        {groups.map(group => {
          const key = group.institutionCode || group.institution;
          const shown = open[key] ? group.lines : group.lines.slice(0, LINES_SHOWN);
          return <li key={key} className="space-y-3 rounded-2xl border bg-background p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex min-w-0 items-start gap-2 text-sm font-semibold leading-6"><Landmark className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{group.institution}</span></h3>
              <p className="shrink-0 text-right text-sm font-semibold tabular-nums">{short(scope === 'all' ? group.total : group.upcoming)}</p>
            </div>
            <ul className="divide-y">
              {shown.map(line => <li key={line.lineId} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm leading-6">{line.description}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" aria-hidden="true" />{planMonthLabel(line.month, line.quarter)}</span>
                    {line.amount ? <span className="tabular-nums">{money(line.amount)}</span> : <span>Sin monto</span>}
                    {line.fit === 'alta' ? <span className="rounded-full bg-cw-success-soft px-2 py-0.5 text-foreground">Calce alto</span> : null}
                  </p>
                  {line.reason ? <p className="text-xs leading-5 text-muted-foreground">{line.reason}</p> : null}
                </div>
                <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" disabled={following !== null} onClick={() => void follow(line)} aria-label={`Seguir: ${line.description}`}>
                  {following === line.lineId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}Seguir
                </Button>
              </li>)}
            </ul>
            {group.lines.length > LINES_SHOWN ? <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={Boolean(open[key])} onClick={() => setOpen(current => ({ ...current, [key]: !current[key] }))}>
              {open[key] ? 'Ver menos' : `Ver ${group.lines.length - LINES_SHOWN} más`}
            </Button> : null}
          </li>;
        })}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">Fuente: {PURCHASE_PLAN_SOURCE}. El plan es referencial: un organismo puede comprar menos, en otra fecha o por otro mecanismo (licitación, Compra Ágil o convenio marco). «Seguir» la agrega a tus oportunidades para prepararte.</p>
    </> : null}
  </section>;
}
