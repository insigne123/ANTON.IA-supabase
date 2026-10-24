'use client';

import Link from 'next/link';
import { ArrowRight, Briefcase, Clock3, FileText, MessageCircleQuestion, RefreshCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { OpportunitiesToday as Today, OpportunitySection } from '@/lib/home/opportunities-today';
import { cn } from '@/lib/utils';
import { usePersonalHome } from './usePersonalHome';

type Response = { access: false } | ({ access: true } & Today);

/** One kind of thing to do, its rows and, when there are more, the way to all of them. */
function Section({ id, title, icon: Icon, section, href, more }: { id: string; title: string; icon: LucideIcon; section: OpportunitySection; href: string; more: string }) {
  if (!section.total) return null;
  return <section aria-labelledby={id} className="space-y-2">
    <h3 id={id} className="text-xs font-medium text-muted-foreground">{title} <span className="tabular-nums">· {section.total.toLocaleString('es-CL')}</span></h3>
    <ul className="space-y-2">
      {section.lines.map(line => <li key={line.id}>
        <Link href={line.href}
          className="group flex items-start gap-3 rounded-xl border border-border/60 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', line.urgent ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{line.title}</span>
            <span className={cn('block text-xs', line.urgent ? 'text-destructive' : 'text-muted-foreground')}>{line.detail}</span>
          </span>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </Link>
      </li>)}
    </ul>
    {section.total > section.lines.length ? <Link href={href} className="inline-block rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {more}</Link> : null}
  </section>;
}

/**
 * «Oportunidades» in «Hoy» (src/lib/home/opportunities-today.ts): what waits for an answer, the ones the person works, the reports ready
 * and, for an administrator, what closes this week with no team. Each row opens the opportunity. Only for whoever has access, and only
 * when there is something to do: nothing to show is no card, and it does not hold a place while it loads.
 */
export function OpportunitiesTodayCard() {
  const { data, error, load } = usePersonalHome<Response>('/api/home/opportunities');
  return <OpportunitiesToday data={data} error={error} onRetry={() => void load()} />;
}

/** The card itself, from what the route answered. */
export function OpportunitiesToday({ data, error, onRetry }: { data: Response | null; error: boolean; onRetry: () => void }) {
  if (error) return <Card className="rounded-2xl"><CardContent className="flex items-center justify-between gap-3 p-4">
    <p role="alert" className="text-sm text-muted-foreground">No pudimos leer tus oportunidades.</p>
    <Button variant="ghost" size="sm" onClick={onRetry}><RefreshCw aria-hidden="true" />Reintentar</Button>
  </CardContent></Card>;
  if (!data || !data.access || data.empty) return null;
  return <Card role="region" className="rounded-2xl" aria-labelledby="opportunities-today-title">
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
      <h2 id="opportunities-today-title" className="text-base font-semibold leading-none tracking-tight">Oportunidades</h2>
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground"><Link href="/opportunities">Abrir<ArrowRight aria-hidden="true" /></Link></Button>
    </CardHeader>
    <CardContent className="space-y-5">
      <Section id="opportunities-today-waiting" title={data.admin ? 'Esperan tu respuesta' : 'Esperando respuesta'} icon={MessageCircleQuestion} section={data.waiting}
        href="/opportunities" more={`Ver las ${data.waiting.total.toLocaleString('es-CL')}`} />
      <Section id="opportunities-today-mine" title="Las que trabajas" icon={Briefcase} section={data.mine} href="/opportunities"
        more={`Ver las ${data.mine.total.toLocaleString('es-CL')}`} />
      <Section id="opportunities-today-reports" title="Informes listos" icon={FileText} section={data.reports} href="/opportunities"
        more={`Ver los ${data.reports.total.toLocaleString('es-CL')}`} />
      <Section id="opportunities-today-closing" title="Cierran esta semana y nadie las trabaja" icon={Clock3} section={data.closing} href={data.closing.href}
        more={`Ver las ${data.closing.total.toLocaleString('es-CL')}, por fecha de cierre`} />
    </CardContent>
  </Card>;
}
