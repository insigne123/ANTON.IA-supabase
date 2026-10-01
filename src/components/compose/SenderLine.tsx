'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export type SenderState =
  | { state: 'loading' }
  | { state: 'connected'; email: string }
  | { state: 'not_connected' }
  | { state: 'unverified' };

/** «De:» before sending: the real mailbox the email leaves from, or what to do when there is none (H06 of the GrupoExpro
 * walkthrough: «¿esto saldrá con mi correo corporativo?» was answered with «puede diferir del perfil»). */
export function SenderLine({ name, provider, sender }: { name: string; provider: 'gmail' | 'outlook'; sender: SenderState }) {
  const label = provider === 'outlook' ? 'Outlook' : 'Gmail';
  const connectHref = provider === 'outlook' ? '/outlook' : '/gmail';
  if (sender.state === 'not_connected') {
    return (
      <Alert role="alert" className="border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <AlertTitle>{label} no está conectado</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2 text-amber-800 dark:text-amber-100/80 sm:flex-row sm:items-center sm:justify-between">
          <span>Conéctalo para que el correo salga desde tu cuenta y las respuestas vuelvan aquí. Tu borrador queda guardado.</span>
          <Button asChild size="sm" variant="outline" className="shrink-0 border-amber-300 bg-background/80 text-foreground">
            <Link href={connectHref}>Conectar {label}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" data-testid="sender-line">
      <span className="font-medium text-muted-foreground">De:</span>
      {sender.state === 'loading' ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Comprobando tu cuenta de {label}…</span>
      ) : sender.state === 'connected' ? (
        <>
          <span className="font-medium">{name ? `${name} <${sender.email}>` : sender.email}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />por {label}</span>
        </>
      ) : (
        <span className="text-muted-foreground">
          tu cuenta de {label}. No pudimos confirmarla: si el envío falla, <Link className="underline underline-offset-2" href={connectHref}>vuelve a conectarla</Link>.
        </span>
      )}
    </p>
  );
}
