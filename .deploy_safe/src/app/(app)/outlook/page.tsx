'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function OutlookConnectPage() {
  const { toast } = useToast();
  const [automationConnected, setAutomationConnected] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activatingBrowser, setActivatingBrowser] = useState(false);
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

  const handleConnect = () => {
    const tenant = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common';
    const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback/azure`;
    const scope = 'offline_access User.Read Mail.Send';

    window.location.href = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=${scope}`;
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
            <Button onClick={handleConnect}>
              {automationConnected ? 'Reconectar / Actualizar permisos' : 'Conectar con Outlook'}
            </Button>
            <Button variant="outline" onClick={handleActivateBrowser} disabled={activatingBrowser}>
              {activatingBrowser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Activar sesion en este navegador
            </Button>
          </div>

          <div className="rounded-md border p-3 text-sm leading-relaxed bg-muted/50">
            <p className="font-medium">Que permite esta conexion?</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Envio de correos manuales desde la plataforma.</li>
              <li><strong>Envio automatico</strong> de campanas en segundo plano (24/7).</li>
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
