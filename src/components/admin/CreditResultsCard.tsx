'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CREDIT_STEPS, costSentence, creditResultsSentence, waitingSentence, type CreditOutcomes, type CreditResultsPerson } from '@/lib/credit-results';

type Response = { from: string; to: string; totals: CreditOutcomes; people: CreditResultsPerson[] };
const n = (value: number) => value.toLocaleString('es-CL');

/**
 * «Qué se obtuvo con los créditos» in Administración (src/lib/credit-results.ts): the period's Apollo credits, the people
 * paid for and what happened with them, for the whole organization, a team or one person.
 */
export function CreditResultsCard({ from, to, organizationId, groupId, userId }: { from: string; to: string; organizationId?: string; groupId?: string; userId?: string }) {
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
      const response = await fetch(`/api/dashboard/admin/credit-results?${search}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body?.error || 'No pudimos leer qué se obtuvo con los créditos.');
      setData(body);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'No pudimos leer qué se obtuvo con los créditos.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [from, to, organizationId, groupId, userId]);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  return <CreditResultsView data={data} loading={loading} error={error} single={Boolean(userId)} onRetry={() => void load()} />;
}

/** The card itself, from what the route answered. */
export function CreditResultsView({ data, loading, error, single, onRetry }: { data: Response | null; loading: boolean; error: string; single: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <Card role="region" aria-labelledby="credit-results-title"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p id="credit-results-title" role="alert" className="text-sm text-muted-foreground">{error}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}><RefreshCw aria-hidden="true" />Reintentar</Button>
      </CardContent></Card>
    );
  }
  if (!data) return loading ? <Skeleton className="h-40 rounded-2xl" /> : null;
  const { totals } = data;
  const cost = costSentence(totals);
  const waiting = waitingSentence(totals);
  const empty = !totals.credits && !totals.paid;
  return (
    <Card role="region" aria-labelledby="credit-results-title" aria-busy={loading}>
      <CardHeader className="space-y-1.5 pb-3">
        <h2 id="credit-results-title" className="text-base font-semibold leading-none tracking-tight">Qué se obtuvo con los créditos</h2>
        <p className="text-sm leading-6 text-muted-foreground">{creditResultsSentence(totals)}</p>
      </CardHeader>
      {empty ? null : (
        <CardContent className="space-y-4">
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="De los créditos a las reuniones">
            {CREDIT_STEPS.map(step => (
              <li key={step.key} className="rounded-xl border border-border/60 p-3">
                <p className="text-2xl font-semibold tabular-nums tracking-tight">{n(totals[step.key])}</p>
                <p className="text-xs text-muted-foreground">{step.label}</p>
              </li>
            ))}
          </ol>
          {cost || waiting ? (
            <div className="space-y-1 text-sm">
              {cost ? <p>{cost}</p> : null}
              {waiting ? <p className="text-cw-warning">{waiting}</p> : null}
            </div>
          ) : null}
          {!single && data.people.length > 1 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead className="text-right">Créditos</TableHead>
                  <TableHead className="text-right">Con datos</TableHead>
                  <TableHead className="text-right">Contactadas</TableHead>
                  <TableHead className="text-right">Conversaciones</TableHead>
                  <TableHead className="text-right">Reuniones</TableHead>
                  <TableHead className="text-right">Sin contacto</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.people.map(person => (
                    <TableRow key={person.userId}>
                      <TableCell className="font-medium">{person.name || 'Persona sin nombre'}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.credits)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.paid)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.contacted)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.conversations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.meetings)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(person.waiting)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Cada persona cuenta para quien la pagó. Contactada: correo enviado, o llamada o WhatsApp con resultado. Conversación: una respuesta real o una llamada contestada. Lo hecho fuera de ANTON.IA sin registrar no aparece.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
