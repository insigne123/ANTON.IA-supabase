'use client';

// Public unsubscribe page (Plan 9, PR-19): says which address the link is for and who sent the email, asks once, and never
// shows a raw server response. Works in light and dark.
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type Preview = { email: string | null; senderName: string | null };

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('t');
  const email = searchParams.get('email');
  const u = searchParams.get('u');
  const o = searchParams.get('o');
  const sig = searchParams.get('sig');
  const hasLegacyParams = Boolean(email && u && sig);
  const hasValidShape = Boolean(token) || hasLegacyParams;

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [preview, setPreview] = useState<Preview>({ email: email || null, senderName: null });
  const [resolvedEmail, setResolvedEmail] = useState(email || '');

  useEffect(() => {
    if (!hasValidShape) return;
    let active = true;
    const params = new URLSearchParams();
    if (token) params.set('t', token);
    else { params.set('email', email || ''); params.set('u', u || ''); if (o) params.set('o', o); params.set('sig', sig || ''); }
    fetch(`/api/tracking/unsubscribe?${params.toString()}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setPreview({ email: typeof data.email === 'string' ? data.email : null, senderName: typeof data.senderName === 'string' ? data.senderName : null });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [email, hasValidShape, o, sig, token, u]);

  const handleUnsubscribe = async () => {
    if (!hasValidShape) return;
    setStatus('loading');
    try {
      const response = await fetch('/api/tracking/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { t: token } : { email, u, o, sig }),
      });
      if (!response.ok) throw new Error('UNSUBSCRIBE_FAILED');
      const data = await response.json().catch(() => ({}));
      setResolvedEmail(typeof data?.email === 'string' ? data.email : preview.email || '');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const shownEmail = preview.email || email;
  const from = preview.senderName ? <> de <strong>{preview.senderName}</strong></> : null;

  if (!hasValidShape) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <XCircle className="h-7 w-7" aria-hidden="true" />
            <CardTitle className="text-foreground">Enlace inválido</CardTitle>
          </div>
          <CardDescription>Este enlace no tiene la información necesaria para procesar la baja.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground/70">
            Si quieres dejar de recibir mensajes, responde al correo que recibiste o escribe al contacto de privacidad indicado en la política del servicio.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'success') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-cw-success">
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            <CardTitle className="text-foreground">Baja confirmada</CardTitle>
          </div>
          <CardDescription>
            {resolvedEmail ? <>No volverás a recibir correos{from} en <strong>{resolvedEmail}</strong>.</> : <>Procesamos tu baja{from}.</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground/70">Si fue un error, escribe directamente a quien te contactó.</p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <XCircle className="h-7 w-7" aria-hidden="true" />
            <CardTitle className="text-foreground">No pudimos procesar la baja</CardTitle>
          </div>
          <CardDescription>El enlace puede estar vencido o incompleto, o hubo un problema temporal.</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-end">
          <Button variant="outline" onClick={() => setStatus('idle')}>Intentar de nuevo</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Confirmar baja</CardTitle>
        <CardDescription>
          {shownEmail
            ? <>¿Quieres dejar de recibir correos{from} en <strong>{shownEmail}</strong>?</>
            : <>¿Quieres dejar de recibir correos{from}?</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>Al confirmar, no te llegarán más correos ni seguimientos de esta cuenta.</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="destructive" onClick={() => void handleUnsubscribe()} disabled={status === 'loading'}>
          {status === 'loading' ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Procesando…</> : 'Sí, darme de baja'}
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function UnsubscribePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <h1 className="sr-only">Gestionar baja de suscripción</h1>
      <Suspense fallback={<p role="status" className="text-sm text-foreground/70">Cargando…</p>}>
        <UnsubscribeContent />
      </Suspense>
    </main>
  );
}
