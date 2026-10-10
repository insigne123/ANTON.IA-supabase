'use client';
import Link from 'next/link';
import {RefreshCw,Send,MailCheck,Users,Bookmark} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {usePersonalHome} from './usePersonalHome';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import type {HomeSummary as Summary} from '@/lib/server/home-summary';
const METRICS=[{key:'sent',title:'Correos enviados hoy',icon:Send,href:'/contacted?view=all'},
  {key:'contacted',title:'Contactos de hoy',icon:Users,href:'/contacted?view=all'},
  {key:'replied',title:'Respuestas humanas hoy',icon:MailCheck,href:'/contacted?view=reply'},
  {key:'saved',title:'Guardados hoy',icon:Bookmark,href:'/saved/leads'}] as const;
export function HomeSummary(){
  const {data:summary,error,loading,load}=usePersonalHome<Summary>('/api/home/summary');
  if(error)return <div role="alert" className="rounded-2xl border p-4 text-sm"><p>No pudimos actualizar tu actividad de hoy.</p><Button variant="ghost" size="sm" onClick={()=>void load()}><RefreshCw aria-hidden="true"/>Reintentar</Button></div>;
  return <div className="space-y-4"><section aria-labelledby="summary-title" aria-busy={loading}>
    <h2 id="summary-title" className="mb-2 text-sm font-semibold">Tu resumen de hoy</h2>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60">{METRICS.map(metric=><Link key={metric.key} href={metric.href} className="min-w-0 bg-card px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><span className="flex items-center gap-2 text-xs text-muted-foreground"><metric.icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true"/>{metric.title}</span>{summary?<span className="mt-1 block text-2xl font-semibold tabular-nums">{summary[metric.key].toLocaleString('es-CL')}</span>:<Skeleton className="mt-2 h-7 w-12"/>}</Link>)}</div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Solo tu actividad en este workspace · día de Chile. Los registros históricos no cuentan como envíos de hoy.</p>
    {summary&&(summary.partial||summary.unclassifiedReplies>0||summary.automaticReplies>0)&&<p role="status" className="mt-2 text-xs text-muted-foreground">{summary.automaticReplies} respuestas automáticas · {summary.unclassifiedReplies} sin clasificar.{summary.partial?' Hay envíos cuya fecha o destinatario no pudo confirmarse.':''}</p>}
  </section><PerformanceChart summary={summary} loading={loading}/></div>;
}
