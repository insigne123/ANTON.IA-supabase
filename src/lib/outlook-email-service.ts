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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toISO(dt: Date) {
  // Sin milisegundos
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
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

/**
 * Busca en "Sent Items" el mensaje más reciente que cuadre con asunto y destinatario.
 * Requiere Mail.Read.
 */
async function findRecentlySentByToAndSubject(params: {
  to: string;
  subject: string;
  lookbackMinutes?: number;
}): Promise<GraphMessage | null> {
  const { to, subject, lookbackMinutes = 10 } = params;
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const select = '$select=id,subject,webLink,conversationId,internetMessageId,toRecipients,sentDateTime';
  const order = '$orderby=sentDateTime desc';
  const top = '$top=25';
  const filter = `$filter=sentDateTime ge ${escapeODataLiteral(toISO(since))}`;

  // Trae los últimos enviados en la ventana y filtra en cliente por exactitud
  const url = `/me/mailFolders('SentItems')/messages?${filter}&${order}&${top}&${select}`;

  const res = await graphFetch(
    url,
    { headers: { ConsistencyLevel: 'eventual' } },
    /* needRead */ true
  );
  if (!res.ok) {
    throw new Error(`graph search error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const list: GraphMessage[] = Array.isArray(data?.value) ? data.value : [];

  const wantedTo = to.trim().toLowerCase();
  const wantedSubject = subject.trim();

  const match = list.find((m) => {
    const okSubj = (m.subject || '').trim() === wantedSubject;
    const okTo =
      (m.toRecipients || []).some(
        (r) => r?.emailAddress?.address?.trim().toLowerCase() === wantedTo
      );
    return okSubj && okTo;
  });

  return match || null;
}

// --- Public API ---

/** Envía un correo intentando crear borrador; si falta Mail.ReadWrite, cae a /me/sendMail. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const toRecipients = [{ emailAddress: { address: input.to } }];
  const ccRecipients = (input.cc || []).map((a) => ({ emailAddress: { address: a } }));
  const bccRecipients = (input.bcc || []).map((a) => ({ emailAddress: { address: a } }));

  // Aplica firma si está habilitada
  const sig = await emailSignatureStorage.get('outlook');
  const finalHtml = applySignatureHTML(input.htmlBody, sig?.html);

  const draftBody = {
    subject: input.subject,
    body: { contentType: 'HTML', content: finalHtml },
    toRecipients,
    ...(ccRecipients.length ? { ccRecipients } : {}),
    ...(bccRecipients.length ? { bccRecipients } : {}),
    isDeliveryReceiptRequested: !!input.requestReceipts,
    isReadReceiptRequested: !!input.requestReceipts,
  };

  // 1) Camino A: crear borrador (requiere Mail.ReadWrite)
  try {
    const draftRes = await graphFetch('/me/messages', {
      method: 'POST',
      body: JSON.stringify(draftBody),
    });

    if (!draftRes.ok) {
      const txt = await draftRes.text();
      throw Object.assign(new Error(`Graph draft error ${draftRes.status}: ${txt}`), {
        status: draftRes.status,
        body: txt,
      });
    }

    const draft = await draftRes.json();
    const messageId = draft?.id as string;
    if (!messageId) throw new Error('No se pudo crear el borrador');

    if (Array.isArray(input.attachments) && input.attachments.length) {
      for (const a of input.attachments) {
        const addRes = await graphFetch(`/me/messages/${encodeURIComponent(messageId)}/attachments`, {
          method: 'POST',
          body: JSON.stringify({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.name,
            contentBytes: a.contentBytes,
            contentType: a.contentType || undefined,
          }),
        });
        if (!addRes.ok) {
          throw new Error(`Graph attach error ${addRes.status}: ${await addRes.text()}`);
        }
      }
    }

    const sendRes = await graphFetch(`/me/messages/${encodeURIComponent(messageId)}/send`, {
      method: 'POST',
    });
    if (!sendRes.ok) {
      throw new Error(`Graph send error ${sendRes.status}: ${await sendRes.text()}`);
    }

    return {
      messageId,
      internetMessageId: draft?.internetMessageId as string | undefined,
      conversationId: draft?.conversationId as string | undefined,
    };
  } catch (err: any) {
    // Si falló por permisos (403/401) u otro “insufficient privileges”, usar camino B
    const msg = String(err?.message || '');
    const status = Number(err?.status || 0);
    const insufficient =
      status === 401 ||
      status === 403 ||
      /access.?denied/i.test(msg) ||
      /insufficient/i.test(msg);

    if (!insufficient) {
      // Error real no relacionado a permisos: propagar
      throw err;
    }
  }

  // 2) Camino B: /me/sendMail (solo necesita Mail.Send) + recuperar metadatos con Mail.Read
  const sendMailBody = {
    message: {
      subject: input.subject,
      body: { contentType: 'HTML', content: finalHtml },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
      ...(bccRecipients.length ? { bccRecipients } : {}),
      ...(Array.isArray(input.attachments) && input.attachments.length
        ? {
          attachments: input.attachments.map(a => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.name,
            contentBytes: a.contentBytes,
            contentType: a.contentType || undefined,
          }))
        }
        : {}
      ),
    },
    saveToSentItems: true,
  };

  const sendRes = await graphFetch('/me/sendMail', {
    method: 'POST',
    body: JSON.stringify(sendMailBody),
  });
  if (!sendRes.ok) {
    throw new Error(`Graph sendMail error ${sendRes.status}: ${await sendRes.text()}`);
  }

  // Dar tiempo a que el ítem aparezca en "Sent Items"
  await delay(1500);

  let msgMeta: GraphMessage | null = null;
  try {
    const tryFind = async (attempt = 1): Promise<GraphMessage | null> => {
      const found = await findRecentlySentByToAndSubject({
        to: input.to,
        subject: input.subject,
        lookbackMinutes: 15,
      });
      if (found || attempt >= 3) return found;
      await delay(1000 * attempt); // backoff 1s, 2s
      return tryFind(attempt + 1);
    };
    msgMeta = await tryFind();
  } catch {
    msgMeta = null;
  }

  return {
    messageId: msgMeta?.id || `sentmail:${Date.now()}`, // fallback
    internetMessageId: msgMeta?.internetMessageId,
    conversationId: msgMeta?.conversationId,
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
