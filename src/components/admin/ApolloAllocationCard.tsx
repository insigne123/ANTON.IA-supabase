'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apolloAllocationCopy, type ApolloCreditAllocation } from '@/lib/apollo-credit-allocation';
import { cn } from '@/lib/utils';

const n = (value: number) => value.toLocaleString('es-CL');

/** Shown only while the organization has Apollo credits assigned for a window; otherwise nothing is drawn. */
export function ApolloAllocationCard() {
  const [allocation, setAllocation] = useState<ApolloCreditAllocation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dashboard/admin/apollo', { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(body => { if (!controller.signal.aborted) setAllocation(body?.allocation ?? null); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!allocation) return null;
  const copy = apolloAllocationCopy(allocation);

  return (
    <Card className="border-border/60" role="region" aria-labelledby="apollo-allocation-title">
      <CardHeader className="pb-3">
        <CardTitle className="text-base"><h2 id="apollo-allocation-title">Créditos de Apollo</h2></CardTitle>
        {allocation.note && <p className="text-sm leading-6 text-muted-foreground">{allocation.note}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={cn('text-sm leading-6', copy.spent && 'font-medium')} role={copy.spent ? 'status' : undefined}>{copy.summary}</p>
        {copy.total !== null && copy.remaining !== null ? (
          <>
            <Progress value={copy.total > 0 ? Math.min(100, Math.round((copy.used / copy.total) * 100)) : 100}
              aria-label={`Usados ${n(copy.used)} de ${n(copy.total)} créditos`} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
              <p><span className="font-semibold tabular-nums">{n(copy.used)}</span> <span className="text-muted-foreground">usados</span></p>
              <p><span className="font-semibold tabular-nums">{n(copy.remaining)}</span> <span className="text-muted-foreground">disponibles</span></p>
            </div>
          </>
        ) : (
          <p className="text-sm"><span className="text-3xl font-semibold tabular-nums tracking-tight">{n(copy.used)}</span> <span className="text-muted-foreground">usados</span></p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">{copy.footnote}</p>
      </CardContent>
    </Card>
  );
}
