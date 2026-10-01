'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, CalendarCheck, CheckCircle2, ChevronRight, CircleAlert, Copy, Download, Mail, MessageSquareReply, Minus, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { adoptionCsv, biggestDrop, helpMessage, type HelpItem, type MetricComparison } from '@/lib/admin/value';
import type { AdminValue } from '@/lib/server/admin-value-data';
import { cn } from '@/lib/utils';

type ValueResponse = AdminValue & { organization: { id: string; name: string } };

const HELP_VISIBLE = 6;

function formatNumber(value: number) {
  return value.toLocaleString('es-CL');
}

function formatDay(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '')
    : value;
}

function DeltaBadge({ metric }: { metric: MetricComparison }) {
  const Icon = metric.trend === 'up' ? ArrowUpRight : metric.trend === 'down' ? ArrowDownRight : Minus;
  const label = metric.trend === 'flat'
    ? 'Igual que el período anterior'
    : `${metric.delta > 0 ? '+' : '−'}${formatNumber(Math.abs(metric.delta))} vs. período anterior (${formatNumber(metric.previous)})`;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium',
      metric.trend === 'up' ? 'text-emerald-700 dark:text-emerald-300' : metric.trend === 'down' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </span>
  );
}

function ResultCard({ label, metric, note, icon: Icon }: { label: string; metric: MetricComparison; note: string; icon: LucideIcon }) {
  return (
    <Card className="rounded-2xl border-border/60 bg-card/90 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 dark:bg-card/75">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{formatNumber(metric.value)}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
        <div className="mt-2"><DeltaBadge metric={metric} /></div>
      </CardContent>
    </Card>
  );
}

function HelpAction({ item, origin, organizationName }: { item: HelpItem; origin: string; organizationName: string }) {
  const { toast } = useToast();
  if (item.action === 'open_person') {
    return (
      <Button asChild variant="ghost" size="sm" className="shrink-0 rounded-xl">
        <Link href={`/dashboard/admin/users/${item.userId}`}>Ver persona<ChevronRight aria-hidden="true" /></Link>
      </Button>
    );
  }
  const label = item.action === 'copy_invite' ? 'Copiar invitación' : 'Copiar recordatorio';
  return (
    <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-xl" aria-label={`${label} para ${item.name}`} onClick={async () => {
      try {
        await navigator.clipboard.writeText(helpMessage(item, origin, organizationName));
        toast({ title: 'Mensaje copiado', description: `Pégalo en un correo o chat para ${item.name}. ANTON.IA no lo envía por ti.` });
      } catch {
        toast({ variant: 'destructive', title: 'No pudimos copiar', description: 'Tu navegador bloqueó el portapapeles. Inténtalo de nuevo.' });
      }
    }}>
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </Button>
  );
}

/**
 * «¿Les está sirviendo?»: what came back against the previous period, how far each person got, and who needs a hand
 * with a message ready to copy (docs/admin-panel-valor.md).
 */
