'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The workspace's Mercado Público ticket, in «Tu empresa»: connected once by an admin, checked before it is
 * saved. It sits inside the company form, so Enter here connects the ticket instead of sending the form.
 */
export function OpportunityTicketConnection() {
  const [ticket, setTicket] = useState(''); const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null); const [connected, setConnected] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/commercial-opportunities/ticket', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) return; const body = await response.json();
      if (!controller.signal.aborted) setConnected(Boolean(body.ticket?.connected || body.ticket?.shared));
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const connect = async () => {
    if (!ticket.trim() || busy) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch('/api/commercial-opportunities/ticket', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
      const body = await response.json(); if (!response.ok) throw Error(body.error);
      setTicket(''); setConnected(true); setFeedback({ ok: true, text: 'Ticket comprobado y conectado.' });
    } catch (e) { setFeedback({ ok: false, text: e instanceof Error ? e.message : 'No se pudo conectar.' }); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Mercado Público</h3>
            {connected ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Conectado</span> : null}
          </div>
          <p className="text-sm text-muted-foreground">{connected ? 'La búsqueda de tu organización ya usa un ticket. Pega otro solo si quieres cambiarlo.' : 'Conecta tu ticket una vez para consultar licitaciones y Compra Ágil.'}</p>
        </div>
      </div>
      <div className="space-y-2 rounded-2xl border bg-muted/30 p-4 sm:p-5">
        <Label htmlFor="op-ticket-value">Ticket de Mercado Público</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="op-ticket-value" type="password" autoComplete="off" className="bg-background" value={ticket} onChange={event => setTicket(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } }} placeholder={connected ? 'Pegar un ticket nuevo' : 'Pegar ticket'} />
          <Button type="button" variant="outline" className="shrink-0" disabled={busy || !ticket.trim()} onClick={() => void connect()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Comprobar y conectar</Button>
        </div>
        {feedback ? <p role={feedback.ok ? 'status' : 'alert'} className={feedback.ok ? 'text-sm text-emerald-700 dark:text-emerald-300' : 'text-sm text-destructive'}>{feedback.text}</p> : null}
      </div>
    </section>
  );
}
