'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, BarChart3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis } from 'recharts';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { hasReplySignal } from '@/lib/antonia-reply-metrics';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';

type PerformanceDatum = {
  date: string;
  label: string;
  sent: number;
  replied: number;
};

const chartConfig = {
  sent: { label: 'Enviados', color: 'hsl(var(--primary))' },
  replied: { label: 'Respuestas', color: 'hsl(var(--chart-2))' },
};

export default function PerformanceChart() {
  const [chartData, setChartData] = useState<PerformanceDatum[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setHasError(false);

      try {
        const contacted = await contactedLeadsStorage.get() || [];
        const today = new Date();
        const dataByDay = new Map<string, PerformanceDatum>();

        for (let index = 6; index >= 0; index -= 1) {
          const day = subDays(today, index);
          const key = format(day, 'yyyy-MM-dd');
          dataByDay.set(key, {
            date: key,
            label: format(day, 'EEE', { locale: es }).replace('.', ''),
            sent: 0,
            replied: 0,
          });
        }

        contacted.forEach((contact) => {
          if (contact?.sentAt) {
            const sentAt = new Date(contact.sentAt);
            if (Number.isFinite(sentAt.getTime())) {
              const day = dataByDay.get(format(sentAt, 'yyyy-MM-dd'));
              if (day) day.sent += 1;
            }
          }

          if (hasReplySignal(contact) && contact.repliedAt) {
            const repliedAt = new Date(contact.repliedAt);
            if (Number.isFinite(repliedAt.getTime())) {
              const day = dataByDay.get(format(repliedAt, 'yyyy-MM-dd'));
              if (day) day.replied += 1;
            }
          }
        });

        if (!cancelled) setChartData(Array.from(dataByDay.values()));
      } catch (error) {
        console.error('Error loading dashboard performance:', error);
        if (!cancelled) {
          setChartData([]);
          setHasError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => chartData.reduce(
    (result, day) => ({ sent: result.sent + day.sent, replied: result.replied + day.replied }),
    { sent: 0, replied: 0 }
  ), [chartData]);

  const isEmpty = totals.sent === 0 && totals.replied === 0;

  return (
    <Card className="h-full overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_12px_32px_-28px_rgba(15,23,42,0.3)]">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 space-y-0 px-5 pb-2 pt-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Rendimiento</CardTitle>
          <CardDescription>Actividad de los últimos 7 días.</CardDescription>
        </div>
        {!loading && !hasError && !isEmpty ? (
          <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground" aria-label={`${totals.sent} enviados y ${totals.replied} respuestas`}>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />{totals.sent} enviados</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-2))]" />{totals.replied} respuestas</span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-1 sm:px-5" aria-busy={loading}>
        {loading ? (
          <div className="space-y-3 pt-2" aria-label="Cargando rendimiento semanal">
            <Skeleton className="h-[174px] w-full rounded-xl" />
            <div className="flex justify-between gap-2 px-2">
              {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-3 w-7" />)}
            </div>
          </div>
        ) : hasError ? (
          <div role="alert" className="flex h-[202px] flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/70 px-5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Rendimiento no disponible</p>
            <p className="mt-1 text-xs text-muted-foreground">No pudimos actualizar la actividad semanal.</p>
          </div>
        ) : isEmpty ? (
          <div className="flex h-[202px] flex-col items-center justify-center rounded-xl bg-muted/25 px-5 text-center">
            <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Aún no hay actividad esta semana</p>
            <p className="mt-1 text-xs text-muted-foreground">Los envíos y respuestas aparecerán aquí.</p>
            <Button asChild variant="outline" size="sm" className="mt-3 bg-background shadow-none">
              <Link href="/search">Buscar leads</Link>
            </Button>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-[202px] w-full aspect-auto"
            aria-label={`Gráfico semanal: ${totals.sent} enviados y ${totals.replied} respuestas`}
          >
            <BarChart data={chartData} accessibilityLayer margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                tickFormatter={(value: string) => value.slice(0, 3)}
              />
              <Tooltip content={<ChartTooltipContent indicator="dot" />} cursor={false} />
              <Bar dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="replied" fill="var(--color-replied)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