export function AdminValueSection({ from, to, groupId, userId, refreshToken }: {
  from: string;
  to: string;
  groupId?: string;
  userId?: string;
  refreshToken: number;
}) {
  const [data, setData] = useState<ValueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllHelp, setShowAllHelp] = useState(false);
  const requestRef = useRef(0);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    try {
      const response = await fetch(`/api/dashboard/admin/value?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar el resumen.');
      if (requestId === requestRef.current) setData(payload as ValueResponse);
    } catch (loadError) {
      if (requestId === requestRef.current) setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el resumen.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [from, to, groupId, userId]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const drop = useMemo(() => (data ? biggestDrop(data.adoption.funnel) : null), [data]);

  function exportPeople() {
    if (!data) return;
    const blob = new Blob([adoptionCsv(data.people)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `personas-${data.range.from}-${data.range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) {
    return (
      <section aria-label="Cargando resultados y adopción" aria-busy="true" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
      </section>
    );
  }

  if (!data) {
    return (
      <Card className="rounded-2xl" role="alert">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />{error || 'No pudimos cargar el resumen.'}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  const { comparison, current, replyRate } = data.results;
  const invited = data.adoption.funnel[0]?.value || 0;
  const help = showAllHelp ? data.needsHelp : data.needsHelp.slice(0, HELP_VISIBLE);
  const days = data.range.from === data.range.to ? 'el día anterior' : `${formatDay(data.previousRange.from)} – ${formatDay(data.previousRange.to)}`;

  return (
    <section aria-labelledby="value-title" className="space-y-4" aria-busy={loading}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="value-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />¿Les está sirviendo?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Comparado con {days}. Las respuestas cuentan solo a personas: sin respuestas automáticas ni rebotes.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="w-full rounded-xl sm:w-auto" onClick={exportPeople} disabled={data.people.length === 0}>
          <Download className="h-4 w-4" aria-hidden="true" />Exportar personas (CSV)
        </Button>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ResultCard label="Correos enviados" metric={comparison.sent} icon={Mail} note="Envíos confirmados en el período." />
        <ResultCard label="Respuestas reales" metric={comparison.replies} icon={MessageSquareReply}
          note={current.sent > 0 ? `${replyRate.toLocaleString('es-CL')} % de los envíos.` : 'Aún sin envíos en el período.'} />
        <ResultCard label="Interesados" metric={comparison.interested} icon={CheckCircle2} note="Piden reunión o responden con interés." />
        <ResultCard label="Reuniones en Pipeline" metric={comparison.pipelineMeetings} icon={CalendarCheck}
          note={data.scope === 'filtered' ? 'Se cuentan solo para toda la organización.' : 'Contactos que pasaron a «Reunión».'} />
      </div>

      <p className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Cómo respondieron:</span>{' '}
        {formatNumber(current.replies.meeting)} piden reunión · {formatNumber(current.replies.positive)} positivas · {formatNumber(current.replies.neutral)} neutras · {formatNumber(current.replies.negative)} negativas · {formatNumber(current.replies.unsubscribe)} piden no recibir más.
        {current.replies.automatic + current.replies.bounced > 0
          ? ` No cuentan: ${formatNumber(current.replies.automatic)} automáticas y ${formatNumber(current.replies.bounced)} rebotes.`
          : ''}
        {' '}Además: {formatNumber(current.savedContacts)} contactos guardados y {formatNumber(current.researched)} investigaciones.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-border/60 bg-card/90 dark:bg-card/75">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Adopción del equipo</CardTitle>
            <CardDescription>
              {formatNumber(data.adoption.active7)} activas esta semana · {formatNumber(data.adoption.active30)} en 30 días · {formatNumber(data.adoption.profileReady)} con perfil y oferta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3" aria-label="Del invitado al primer envío">
              {data.adoption.funnel.map((step, index) => {
                const width = invited > 0 ? Math.max(step.value > 0 ? 4 : 0, Math.round((step.value / invited) * 100)) : 0;
                return (
                  <li key={step.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className={cn(drop?.to.id === step.id && 'font-medium')}>{step.label}</span>
                      <span className="font-semibold tabular-nums">{formatNumber(step.value)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                        style={{ width: `${width}%`, opacity: 1 - index * 0.12 }} />
                    </div>
                  </li>
                );
              })}
            </ol>
            {drop ? (
              <p className="mt-4 rounded-xl bg-primary/5 p-3 text-sm">
                <span className="font-medium">Dónde se quedan:</span> {formatNumber(drop.lost)} {drop.lost === 1 ? 'persona llega' : 'personas llegan'} a «{drop.from.label}» y no a «{drop.to.label}».
                {drop.to.id === 'mail' ? ' Sin correo conectado no pueden enviar: es lo primero que conviene resolver.' : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 bg-card/90 dark:bg-card/75">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quién necesita ayuda</CardTitle>
            <CardDescription>Lo que más los frena, con un mensaje listo para copiar y enviarles tú.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.needsHelp.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-6 py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Todos tienen lo necesario para vender</p>
                <p className="mt-1 text-sm text-muted-foreground">Entraron, conectaron su correo, completaron su perfil y ya enviaron.</p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-border/60">
                  {help.map((item) => (
                    <li key={item.userId} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.name}<span className="font-normal text-muted-foreground"> · {item.title}</span></p>
                        <p className="text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                      <HelpAction item={item} origin={origin} organizationName={data.organization.name} />
                    </li>
                  ))}
                </ul>
                {data.needsHelp.length > HELP_VISIBLE ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-2 rounded-xl" onClick={() => setShowAllHelp((value) => !value)} aria-expanded={showAllHelp}>
                    {showAllHelp ? 'Ver menos' : `Ver las ${data.needsHelp.length} personas`}
                  </Button>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
