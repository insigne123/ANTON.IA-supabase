
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { QUOTA_KINDS, type QuotaKind, getClientQuota, getClientLimit, isCreditQuotaKind, onQuotaChange, setClientQuotaSnapshot } from '@/lib/quota-client';
import { DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';
import { cn } from '@/lib/utils';
import { AlertCircle, Loader2, Users, Sparkles } from 'lucide-react';

type Props = {
  className?: string;
  /** Si no se provee, muestra todos: leadSearch, research, contact */
  kinds?: QuotaKind[];
  /** Modo compacto: sin Card wrapper */
  compact?: boolean;
  /** Resumen horizontal para superficies con poco alto */
  summary?: boolean;
  /** Título opcional */
  title?: string;
  /** Forzar sync con servidor al cargar (default: true) */
  syncServer?: boolean;
};

type Row = {
  kind: QuotaKind;
  label: string;
  shortLabel: string;
  icon: JSX.Element;
  count: number;
  limit: number;
  pct: number;
};

function nextResetLocalString(): string {
  // próximo inicio de día UTC en hora local
  const now = new Date();
  const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return nextUtcMidnight.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toRows(kinds: QuotaKind[], useClientSnapshot: boolean): Row[] {
  const quota = useClientSnapshot ? getClientQuota() : null;
  const visibleKinds = kinds.filter((kind, index) => !isCreditQuotaKind(kind)
    || kinds.findIndex((candidate) => isCreditQuotaKind(candidate)) === index);
  return visibleKinds.map((k) => {
    const count = quota?.[k] || 0;
    const limit = useClientSnapshot ? getClientLimit(k) : DEFAULT_DAILY_QUOTA_LIMITS[k];
    const pct = Math.max(0, Math.min(100, Math.round((count / Math.max(1, limit)) * 100)));
    const label = isCreditQuotaKind(k) ? 'Créditos' : 'Contactos';

    const shortLabel = isCreditQuotaKind(k) ? 'Créditos' : 'Contactos';

    const icon = isCreditQuotaKind(k)
      ? <Sparkles className="h-4 w-4" aria-hidden="true" />
      : <Users className="h-4 w-4" aria-hidden="true" />;

    return { kind: k, label, shortLabel, icon, count, limit, pct };
  });
}

export default function DailyQuotaProgress({ className, kinds, compact, summary, title = 'Uso diario', syncServer = true }: Props) {
  const [tick, setTick] = useState(0);
  const [resetDateStr, setResetDateStr] = useState<string>('');
  const [clientReady, setClientReady] = useState(false);
  const [syncState, setSyncState] = useState<'loading' | 'ready' | 'error'>(syncServer ? 'loading' : 'ready');
  const ks = useMemo(() => kinds && kinds.length ? kinds : QUOTA_KINDS, [kinds]);

  useEffect(() => {
    // Suscribirse a cambios de cuota en este tab
    const off = onQuotaChange(() => setTick((x) => x + 1));
    // También refrescar cuando cambia el día (por navegación prolongada)
    const id = setInterval(() => setTick((x) => x + 1), 60_000); // 1 min

    // Calcular la fecha del lado cliente para evitar hydration mismatch
    setResetDateStr(nextResetLocalString());
    setClientReady(true);

    return () => { off(); clearInterval(id); };
  }, []);

  // Sync con servidor: lee /api/quota/status y actualiza el espejo local para los recursos visibles
  useEffect(() => {
    if (!syncServer) {
      setSyncState('ready');
      return;
    }
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/quota/status', {
          method: 'GET',
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!res.ok) throw new Error('Quota status request failed');
        const data = await res.json();
        const statuses: Array<{ resource: string; count: number; limit: number; dayKey: string }> = data?.statuses || [];
        // Refleja exactamente lo que ve el servidor para evitar que queden contadores viejos en localStorage.
        const map = new Map(statuses.map(s => [s.resource, s]));
        for (const k of ks) {
          const s = map.get(k);
          if (!s) continue;
          const local = getClientQuota()[k] || 0;
          const localLimit = getClientLimit(k);
          if (s.count !== local || s.limit !== localLimit) {
            setClientQuotaSnapshot(k, { count: s.count, limit: s.limit });
          }
        }
        if (!abort.signal.aborted) setSyncState('ready');
      } catch (error) {
        if (!abort.signal.aborted) setSyncState('error');
      }
      finally {
        if (!abort.signal.aborted) setTick(x => x + 1);
      }
    })();
    return () => abort.abort();
  }, [ks, syncServer]);


  const rows = useMemo(() => {
    void tick;
    return toRows(ks, clientReady);
  }, [clientReady, tick, ks]);

  if (summary) {
    return (
      <Card className={cn('overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_10px_28px_-26px_rgba(15,23,42,0.28)]', className)} aria-busy={syncState === 'loading'}>
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:gap-5">
          <div className="min-w-0 lg:w-40 lg:shrink-0">
            <CardTitle className="text-sm">{title}</CardTitle>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-live="polite">
              {syncState === 'loading' ? (
                <><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Actualizando uso</>
              ) : syncState === 'error' ? (
                <><AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-300" aria-hidden="true" /> Mostrando datos guardados</>
              ) : (
                <>Se reinicia a las {resetDateStr || '—'}</>
              )}
            </div>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.kind} className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{row.icon}</span>
                    <span className="truncate">{row.shortLabel}</span>
                  </span>
                  <span className={cn('shrink-0 font-medium tabular-nums', row.pct >= 100 && 'text-destructive')}>
                    {row.count}/{row.limit}
                  </span>
                </div>
                <Progress className="mt-1.5 h-1.5" value={row.pct} aria-label={`${row.label}: ${row.count} de ${row.limit}`} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const content = (
    <div className={cn('space-y-3', compact && 'rounded-[24px] border border-border/60 bg-card/65 p-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.16)]')}>
      {compact && title ? <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</div> : null}
      {rows.map((r) => (
        <div key={r.kind} className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {r.icon}
              <span className="text-sm font-medium">{r.label}</span>
              <Badge variant={r.pct >= 100 ? 'destructive' : r.pct >= 80 ? 'secondary' : 'outline'}>
                {r.count}/{r.limit}
              </Badge>
            </div>
            <Progress value={r.pct} aria-label={`Progreso ${r.label}`} />
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">{r.pct}%</div>
        </div>
      ))}
      <div className="text-[11px] text-muted-foreground">
        Resetea aprox.: {resetDateStr || '...'} (medianoche UTC).
      </div>
    </div>
  );

  if (compact) return content;

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {content}
      </CardContent>
    </Card>
  );
}
