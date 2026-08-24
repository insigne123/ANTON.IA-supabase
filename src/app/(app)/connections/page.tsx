import { Mail, Send } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { SettingsLinkRow } from '@/components/settings/settings-link-row';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <PageHeader
        title="Conexiones"
        description="Conecta las cuentas de correo que ANTON.IA utiliza para enviar mensajes y sincronizar respuestas."
      />

      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
        <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
          <CardTitle className="text-lg">Correo</CardTitle>
          <CardDescription>Elige un proveedor para revisar su estado o actualizar permisos.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 p-2">
          <SettingsLinkRow
            href="/gmail"
            icon={Mail}
            title="Gmail"
            description="Administra la conexión de Google para envíos y lectura de respuestas."
          />
          <SettingsLinkRow
            href="/outlook"
            icon={Send}
            title="Outlook"
            description="Administra Microsoft 365 para automatización y envíos desde este navegador."
          />
        </CardContent>
      </Card>
    </div>
  );
}
