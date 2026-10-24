'use client';
import { ExternalLink, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isFinalResult, resultLine, type StoredResult } from '@/lib/commercial-opportunities/close-outcome';
import type { WorkState } from '@/lib/commercial-opportunities/member-work';
import type { ClosePrefill } from './CloseReasonDialog';

type Props = {
  result: StoredResult | null | undefined; state: WorkState | null; admin: boolean; busy: boolean;
  /** Opens «Pasar a Ganada» or «Pasar a Perdida» with what Mercado Público said already filled in. */
  onClose: (state: 'won' | 'lost', prefill: ClosePrefill) => void;
};

/**
 * After «Presentada», what happened (OPP-29), from Mercado Público, checked every morning: «Adjudicada el 20 de octubre a Seguridad Sur
 * SpA por $85.000.000, entre 5 ofertas.» An administrator records it with one click, with who won and for how much already filled in;
 * the one in front is the likely one (won when the winner's RUT is the company's). Nothing shows once it is closed.
 */
export function TenderResultCallout({ result, state, admin, busy, onClose }: Props) {
  if (['won', 'lost', 'archived', 'unassigned'].includes(state ?? 'assigned')) return null;
  const final = isFinalResult(result?.status);
  // Before it is decided, only a presented tender says anything: that it is being watched, and when it should be awarded.
  if (!final && state !== 'submitted') return null;
  const line = result ? resultLine(result) : 'Revisamos el resultado en Mercado Público cada mañana: les avisaremos cuando se adjudique.';
  const awarded = result?.status === 'adjudicada';
  const first = result?.winners[0];
  const lost: ClosePrefill = awarded ? { motives: ['competitor'], winner: first?.name ?? null, amount: result?.total ?? null } : { motives: ['void'] };
  const won: ClosePrefill = { amount: (result?.winners.length === 1 ? result.total : null) ?? null };
  return <section aria-label="Resultado en Mercado Público" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-muted/20 px-4 py-3">
    <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-sm">
      <span className="font-medium">{final ? 'Resultado: ' : 'Presentada. '}</span>{line}
      {result?.ours === true && awarded ? <span className="font-medium"> La adjudicaron a tu empresa.</span> : null}
      {result?.actUrl ? <> <a href={result.actUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver acta<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span></a></> : null}
    </p>
    {final && admin ? <div className="flex flex-wrap gap-2">
      {awarded && result?.ours === true
        ? <><Button size="sm" disabled={busy} onClick={() => onClose('won', won)}>Pasar a Ganada</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onClose('lost', lost)}>No la ganamos</Button></>
        : awarded && result?.ours === false
          ? <><Button size="sm" disabled={busy} onClick={() => onClose('lost', lost)}>Pasar a Perdida</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onClose('won', won)}>La ganamos</Button></>
          : awarded
            // Without the company's RUT the page cannot tell: both ways, neither in front.
            ? <><Button size="sm" variant="outline" disabled={busy} onClick={() => onClose('won', won)}>La ganamos</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onClose('lost', lost)}>No la ganamos</Button></>
            : <Button size="sm" disabled={busy} onClick={() => onClose('lost', lost)}>Pasar a Perdida</Button>}
    </div> : null}
    {final && !admin ? <p className="w-full text-xs text-muted-foreground">Un administrador registrará el resultado.</p> : null}
  </section>;
}
