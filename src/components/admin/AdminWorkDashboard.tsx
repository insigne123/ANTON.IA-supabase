'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WorkReport } from '@/lib/admin/work';
import { cn } from '@/lib/utils';

type Report = WorkReport & { days: number; period: { from: string; to: string } };
const PERIODS = [7, 30, 90] as const;
const n = (value: number) => value.toLocaleString('es-CL');
const usd = (value: number) => `US$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (at: string | null) => (at ? new Date(at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).replace(/(\p{L}{3})\./u, '$1') : '—');

/** A figure whose label may take two lines on a narrow column: the values stay on one baseline. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return <div className="flex min-w-0 flex-col justify-between gap-1 rounded-xl border border-border/60 p-3">
    <p className="text-xs leading-4 text-muted-foreground">{label}</p>
    <p className={cn('text-xl font-semibold tabular-nums', tone === 'warn' && 'text-destructive')}>{value}</p>
  </div>;
}

/** A budget at a glance: how much of it is used, with what it means in words. */
function Budget({ cap }: { cap: WorkReport['caps'][number] }) {
  const share = cap.limit > 0 ? Math.min(1, cap.used / cap.limit) : 0;
  return <Card className="border-border/60">
    <CardContent className="space-y-3 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{cap.label}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(share * 100)} %</span>
      </div>
      <div role="progressbar" aria-label={cap.label} aria-valuemin={0} aria-valuemax={cap.limit} aria-valuenow={Number(cap.used.toFixed(2))} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', share >= 0.9 ? 'bg-destructive' : share >= 0.7 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{cap.detail}</p>
      {cap.id === 'credits' ? <Link href="/dashboard/admin/credits" className="inline-block rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver créditos</Link> : null}
    </CardContent>
  </Card>;
}

/** The report itself, given the data: the page loads it, the tests render it. */
export function AdminWorkReport({ report }: { report: Report }) {
  const { opportunities: opp, cowork } = report;
  return <div className="space-y-6">
    <section aria-labelledby="work-budgets" className="space-y-3">
      <h2 id="work-budgets" className="text-base font-semibold">Presupuestos</h2>
      <div className="grid gap-3 md:grid-cols-3">{report.caps.map(cap => <Budget key={cap.id} cap={cap} />)}</div>
    </section>

    <Card className="border-border/60">
      <CardHeader className="pb-3"><CardTitle className="text-base"><h2>Oportunidades</h2></CardTitle>
        <p className="text-sm text-muted-foreground">{opp.activePeople ? `${opp.activePeople === 1 ? '1 persona trabajó' : `${n(opp.activePeople)} personas trabajaron`} oportunidades en el período.` : 'Nadie trabajó oportunidades en el período.'}</p></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Figure label="En curso" value={n(opp.inPlay)} />
          <Figure label="Vencidas sin presentar" value={n(opp.overdue)} tone={opp.overdue ? 'warn' : undefined} />
          <Figure label="Decisiones esperando" value={n(opp.waiting)} tone={opp.waiting ? 'warn' : undefined} />
          <Figure label="Presentadas" value={n(opp.submitted)} />
          <Figure label="Ganadas" value={n(opp.won)} />
          <Figure label="Perdidas" value={n(opp.lost)} />
        </div>
        {opp.people.length ? <div className="overflow-x-auto rounded-xl border border-border/60"><Table>
          <TableHeader><TableRow><TableHead>Persona</TableHead><TableHead className="text-right">En curso</TableHead><TableHead className="text-right">Acciones</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Presentadas</TableHead><TableHead className="hidden text-right sm:table-cell">Ganadas</TableHead><TableHead className="hidden md:table-cell">Último uso</TableHead></TableRow></TableHeader>
          <TableBody>{opp.people.map(person => <TableRow key={person.id}><TableCell className="font-medium">{person.name}</TableCell><TableCell className="text-right tabular-nums">{n(person.open)}</TableCell>
            <TableCell className="text-right tabular-nums">{n(person.actions)}</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{n(person.submitted)}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{n(person.won)}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{when(person.lastAt)}</TableCell></TableRow>)}</TableBody>
        </Table></div> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cuando alguien trabaje una oportunidad, aparecerá aquí. <Link href="/opportunities" className="font-medium text-primary underline-offset-2 hover:underline">Ir a Oportunidades</Link></p>}
      </CardContent>
    </Card>

    <Card className="border-border/60">
      <CardHeader className="pb-3"><CardTitle className="text-base"><h2>Cowork</h2></CardTitle>
        <p className="text-sm text-muted-foreground">{cowork.activePeople ? `${cowork.activePeople === 1 ? '1 persona lo usó' : `${n(cowork.activePeople)} personas lo usaron`} en el período.` : 'Nadie usó Cowork en el período.'}</p></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label="Conversaciones" value={n(cowork.conversations)} />
          <Figure label="Mensajes" value={n(cowork.turns)} />
          <Figure label="Personas" value={n(cowork.activePeople)} />
          <Figure label="Costo estimado" value={usd(cowork.costUsd)} />
        </div>
        {cowork.unknownCost ? <p className="text-xs text-muted-foreground">{cowork.unknownCost === 1 ? '1 llamada a la IA no tiene precio configurado' : `${n(cowork.unknownCost)} llamadas a la IA no tienen precio configurado`}: el costo real puede ser mayor.</p> : null}
        {cowork.people.length ? <div className="overflow-x-auto rounded-xl border border-border/60"><Table>
          <TableHeader><TableRow><TableHead>Persona</TableHead><TableHead className="text-right">Conversaciones</TableHead><TableHead className="hidden text-right sm:table-cell">Mensajes</TableHead>
            <TableHead className="text-right">Costo</TableHead><TableHead className="hidden md:table-cell">Último uso</TableHead></TableRow></TableHeader>
          <TableBody>{cowork.people.map(person => <TableRow key={person.id}><TableCell className="font-medium">{person.name}</TableCell><TableCell className="text-right tabular-nums">{n(person.conversations)}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{n(person.turns)}</TableCell><TableCell className="text-right tabular-nums">{usd(person.costUsd)}</TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">{when(person.lastAt)}</TableCell></TableRow>)}</TableBody>
        </Table></div> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cuando alguien converse con Cowork, aparecerá aquí.</p>}
      </CardContent>
    </Card>
  </div>;
}

/**
 * «Oportunidades y Cowork» (OPP-07, APP-14, COW-15): the three budgets side by side, who works the opportunities and how they end, and who
 * uses Cowork and what it costs, for the last 7, 30 or 90 days.
 */
export function AdminWorkDashboard() {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/dashboard/admin/work?days=${days}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No pudimos cargar el informe.');
      if (id === request.current) setReport(body);
    } catch (problem) { if (id === request.current) setError(problem instanceof Error ? problem.message : 'No pudimos cargar el informe.'); }
    finally { if (id === request.current) setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  return <div className="mx-auto w-full max-w-[1320px] pb-10">
    <PageHeader title="Oportunidades y Cowork" description="Quién trabaja las oportunidades, quién usa Cowork y cuánto queda de cada presupuesto.">
      <Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label="Actualizar el informe" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /></Button>
    </PageHeader>
    <div role="group" aria-label="Período" className="mb-5 flex flex-wrap gap-1.5">
      {PERIODS.map(value => <Button key={value} type="button" size="sm" variant={days === value ? 'secondary' : 'ghost'} aria-pressed={days === value} className={cn(days === value && 'font-semibold')} onClick={() => setDays(value)}>{value} días</Button>)}
    </div>
    {error ? <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button></div> : null}
    {report ? <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}><AdminWorkReport report={report} /></div>
      : loading ? <div className="space-y-4" aria-busy="true" aria-label="Cargando el informe"><div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-64 rounded-2xl" /></div> : null}
  </div>;
}
