'use client';
import {Area,AreaChart,CartesianGrid,XAxis,YAxis,Tooltip} from 'recharts';
import {ChartContainer,ChartTooltipContent} from '@/components/ui/chart';
import type {AdminUsageReport} from '@/lib/admin/usage';
const chartConfig={active:{label:'Personas activas',color:'hsl(var(--chart-1))'},credits:{label:'Créditos del cupo diario',color:'hsl(var(--chart-2))'}};
/** «Cuándo se utiliza», apart so the report loads recharts once the chart shows, not with the page (APP-25). */
export default function UsageChart({daily,chart,date,onDay}:{daily:AdminUsageReport['daily'];chart:'active'|'credits';date:(value:string)=>string;onDay:(day:string)=>void}){
  return <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto"><AreaChart accessibilityLayer data={daily} margin={{left:-12,right:8,top:8,bottom:0}} onClick={event=>{if(event?.activeLabel)onDay(String(event.activeLabel));}}><CartesianGrid vertical={false}/><XAxis dataKey="day" tickFormatter={date} tickLine={false} axisLine={false} minTickGap={25}/><YAxis allowDecimals={false} tickLine={false} axisLine={false}/><Tooltip content={<ChartTooltipContent labelFormatter={value=>date(String(value))}/>}/><Area isAnimationActive={false} dataKey={chart} type="monotone" stroke={`var(--color-${chart})`} fill={`var(--color-${chart})`} fillOpacity={.14} strokeWidth={2}/></AreaChart></ChartContainer>;
}
