'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { providerConnectionError } from '@/lib/provider-connection-feedback';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

function OutlookConnectPageInner() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [automationConnected, setAutomationConnected] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activatingBrowser, setActivatingBrowser] = useState(false);
  const [statusError, setStatusError] = useState('');

  const checkConnection = useCallback(async () => {
    setLoading(true);
    setStatusError('');
    try {
      const signedInBrowser = await microsoftAuthService.isSignedIn().catch(() => false);
      setBrowserReady(signedInBrowser);

      const response = await fetch('/api/integrations/store-token', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load provider connection status');
      const connections = await response.json();
      setAutomationConnected(Boolean(connections?.outlook));
    } catch {
      setStatusError('No pudimos consultar la conexion. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (!connected && !error) return;

    if (connected === 'true') {
      toast({
        title: 'Outlook conectado',
        description: 'Cuenta vinculada. Los permisos se verificaron al conectar.',
      });
      void checkConnection();
    }

    if (error) {
      toast({
        variant: 'destructive',
        title: 'No se pudo conectar Outlook',
        description: providerConnectionError(error),
      });
    }

    router.replace('/outlook');
  }, [checkConnection, router, searchParams, toast]);

  const handleConnect = () => {
    window.location.assign('/api/auth/connect/azure');
  };

  const handleActivateBrowser = async () => {
    setActivatingBrowser(true);
    try {
      await microsoftAuthService.getSendToken();
      setBrowserReady(true);
      toast({
        title: 'Sesion del navegador lista',
        description: 'Este navegador ya puede usar Outlook para envios manuales con menos friccion.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo activar la sesion',
        description: error?.message || 'Microsoft solicito validacion adicional.',
      });
    } finally {
      setActivatingBrowser(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conexion con Outlook (Microsoft 365)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {loading ? (
              <div className="text-sm text-muted-foreground">Verificando conexion...</div>
            ) : statusError ? (
              <div role="alert" className="text-sm text-destructive">{statusError}<Button variant="ghost" onClick={() => void checkConnection()}>Reintentar</Button></div>
            ) : (
              <>
                <div className={`flex items-center font-medium ${automationConnected ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                  {automationConnected ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <XCircle className="mr-2 h-5 w-5" />}
                  {automationConnected ? 'Cuenta vinculada para automatizacion' : 'Automatizacion no conectada'}
                </div>
                <div className={`flex items-center font-medium ${browserReady ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                  {browserReady ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <XCircle className="mr-2 h-5 w-5" />}
                  {browserReady ? 'Hay una sesion de Microsoft en este navegador' : 'Este navegador puede pedir inicio de sesion al enviar manualmente'}
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleConnect}>
              {automationConnected ? 'Reconectar / Actualizar permisos' : 'Conectar con Outlook'}
            </Button>
            <Button variant="outline" onClick={handleActivateBrowser} disabled={activatingBrowser}>
              {activatingBrowser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Activar sesion en este navegador
            </Button>
          </div>

          {automationConnected && !loading && !statusError ? <p className="text-sm text-muted-foreground">Hay credenciales guardadas. Su vigencia se comprueba al usarlas; reconecta si el proveedor revoco el acceso.</p> : null}

          <div className="rounded-md border p-3 text-sm leading-relaxed bg-muted/50">
            <p className="font-medium">Que permite esta conexion?</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Envio de correos manuales desde la plataforma.</li>
              <li><strong>Envio automatico</strong> de campanas en segundo plano (24/7).</li>
              <li>Lectura de hilos para detectar respuestas y acuses cuando sincronizas la bandeja.</li>
              <li>Almacenamiento seguro de credenciales (Refresh Token).</li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              La automatizacion y el envio manual usan mecanismos distintos. Si la automatizacion esta conectada pero este navegador no,
              Outlook puede pedir login o consentimiento al momento de enviar manualmente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OutlookConnectPage() {
  return (
    <Suspense fallback={<div className="container mx-auto max-w-3xl text-sm text-muted-foreground">Verificando conexion...</div>}>
      <OutlookConnectPageInner />
    </Suspense>
  );
}
