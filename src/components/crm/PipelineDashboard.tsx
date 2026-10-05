'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, Minus, Sparkles } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PipelineStage } from '@/lib/crm-types';
import {
  DASHBOARD_ORIGINS, DASHBOARD_PERIODS, buildPipelineDashboard, filterPipelineRows, pipelineOwners, trendText,
  type DashboardOrigin, type DashboardPeriod, type Trend,
} from '@/lib/pipeline-dashboard';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { cn } from '@/lib/utils';

/**
 * The pipeline as a CRM panel (Plan 11, PR 4a), after the reference the user shared: figures with their comparison, the
 * open pipeline by stage (a donut), how far each stage gets, contacts per month against their recent average, the new
 * leads of 13 months, and sentences that read it. One filter row scopes everything below it. The stage colors are the
 * ordinal ramp of the primary blue (--pipeline-stage-1..6); every chart has its table.
 */
const STAGE_COLOR: Record<PipelineStage, string> = {
  inbox: 'hsl(var(--pipeline-stage-1))', qualified: 'hsl(var(--pipeline-stage-2))', contacted: 'hsl(var(--pipeline-stage-3))',
  engaged: 'hsl(var(--pipeline-stage-4))', meeting: 'hsl(var(--pipeline-stage-5))', negotiation: 'hsl(var(--pipeline-stage-6))',
  closed_won: 'var(--cw-success)', closed_lost: 'hsl(var(--muted-foreground))',
};
const PERIOD_KEY = 'anton.crm.period';
const number = new Intl.NumberFormat('es-CL');
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

