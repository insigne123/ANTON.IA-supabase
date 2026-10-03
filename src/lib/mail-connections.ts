import { MAIL_PROVIDER_LABEL, type MailProvider } from '@/lib/mail-sender';

export type MailConnectionsState = {
  google: boolean;
  outlook: boolean;
  updatedAt?: Partial<Record<MailProvider, string | null>>;
  approvedCampaigns?: number;
};

/** What disconnecting means for this person, said before they confirm (Conexiones). */
export function disconnectWarning(provider: MailProvider, state: MailConnectionsState): string {
  const other: MailProvider = provider === 'google' ? 'outlook' : 'google';
  const parts = [`ANTON.IA dejará de enviar desde ${MAIL_PROVIDER_LABEL[provider]} y de leer sus respuestas.`];
  if (state[other]) {
    parts.push(`${MAIL_PROVIDER_LABEL[other]} sigue conectado y envía desde ahora.`);
  } else {
    const campaigns = state.approvedCampaigns || 0;
    parts.push(campaigns > 0
      ? `No te queda otra cuenta: los envíos pendientes de ${campaigns === 1 ? 'tu campaña aprobada' : `tus ${campaigns} campañas aprobadas`} esperarán hasta que conectes una.`
      : 'No te queda otra cuenta: para volver a enviar tendrás que conectar una.');
  }
  return parts.join(' ');
}
