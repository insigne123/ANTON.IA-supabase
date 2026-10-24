'use client';

import Link from 'next/link';
import { lastSearchLabel, type SourceHealth, type SourceState } from '@/lib/commercial-opportunities/source-health';
import { cn } from '@/lib/utils';

const DOT: Record<SourceState, string> = {
  ok: 'bg-emerald-500', searching: 'bg-primary motion-safe:animate-pulse', retrying: 'bg-amber-500', partial: 'bg-amber-500', failed: 'bg-destructive',
};

/**
 * How the daily search went, under the status strip (OPP-15): when it last answered and each source with a dot, the reason in words when
 * one did not answer. A radar with nothing new no longer looks the same as a broken one. With the ticket ANTON.IA shares (one quota for
 * every workspace), the way to connect the company's own, in «Conexiones».
 */
export function SearchHealthLine({ health, now = new Date() }: { health: { sources: SourceHealth[]; ticket: 'own' | 'shared' }; now?: Date }) {
  if (!health.sources.length) return null;
  const last = lastSearchLabel(health.sources, now);
  const tenders = health.sources.some(item => item.source === 'tenders' || item.source === 'compraAgil');
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    {last ? <span>{last}</span> : null}
    {health.sources.map(item => <span key={item.source} className="inline-flex items-center gap-1.5" title={item.detail}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[item.state])} />
      <span className={cn(item.state === 'failed' ? 'text-destructive' : item.state === 'ok' ? '' : 'text-foreground')}>{item.label}</span>
      {item.state === 'ok' ? <span className="sr-only">: {item.detail}</span> : <span>· {item.detail}</span>}
    </span>)}
    {tenders && health.ticket === 'shared' ? <Link href="/connections"
      className="rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Conecta el ticket de Mercado Público de tu empresa</Link> : null}
  </p>;
}
