'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { microsoftAuthService } from '@/lib/microsoft-auth-service';
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
  const [connecting, setConnecting] = useState(false);
  const supabase = createClientComponentClient();

  const checkConnection = useCallback(async () => {
    try {
      const signedInBrowser = await microsoftAuthService.isSignedIn().catch(() => false);
      setBrowserReady(signedInBrowser);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('provider_tokens')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('provider', 'outlook')
        .maybeSingle();

      setAutomationConnected(!!data);
    } catch (error) {
      console.error('Error checking connection:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    const details = searchParams.get('details');

    if (!connected && !error) return;

    if (connected === 'true') {
      toast({
        title: 'Outlook conectado',
        description: 'La automatizacion ya puede usar tu cuenta. Si vas a enviar desde este navegador, activa tambien la sesion local.',
      });
      void checkConnection();
    }

    if (error) {
      toast({
        variant: 'destructive',
        title: 'No se pudo conectar Outlook',
        description: details || error,
      });
    }

    router.replace('/outlook');
  }, [checkConnection, router, searchParams, toast]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          variant: 'destructive',
          title: 'Sesion expirada',
          description: 'Vuelve a iniciar sesion en ANTON.IA antes de conectar Outlook.',
        });
        return;
      }

      const tenant = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common';
      const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID?.trim();
      if (!clientId) {
        toast({
          variant: 'destructive',
          title: 'Configuracion incompleta',
          description: 'Falta NEXT_PUBLIC_AZURE_AD_CLIENT_ID.',
        });
        return;
      }

      const redirectUri = `${window.location.origin}/api/auth/callback/azure`;
      const authUrl = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: 'offline_access User.Read Mail.Send Mail.Read',
      }).toString();

      window.location.assign(authUrl.toString());
    } finally {
      setConnecting(false);
    }
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
            ) : (
              <>
                <div className={`flex items-center font-medium ${automationConnected ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {automationConnected ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <XCircle className="mr-2 h-5 w-5" />}
                  {automationConnected ? 'Automatizacion conectada' : 'Automatizacion no conectada'}
                </div>
                <div className={`flex items-center font-medium ${browserReady ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {browserReady ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <XCircle className="mr-2 h-5 w-5" />}
                  {browserReady ? 'Este navegador esta listo para envios manuales' : 'Este navegador puede pedir inicio de sesion al enviar manualmente'}
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {automationConnected ? 'Reconectar / Actualizar permisos' : 'Conectar con Outlook'}
            </Button>
            <Button variant="outline" onClick={handleActivateBrowser} disabled={activatingBrowser || connecting}>
              {activatingBrowser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Activar sesion en este navegador
            </Button>
          </div>

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
