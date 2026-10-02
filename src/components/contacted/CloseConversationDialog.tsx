'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  CONVERSATION_CLOSE_OPTIONS,
  conversationCloseOption,
  type ConversationCloseOutcome,
  type ConversationTeamLock,
} from '@/lib/conversation-close';

export type ConversationCloseResult = { outcome: ConversationCloseOutcome; team: { status: string | null; changed: boolean }; stage: string | null; stageSaved: boolean };

/** What the page says after closing, in one line. */
export function conversationClosedNotice(name: string, result: ConversationCloseResult): string {
  const option = conversationCloseOption(result.outcome);
  const team = result.team.changed
    ? result.team.status === 'available' ? ' Queda libre para el equipo.'
      : result.team.status === 'suppressed' ? ' Nadie del equipo vuelve a contactarlo.'
        : result.team.status === 'closed' ? ' Nadie del equipo vuelve a prospectarlo.' : ''
    : '';
  const stage = option.stage && !result.stageSaved ? ' No pudimos cambiar la etapa en el pipeline: cámbiala desde ahí.' : '';
  return `Conversación con ${name} cerrada: ${option.label}.${team}${stage}`;
}

/**
 * «Cerrar conversación» (Plan 5, PR-9a): one step, four outcomes, each with what happens to the contact. With
 * collaboration on and an active team thread, the line says what changes for the team.
 */
export function CloseConversationDialog({ open, onOpenChange, contactedId, name, team, observedAt, onClosed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactedId: string;
  name: string;
  team: ConversationTeamLock | null;
  observedAt: string;
  onClosed: (result: ConversationCloseResult) => void;
}) {
  const [outcome, setOutcome] = useState<ConversationCloseOutcome | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setOutcome(''); setError(''); } }, [open]);
  const teamThread = Boolean(team?.enabled && team.status === 'active');

  async function submit() {
    if (!outcome) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/contacted/${encodeURIComponent(contactedId)}/conversation/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, observedAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.error === 'string' && response.status !== 401 && response.status !== 500 ? data.error : 'No pudimos cerrar la conversación. Intenta nuevamente.');
      onClosed(data as ConversationCloseResult);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Cerrar la conversación con {name}</DialogTitle>
        <DialogDescription>¿Cómo terminó? La conversación sale de «Por responder» y el historial se conserva.</DialogDescription>
      </DialogHeader>
      <RadioGroup value={outcome} onValueChange={value => setOutcome(value as ConversationCloseOutcome)} aria-label="Cómo terminó la conversación" className="gap-2">
        {CONVERSATION_CLOSE_OPTIONS.map(option => <label key={option.outcome} htmlFor={`close-${option.outcome}`}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50 ${outcome === option.outcome ? 'border-primary bg-primary/5' : ''}`}>
          <RadioGroupItem id={`close-${option.outcome}`} value={option.outcome} className="mt-0.5" disabled={saving} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-sm text-muted-foreground">{teamThread ? option.team : option.solo}</span>
          </span>
        </label>)}
      </RadioGroup>
      {teamThread && team && !team.mine && <p className="text-sm text-muted-foreground">Este contacto lo lleva otra persona del equipo: solo ella o un administrador pueden cerrarlo.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Volver</Button>
        <Button disabled={!outcome || saving} onClick={() => void submit()}>{saving ? 'Cerrando…' : 'Cerrar conversación'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
