'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CALL_OUTCOMES, outcomeLabel, shouldAskOutcome, type CallChannel, type CallOutcome, type PendingCall } from '@/lib/contact-calls';
import { CALL_STARTED_EVENT, clearPendingCall, readPendingCall, saveCallOutcome } from '@/lib/contact-calls-client';
import { cn } from '@/lib/utils';

/** The five results as one tap each; the first two are what the work is for. */
export function CallOutcomeChoices({
  channel,
  busy,
  onChoose,
  compact = false,
}: {
  channel: CallChannel;
  busy: CallOutcome | null;
  onChoose: (outcome: CallOutcome) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-2 sm:flex sm:flex-wrap' : 'grid-cols-1 sm:grid-cols-2')} role="group" aria-label="¿Cómo te fue?">
      {CALL_OUTCOMES.map(({ key }) => (
        <Button
          key={key}
          type="button"
          size={compact ? 'sm' : 'default'}
          variant={key === 'meeting' || key === 'answered' ? 'default' : 'outline'}
          disabled={busy !== null}
          onClick={() => onChoose(key)}
          className={cn('justify-center', compact && 'h-8 rounded-full px-3 text-xs')}
        >
          {busy === key ? <Loader2 className="mr-1.5 h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : null}
          {outcomeLabel(key, channel)}
        </Button>
      ))}
    </div>
  );
}

const channelWord = (channel: CallChannel) => (channel === 'whatsapp' ? 'WhatsApp' : 'Llamada');

/**
 * Asks how the last call or WhatsApp went when the person comes back to ANTON.IA. «Más tarde» leaves it for «Hoy», which
 * lists the calls still without a result.
 */
export function CallOutcomePrompt() {
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingCall | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<CallOutcome | null>(null);
  const [error, setError] = useState('');
  const awaySince = useRef<number | null>(null);

  const check = useCallback(() => {
    const current = readPendingCall();
    setPending(current);
    if (current && shouldAskOutcome(current, new Date(), awaySince.current)) {
      setNote('');
      setError('');
      setOpen(true);
    }
    awaySince.current = null;
  }, []);

  useEffect(() => {
    check();
    const away = () => { if (awaySince.current === null) awaySince.current = Date.now(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') away(); else check(); };
    const onStarted = () => { awaySince.current = null; setOpen(false); setPending(readPendingCall()); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', away);
    window.addEventListener('focus', check);
    window.addEventListener(CALL_STARTED_EVENT, onStarted);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', check);
      window.removeEventListener(CALL_STARTED_EVENT, onStarted);
    };
  }, [check]);

  const later = () => {
    if (pending) clearPendingCall(pending.id);
    setOpen(false);
    toast({ title: 'Queda en «Hoy»', description: 'Anota el resultado cuando puedas: así cuenta para tu meta de la semana.' });
  };

  const choose = async (outcome: CallOutcome) => {
    if (!pending) return;
    setBusy(outcome);
    setError('');
    const result = await saveCallOutcome({
      id: pending.id,
      channel: pending.channel,
      leadId: pending.contact?.leadId || null,
      contact: { name: pending.name, company: pending.company, leadId: pending.contact?.leadId, providerPersonId: pending.contact?.providerPersonId, email: pending.contact?.email },
    }, outcome, note);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    setPending(null);
    toast({
      title: `${outcomeLabel(outcome, pending.channel)}: guardado`,
      description: result.pipeline ? 'Quedó en el Pipeline con la reunión sugerida.' : 'Cuenta para tu meta de la semana.',
    });
  };

  if (!pending) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) later(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Cómo te fue con {pending.name || 'este contacto'}?</DialogTitle>
          <DialogDescription>
            {[channelWord(pending.channel), pending.company].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>
        <CallOutcomeChoices channel={pending.channel} busy={busy} onChoose={(outcome) => void choose(outcome)} />
        <div className="space-y-1.5">
          <label htmlFor="call-outcome-note" className="text-xs font-medium text-foreground/70">Nota (opcional)</label>
          <Textarea
            id="call-outcome-note"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Por ejemplo: llamar el martes, pidió propuesta"
          />
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={later} disabled={busy !== null}>Más tarde</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
