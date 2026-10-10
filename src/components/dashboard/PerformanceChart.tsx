'use client';
import {Bar,BarChart,CartesianGrid,XAxis,Tooltip} from 'recharts';
import {Card,CardHeader,CardContent,CardTitle,CardDescription} from '@/components/ui/card';
import {ChartContainer,ChartTooltipContent} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import type {HomeSummary} from '@/lib/server/home-summary';
const config={sent:{label:'Correos enviados',color:'hsl(var(--primary))'},replied:{label:'Respuestas humanas',color:'hsl(var(--chart-2))'}};
/** Uses the exact same personal/day snapshot as the summary. Never downloads shared contacted history. */
export default function PerformanceChart({summary,loading=false}:{summary:HomeSummary|null;loading?:boolean}){
  return <Card className="overflow-hidden rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-base">Tu actividad de hoy</CardTitle><CardDescription>Envíos y respuestas por hora de Chile.</CardDescription></CardHeader><CardContent>
    {loading&&!summary?<Skeleton className="h-48 w-full"/>:!summary?.activity.length?<p className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">Aún no hay envíos confirmados ni respuestas humanas tuyas hoy en este workspace.</p>:
      <ChartContainer config={config} className="h-48 w-full aspect-auto" aria-label={`Actividad de hoy: ${summary.sent} correos y ${summary.replied} respuestas humanas`}><BarChart data={summary.activity} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="hour" tickLine={false} axisLine={false}/><Tooltip content={<ChartTooltipContent/>}/><Bar isAnimationActive={false} dataKey="sent" fill="var(--color-sent)" radius={[4,4,0,0]}/><Bar isAnimationActive={false} dataKey="replied" fill="var(--color-replied)" radius={[4,4,0,0]}/></BarChart></ChartContainer>}
  </CardContent></Card>;
}
