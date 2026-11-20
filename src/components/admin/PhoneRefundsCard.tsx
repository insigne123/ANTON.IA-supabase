'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { creditsLabel } from '@/lib/credit-prices';
import { phoneRefundLabel, phoneRefundReportText, phoneRefundSummary, showPhone, type PhoneRefundClaim } from '@/lib/phone-refunds';

type State = { enabled: boolean; claims: PhoneRefundClaim[]; canReview: boolean; phoneCredits: number };
const day = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' });

/**
 * «Teléfonos que no existen» (src/lib/phone-refunds.ts): the administrator sends the numbers, the ANTON.IA team tries them and
 * the confirmed ones give their credits back. Drawn only for an organization whose agreement includes it, or that has a list.
 */
export function PhoneRefundsCard() {
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dashboard/admin/phone-refunds', { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(body => { if (!controller.signal.aborted && body) setState(body); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const send = useCallback(async (key: string, payload: Record<string, unknown>) => {
    setBusy(key); setMessage(null);
    try {
      const response = await fetch('/api/dashboard/admin/phone-refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setMessage({ text: body?.error || 'No pudimos completar la solicitud. Intenta nuevamente.', error: true }); return; }
      setState(current => (current ? { ...current, claims: body.claims ?? current.claims } : current));
      if (body.report) {
        setMessage({ text: phoneRefundReportText(body.report), error: false });
        if (body.report.added && !body.report.unknown.length && !body.report.invalid.length) setText('');
      }
    } catch { setMessage({ text: 'No pudimos conectar. Revisa tu conexión e intenta nuevamente.', error: true }); }
    finally { setBusy(null); }
  }, []);

  if (!state || (!state.enabled && !state.claims.length)) return null;
  const summary = phoneRefundSummary(state.claims);

  return (
    <Card className="border-border/60" role="region" aria-labelledby="phone-refunds-title">
      <CardHeader className="pb-3">
        <CardTitle className="text-base"><h2 id="phone-refunds-title">Teléfonos que no existen</h2></CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Si un teléfono que te entregamos no existe, envíanoslo. Lo probamos en un plazo de 5 días hábiles y, si se confirma, te devolvemos {state.phoneCredits === 1 ? 'su crédito' : `sus ${creditsLabel(state.phoneCredits)}`}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.enabled && (
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (text.trim()) void send('report', { action: 'report', phones: text }); }}>
            <Label htmlFor="phone-refunds-list">Teléfonos, uno por línea</Label>
            <Textarea id="phone-refunds-list" rows={3} inputMode="tel" placeholder={'+56 9 1234 5678\n+56 2 2345 6789'} value={text}
              onChange={event => setText(event.target.value)} maxLength={6000} disabled={busy === 'report'} />
            <Button type="submit" size="sm" disabled={!text.trim() || busy === 'report'}>{busy === 'report' ? 'Enviando…' : 'Enviar teléfonos'}</Button>
          </form>
        )}
        {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm leading-6 text-destructive' : 'text-sm leading-6'}>{message.text}</p>}
        {state.claims.length ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{summary}</p>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
              {state.claims.map(claim => (
                <li key={claim.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">{showPhone(claim.phone)}</p>
                    <p className="truncate text-xs text-muted-foreground">{[claim.contactName, `Enviado el ${day(claim.reportedAt)}`, claim.reviewNote].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {state.canReview && claim.status === 'reported' ? (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void send(claim.id, { action: 'review', id: claim.id, decision: 'confirmed' })}>No existe: devolver</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void send(claim.id, { action: 'review', id: claim.id, decision: 'rejected' })}>Sí existe</Button>
                      </>
                    ) : (
                      <Badge variant={claim.status === 'confirmed' ? 'default' : 'secondary'}>
                        {phoneRefundLabel(claim.status)}{claim.status === 'confirmed' ? ` · ${creditsLabel(claim.credits)}` : ''}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aún no has enviado teléfonos.</p>
        )}
      </CardContent>
    </Card>
  );
}
