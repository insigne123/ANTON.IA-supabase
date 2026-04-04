'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type ReplyLabResult = {
  id: string;
  label: string;
  expectedAction: string;
  actualAction: string;
  recommendedAction: string;
  passed: boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
};

type ReplyLabRun = {
  config: {
    enabled: boolean;
    mode: string;
    approvalMode: string;
    maxAutoTurns: number;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    safeToPromote: boolean;
  };
  results: ReplyLabResult[];
};

type ReplyLabPayload = {
  activeConfig: any;
  preview: ReplyLabRun;
  history: Array<{
    id: string;
    created_at: string;
    summary: ReplyLabRun['summary'];
  }>;
};

export default function AntoniaReplyLabPage() {
  const { toast } = useToast();
  const [payload, setPayload] = useState<ReplyLabPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/antonia/reply-lab', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar Reply Safety Lab');
      setPayload(await res.json());
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'No se pudo cargar el laboratorio' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function runLab() {
    setRunning(true);
    try {
      const res = await fetch('/api/antonia/reply-lab', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo ejecutar el laboratorio');
      toast({ title: 'Reply Safety Lab ejecutado', description: `Pass rate: ${data.run.summary.passRate}%` });
      await load();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'No se pudo ejecutar la prueba' });
    } finally {
      setRunning(false);
    }
  }

  const preview = payload?.preview;

  return (
    <div className="container mx-auto space-y-6">
      <PageHeader
        title="Reply Safety Lab"
        description="Suite de replay y policy checks para validar replies autonomos antes de habilitar produccion full-auto."
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/antonia"><Button variant="outline">Volver a ANTONIA</Button></Link>
        <Button variant="outline" onClick={load} disabled={loading || running}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refrescar
        </Button>
        <Button onClick={runLab} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
          Ejecutar laboratorio
        </Button>
      </div>

      {preview ? (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardDescription>Modo reply autopilot</CardDescription><CardTitle className="text-lg">{preview.config.mode}</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Pass rate</CardDescription><CardTitle className="text-lg">{preview.summary.passRate}%</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Escenarios</CardDescription><CardTitle className="text-lg">{preview.summary.total}</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Gate de promocion</CardDescription><CardTitle className="text-lg">{preview.summary.safeToPromote ? 'Listo' : 'Bloqueado'}</CardTitle></CardHeader>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Preview activo</CardTitle>
          <CardDescription>
            Evalua si ANTONIA responderia correctamente en casos seguros, ambiguos y riesgosos antes de liberar auto-reply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !preview ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : preview ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caso</TableHead>
                    <TableHead>Esperado</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Recomendado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.results.map((result) => (
                    <TableRow key={result.id}>
                      <TableCell className="font-medium">{result.label}</TableCell>
                      <TableCell>{result.expectedAction}</TableCell>
                      <TableCell>{result.actualAction}</TableCell>
                      <TableCell>{result.recommendedAction}</TableCell>
                      <TableCell>
                        <Badge variant={result.passed ? 'default' : 'destructive'} className="gap-1">
                          {result.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {result.passed ? 'Pass' : 'Fail'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px] text-xs text-muted-foreground">{result.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sin datos disponibles.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de ejecuciones</CardTitle>
          <CardDescription>Usa estas corridas como gate antes de pasar el reply autopilot a produccion real.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {payload?.history?.length ? payload.history.map((item) => (
            <div key={item.id} className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{new Date(item.created_at).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Pass rate {item.summary.passRate}% · {item.summary.passed}/{item.summary.total} casos</div>
              </div>
              <Badge variant={item.summary.safeToPromote ? 'default' : 'secondary'}>
                {item.summary.safeToPromote ? 'Gate aprobado' : 'Gate bloqueado'}
              </Badge>
            </div>
          )) : (
            <div className="text-sm text-muted-foreground">Aun no hay ejecuciones guardadas.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
