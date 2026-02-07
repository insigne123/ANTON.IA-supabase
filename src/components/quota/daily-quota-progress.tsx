
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { QUOTA_KINDS, type QuotaKind, getClientQuota, getClientLimit, onQuotaChange } from '@/lib/quota-client';
import { cn } from '@/lib/utils';
import { FlaskConical, Search, Users, Sparkles } from 'lucide-react';
import { incClientQuota } from '@/lib/quota-client'; // sólo para emitir evento tras set local
import { microsoftAuthService } from '@/lib/microsoft-auth-service';

type Props = {
  className?: string;
  /** Si no se provee, muestra todos: leadSearch, research, contact */
  kinds?: QuotaKind[];
  /** Modo compacto: sin Card wrapper */
  compact?: boolean;
  /** Título opcional */
  title?: string;
  /** Forzar sync con servidor al cargar (default: true) */
  syncServer?: boolean;
};

type Row = {
  kind: QuotaKind;
  label: string;
  icon: JSX.Element;
  count: number;
  limit: number;
  pct: number;
};

function nextResetLocalString(): string {
  // próximo inicio de día UTC en hora local
  const now = new Date();
  const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return nextUtcMidnight.toLocaleString();
}

function toRows(kinds: QuotaKind[]): Row[] {
  const quota = getClientQuota();
  return kinds.map((k) => {
    const count = quota[k] || 0;
    const limit = getClientLimit(k);
    const pct = Math.max(0, Math.min(100, Math.round((count / Math.max(1, limit)) * 100)));
    const label =
      k === 'leadSearch' ? 'Búsqueda de Leads' :
      k === 'enrich'     ? 'Enriquecimiento' :
      k === 'research'   ? 'Investigación' :
      k === 'contact'    ? 'Contactos' : k;

    const icon =
      k === 'leadSearch' ? <Search className="h-4 w-4" aria-hidden="true" /> :
      k === 'enrich'     ? <Sparkles className="h-4 w-4" aria-hidden="true" /> :
      k === 'research'   ? <FlaskConical className="h-4 w-4" aria-hidden="true" /> :
      <Users className="h-4 w-4" aria-hidden="true" />;

    return { kind: k, label, icon, count, limit, pct };
  });
}

export default function DailyQuotaProgress({ className, kinds, compact, title = 'Uso diario', syncServer = true }: Props) {
  const [tick, setTick] = useState(0);
  const [resetDateStr, setResetDateStr] = useState<string>('');
  const ks = kinds && kinds.length ? kinds : QUOTA_KINDS;

  useEffect(() => {
    // Suscribirse a cambios de cuota en este tab
    const off = onQuotaChange(() => setTick((x) => x + 1));
    // También refrescar cuando cambia el día (por navegación prolongada)
    const id = setInterval(() => setTick((x) => x + 1), 60_000); // 1 min

    // Calcular la fecha del lado cliente para evitar hydration mismatch
    setResetDateStr(nextResetLocalString());

    return () => { off(); clearInterval(id); };
  }, []);

  // Sync con servidor: lee /api/quota/status y actualiza el espejo local para los recursos visibles
  useEffect(() => {
    if (!syncServer) return;
    const userId = microsoftAuthService.getUserIdentity()?.email || '';
    if (!userId) return;
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/quota/status', {
          method: 'GET',
          headers: { 'x-user-id': userId },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const statuses: Array<{ resource: string; count: number; limit: number; dayKey: string }> = data?.statuses || [];
        // Para cada recurso visible, si el servidor trae un count > espejo, “subimos” el espejo local
        // usando incClientQuota repetidamente (emite eventos y mantiene formato).
        const map = new Map(statuses.map(s => [s.resource, s]));
        for (const k of ks) {
          const s = map.get(k);
          if (!s) continue;
          const local = getClientQuota()[k] || 0;
          if (s.count > local) {
            // sube hasta igualar server (normalmente será 0→n o +1)
            for (let i = local; i < s.count; i++) incClientQuota(k);
          }
        }
      } catch { /* ignore */ }
      finally { setTick(x => x + 1); }
    })();
    return () => abort.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // sólo al montar


  const rows = useMemo(() => {
    void tick;
    return toRows(ks);
  }, [tick, ks]);

  const content = (
    <div className={cn('space-y-3', compact && 'p-0')}>
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
