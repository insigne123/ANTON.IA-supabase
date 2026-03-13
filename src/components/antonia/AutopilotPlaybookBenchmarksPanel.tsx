'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type BenchmarkRow = {
  playbookId: string;
  playbookName: string;
  missions: number;
  contacts: number;
  opens: number;
  replies: number;
  positives: number;
  failed: number;
  compliance: number;
  openRate: number;
  replyRate: number;
  positiveRate: number;
  deliverabilityRisk: number;
};

export function AutopilotPlaybookBenchmarksPanel() {
  const [items, setItems] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/antonia/playbook-benchmarks', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudieron cargar los benchmarks');
      const data = await res.json();
      setItems((data.items || []) as BenchmarkRow[]);
    } catch (error) {
      console.error('[AutopilotPlaybookBenchmarksPanel] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Benchmark por playbook
            </CardTitle>
            <CardDescription>
              Compara que playbooks de outsourcing convierten mejor y cuales estan mostrando riesgo de deliverability.
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={fetchItems}>
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
            Aun no hay misiones con playbooks suficientes para comparar.
          </div>
        ) : items.map((item) => (
          <div key={item.playbookId} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{item.playbookName}</p>
                <p className="text-xs text-muted-foreground">Misiones: {item.missions} · Contactos: {item.contacts} · Positivas: {item.positives}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Open {item.openRate}%</Badge>
                <Badge variant="outline">Reply {item.replyRate}%</Badge>
                <Badge variant={item.positiveRate >= 10 ? 'default' : 'secondary'}>Positive {item.positiveRate}%</Badge>
                <Badge variant={item.deliverabilityRisk >= 20 ? 'destructive' : 'outline'}>Risk {item.deliverabilityRisk}%</Badge>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
