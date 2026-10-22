'use client';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FitProposal } from '@/lib/commercial-opportunities/member-work';

/**
 * The answers members gave to «¿Cumplimos?» that wait for an administrator: they are claims about the company, and the offers built on
 * its ficha are public, so they go into the ficha only when an administrator confirms them. Everyone sees what is waiting; only
 * administrators get the buttons.
 */
export function FitProposals({ proposals, admin, busy, nameOf, onResolve }: {
  proposals: FitProposal[]; admin: boolean; busy: boolean; nameOf: (userId: string | null) => string;
  onResolve: (activityId: string, accept: boolean) => void;
}) {
  if (!proposals.length) return null;
  return <section aria-label="Respuestas para la ficha" className="space-y-3 rounded-xl bg-cw-warning-soft px-4 py-3">
    <div>
      <h2 className="text-sm font-semibold">{admin ? 'Respuestas para la ficha por confirmar' : 'Tu respuesta espera a un administrador'}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{admin
        ? 'Un integrante respondió por la empresa. Si es cierto, confírmala y pasa a la ficha; si no, descártala.'
        : 'Lo que respondes por la empresa entra a la ficha cuando un administrador lo confirma.'}</p>
    </div>
    <ul className="divide-y divide-border/60">
      {proposals.map(proposal => <li key={proposal.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1 text-sm">
          <p className="leading-6">{proposal.question}</p>
          <p className="font-medium leading-6">{proposal.answer}</p>
          <p className="text-xs text-muted-foreground">{nameOf(proposal.actorId)}</p>
        </div>
        {admin && <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={busy} onClick={() => onResolve(proposal.id, true)}><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Confirmar</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onResolve(proposal.id, false)}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Descartar</Button>
        </div>}
      </li>)}
    </ul>
  </section>;
}
