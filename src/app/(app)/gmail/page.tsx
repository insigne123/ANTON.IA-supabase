'use client';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle } from 'lucide-react';
import { providerConnectionError } from '@/lib/provider-connection-feedback';

export default function GmailConnectPage() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const checkConnection = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/integrations/store-token', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load provider connection status');
      const connections = await response.json();
      setConnected(Boolean(connections?.google));
    } catch {
      setError('No pudimos consultar la conexion. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
    const params = new URLSearchParams(window.location.search);
    if (params.has('error')) setFeedback(providerConnectionError(params.get('error') || ''));
    else if (params.get('connected') === 'true') setFeedback('Cuenta vinculada. Los permisos se verificaron al conectar.');
    if (params.has('error') || params.has('connected')) window.history.replaceState(window.history.state, '', '/gmail');
  }, [checkConnection]);

  const handleConnect = () => {
    window.location.assign('/api/auth/connect/google');
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conexión con Gmail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {feedback ? <p role="status" className="text-sm text-muted-foreground">{feedback}</p> : null}
          <div className="flex items-center gap-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Verificando conexión...</div>
            ) : error ? (
              <div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" onClick={() => void checkConnection()}>Reintentar</Button></div>
            ) : connected ? (
              <div className="flex items-center text-emerald-700 dark:text-emerald-300 font-medium">
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Cuenta vinculada
              </div>
            ) : (
              <div className="flex items-center text-muted-foreground">
                <XCircle className="mr-2 h-5 w-5" />
                No conectado
              </div>
            )}
          </div>

          {connected && !loading && !error ? <p className="text-sm text-muted-foreground">Hay credenciales guardadas. Su vigencia se comprueba al usarlas; reconecta si el proveedor revoco el acceso.</p> : null}

          <div className="flex items-center gap-2">
            <Button onClick={handleConnect}>
              {connected ? 'Reconectar / Actualizar permisos' : 'Conectar con Google'}
            </Button>
          </div>

          <div className="rounded-md border p-3 text-sm leading-relaxed bg-muted/50">
            <p className="font-medium">¿Qué permite esta conexión?</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Envío de correos manuales desde la plataforma.</li>
              <li><strong>Envío automático</strong> de campañas en segundo plano (24/7).</li>
              <li>Lectura de hilos para detectar respuestas cuando sincronizas la bandeja.</li>
              <li>Almacenamiento seguro de credenciales (Refresh Token).</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
