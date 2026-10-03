'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, Mail, Send } from 'lucide-react';

import { useConfirm } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/dates';
import { disconnectWarning, type MailConnectionsState } from '@/lib/mail-connections';
import { MAIL_PROVIDER_LABEL, type MailProvider } from '@/lib/mail-sender';

type ConnectionsState = MailConnectionsState;

const PROVIDERS: Array<{ provider: MailProvider; icon: typeof Mail; connectHref: string; detailsHref: string; pitch: string }> = [
  { provider: 'google', icon: Mail, connectHref: '/api/auth/connect/google', detailsHref: '/gmail', pitch: 'Envía desde tu Gmail y lee las respuestas aquí.' },
  { provider: 'outlook', icon: Send, connectHref: '/api/auth/connect/azure', detailsHref: '/outlook', pitch: 'Envía desde Microsoft 365 y lee las respuestas aquí.' },
];

/**
 * Conexiones: one row per mailbox with its state and the action that fits it (Conectar, Reconectar, Desconectar).
 * Disconnecting asks first and explains what stops; `onChanged` lets the page refresh what depends on it.
 */
export function MailConnectionsCard({ onChanged }: { onChanged?: () => void }) {
  const confirm = useConfirm();
  const [state, setState] = useState<ConnectionsState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<MailProvider | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/integrations/store-token', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setState(await response.json());
    } catch {
      setError('No pudimos revisar tus cuentas de correo.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disconnect = async (provider: MailProvider) => {
    if (!state || busy) return;
    const confirmed = await confirm({
      title: `¿Desconectar ${MAIL_PROVIDER_LABEL[provider]}?`,
      description: disconnectWarning(provider, state),
      confirmLabel: 'Desconectar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(provider);
    setNotice('');
    try {
      const response = await fetch(`/api/integrations/store-token?provider=${provider}`, { method: 'DELETE', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos desconectar la cuenta. Intenta de nuevo.');
      setNotice(`${MAIL_PROVIDER_LABEL[provider]} quedó desconectado.`);
      await load();
      onChanged?.();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'No pudimos desconectar la cuenta. Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
      <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
        <CardTitle className="text-lg">Correo</CardTitle>
        <CardDescription>Las cuentas desde las que ANTON.IA envía tus correos y lee las respuestas.</CardDescription>
      </CardHeader>
      <CardContent data-tour="connections-list" className="space-y-3 px-5 py-5 sm:px-6">
        {!state && !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Revisando tus cuentas…
          </p>
        )}
        {state && PROVIDERS.map(({ provider, icon: Icon, connectHref, detailsHref, pitch }) => {
          const connected = state[provider];
          const updatedAt = state.updatedAt?.[provider];
          const label = MAIL_PROVIDER_LABEL[provider];
          return (
            <div key={provider} className="flex flex-col gap-3 rounded-2xl border border-border/70 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
                    {label}
                    <Badge variant={connected ? 'success' : 'neutral'}>{connected ? 'Conectado' : 'Sin conectar'}</Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {connected ? (updatedAt ? `Conexión actualizada el ${formatDate(updatedAt)}.` : 'Lista para enviar.') : pitch}{' '}
                    <Link href={detailsHref} className="font-medium text-primary underline-offset-4 hover:underline">Detalles</Link>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {connected ? (
                  <>
                    <Button asChild variant="outline" size="sm"><a href={connectHref}>Reconectar</a></Button>
                    <Button variant="ghost" size="sm" onClick={() => void disconnect(provider)} disabled={busy !== null} aria-label={`Desconectar ${label}`}>
                      {busy === provider && <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
                      Desconectar
                    </Button>
                  </>
                ) : (
                  <Button asChild size="sm"><a href={connectHref}>Conectar {label}</a></Button>
                )}
              </div>
            </div>
          );
        })}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {error && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {error}
            <Button variant="ghost" size="sm" onClick={() => void load()}>Reintentar</Button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
