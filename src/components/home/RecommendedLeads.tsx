'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw, Target, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { recommendationLink } from '@/lib/icp/view';
import { cn } from '@/lib/utils';

type Recommended = {
  leadId: string; name: string | null; title: string | null; company: string | null; score: number;
  reasons: string[]; missing: string[]; list?: 'por_escribir' | 'por_completar';
};
type Recommendations = {
  criteria: { terms: string[]; source: 'pedido' | 'perfil' | 'ninguno' };
  savedContacts: number; notContacted: number; fitting: number | null; excludedByTeam: number; readyToWrite: number; needEmail: number;
  top: Recommended[]; partial?: string;
};

const SHOWN = 5;
const MISSING_LABELS: Record<string, string> = { 'buscar su correo': 'Sin correo', investigarla: 'Sin investigar' };

/**
 * «Recomendados para ti» in Inicio (plan 8, phase 2): the contacts nobody has written to, best first for the customer of
 * «Perfil», with why each one fits and what is missing. Each row goes where the person acts on it.
 */
export function RecommendedLeads() {
  const [data, setData] = useState<Recommendations | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/leads/recommendations', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json() as Recommendations;
      if (!json || !Array.isArray(json.top) || !json.criteria) throw new Error('unexpected response');
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = data ? data.top.slice(0, expanded ? data.top.length : SHOWN) : [];
  return (
    <section id="recomendados" aria-labelledby="recommended-title" className="scroll-mt-24">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle id="recommended-title" className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" aria-hidden="true" />Recomendados para ti
          </CardTitle>
          <CardDescription>
            {data?.criteria.source === 'perfil'
              ? 'Tus contactos que aún nadie contacta, ordenados por cuánto calzan con tu cliente ideal de «Perfil» y por lo listos que están.'
              : 'Tus contactos que aún nadie contacta, ordenados por nivel y por lo listos que están.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando recomendados">
              {[0, 1, 2].map(index => <Skeleton key={index} className="h-14 rounded-xl" />)}
            </div>
          ) : error || !data ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <p className="text-sm text-muted-foreground">No pudimos cargar tus recomendados. Tus contactos están bien; prueba de nuevo.</p>
              <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Reintentar</Button>
            </div>
          ) : data.savedContacts === 0 ? (
            <Empty text="Aún no tienes contactos guardados. Guarda los primeros desde «Buscar prospectos» y aquí verás a quién escribir primero."
              href="/search" cta="Buscar prospectos" />
          ) : !data.top.length ? (
            <Empty text={data.criteria.source === 'perfil'
              ? 'Ninguno de tus contactos sin escribir calza con los cargos e industrias de tu cliente ideal. Busca nuevos o ajusta «Perfil».'
              : 'Todos tus contactos ya recibieron algo o los trabaja otro miembro del equipo.'}
              href="/search" cta="Buscar prospectos" />
          ) : (
            <>
              <p className="mb-3 text-sm text-foreground">
                {data.fitting !== null ? <><strong className="font-semibold">{data.fitting}</strong> calzan · </> : null}
                <strong className="font-semibold">{data.readyToWrite}</strong> con correo · <strong className="font-semibold">{data.needEmail}</strong> sin correo
                {data.excludedByTeam ? <span className="text-muted-foreground"> · {data.excludedByTeam} los trabaja otro miembro</span> : null}
              </p>
              {data.criteria.source === 'ninguno' ? (
                <p className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Define los cargos e industrias de tu cliente ideal en <Link href="/profile#icp-heading" className="font-medium text-primary underline-offset-4 hover:underline">Perfil</Link> para ordenarlos por calce.
                </p>
              ) : null}
              <ul className="space-y-2">
                {visible.map((item, index) => {
                  const link = recommendationLink(item);
                  return (
                    <li key={item.leadId} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:fill-mode-both" style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}>
                      <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold tabular-nums text-primary" aria-label={`Calce ${item.score} de 100`}>
                            {item.score}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{item.name || 'Sin nombre'}</p>
                            <p className="truncate text-xs text-muted-foreground">{[item.title, item.company].filter(Boolean).join(', ') || 'Sin cargo'}</p>
                            <p className="truncate text-xs text-muted-foreground/90">{item.reasons.slice(0, 3).join(' · ')}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 sm:pl-0">
                          {item.missing.map(missing => (
                            <span key={missing} className={cn('rounded-full px-2 py-0.5 text-xs',
                              missing === 'buscar su correo' ? 'bg-cw-warning-soft text-cw-warning' : 'bg-muted text-muted-foreground')}>
                              {MISSING_LABELS[missing] || missing}
                            </span>
                          ))}
                          <Button asChild size="sm" variant="outline" className="h-8">
                            <Link href={link.href}>{link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {data.top.length > SHOWN ? (
                <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
                  {expanded ? 'Ver menos' : `Ver ${data.top.length - SHOWN} más`}
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Empty({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex gap-2 text-sm text-muted-foreground"><Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{text}</p>
      <Button asChild size="sm" variant="outline"><Link href={href}>{cta}</Link></Button>
    </div>
  );
}
