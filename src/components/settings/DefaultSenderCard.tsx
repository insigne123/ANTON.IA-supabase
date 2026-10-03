'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Mail, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MAIL_PROVIDER_LABEL, type MailProvider } from '@/lib/mail-sender';
import { cn } from '@/lib/utils';

type SenderState = { connected: Record<MailProvider, boolean>; preferred: MailProvider | null; resolved: MailProvider | null };

const OPTIONS: Array<{ provider: MailProvider; icon: typeof Mail }> = [
  { provider: 'google', icon: Mail },
  { provider: 'outlook', icon: Send },
];

/** What the card says under the options: who sends now, or what is missing to send. */
function senderStatus(state: SenderState): string {
  const connected = OPTIONS.filter(option => state.connected[option.provider]).map(option => option.provider);
  if (!connected.length) return 'Conecta Gmail u Outlook para enviar correos desde ANTON.IA.';
  if (!state.resolved) return 'Tienes dos cuentas conectadas: elige cuál envía para que nadie te lo pregunte.';
  if (!state.preferred) return `Se usa ${MAIL_PROVIDER_LABEL[state.resolved]}, tu única cuenta conectada.`;
  return `Cowork y tus campañas envían desde ${MAIL_PROVIDER_LABEL[state.resolved]}.`;
}

/** Conexiones: the mailbox that sends by default (Plan 5, PR-6b). Cowork and the campaigns use it instead of asking. */
export function DefaultSenderCard() {
  const [state, setState] = useState<SenderState | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<MailProvider | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/integrations/default-sender', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo leer tu remitente.');
    return data as SenderState;
  }, []);

  useEffect(() => {
    let disposed = false;
    load().then(data => { if (!disposed) setState(data); })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo leer tu remitente.'); });
    return () => { disposed = true; };
  }, [load]);

  async function choose(provider: MailProvider) {
    if (saving || state?.preferred === provider) return;
    setSaving(provider); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/integrations/default-sender', {
        method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar tu remitente. Inténtalo de nuevo.');
      setState(data as SenderState);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar tu remitente. Inténtalo de nuevo.');
    } finally { setSaving(null); }
  }

  return (
    <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
      <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
        <CardTitle className="text-lg">Remitente predeterminado</CardTitle>
        <CardDescription>Cowork y tus campañas envían desde esta cuenta, sin preguntarte cada vez.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 py-5 sm:px-6">
        {!state && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Revisando tus cuentas…
        </p>}
        {state && <RadioGroup value={state.preferred ?? (state.resolved ?? '')} onValueChange={value => void choose(value as MailProvider)}
          aria-label="Cuenta que envía por defecto" className="gap-3 sm:grid-cols-2">
          {OPTIONS.map(({ provider, icon: Icon }) => {
            const connected = state.connected[provider];
            const id = `default-sender-${provider}`;
            return <Label key={provider} htmlFor={id}
              className={cn('flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 px-4 py-3 transition-colors',
                connected ? 'cursor-pointer hover:bg-muted/60' : 'cursor-not-allowed bg-muted/40',
                (state.preferred ?? state.resolved) === provider && 'border-primary/60 bg-primary/5')}>
              <RadioGroupItem id={id} value={provider} disabled={!connected || saving !== null} />
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-tight text-foreground">{MAIL_PROVIDER_LABEL[provider]}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {saving === provider ? 'Guardando…' : connected ? 'Conectada' : 'No conectada: conéctala en «Correo» para elegirla'}
                </span>
              </span>
            </Label>;
          })}
        </RadioGroup>}
        {state && <p role="status" className="text-sm text-muted-foreground">{saved && state.resolved
          ? `Listo: Cowork y tus campañas enviarán desde ${MAIL_PROVIDER_LABEL[state.resolved]}.` : senderStatus(state)}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
