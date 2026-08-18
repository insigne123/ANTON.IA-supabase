// Cliente robusto para Microsoft Graph (Outlook)
import { microsoftAuthService } from './microsoft-auth-service';
import { emailSignatureStorage } from './email-signature-storage';
import { applySignatureHTML } from './signature-apply';

// --- Types ---
export type SendEmailInput = {
  to: string;
  subject: string;
  htmlBody: string;
  cc?: string[];
  bcc?: string[];
  requestReceipts?: boolean;
  attachments?: Array<{ name: string; contentBytes: string; contentType?: string }>;
  leadId?: string;
  researchSnapshotId?: string | null;
  idempotencyKey: string;
  trackingId?: string;
  tracking?: {
    pixel?: boolean;
    linkTracking?: boolean;
  };
};

export type SendEmailResult = {
  messageId: string;
  internetMessageId?: string;
  conversationId?: string;
};

type GraphMessage = {
  id: string;
  subject?: string;
  webLink?: string;
  conversationId?: string;
  internetMessageId?: string;
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  sentDateTime?: string;
};

// --- Helpers ---
function escapeODataLiteral(s: string) {
  return s.replace(/'/g, "''");
}

async function graphFetch(input: string, init?: RequestInit, needRead = false) {
  const token = needRead
    ? await microsoftAuthService.getReadToken()
    : await microsoftAuthService.getSendToken();

  const res = await fetch(`https://graph.microsoft.com/v1.0${input}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  return res;
}

// --- Public API ---

/** Envía un correo intentando crear borrador; si falta Mail.ReadWrite, cae a /me/sendMail. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const sig = await emailSignatureStorage.get('outlook');
  const finalHtml = applySignatureHTML(input.htmlBody, sig?.html);
  if (input.attachments?.length) {
    throw new Error('Los adjuntos todavia no estan disponibles en el envio idempotente de Outlook.');
  }
  if (input.cc?.length || input.bcc?.length) {
    throw new Error('CC y BCC todavia no estan disponibles en el envio idempotente de Outlook.');
  }
  const res = await fetch('/api/providers/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'outlook',
      to: input.to,
      subject: input.subject,
      htmlBody: finalHtml,
      leadId: input.leadId,
      researchSnapshotId: input.researchSnapshotId,
      idempotencyKey: input.idempotencyKey,
      trackingId: input.trackingId,
      tracking: input.tracking,
      requestReceipts: Boolean(input.requestReceipts),
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.error || payload?.graph?.error?.message || `Outlook send failed (${res.status})`);
  }

  const providerResponse = payload?.receipt?.providerResponse || {};
  return {
    messageId: payload?.receipt?.providerMessageId || providerResponse?.messageId || providerResponse?.id,
    internetMessageId: providerResponse?.internetMessageId,
    conversationId: providerResponse?.conversationId,
  };
}

/** Devuelve el mensaje por ID de Graph, o null si no existe. */
export async function getMessageById(id: string): Promise<GraphMessage | null> {
  const q = `/me/messages/${encodeURIComponent(id)}?$select=id,subject,webLink,conversationId,internetMessageId`;
  const res = await graphFetch(q, undefined, /*needRead*/ true);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`graph error ${res.status}: ${await res.text()}`);
  return (await res.json()) as GraphMessage;
}

/** Busca por internetMessageId (ej. "<SG2P...@namprdxx.prod.outlook.com>") */
export async function findMessageByInternetId(internetMessageId: string): Promise<GraphMessage | null> {
  if (!internetMessageId) return null;
  const filter = `$filter=internetMessageId eq '${escapeODataLiteral(internetMessageId)}'`;
  const select = '$select=id,subject,webLink,conversationId,internetMessageId';
  const top = '$top=1';
  const url = `/me/messages?${encodeURI(filter)}&${top}&${select}`;
  const res = await graphFetch(url, { headers: { ConsistencyLevel: 'eventual' } }, /*needRead*/ true);
  if (!res.ok) throw new Error(`graph search error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = Array.isArray(data?.value) && data.value.length ? (data.value[0] as GraphMessage) : null;
  return msg;
}

/** Fallback: toma el último mensaje de una conversación */
export async function getLastMessageByConversation(conversationId: string): Promise<GraphMessage | null> {
  if (!conversationId) return null;
  const filter = `$filter=conversationId eq '${escapeODataLiteral(conversationId)}'`;
  const order = '$orderby=receivedDateTime desc';
  const top = '$top=1';
  const select = '$select=id,subject,webLink,conversationId,internetMessageId';
  const url = `/me/messages?${encodeURI(filter)}&${order}&${top}&${select}`;
  const res = await graphFetch(url, { headers: { ConsistencyLevel: 'eventual' } }, /*needRead*/ true);
  if (!res.ok) throw new Error(`graph conv error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = Array.isArray(data?.value) && data.value.length ? (data.value[0] as GraphMessage) : null;
  return msg;
}

/**
 * Encuentra el mensaje usando las pistas que guardamos (id/internetMessageId/conversationId)
 * y abre su webLink en una nueva pestaña. Lanza error con texto amigable si faltan permisos.
 */
export async function openSentMessageWebLink(opts: {
  id?: string | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}) {
  try {
    if (opts.id && !String(opts.id).startsWith('sentmail:')) {
      const byId = await getMessageById(opts.id);
      if (byId?.webLink) {
        window.open(byId.webLink, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    if (opts.internetMessageId) {
      const byIid = await findMessageByInternetId(opts.internetMessageId);
      if (byIid?.webLink) {
        window.open(byIid.webLink, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    if (opts.conversationId) {
      const byConv = await getLastMessageByConversation(opts.conversationId);
      if (byConv?.webLink) {
        window.open(byConv.webLink, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    throw new Error('No se pudo localizar el mensaje. Verifica que Mail.Read esté concedido.');
  } catch (e: any) {
    throw new Error(
      e?.errorMessage?.includes('consent_required') || e?.message?.includes('consent_required')
        ? 'Se requiere Mail.Read para ver el email. Actívalo en “Conexión con Outlook”.'
        : e?.message || 'No se pudo abrir el email.'
    );
  }
}
