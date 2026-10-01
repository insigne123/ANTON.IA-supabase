'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CheckCircle2, Circle, MailCheck, MessageSquareReply, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TodayPlan, TodayQueueItem } from '@/lib/home/today';

type TodayResponse = TodayPlan & { partial?: boolean; firstName?: string };

const QUEUE_ICONS: Record<TodayQueueItem['kind'], typeof MessageSquareReply> = {
  reply: MessageSquareReply,
  commitment: CalendarClock,
  ready: MailCheck,
};

/** «Hoy»: one clear next step, what is still missing to send, and the people waiting for an answer (src/lib/home/today.ts). */
export function TodayPanel() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/home/today', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return (
      <section aria-label="Hoy" aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </section>
    );
  }

  if (error || !data) {
    return (
      <Card className="rounded-2xl" role="alert">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">No pudimos cargar lo que toca hoy. Tus datos están bien; prueba de nuevo.</p>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  const setupComplete = data.setupDone === data.setup.length;

  return (
    <section aria-label="Hoy" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-tour="today">
      <div className="space-y-4">
        <Card className="relative overflow-hidden rounded-2xl border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
          <CardHeader className="pb-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {data.firstName ? `Hola, ${data.firstName}. Lo primero hoy` : 'Lo primero hoy'}
            </p>
            <CardTitle className="text-xl leading-snug sm:text-2xl">{data.primary.title}</CardTitle>
            <CardDescription className="text-sm">{data.primary.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={data.primary.href}>{data.primary.cta}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lo que te espera</CardTitle>
            <CardDescription>Respuestas, compromisos y contactos listos, en orden de urgencia.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.queue.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                Nada pendiente por ahora. Cuando alguien te responda o venza un compromiso, aparecerá aquí.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.queue.map((item, index) => {
                  const Icon = QUEUE_ICONS[item.kind];
                  return (
                    <li key={item.id} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both"
                      style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}>
                      <Link href={item.href}
                        className="group flex items-start gap-3 rounded-xl border border-border/60 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          item.urgent ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="block text-xs text-muted-foreground">{item.description}</span>
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn('rounded-2xl', setupComplete && 'lg:self-start')} data-tour="setup">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{setupComplete ? 'Todo listo para vender' : 'Prepara tu cuenta'}</CardTitle>
          <CardDescription>
            {setupComplete ? 'Tu perfil, tu correo y tus contactos están listos.' : `${data.setupDone} de ${data.setup.length} pasos. Cada uno toma un par de minutos.`}
          </CardDescription>
          <Progress value={(data.setupDone / data.setup.length) * 100} className="mt-2 h-2" aria-label={`${data.setupDone} de ${data.setup.length} pasos completos`} />
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {data.setup.map((step) => (
              <li key={step.id} className={cn('flex items-start gap-3 rounded-xl p-2', !step.done && 'bg-muted/30')}>
                {step.done
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                    {step.title}<span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                  </p>
                  {!step.done ? (
                    <>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                      <Button asChild variant="link" size="sm" className="h-auto px-0 text-xs">
                        <Link href={step.href}>{step.cta}</Link>
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}
