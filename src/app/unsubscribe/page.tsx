'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

function UnsubscribeContent() {
    const searchParams = useSearchParams();
    const email = searchParams.get('email');
    const u = searchParams.get('u');
    const o = searchParams.get('o');
    const sig = searchParams.get('sig');

    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [msg, setMsg] = useState('');

    const handleUnsubscribe = async () => {
        if (!email || !u || !sig) return;
        setStatus('loading');
        try {
            const res = await fetch('/api/tracking/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, u, o, sig })
            });

            if (!res.ok) {
                const err = await res.text();
                throw new Error(err || 'Error al procesar la solicitud.');
            }

            setStatus('success');
        } catch (e: any) {
            setStatus('error');
            setMsg(e.message);
        }
    };

    if (status === 'success') {
        return (
            <Card className="w-full max-w-md border-green-200">
                <CardHeader>
                    <div className="flex items-center gap-2 text-green-600 mb-2">
                        <CheckCircle2 className="h-8 w-8" />
                        <CardTitle>Suscripción Cancelada</CardTitle>
                    </div>
                    <CardDescription>
                        La dirección <strong>{email}</strong> ha sido eliminada correctamente de nuestra lista de envíos.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Lamentamos verte partir. Si esto fue un error, por favor contacta al remitente directamente.
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (status === 'error') {
        return (
            <Card className="w-full max-w-md border-red-200">
                <CardHeader>
                    <div className="flex items-center gap-2 text-red-600 mb-2">
                        <XCircle className="h-8 w-8" />
                        <CardTitle>Error</CardTitle>
                    </div>
                    <CardDescription>
                        No se pudo procesar la solicitud.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        {msg || 'El enlace podría estar expirado o ser inválido.'}
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle>Confirmar baja de suscripción</CardTitle>
                <CardDescription>
                    ¿Estás seguro de que deseas dejar de recibir correos en <strong>{email}</strong>?
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-md text-amber-800 text-sm">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <p>
                        Al confirmar, bloquearemos el envío de nuevos o correos de seguimiento a tu dirección desde esta cuenta.
                    </p>
                </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
                <Button
                    variant="destructive"
                    onClick={handleUnsubscribe}
                    disabled={status === 'loading'}
                >
                    {status === 'loading' ? 'Procesando...' : 'Sí, darme de baja'}
                </Button>
            </CardFooter>
        </Card>
    );
}

export default function UnsubscribePage() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <Suspense fallback={<div>Cargando...</div>}>
                <UnsubscribeContent />
            </Suspense>
        </div>
    );
}
