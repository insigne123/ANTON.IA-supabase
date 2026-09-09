'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Coins, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type QuotaBucket = { count: number; limit: number } | null;

type QuotaStatusResponse = {
  credits?: {
    count: number;
    limit: number;
    resetAtISO?: string;
    mode?: 'user' | 'team' | 'hybrid';
    binding?: 'user' | 'team';
    user?: QuotaBucket;
    team?: QuotaBucket;
  };
  statuses?: Array<{ resource: string; count: number; limit: number }>;
};

type CreditsState = 'loading' | 'ready' | 'error' | 'unauthorized';

function timeLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function resolveError(error: unknown): CreditsState {
  const message = error instanceof Error ? error.message : '';
  if (message.endsWith('_401') || message.endsWith('_403')) return 'unauthorized';
  return 'error';
}

async function requestUserCredits(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 10_000);
  try {
    const response = await fetch('/api/quota/status', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`USER_CREDIT_REQUEST_${response.status}`);
    return (await response.json()) as QuotaStatusResponse;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export default function UserCreditsCard({ className }: { className?: string }) {
  const [credits, setCredits] = useState<QuotaStatusResponse['credits'] | null>(null);
  const [state, setState] = useState<CreditsState>('loading');

  useEffect(() => {
    const abort = new AbortController();
    requestUserCredits(abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setCredits(result?.credits ?? null);
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
      const result = await requestUserCredits();
      setCredits(result?.credits ?? null);
      setState('ready');
    } catch (error) {
      setState(resolveError(error));
    }
  }

  // Cupo personal primero, según preferencia del usuario.
  const personal = credits?.user ?? null;
  const usingTeamFallback = !personal && credits != null;
  const used = personal?.count ?? credits?.count ?? 0;
  const limit = personal?.limit ?? credits?.limit ?? 0;
  const remaining = Math.max(0, limit - used);
  const usedPercent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const lowBalance = limit > 0 && remaining <= Math.max(5, Math.round(limit * 0.2));
  const resetLabel = timeLabel(credits?.resetAtISO);
  const usesTeamQuota = usingTeamFallback && credits?.binding === 'team';

  const statusLabel =
    state === 'loading'
      ? 'Actualizando tu cupo'
      : state === 'unauthorized'
        ? 'Tu sesión ya no está disponible. Recarga la página para continuar.'
        : state === 'error'
          ? 'No pudimos actualizar tu cupo. Puedes reintentarlo.'
          : usesTeamQuota
            ? `Usas el cupo de tu equipo${resetLabel ? ` · se reinicia a las ${resetLabel}` : ''}`
            : `Cupo personal${resetLabel ? ` · se reinicia a las ${resetLabel}` : ''}`;

  return (
    <Card
      className={cn(
        'h-full overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_10px_28px_-26px_rgba(15,23,42,0.28)]',
        className,
      )}
      aria-busy={state === 'loading'}
    >
      <CardContent className="flex h-full flex-col justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Coins className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Mis créditos</h2>
              <p className="truncate text-xs text-muted-foreground" role="status" aria-live="polite">
                {statusLabel}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs text-muted-foreground"
            onClick={() => void refresh()}
            disabled={state === 'loading'}
          >
            <RefreshCw className={cn('size-3.5', state === 'loading' && 'motion-safe:animate-spin')} aria-hidden="true" />
            Recargar
          </Button>
        </div>

        {state === 'loading' && credits == null ? (
          <div className="space-y-3" aria-label="Actualizando tus créditos">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : state !== 'ready' && credits == null ? (
          <div className="space-y-2" role="status">
            <div className="text-2xl font-semibold tracking-tight text-muted-foreground">—</div>
            <p className="text-xs leading-5 text-muted-foreground">
              {state === 'unauthorized'
                ? 'Tu sesión ya no está disponible. Recarga la página para continuar.'
                : 'No pudimos actualizar tu cupo. Puedes reintentarlo sin afectar tu uso.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-end gap-2">
              <span
                className={cn(
                  'text-3xl font-semibold tracking-[-0.04em] tabular-nums',
                  lowBalance && 'text-amber-700 dark:text-amber-300',
                )}
              >
                {remaining.toLocaleString('es-CL')}
              </span>
              <span className="pb-1 text-xs text-muted-foreground">restantes para ti hoy</span>
              {lowBalance ? (
                <Badge
                  variant="outline"
                  className="mb-0.5 gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Quedan pocos
                </Badge>
              ) : null}
            </div>
            <div>
              <div className="mb-1.5 flex justify-between gap-3 text-[11px] text-muted-foreground">
                <span>{used.toLocaleString('es-CL')} usados</span>
                <span>{limit.toLocaleString('es-CL')} asignados</span>
              </div>
              <Progress
                value={usedPercent}
                className="h-1.5 motion-reduce:[&>div]:transition-none"
                aria-label={`Mis créditos usados: ${used} de ${limit}`}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span>{usesTeamQuota ? 'Cupo del equipo aplicado a tu cuenta' : 'Tu cupo asignado de hoy'}</span>
          <Badge variant="secondary" className="font-medium">
            Cupo personal
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
