'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type CloseTarget = { id: string; state: 'won' | 'lost'; revision: number };

const COPY = {
  won: {
    title: 'Pasar a Ganada', action: 'Pasar a Ganada',
    description: 'Una línea sobre qué hizo la diferencia ayuda al equipo a repetirlo. Es opcional.',
    placeholder: 'Ej.: respondimos antes del cierre y el precio era el más bajo.',
  },
  lost: {
    title: 'Pasar a Perdida', action: 'Pasar a Perdida',
    description: 'Una línea sobre qué pasó ayuda al equipo a aprender de esta. Es opcional.',
    placeholder: 'Ej.: adjudicaron a otra empresa con menor plazo de entrega.',
  },
} as const;

/**
 * Closing an opportunity as won or lost asks, once, for the reason in a line. It is optional (the move works with it empty) and it goes
 * to the activity of the opportunity next to the new stage, where the team reads it: «Estado: Perdida. Adjudicaron a otra empresa…».
 * Cancel leaves the opportunity where it was.
 */
export function CloseReasonDialog({ target, busy, error, onConfirm, onCancel }: {
  target: CloseTarget | null; busy: boolean;
  /** What went wrong the last time it was confirmed (a stale revision, no connection): the note stays so it is not typed again. */
  error?: string;
  onConfirm: (target: CloseTarget, note: string) => void | Promise<unknown>; onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  // The line of one opportunity is not carried to the next, nor kept once the dialog closes.
  const which = target ? `${target.id}:${target.state}` : '';
  useEffect(() => { setNote(''); }, [which]);
  const copy = target ? COPY[target.state] : COPY.won;
  return <Dialog open={target !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (target && !busy) void onConfirm(target, note.replace(/\s+/g, ' ').trim()); }}>
        <div className="space-y-2">
          <Label htmlFor="close-reason">Motivo (opcional)</Label>
          <Textarea id="close-reason" value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3} autoFocus placeholder={copy.placeholder} />
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
