'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CircleGauge, Phone, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import { cn } from '@/lib/utils';

type ApolloCreditsResponse = {
  scope: 'shared';
  balance: {
    remaining: number;
    used: number;
    limit: number;
    cycleEnd: string | null;
    capturedAt: string;
    stale: boolean;
  };
  costs: {
    emailEnrichment: number;
    phoneEnrichment: number;
  };
};
type ApolloCreditsState = 'loading' | 'ready' | 'error' | 'unavailable' | 'unauthorized';

async function requestApolloCredits(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 10_000);
  try {
    const response = await fetch('/api/apollo/credits', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`APOLLO_CREDIT_REQUEST_${response.status}`);
    return response.json() as Promise<ApolloCreditsResponse>;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(date);
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function errorMessage(state: ApolloCreditsState) {
  if (state === 'unavailable') return 'Apollo todavía no publica un saldo para este ciclo.';
  if (state === 'unauthorized') return 'Tu sesión ya no está disponible. Recarga la página para continuar.';
  return 'No pudimos actualizar el saldo. Puedes reintentarlo sin afectar tus créditos.';
}

function resolveError(error: unknown): ApolloCreditsState {
  const message = error instanceof Error ? error.message : '';
  if (message.endsWith('_401') || message.endsWith('_403')) return 'unauthorized';
  if (message.endsWith('_503')) return 'unavailable';
  return 'error';
}

export default function ApolloCreditsCard({ className }: { className?: string }) {
  const [data, setData] = useState<ApolloCreditsResponse | null>(null);
  const [state, setState] = useState<ApolloCreditsState>('loading');

  useEffect(() => {
    const abort = new AbortController();
    requestApolloCredits(abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setData(result);
        setState('ready');
      })
      .catch((error) => {
        if (!abort.signal.aborted) setState(resolveError(error));
      });
    return () => abort.abort();
  }, []);

  async function refresh() {
    setState('loading');
    try {
      setData(await requestApolloCredits());
      setState('ready');
    } catch (error) {
      setState(resolveError(error));
    }
  }

  const balance = data?.balance;
  const usedPercent = balance ? Math.min(100, Math.round((balance.used / Math.max(1, balance.limit)) * 100)) : 0;
  const phoneCost = data?.costs.phoneEnrichment || APOLLO_PHONE_ENRICHMENT_CREDITS;
  const lowBalance = Boolean(balance && balance.remaining < phoneCost * 10);
  const capturedLabel = balance ? timeLabel(balance.capturedAt) : null;
  const accountLabel = balance?.cycleEnd
    ? `Cuenta compartida · se renueva el ${dateLabel(balance.cycleEnd) || 'próximo ciclo'}`
    : 'Saldo de la cuenta compartida';
  const statusLabel = state === 'loading'
    ? 'Actualizando saldo compartido'
    : state !== 'ready'
      ? (balance ? `Mostrando saldo guardado${capturedLabel ? ` de las ${capturedLabel}` : ''}` : errorMessage(state))
      : balance?.stale
        ? `Saldo guardado de las ${capturedLabel || '—'}`
        : `Actualizado a las ${capturedLabel || '—'}`;

  return (
    <Card
      className={cn('h-full overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_10px_28px_-26px_rgba(15,23,42,0.28)]', className)}
      aria-busy={state === 'loading'}
    >
      <CardContent className="flex h-full flex-col justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CircleGauge className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Créditos Apollo</h2>
              <p className="truncate text-xs text-muted-foreground" role="status" aria-live="polite">{statusLabel}</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-9 px-3 text-xs text-muted-foreground" onClick={() => void refresh()} disabled={state === 'loading'}>
            <RefreshCw className={cn('size-3.5', state === 'loading' && 'motion-safe:animate-spin')} aria-hidden="true" />
            Recargar
          </Button>
        </div>

        {state === 'loading' && !balance ? (
          <div className="space-y-3" aria-label="Actualizando créditos Apollo">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : state !== 'ready' && state !== 'loading' && !balance ? (
          <div className="space-y-2" role="status">
            <div className="text-2xl font-semibold tracking-tight text-muted-foreground">—</div>
            <p className="text-xs leading-5 text-muted-foreground">{errorMessage(state)}</p>
          </div>
        ) : balance ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-end gap-2">
              <span className={cn('text-3xl font-semibold tracking-[-0.04em] tabular-nums', lowBalance && 'text-amber-700 dark:text-amber-300')}>
                {balance.remaining.toLocaleString('es-CL')}
              </span>
              <span className="pb-1 text-xs text-muted-foreground">restantes</span>
              {lowBalance ? (
                <Badge variant="outline" className="mb-0.5 gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Saldo bajo
                </Badge>
              ) : null}
            </div>
            <div>
              <div className="mb-1.5 flex justify-between gap-3 text-[11px] text-muted-foreground">
                <span>{balance.used.toLocaleString('es-CL')} usados</span>
                <span>{balance.limit.toLocaleString('es-CL')} totales</span>
              </div>
              <Progress value={usedPercent} className="h-1.5 motion-reduce:[&>div]:transition-none" aria-label={`Créditos Apollo usados: ${balance.used} de ${balance.limit}`} />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span>{accountLabel}</span>
          <Badge variant="secondary" className="gap-1.5 font-medium">
            <Phone className="size-3" aria-hidden="true" />
            Teléfono: {phoneCost} créditos
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
