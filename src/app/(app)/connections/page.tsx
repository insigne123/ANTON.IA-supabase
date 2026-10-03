import { PageHeader } from '@/components/page-header';
import { ConnectionsPanel } from '@/components/settings/ConnectionsPanel';

export default function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <PageHeader
        title="Conexiones"
        description="Conecta las cuentas de correo que ANTON.IA utiliza para enviar mensajes y sincronizar respuestas."
      />
      <ConnectionsPanel />
    </div>
  );
}
