'use client';

import { useEffect, useState } from 'react';
import { Ban, FileText, ShieldAlert, UserRoundCheck } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { SettingsLinkRow } from '@/components/settings/settings-link-row';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PrivacySettingsPage() {
  // The server answers with PRIVACY_ADMIN_EMAILS, the same list the requests and incidents pages and APIs check.
  const [canAccessPrivacyAdmin, setCanAccessPrivacyAdmin] = useState(false);
  // A failed check hides the admin rows like a «no»; the page says it could not tell, so an admin does not think they lost access.
  const [accessUnknown, setAccessUnknown] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/privacy/access', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (response.status >= 500) throw new Error(`privacy access ${response.status}`);
        return response.ok ? response.json() : null;
      })
      .then((data) => { if (!controller.signal.aborted) setCanAccessPrivacyAdmin(data?.admin === true); })
      .catch(() => { if (!controller.signal.aborted) setAccessUnknown(true); });
    return () => controller.abort();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <PageHeader
        title="Privacidad"
        description="Gestiona bajas, solicitudes y controles de cumplimiento desde un solo lugar."
      />

      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
        <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
          <CardTitle>Controles de privacidad</CardTitle>
          <CardDescription>Accede solo al control que necesitas revisar.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 p-2">
          <SettingsLinkRow
            href="/settings/unsubscribes"
            icon={Ban}
            title="Bajas y exclusiones"
            description="Administra correos y dominios que no deben volver a ser contactados."
          />
          {canAccessPrivacyAdmin ? (
            <>
              <SettingsLinkRow
                href="/settings/privacy-requests"
                icon={UserRoundCheck}
                title="Solicitudes de privacidad"
                description="Revisa y gestiona solicitudes de acceso, rectificación o eliminación."
              />
              <SettingsLinkRow
                href="/settings/privacy-incidents"
                icon={ShieldAlert}
                title="Incidentes de privacidad"
                description="Registra y da seguimiento a incidentes que requieren atención."
              />
            </>
          ) : null}
          {accessUnknown ? (
            <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
              No pudimos comprobar si puedes ver las solicitudes y los incidentes de privacidad. Recarga la página para intentarlo de nuevo.
            </p>
          ) : null}
          <SettingsLinkRow
            href="/privacy"
            icon={FileText}
            title="Política de privacidad"
            description="Consulta la política pública y los canales disponibles para ejercer derechos."
          />
        </CardContent>
      </Card>
    </div>
  );
}
