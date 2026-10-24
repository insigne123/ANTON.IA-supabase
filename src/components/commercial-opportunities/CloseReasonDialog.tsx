'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MAX_MOTIVES, motivesFor, type CloseDetail } from '@/lib/commercial-opportunities/close-outcome';
import { cn } from '@/lib/utils';

/** What Mercado Público already said (OPP-29) comes filled in: who won and for how much, and «desierta» when nobody did. */
export type ClosePrefill = { motives?: string[]; winner?: string | null; amount?: number | null };
export type CloseTarget = { id: string; state: 'won' | 'lost'; revision: number; prefill?: ClosePrefill };

const COPY = {
  won: {
    title: 'Pasar a Ganada', action: 'Pasar a Ganada',
    description: 'Qué hizo la diferencia ayuda al equipo a repetirlo. Todo es opcional.',
    placeholder: 'Ej.: respondimos antes del cierre y el precio era el más bajo.',
  },
  lost: {
    title: 'Pasar a Perdida', action: 'Pasar a Perdida',
    description: 'Qué pasó ayuda al equipo a aprender de esta. Todo es opcional.',
    placeholder: 'Ej.: pidieron un plazo de entrega menor al que ofrecimos.',
  },
} as const;
/** «$85.000.000» or «85000000» as a number; anything else, nothing. */
const amountOf = (value: string) => { const digits = value.replace(/[^\d]/g, ''); return digits ? Number(digits) : undefined; };

/**
 * Closing an opportunity as won or lost asks, once, why: up to three reasons in chips, the same for everyone so they can be counted
 * («Lo que aprendimos»), and for one lost who won it and for how much. All optional: the move works with nothing. It goes to the activity
 * of the opportunity next to the new stage: «Estado: Perdida · Precio. Ganó Seguridad Sur SpA por $85.000.000.». Cancel leaves it as it was.
 */
export function CloseReasonDialog({ target, busy, error, onConfirm, onCancel }: {
  target: CloseTarget | null; busy: boolean;
  /** What went wrong the last time it was confirmed (a stale revision, no connection): what was chosen stays so it is not done again. */
  error?: string;
  onConfirm: (target: CloseTarget, note: string, detail: CloseDetail) => void | Promise<unknown>; onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [motives, setMotives] = useState<string[]>([]);
  const [winner, setWinner] = useState('');
  const [amount, setAmount] = useState('');
  // What was chosen for one opportunity is not carried to the next, nor kept once the dialog closes; what is known comes filled in.
  // A failed confirm keeps the same target, and so what was chosen.
  useEffect(() => {
    setNote(''); setMotives(target?.prefill?.motives?.slice(0, MAX_MOTIVES) ?? []);
    setWinner(target?.state === 'lost' ? target.prefill?.winner ?? '' : '');
    setAmount(target?.prefill?.amount ? Math.round(target.prefill.amount).toLocaleString('es-CL') : '');
  }, [target]);
  const state = target?.state ?? 'won';
  const copy = COPY[state];
  const toggle = (id: string) => setMotives(current => current.includes(id) ? current.filter(item => item !== id) : current.length >= MAX_MOTIVES ? current : [...current, id]);
  const submit = () => {
    if (!target || busy) return;
    const value = amountOf(amount);
    void onConfirm(target, note.replace(/\s+/g, ' ').trim(), {
      motives, ...(state === 'lost' && winner.trim() ? { winner: winner.replace(/\s+/g, ' ').trim() } : {}), ...(value !== undefined ? { amount: value } : {}),
    });
  };
  return <Dialog open={target !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{state === 'won' ? 'Por qué la ganamos' : 'Por qué la perdimos'} <span className="font-normal text-muted-foreground">(hasta {MAX_MOTIVES})</span></legend>
          <div className="flex flex-wrap gap-2">
            {/* The chosen one is the dark pill, as in the filters of the list; a fourth cannot be added until one is taken away. */}
            {motivesFor(state).map(([id, label]) => {
              const on = motives.includes(id);
              return <button key={id} type="button" aria-pressed={on} disabled={busy || (!on && motives.length >= MAX_MOTIVES)} onClick={() => toggle(id)}
                className={cn('h-8 shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  on ? 'border-transparent bg-foreground font-medium text-background' : 'border-border bg-background text-foreground/75 hover:bg-muted hover:text-foreground')}>
                {label}</button>;
            })}
          </div>
        </fieldset>
        <div className={cn('grid gap-3', state === 'lost' && 'sm:grid-cols-2')}>
          {state === 'lost' && <div className="space-y-2">
            <Label htmlFor="close-winner">Quién la ganó (opcional)</Label>
            <Input id="close-winner" value={winner} onChange={event => setWinner(event.target.value)} maxLength={200} placeholder="Ej.: Seguridad Sur SpA" autoComplete="off" />
          </div>}
          <div className="space-y-2">
            <Label htmlFor="close-amount">{state === 'lost' ? 'Por cuánto (opcional)' : 'Monto adjudicado (opcional)'}</Label>
            <Input id="close-amount" value={amount} onChange={event => setAmount(event.target.value)} inputMode="numeric" maxLength={20} placeholder="Ej.: 85.000.000" autoComplete="off" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="close-reason">Algo más (opcional)</Label>
          <Textarea id="close-reason" value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={2} placeholder={copy.placeholder} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{copy.action}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
