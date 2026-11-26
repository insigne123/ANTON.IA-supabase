import { MAIL_PROVIDER_LABEL, type MailProvider } from '@/lib/mail-sender';

export type MailConnectionsState = {
  google: boolean;
  outlook: boolean;
  updatedAt?: Partial<Record<MailProvider, string | null>>;
  /** The connection is the organization's mailbox, connected once for everyone (shared-mailbox.ts). */
  shared?: Partial<Record<MailProvider, boolean>>;
  approvedCampaigns?: number;
};

/** What a person reads after connecting the organization's mailbox: nobody else has to sign in. */
export const SHARED_MAILBOX_CONNECTED = 'Es la casilla de tu equipo: quedó conectada para todos y nadie más tiene que iniciar sesión.';
/** The same connection, as each member sees it in Conexiones. */
export const SHARED_MAILBOX_NOTE = 'Casilla del equipo: se conectó una vez y la usan todos.';

/** What disconnecting means for this person, said before they confirm (Conexiones). */
export function disconnectWarning(provider: MailProvider, state: MailConnectionsState): string {
  const other: MailProvider = provider === 'google' ? 'outlook' : 'google';
  const parts = [`ANTON.IA dejará de enviar desde ${MAIL_PROVIDER_LABEL[provider]} y de leer sus respuestas.`];
  if (state.shared?.[provider]) parts.push('Es la casilla del equipo: se desconecta solo para ti; el resto la sigue usando.');
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
