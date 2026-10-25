'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { sharePercent, type MonthPoint } from '@/lib/pipeline-dashboard';

/** The two recharts charts of the pipeline panel, apart so the panel loads them once they show (APP-25). Each has its table in the panel. */
const number = new Intl.NumberFormat('es-CL');
// Room for the y-axis labels of the largest value («200» was cut to «'00» by a negative margin and a fixed width).
const axisWidth = (values: number[]) => Math.max(28, number.format(Math.max(0, ...values)).length * 8 + 10);

/** Contacts per month, with the line of the recent average when there is one. */
export function ContactedChart({ months, threshold }: { months: MonthPoint[]; threshold: number | null }) {
  return (
    <ChartContainer config={{ contacted: { label: 'Contactados', color: 'hsl(var(--primary))' } }} className="aspect-auto h-[230px] w-full"
      aria-label={`Contactos por mes: ${months.map(month => `${month.label} ${month.contacted}`).join(', ')}`}>
      <BarChart data={months} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={axisWidth(months.map(month => Math.max(month.contacted, threshold ?? 0)))} />
        <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltipContent indicator="line"
          formatter={(value, _name, item) => <MonthReadout contacted={Number(value)} replied={Number(item?.payload?.replied || 0)} />} />} />
        {threshold !== null ? (
          // The subtitle names the line; a label inside the plot would sit on the latest bar.
          <ReferenceLine y={threshold} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
        ) : null}
        <Bar dataKey="contacted" fill="var(--color-contacted)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/** New contacts per month, the 13 months of the panel. */
export function NewLeadsChart({ months }: { months: MonthPoint[] }) {
  return (
    <ChartContainer config={{ newLeads: { label: 'Contactos nuevos', color: 'hsl(var(--primary))' } }} className="aspect-auto h-[230px] w-full"
      aria-label={`Contactos nuevos por mes: ${months.map(month => `${month.label} ${month.newLeads}`).join(', ')}`}>
      <AreaChart data={months} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={16} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={axisWidth(months.map(month => month.newLeads))} />
        <Tooltip cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} content={<ChartTooltipContent indicator="line" />} />
        <Area dataKey="newLeads" type="monotone" stroke="var(--color-newLeads)" strokeWidth={2} fill="var(--color-newLeads)" fillOpacity={0.1}
          dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

function MonthReadout({ contacted, replied }: { contacted: number; replied: number }) {
  return (
    <span className="grid w-full gap-0.5">
      <span className="flex justify-between gap-3"><span className="text-muted-foreground">Contactados</span><span className="font-semibold tabular-nums text-foreground">{number.format(contacted)}</span></span>
      <span className="flex justify-between gap-3"><span className="text-muted-foreground">Respondieron</span>
        <span className="tabular-nums text-foreground">{number.format(replied)}{contacted ? ` (${sharePercent(replied / contacted)})` : ''}</span></span>
    </span>
  );
}
