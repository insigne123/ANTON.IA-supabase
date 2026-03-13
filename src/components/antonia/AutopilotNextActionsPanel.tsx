'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Flame, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type NextAction = {
  id: string;
  priority: number;
  kind: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTarget: string;
  ctaTargetType: 'tab' | 'route';
  suggestedReply?: string;
};

function kindIcon(kind: string) {
  if (kind === 'hot_reply') return <Flame className="h-4 w-4 text-orange-500" />;
  if (kind === 'guardrail' || kind === 'compliance' || kind === 'delivery') return <ShieldAlert className="h-4 w-4 text-rose-500" />;
  return <Sparkles className="h-4 w-4 text-primary" />;
}

export function AutopilotNextActionsPanel({
  onOpenTab,
}: {
  onOpenTab?: (tab: string) => void;
}) {
  const [items, setItems] = useState<NextAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/antonia/next-actions', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudieron cargar las acciones');
      const data = await res.json();
      setItems((data.items || []) as NextAction[]);
    } catch (error) {
      console.error('[AutopilotNextActionsPanel] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
    const interval = setInterval(fetchActions, 30000);
    return () => clearInterval(interval);
  }, [fetchActions]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Next Best Actions</CardTitle>
            <CardDescription>Lo que ANTONIA recomienda atender primero para sostener el piloto automatico.</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={fetchActions}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
            No hay acciones urgentes. El autopilot esta relativamente estable.
          </div>
        ) : items.map((item) => (
          <div key={item.id} className="rounded-xl border p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {kindIcon(item.kind)}
                  <Badge variant="outline">P{item.priority}</Badge>
                  <Badge variant="secondary">{item.kind}</Badge>
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                {item.suggestedReply && (
                  <div className="rounded-lg bg-secondary/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                    {item.suggestedReply}
                  </div>
                )}
              </div>

              <div className="shrink-0">
                {item.ctaTargetType === 'route' ? (
                  <Button asChild>
                    <Link href={item.ctaTarget}>
                      {item.ctaLabel} <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={() => onOpenTab?.(item.ctaTarget)}>
                    {item.ctaLabel} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
