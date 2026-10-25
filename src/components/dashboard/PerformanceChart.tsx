'use client';
import dynamic from 'next/dynamic';
import {Card,CardHeader,CardContent,CardTitle,CardDescription} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import type {HomeSummary} from '@/lib/server/home-summary';
const PerformanceBars=dynamic(()=>import('./PerformanceBars'),{ssr:false,loading:()=><Skeleton className="h-48 w-full"/>});
/** Uses the exact same personal/day snapshot as the summary. Never downloads shared contacted history. */
export default function PerformanceChart({summary,loading=false}:{summary:HomeSummary|null;loading?:boolean}){
  return <Card className="overflow-hidden rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-base">Tu actividad de hoy</CardTitle><CardDescription>Envíos y respuestas por hora de Chile.</CardDescription></CardHeader><CardContent>
    {loading&&!summary?<Skeleton className="h-48 w-full"/>:!summary?.activity.length?<p className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">Hoy aún no envías correos ni recibes respuestas en esta organización.</p>:
      <PerformanceBars summary={summary}/>}
  </CardContent></Card>;
}
