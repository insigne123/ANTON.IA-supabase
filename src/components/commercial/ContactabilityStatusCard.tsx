'use client';

import { AlertTriangle, CheckCircle2, Loader2, MailX, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ContactabilityResult, ContactabilityStatus } from '@/lib/commercial-intelligence';
import { cn } from '@/lib/utils';
import { useContactability } from '@/hooks/use-contactability';

type Props = {
  email?: string | null;
  result?: ContactabilityResult | null;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
  onRetry?: () => void;
};

function statusIcon(status: ContactabilityStatus) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'warning') return <AlertTriangle className="h-4 w-4" />;
  if (status === 'blocked') return <MailX className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
}

function statusClasses(status?: ContactabilityStatus | null) {
  switch (status) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
    case 'blocked':
      return 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100';
    default:
      return 'border-border bg-muted/30 text-foreground';
  }
}

function reasonLabel(reason: string) {
  switch (reason) {
    case 'unsubscribe_or_privacy_block':
    case 'unsubscribe_reply':
      return 'Baja o preferencia de privacidad registrada';
    case 'blocked_domain':
      return 'Dominio excluido por tu organizacion';
    case 'do_not_contact':
      return 'Marcado como no contactar';
    case 'recent_bounce':
      return 'Rebote reciente';
    case 'missing_email':
      return 'Falta un email valido';
    default:
      return null;
  }
}

export function ContactabilityStatusCard({ email, result: providedResult, loading: providedLoading, error: providedError, compact, onRetry }: Props) {
  const fetched = useContactability(providedResult === undefined ? email : null);
  const result = providedResult === undefined ? fetched.result : providedResult;
  const loading = providedLoading === undefined ? fetched.loading : providedLoading;
  const error = providedError === undefined ? fetched.error : providedError;
  const retry = onRetry || fetched.refresh;

  if (loading) {
    return (
      <div role="status" aria-live="polite" className={cn('rounded-xl border bg-card p-4', compact && 'p-3')}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className={cn('rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100', compact && 'p-3')}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">No pudimos verificar este contacto</p>
              <p className="text-xs opacity-80">{error}</p>
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={retry}>
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div role="status" className={cn('rounded-xl border border-dashed p-4 text-sm text-muted-foreground', compact && 'p-3')}>
        Agrega un email para verificar si el contacto puede recibir mensajes.
      </div>
    );
  }

  const visibleReasons = result.reasons.map(reasonLabel).filter(Boolean) as string[];

  return (
    <div role={result.status === 'blocked' ? 'alert' : 'status'} aria-live="polite" className={cn('rounded-xl border p-4', statusClasses(result.status), compact && 'p-3')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {statusIcon(result.status)}
            <p className="text-sm font-semibold">{result.label}</p>
          </div>
          <p className="text-xs opacity-80">{result.description}</p>
          {visibleReasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {visibleReasons.slice(0, 3).map((reason) => (
                <Badge key={reason} variant="outline" className="border-current/20 bg-background/40 text-[11px] text-current">
                  {reason}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {email && !compact && <Badge variant="outline" className="w-fit border-current/20 bg-background/40 text-current">Estado del contacto</Badge>}
      </div>
    </div>
  );
}