export function PipelineDashboard({ rows, onOpenStage, pending, refreshedAt, now }: {
  rows: UnifiedRow[];
  onOpenStage: (stage: PipelineStage) => void;
  /** Suggested stage changes waiting for confirmation, by the stage they propose. */
  pending?: Partial<Record<PipelineStage, number>>;
  /** When the rows were last read; the panel says how fresh it is. */
  refreshedAt?: number | null;
  now?: number;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const [owner, setOwner] = useState('all');
  const [origin, setOrigin] = useState<DashboardOrigin>('all');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PERIOD_KEY);
      if (DASHBOARD_PERIODS.some(item => item.id === stored)) setPeriod(stored as DashboardPeriod);
    } catch { /* storage unavailable */ }
  }, []);
  const choosePeriod = (next: DashboardPeriod) => {
    setPeriod(next);
    try { window.localStorage.setItem(PERIOD_KEY, next); } catch { /* storage unavailable */ }
  };

  const owners = useMemo(() => pipelineOwners(rows), [rows]);
  const filtered = useMemo(() => filterPipelineRows(rows, { owner, origin }), [rows, owner, origin]);
  const panel = useMemo(() => buildPipelineDashboard(filtered, { now, period }), [filtered, now, period]);
  const previous = panel.period.short;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Filtros del panel">
        <Select value={period} onValueChange={value => choosePeriod(value as DashboardPeriod)}>
          <SelectTrigger className="h-9 w-full sm:w-[170px]" aria-label="Período"><SelectValue /></SelectTrigger>
          <SelectContent>{DASHBOARD_PERIODS.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="h-9 w-full sm:w-[220px]" aria-label="Responsable"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los responsables</SelectItem>
            {owners.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={origin} onValueChange={value => setOrigin(value as DashboardOrigin)}>
          <SelectTrigger className="h-9 w-full sm:w-[200px]" aria-label="Origen"><SelectValue /></SelectTrigger>
          <SelectContent>{DASHBOARD_ORIGINS.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground sm:ml-auto" aria-live="polite">
          {refreshedAt ? `Actualizado ${freshness(refreshedAt, now)} · se actualiza solo` : 'Se actualiza solo'}
        </p>
      </div>

      {panel.insights.length ? (
        <section aria-label="Lectura del pipeline" className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Lectura</p>
          <ul className="mt-2 space-y-1.5">
            {panel.insights.map(insight => (
              <li key={insight.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground">
                <span>{insight.text}</span>
                {insight.stage ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenStage(insight.stage!)}>
                    Ver «{panel.stages.find(slice => slice.stage === insight.stage)?.label}» <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Cifras del pipeline" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Abiertos" value={number.format(panel.open)} caption={`de ${number.format(panel.total)} en el pipeline`} />
        <Tile label="Leads nuevos" value={number.format(panel.newLeads.value)} trend={panel.newLeads} previous={previous} />
        <Tile label="Contactados" value={number.format(panel.contacted.value)} trend={panel.contacted} previous={previous} />
        <Tile label="Tasa de respuesta" value={percent(panel.responseRate.value)}
          caption={panel.responseRate.deltaPoints === null ? `de ${number.format(panel.contacted.value)} contactados`
            : panel.responseRate.deltaPoints === 0 ? `igual que ${previous}`
              : `${panel.responseRate.deltaPoints > 0 ? '+' : '−'}${Math.abs(panel.responseRate.deltaPoints)} pts vs ${previous}`}
          direction={panel.responseRate.deltaPoints === null ? undefined : panel.responseRate.deltaPoints > 0 ? 'up' : panel.responseRate.deltaPoints < 0 ? 'down' : 'flat'} />
        <Tile label="En reunión o más" value={number.format(panel.meetings)} caption="reunión, negociación o ganado" />
        <Tile label="% ganados" value={percent(panel.winRate)} caption={`${panel.won} ${panel.won === 1 ? 'ganado' : 'ganados'} · ${panel.lost} ${panel.lost === 1 ? 'perdido' : 'perdidos'}`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pipeline abierto por etapa" subtitle={`${number.format(panel.open)} leads abiertos · toca una etapa para verlos`}
          table={<DataTable head={['Etapa', 'Leads', '% del abierto']} rows={panel.stages.map(slice => [slice.label, number.format(slice.count), percent(slice.share)])} />}>
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative mx-auto aspect-square w-full max-w-[240px]">
              <ChartContainer config={{}} className="aspect-square h-full w-full" aria-label={`Pipeline abierto por etapa: ${panel.stages.map(slice => `${slice.label} ${slice.count}`).join(', ')}`}>
                <PieChart>
                  <Tooltip cursor={false} content={<ChartTooltipContent hideIndicator formatter={(value, name) => <StageReadout name={String(name)} value={Number(value)} total={panel.open} />} />} />
                  <Pie data={panel.stages.filter(slice => slice.count > 0)} dataKey="count" nameKey="label" rootTabIndex={-1} innerRadius="62%" outerRadius="92%" stroke="hsl(var(--card))" strokeWidth={2}
                    isAnimationActive={false} onClick={(slice: { stage?: PipelineStage }) => slice?.stage && onOpenStage(slice.stage)} className="cursor-pointer">
                    {panel.stages.filter(slice => slice.count > 0).map(slice => (
                      <Cell key={slice.stage} fill={STAGE_COLOR[slice.stage]} aria-label={`${slice.label}: ${slice.count} (${percent(slice.share)})`} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold text-foreground">{number.format(panel.open)}</span>
                <span className="text-xs text-muted-foreground">abiertos</span>
              </div>
            </div>
            <ul className="space-y-1" aria-label="Etapas">
              {panel.stages.map(slice => (
                <li key={slice.stage}>
                  <button type="button" onClick={() => onOpenStage(slice.stage)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: STAGE_COLOR[slice.stage] }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
                    {pending?.[slice.stage] ? <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">{pending[slice.stage]} por confirmar</span> : null}
                    <span className="tabular-nums text-foreground">{number.format(slice.count)}</span>
                    <span className="w-11 text-right tabular-nums text-xs text-muted-foreground">{percent(slice.share)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="Avance por etapa" subtitle="Cuántos llegaron a cada etapa y qué parte siguió a la siguiente"
          table={<DataTable head={['Etapa', 'Llegaron', 'Siguieron']} rows={panel.funnel.map(step => [step.label, number.format(step.reached), percent(step.conversionToNext)])} />}>
          <ol className="space-y-2">
            {panel.funnel.map(step => {
              const max = Math.max(1, panel.funnel[0]?.reached || 1);
              return (
                <li key={step.stage}>
                  <button type="button" onClick={() => onOpenStage(step.stage)}
                    className="group w-full rounded-lg px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-foreground">{step.label}</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-medium tabular-nums text-foreground">{number.format(step.reached)}</span>
                        {step.conversionToNext !== null ? ` · ${percent(step.conversionToNext)} siguió` : ''}
                      </span>
                    </span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full transition-[width] group-hover:opacity-90"
                        style={{ width: `${Math.max(step.reached ? 2 : 0, (step.reached / max) * 100)}%`, background: STAGE_COLOR[step.stage] }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Perdidos: {number.format(panel.lost)}. Pueden salir de cualquier etapa, por eso van aparte.</p>
        </ChartCard>

        <ChartCard title="Contactos por mes" subtitle={panel.contactedThreshold === null ? 'Correos de primer contacto enviados cada mes'
          : `La línea es tu promedio de los 3 meses anteriores: ${number.format(panel.contactedThreshold)} por mes`}
          table={<DataTable head={['Mes', 'Contactados', 'Respondieron', 'Tasa']} rows={panel.months.slice(-6).map(month => [month.label, number.format(month.contacted), number.format(month.replied), percent(month.responseRate)])} />}>
          <ChartContainer config={{ contacted: { label: 'Contactados', color: 'hsl(var(--primary))' } }} className="aspect-auto h-[230px] w-full"
            aria-label={`Contactos por mes: ${panel.months.slice(-6).map(month => `${month.label} ${month.contacted}`).join(', ')}`}>
            <BarChart data={panel.months.slice(-6)} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltipContent indicator="line"
                formatter={(value, _name, item) => <MonthReadout contacted={Number(value)} replied={Number(item?.payload?.replied || 0)} />} />} />
              {panel.contactedThreshold !== null ? (
                // The subtitle names the line; a label inside the plot would sit on the latest bar.
                <ReferenceLine y={panel.contactedThreshold} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
              ) : null}
              <Bar dataKey="contacted" fill="var(--color-contacted)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Leads nuevos, últimos 13 meses" subtitle="Personas que entraron al pipeline cada mes"
          table={<DataTable head={['Mes', 'Leads nuevos']} rows={panel.months.map(month => [month.label, number.format(month.newLeads)])} />}>
          <ChartContainer config={{ newLeads: { label: 'Leads nuevos', color: 'hsl(var(--primary))' } }} className="aspect-auto h-[230px] w-full"
            aria-label={`Leads nuevos por mes: ${panel.months.map(month => `${month.label} ${month.newLeads}`).join(', ')}`}>
            <AreaChart data={panel.months} margin={{ top: 16, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={16} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <Tooltip cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} content={<ChartTooltipContent indicator="line" />} />
              <Area dataKey="newLeads" type="monotone" stroke="var(--color-newLeads)" strokeWidth={2} fill="var(--color-newLeads)" fillOpacity={0.1}
                dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function freshness(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  return minutes < 1 ? 'recién' : minutes === 1 ? 'hace 1 min' : `hace ${minutes} min`;
}

function Tile({ label, value, caption, trend, previous, direction }: {
  label: string; value: string; caption?: string; trend?: Trend; previous?: string; direction?: Trend['direction'];
}) {
  const way = trend?.direction ?? direction;
  const Icon = way === 'up' ? ArrowUpRight : way === 'down' ? ArrowDownRight : way === 'flat' ? Minus : null;
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        {Icon ? <Icon className={cn('h-3.5 w-3.5 shrink-0', way === 'up' ? 'text-cw-success' : way === 'down' ? 'text-cw-danger' : 'text-muted-foreground')} aria-hidden="true" /> : null}
        <span>{trend && previous ? trendText(trend.delta, previous) : caption}</span>
      </p>
    </div>
  );
}

function ChartCard({ title, subtitle, table, children }: { title: string; subtitle: string; table: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-3">{children}</div>
      <Collapsible className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group h-7 px-2 text-xs text-muted-foreground">
            Ver como tabla <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>{table}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-1 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>{head.map((cell, index) => <th key={cell} scope="col" className={cn('px-2.5 py-1.5 font-medium', index > 0 && 'text-right')}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row[0]} className="border-t border-border/60">
              {row.map((cell, index) => <td key={index} className={cn('px-2.5 py-1.5 text-foreground', index > 0 && 'text-right tabular-nums')}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageReadout({ name, value, total }: { name: string; value: number; total: number }) {
  return (
    <span className="flex w-full items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{name}</span>
      <span className="font-semibold tabular-nums text-foreground">{number.format(value)} <span className="font-normal text-muted-foreground">({percent(total ? value / total : 0)})</span></span>
    </span>
  );
}

function MonthReadout({ contacted, replied }: { contacted: number; replied: number }) {
  return (
    <span className="grid w-full gap-0.5">
      <span className="flex justify-between gap-3"><span className="text-muted-foreground">Contactados</span><span className="font-semibold tabular-nums text-foreground">{number.format(contacted)}</span></span>
      <span className="flex justify-between gap-3"><span className="text-muted-foreground">Respondieron</span>
        <span className="tabular-nums text-foreground">{number.format(replied)}{contacted ? ` (${percent(replied / contacted)})` : ''}</span></span>
    </span>
  );
}

