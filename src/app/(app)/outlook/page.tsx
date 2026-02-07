'use client';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function OutlookConnectPage() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  const checkConnection = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('provider_tokens')
        .select('*')
        .eq('user_id', user.id)
        .eq('provider', 'outlook')
        .maybeSingle();

      setConnected(!!data);
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

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conexión con Outlook (Microsoft 365)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Verificando conexión...</div>
            ) : connected ? (
              <div className="flex items-center text-green-600 font-medium">
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Conectado y listo para automatización
              </div>
            ) : (
              <div className="flex items-center text-muted-foreground">
                <XCircle className="mr-2 h-5 w-5" />
                No conectado
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleConnect}>
              {connected ? 'Reconectar / Actualizar permisos' : 'Conectar con Outlook'}
            </Button>
          </div>

          <div className="rounded-md border p-3 text-sm leading-relaxed bg-muted/50">
            <p className="font-medium">¿Qué permite esta conexión?</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Envío de correos manuales desde la plataforma.</li>
              <li><strong>Envío automático</strong> de campañas en segundo plano (24/7).</li>
              <li>Almacenamiento seguro de credenciales (Refresh Token).</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
