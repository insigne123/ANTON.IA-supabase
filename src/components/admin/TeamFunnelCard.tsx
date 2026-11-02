'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WORK_STEPS, funnelSentence, hasWork, stallCell, teamStall, workStall, type TeamFunnel } from '@/lib/team-funnel';
import { cn } from '@/lib/utils';

type Response = TeamFunnel & { from: string; to: string };
const n = (value: number) => value.toLocaleString('es-CL');

/**
 * «El trabajo, paso a paso» in Administración (src/lib/team-funnel.ts): the period's steps for the organization, a team or
 * one person, where the work stops for most of them, and each member's row.
 */
export function TeamFunnelCard({ from, to, organizationId, groupId, userId }: { from: string; to: string; organizationId?: string; groupId?: string; userId?: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError('');
    try {
      const search = new URLSearchParams({ from, to });
      if (organizationId) search.set('organizationId', organizationId);
      if (groupId) search.set('groupId', groupId);
      if (userId) search.set('userId', userId);
      const response = await fetch(`/api/dashboard/admin/team-funnel?${search}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body?.error || 'No pudimos leer el trabajo del equipo.');
      setData(body);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'No pudimos leer el trabajo del equipo.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [from, to, organizationId, groupId, userId]);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  return <TeamFunnelView data={data} loading={loading} error={error} single={Boolean(userId)} onRetry={() => void load()} />;
}

/** The card itself, from what the route answered. */
export function TeamFunnelView({ data, loading, error, single, onRetry }: { data: Response | null; loading: boolean; error: string; single: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <Card role="region" aria-labelledby="team-funnel-title"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p id="team-funnel-title" role="alert" className="text-sm text-muted-foreground">{error}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}><RefreshCw aria-hidden="true" />Reintentar</Button>
      </CardContent></Card>
    );
  }
  if (!data) return loading ? <Skeleton className="h-40 rounded-2xl" /> : null;
  const stalled = single ? workStall(data.total)?.step : teamStall(data)?.step;
  return (
    <Card role="region" aria-labelledby="team-funnel-title" aria-busy={loading}>
      <CardHeader className="space-y-1.5 pb-3">
        <h2 id="team-funnel-title" className="text-base font-semibold leading-none tracking-tight">El trabajo, paso a paso</h2>
        <p className="text-sm leading-6 text-muted-foreground">{funnelSentence(data, single)}</p>
      </CardHeader>
      {hasWork(data.total) ? (
        <CardContent className="space-y-4">
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Del contacto guardado a la conversación">
            {WORK_STEPS.map(step => (
              <li key={step.key} className={cn('rounded-xl border p-3', step.key === stalled ? 'border-transparent bg-cw-warning-soft' : 'border-border/60')}>
                <p className="text-2xl font-semibold tabular-nums tracking-tight">{n(data.total[step.key])}</p>
                <p className={cn('text-xs', step.key === stalled ? 'text-cw-warning' : 'text-muted-foreground')}>
                  {step.label}{step.key === stalled ? <span className="sr-only"> (aquí se frena)</span> : null}
                </p>
              </li>
            ))}
          </ol>
          {!single && data.people.length > 1 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Persona</TableHead>
                  {WORK_STEPS.map(step => <TableHead key={step.key} className="text-right">{step.label}</TableHead>)}
                  <TableHead>Dónde se frena</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.people.map(person => (
                    <TableRow key={person.userId}>
                      <TableCell className="font-medium">{person.name || 'Persona sin nombre'}</TableCell>
                      {WORK_STEPS.map(step => <TableCell key={step.key} className="text-right tabular-nums">{n(person.funnel[step.key])}</TableCell>)}
                      <TableCell className="whitespace-nowrap text-muted-foreground">{stallCell(person.funnel)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Cada paso cuenta lo hecho en el período, así que uno puede superar al anterior. Contactados: correo enviado, o llamada o WhatsApp con resultado. Conversaciones: una respuesta real o una llamada contestada.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}
