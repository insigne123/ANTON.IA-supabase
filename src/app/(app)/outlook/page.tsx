'use client';
import { useEffect, useState } from 'react';
import { microsoftAuthService, SCOPES, getMsalPublicInfo } from '@/lib/microsoft-auth-service';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Download, ExternalLink } from 'lucide-react';

export default function OutlookConnectPage() {
  const [connected, setConnected] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState('');
  const tenantMode = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'organizations';
  const modeLabel =
    /^[0-9a-f-]{36}$/i.test(tenantMode) ? 'Solo tenant específico'
    : tenantMode === 'common'    ? 'Org + personales'
    : tenantMode === 'consumers' ? 'Solo personales'
    : 'Solo organizacionales';
  
  const [msalInfo, setMsalInfo] = useState(() => getMsalPublicInfo(true));

  useEffect(() => {
    // Chequeo PASIVO: no abre popup, no hace redirect
    (async () => {
      const ok = await microsoftAuthService.isSignedIn().catch(() => false);
      setConnected(ok);
      setStatus(ok ? 'Sesión detectada.' : 'No autenticado.');
    })();
    // Actualizar con el URI del cliente después del montaje
    setMsalInfo(getMsalPublicInfo(false));
  }, []);

  const handleConnect = async () => {
    setStatus('Conectando…');
    try {
      await microsoftAuthService.login();
      setConnected(true);
      setStatus('Conectado correctamente.');
    } catch (e: any) {
      // Si el navegador bloquea popup, haremos redirect; este mensaje es solo informativo
      setStatus(e?.message || 'Redirigiendo a Microsoft…');
    }
  };

  const handleDisconnect = async () => {
    await microsoftAuthService.logout();
    setConnected(false);
    setStatus('Sesión cerrada.');
  };

  const handleEnableTracking = async (checked: boolean) => {
    setTracking(checked);
    if (!checked) return;
    try {
      await microsoftAuthService.getAccessToken(SCOPES.READ);
      setStatus('Tracking habilitado (Mail.Read concedido).');
    } catch {
      setStatus('No se pudo habilitar tracking. Revisa el consentimiento.');
    }
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            Conexión con Outlook (Microsoft 365)
            <span className="ml-2 text-xs rounded bg-muted px-2 py-0.5 align-middle">
              Modo: {modeLabel}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button onClick={handleConnect} disabled={connected}>
              {connected ? 'Conectado' : 'Conectar con Outlook'}
            </Button>
            {connected && (
              <Button variant="secondary" onClick={handleDisconnect}>
                Desconectar
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">{status}</div>

          <div className="rounded-md border p-3 text-sm leading-relaxed">
            <p className="font-medium">Privacidad y permisos</p>
            <ul className="list-disc pl-5 mt-2">
              <li>La app solicita <strong>solo</strong> permisos delegados del usuario actual.</li>
              <li>Por defecto: <code>User.Read</code> (identidad) y, al enviar: <code>Mail.Send</code>.</li>
              <li>Opcional (tracking): <code>Mail.Read</code> para leer <em>tu propio</em> buzón y procesar acuses.</li>
              <li>No se usan permisos de organización (<code>*.Read.All</code>) ni acceso a otros usuarios.</li>
              <li>Los tokens se almacenan en <code>sessionStorage</code> y se renuevan automáticamente.</li>
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="tracking" checked={tracking} onCheckedChange={handleEnableTracking} />
            <Label htmlFor="tracking">Activar seguimiento por acuses (requerirá Mail.Read)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notas para administradores de la organización</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed space-y-2">
          <p>
            Esta aplicación es de un inquilino externo (tercero). En Microsoft Entra, verás mensajes como:
            <em> “SCIM no admitido” </em> y <em> “Cifrado de tokens no disponible; app de otra organización”</em>.
            Es normal para apps SPA de terceros: no se usa aprovisionamiento SCIM ni cifrado de tokens SAML/WS-Fed.
          </p>
          <p>
            Si el tenant tiene deshabilitado el consentimiento de usuario, el admin debe otorgar
            consentimiento para <code>User.Read</code> y <code>Mail.Send</code>.
          </p>
        </CardContent>
      </Card>

      {/* Documentos legales */}
      <Card>
        <CardHeader>
          <CardTitle>Documentos legales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a
                href="/legal/anton-ia-condiciones-privacidad-v1.1.pdf"
                download
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Descargar Condiciones de Uso y Declaración de Privacidad (PDF)"
              >
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF (v1.1)
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a
                href="/legal/anton-ia-condiciones-privacidad-v1.1.pdf"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir Condiciones de Uso y Declaración de Privacidad en el navegador"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Ver en navegador
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Este documento describe el uso de datos en ANTON.IA (permisos delegados, sin <code>offline_access</code>, <code>Mail.Read</code> opcional).
          </p>
        </CardContent>
      </Card>

      {/* Diagnóstico MSAL: ayuda a resolver AADSTS50011 */}
      <Card>
        <CardHeader>
          <CardTitle>Diagnóstico de Conexión (MSAL)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div><span className="font-medium">Client ID:</span> <code>{msalInfo.clientId}</code></div>
          <div><span className="font-medium">Tenant:</span> <code>{msalInfo.tenantId}</code></div>
          <div>
            <span className="font-medium">Redirect URI efectivo:</span>{' '}
            <code className="break-all">{msalInfo.redirectUri}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Asegúrate de que este Redirect URI esté dado de alta en Azure → App registrations → (tu app) → Authentication → <b>Single-page application</b>.
            Debe coincidir <i>carácter por carácter</i>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
