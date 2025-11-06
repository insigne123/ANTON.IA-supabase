// Abre el correo enviado en el cliente correcto (Outlook o Gmail)
import type { ContactedLead } from './types';
import { openSentMessageWebLink as openOutlookWebLink } from './outlook-email-service';

function openInNewTab(url: string) {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openSentMessageFor(lead: Pick<ContactedLead,
  'provider'|'messageId'|'internetMessageId'|'conversationId'|'threadId'|'email'|'subject'
>) {
  if (lead.provider === 'outlook') {
    // Usa la lógica existente de Outlook (Graph)
    await openOutlookWebLink({
      id: lead.messageId || undefined,
      internetMessageId: lead.internetMessageId || undefined,
      conversationId: lead.conversationId || undefined,
    });
    return;
  }

  // Gmail: construir URL de interfaz web
  // Preferencias: 1) ir al hilo si tenemos threadId; 2) ir al mensaje si tenemos id; 3) búsqueda por asunto+para
  if (lead.threadId) {
    // Muestra el hilo (funciona con #inbox o #all)
    openInNewTab(`https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(lead.threadId)}`);
    return;
  }
  if (lead.messageId) {
    // Abre el mensaje específico
    openInNewTab(`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(lead.messageId)}`);
    return;
  }
  // Fallback: búsqueda (evita depender de IDs)
  const parts = [];
  if (lead.subject) parts.push(`subject:"${lead.subject.replace(/"/g, '\\"')}"`);
  if (lead.email) parts.push(`to:${lead.email}`);
  const q = parts.length ? parts.join(' ') : '';
  openInNewTab(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`);
}
