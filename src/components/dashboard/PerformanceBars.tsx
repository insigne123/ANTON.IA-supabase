'use client';
import {Bar,BarChart,CartesianGrid,XAxis,Tooltip} from 'recharts';
import {ChartContainer,ChartTooltipContent} from '@/components/ui/chart';
import type {HomeSummary} from '@/lib/server/home-summary';
const config={sent:{label:'Correos enviados',color:'hsl(var(--primary))'},replied:{label:'Respuestas de personas',color:'hsl(var(--chart-2))'}};
/** The bars of «Tu actividad de hoy», apart so «Hoy» loads recharts once they show, not with the page (APP-25). */
export default function PerformanceBars({summary}:{summary:HomeSummary}){
  return <ChartContainer config={config} className="h-48 w-full aspect-auto" aria-label={`Actividad de hoy: ${summary.sent} correos y ${summary.replied} respuestas de personas`}><BarChart data={summary.activity} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="hour" tickLine={false} axisLine={false}/><Tooltip content={<ChartTooltipContent/>}/><Bar isAnimationActive={false} dataKey="sent" fill="var(--color-sent)" radius={[4,4,0,0]}/><Bar isAnimationActive={false} dataKey="replied" fill="var(--color-replied)" radius={[4,4,0,0]}/></BarChart></ChartContainer>;
}
