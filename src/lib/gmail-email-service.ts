// Fachada cliente para envío Gmail idempotente mediante el backend.

import { mapDurableSendReceipt, type DurableSendReceipt } from './outbound-send-receipt';

export type GmailSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ name: string; contentBytes: string; contentType?: string }>;
  leadId?: string;
  researchSnapshotId?: string | null;
  draftId?: string | null;
  versionId?: string | null;
  organizationId: string;
  idempotencyKey?: string;
};

export type GmailSendResult = DurableSendReceipt & {
  id: string;
  threadId: string;
};

export async function sendGmailEmail(input: GmailSendInput): Promise<GmailSendResult> {
  const hasCanonicalDraft = Boolean(input.draftId && input.versionId);
  if (Boolean(input.draftId) !== Boolean(input.versionId)) {
    throw new Error('draftId y versionId deben enviarse juntos.');
  }
  if (!hasCanonicalDraft) {
    throw new Error('Selecciona un borrador aprobado antes de enviar.');
  }
  if (!String(input.organizationId || '').trim()) {
    throw new Error('No se pudo confirmar la organización del borrador.');
  }
  if (input.attachments?.length) {
    throw new Error('Los adjuntos todavia no estan disponibles en el envio idempotente de Gmail.');
  }
  if (input.cc?.length || input.bcc?.length || input.replyTo) {
    throw new Error('CC, BCC y Reply-To todavia no estan disponibles en el envio idempotente de Gmail.');
  }
  const res = await fetch('/api/providers/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'google',
      draftId: input.draftId,
      versionId: input.versionId,
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  const data = await res.json().catch(() => null);
  const durableReceipt = mapDurableSendReceipt(data);
  if (!durableReceipt) {
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : `Fallo al enviar correo con Gmail (${res.status})`;
    throw new Error(message);
  }
  const providerResponse = data?.receipt?.providerResponse || {};
  if (durableReceipt.status === 'sent' && !providerResponse?.threadId) {
    console.warn('[gmail/send] La respuesta no incluyó threadId; revisar backend/permiso gmail.readonly si luego quieres leer/trackear el hilo.');
  }
  return {
    ...durableReceipt,
    id: durableReceipt.providerMessageId || providerResponse?.id || '',
    threadId: providerResponse?.threadId || '',
  };
}
