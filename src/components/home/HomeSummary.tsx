'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Megaphone, MailCheck, RefreshCw, Send, UserCheck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { HomeSummary as Summary } from '@/lib/server/home-summary';

const METRICS: Array<{ key: keyof Omit<Summary, 'campaigns'>; title: string; icon: typeof Send; href: string }> = [
  { key: 'contacted', title: 'Contactados', icon: Send, href: '/contacted?view=all' },
  { key: 'replied', title: 'Respuestas', icon: MailCheck, href: '/contacted?view=reply' },
  { key: 'activeCampaigns', title: 'Campañas activas', icon: Megaphone, href: '/campaigns' },
  { key: 'enrichedLeads', title: 'Con correo', icon: UserCheck, href: '/saved/leads/enriched' },
];

/**
 * «Tu semana» on «Hoy»: four counts that open the screen behind them, and the approved campaigns with how far they got.
 * One request (/api/home/summary) with exact counts, instead of downloading whole tables in the browser.
 */
export function HomeSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const response = await fetch('/api/home/summary', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setSummary(await response.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <Alert variant="warning" role="alert">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          No pudimos actualizar el resumen. Tus contactos y campañas siguen bien.
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="summary-title" aria-busy={!summary}>
        <h2 id="summary-title" className="mb-2 text-sm font-semibold tracking-tight">Tu resumen</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60">
          {METRICS.map((metric) => (
            <Link
              key={metric.key}
              href={metric.href}
              className="group min-w-0 bg-card px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-foreground/70">
                <metric.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {metric.title}
              </span>
              {summary ? (
                <span className="mt-1 block text-2xl font-semibold leading-7 tracking-[-0.02em] tabular-nums">
                  {summary[metric.key].toLocaleString('es-CL')}
                </span>
              ) : (
                <Skeleton className="mt-1.5 h-7 w-12" />
              )}
            </Link>
          ))}
        </div>
      </section>

      {summary && summary.campaigns.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Campañas en curso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.campaigns.map((campaign) => {
              const percent = campaign.total > 0 ? Math.round((campaign.sent / campaign.total) * 100) : 0;
              return (
                <Link key={campaign.id} href="/campaigns" className="block rounded-xl p-2 -m-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{campaign.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-foreground/70">{campaign.sent} de {campaign.total} enviados</span>
                  </span>
                  <Progress value={percent} className="mt-2 h-1.5" aria-label={`${campaign.name}: ${campaign.sent} de ${campaign.total} correos enviados`} />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
