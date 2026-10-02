'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { analyzeIcp } from '@/lib/cowork/icp';
import { formatRate, formatRateCompact, icpPeriod, includesTerm, SEGMENT_VIEWS, type SegmentView } from '@/lib/icp/view';
import { cn } from '@/lib/utils';

type Analysis = ReturnType<typeof analyzeIcp> & { partial?: string };
const isAnalysis = (data: unknown): data is Analysis => {
  const value = data as Partial<Analysis> | null;
  return Boolean(value && typeof value === 'object' && value.totals && value.segments && Array.isArray(value.gaps));
};

/**
 * «Lo que dicen tus resultados» in Perfil › Tu cliente ideal (plan 8, phase 2): who answered, by role area, industry,
 * place and level, with the probable range of each rate and a warning when the sample is too small to conclude. An
 * industry that brought positive answers can be added to the form; nothing is saved until the person saves the profile.
 */
export function IcpResultsPanel({ targetIndustries, onAddIndustry }: { targetIndustries: string; onAddIndustry: (industry: string) => void }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SegmentView>('area');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/icp', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((data as { error?: string }).error || 'No pudimos leer tus resultados.');
      if (!isAnalysis(data)) throw new Error('No pudimos leer tus resultados.');
      setAnalysis(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos leer tus resultados.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const segment = analysis?.segments[view];
  const small = analysis ? analysis.totals.confidence.startsWith('muestra chica') : false;
  const period = useMemo(() => (analysis ? icpPeriod(analysis.totals.firstSend, analysis.totals.lastSend) : ''), [analysis]);

  return (
    <section aria-labelledby="icp-results-heading" className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="icp-results-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />Lo que dicen tus resultados
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Quién respondió a los correos de tu equipo, por grupo. Úsalo para ajustar los campos de arriba.</p>
        </div>
        {analysis ? (
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', small ? 'bg-cw-warning-soft text-cw-warning' : 'bg-primary/10 text-primary')}>
            {small ? 'Muestra chica' : analysis.totals.confidence === 'indicio' ? 'Indicio' : 'Muestra suficiente'}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Cargando tus resultados">
          <Skeleton className="h-5 w-3/4" /><Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground" role="alert">
          {error}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Reintentar</Button>
        </div>
      ) : analysis && analysis.totals.people === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
          Aún no hay correos enviados para comparar. Cuando tu equipo envíe, aquí verás qué cargos e industrias responden.
        </p>
      ) : analysis && segment ? (
        <>
          <p className="mt-3 text-sm text-foreground">
            <strong className="font-semibold">{analysis.totals.people}</strong> {analysis.totals.people === 1 ? 'persona contactada' : 'personas contactadas'}{period}:{' '}
            <strong className="font-semibold">{analysis.totals.replied}</strong> respondieron ({formatRate(analysis.totals.replyRate)}) y{' '}
            <strong className="font-semibold">{analysis.totals.positive}</strong> con interés ({formatRate(analysis.totals.positiveRate)}).
            {analysis.totals.meetings ? <> {analysis.totals.meetings} llegaron a reunión.</> : null}
          </p>
          {small ? (
            <p className="mt-2 flex gap-2 rounded-lg bg-cw-warning-soft px-3 py-2 text-xs text-cw-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Con menos de 30 personas, las diferencias entre grupos pueden ser azar: tómalas como pistas para probar, no como conclusiones.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Ver por">
            {SEGMENT_VIEWS.map(item => (
              <Button key={item.id} type="button" size="sm" variant={view === item.id ? 'default' : 'outline'} aria-pressed={view === item.id}
                className="h-8 rounded-full" onClick={() => setView(item.id)}>{item.label}</Button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 sm:px-4">{SEGMENT_VIEWS.find(item => item.id === view)?.column}</TableHead>
                  <TableHead className="px-3 text-right sm:px-4"><span className="sm:hidden">Total</span><span className="hidden sm:inline">Contactadas</span></TableHead>
                  <TableHead className="hidden px-3 text-right sm:table-cell sm:px-4">Respondieron</TableHead>
                  <TableHead className="px-3 text-right sm:px-4"><span className="sm:hidden">Interés</span><span className="hidden sm:inline">Con interés</span></TableHead>
                  {view === 'industry' ? <TableHead className="w-24"><span className="sr-only">Acción</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {segment.groups.map(group => {
                  const added = includesTerm(targetIndustries, group.value);
                  return (
                    <TableRow key={group.value}>
                      <TableCell className="px-3 font-medium sm:px-4">{group.value}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums sm:px-4">{group.sent}</TableCell>
                      <TableCell className="hidden px-3 text-right tabular-nums sm:table-cell sm:px-4">{group.replied}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums sm:px-4">
                        {group.positive} <span className="hidden text-xs text-muted-foreground sm:inline">· {formatRateCompact(group.positiveRate)}</span>
                      </TableCell>
                      {view === 'industry' ? (
                        <TableCell className="text-right">
                          {group.positive > 0 && !/^Sin /.test(group.value) ? (
                            added ? <span className="whitespace-nowrap text-xs text-muted-foreground">En tu perfil</span> : (
                              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAddIndustry(group.value)}
                                aria-label={`Sumar ${group.value} a las industrias de tu cliente ideal`}>
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />Sumar
                              </Button>
                            )
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {segment.otherGroups ? (
            <p className="mt-2 text-xs text-muted-foreground">Y {segment.otherGroups} {segment.otherGroups === 1 ? 'grupo más' : 'grupos más'} con {segment.otherSent} personas en total.</p>
          ) : null}

          {analysis.coverage ? (
            <p className="mt-4 text-sm text-foreground">
              <strong className="font-semibold">{analysis.coverage.fitDeclared}</strong> de tus {analysis.coverage.savedContacts} contactos calzan con tu cliente ideal
              y <strong className="font-semibold">{analysis.coverage.fitNotContacted}</strong> aún no reciben nada.{' '}
              {analysis.coverage.fitNotContacted ? <Link href="/dashboard#recomendados" className="font-medium text-primary underline-offset-4 hover:underline">Ver a quién escribir</Link> : null}
            </p>
          ) : null}
          {analysis.gaps.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground" aria-label="Lo que falta">
              {analysis.gaps.filter(gap => !/muy pocas para concluir/.test(gap)).map(gap => <li key={gap}>· {gap}</li>)}
            </ul>
          ) : null}
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded font-medium text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cómo se calcula</summary>
            <p className="mt-1.5 leading-5">{analysis.method}</p>
            {analysis.partial ? <p className="mt-1">{analysis.partial}</p> : null}
          </details>
        </>
      ) : null}
    </section>
  );
}
