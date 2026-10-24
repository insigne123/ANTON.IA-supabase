'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DISCARD_REASONS, type DiscardReason } from '@/lib/commercial-opportunities/list-stages';
import { filterChip } from './OpportunityFilters';

/** What is being put aside: one opportunity (its title) or several of the list. */
export type DiscardTarget = { ids: string[]; title?: string };

/**
 * «No es para nosotros»: the reason in a word (and, for «Otro motivo», the line that says which). The opportunities go to «Archivadas»
 * and the next evaluations read the reason, so the AI stops bringing more of the same. Cancel leaves them where they were.
 */
export function DiscardDialog({ target, busy, error, onConfirm, onCancel }: {
  target: DiscardTarget | null; busy: boolean; error?: string;
  onConfirm: (target: DiscardTarget, reason: DiscardReason, note: string) => void | Promise<unknown>; onCancel: () => void;
}) {
  const [reason, setReason] = useState<DiscardReason | null>(null);
  const [note, setNote] = useState('');
  // What was picked for one set is not carried to the next.
  const which = target ? target.ids.join(',') : '';
  useEffect(() => { setReason(null); setNote(''); }, [which]);
  const count = target?.ids.length ?? 0;
  const needsNote = reason === 'otro' && note.trim().length < 3;
  const title = count > 1 ? `No son para nosotros (${count})` : 'No es para nosotros';
  return <Dialog open={target !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{count > 1 ? `Las ${count} pasan` : target?.title ? `«${target.title.length > 90 ? `${target.title.slice(0, 89)}…` : target.title}» pasa` : 'Pasa'} a «Archivadas». La IA tendrá en cuenta el motivo en las próximas búsquedas.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (target && reason && !needsNote && !busy) void onConfirm(target, reason, note.replace(/\s+/g, ' ').trim()); }}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿Por qué?</legend>
          <div role="radiogroup" aria-label="Motivo" className="flex flex-wrap gap-2">
            {DISCARD_REASONS.map(option => <button key={option.id} type="button" role="radio" aria-checked={reason === option.id} onClick={() => setReason(option.id)}
              className={cn(filterChip(reason === option.id), 'h-9')}>{option.label}</button>)}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="discard-note">{reason === 'otro' ? 'Cuéntalo en una línea' : 'Algo más · opcional'}</Label>
          <Input id="discard-note" value={note} onChange={event => setNote(event.target.value)} maxLength={300} required={reason === 'otro'}
            placeholder={reason === 'zona' ? 'Ej.: solo trabajamos en la Región Metropolitana' : 'Ej.: piden una certificación que no tenemos'} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={busy || !reason || needsNote}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{count > 1 ? `Archivar ${count}` : 'Archivar'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
