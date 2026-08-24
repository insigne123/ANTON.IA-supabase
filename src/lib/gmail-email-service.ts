// Fachada cliente para envío Gmail idempotente mediante el backend.

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
  idempotencyKey?: string;
};

export async function sendGmailEmail(input: GmailSendInput): Promise<{ id: string; threadId: string; }> {
  const hasCanonicalDraft = Boolean(input.draftId && input.versionId);
  if (Boolean(input.draftId) !== Boolean(input.versionId)) {
    throw new Error('draftId y versionId deben enviarse juntos.');
  }
  if (!hasCanonicalDraft) {
    throw new Error('Selecciona un borrador aprobado antes de enviar.');
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
      idempotencyKey: input.idempotencyKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[gmail/send] backend error', res.status, text);
    let message = text;
    try { message = JSON.parse(text)?.error || text; } catch {}
    throw new Error(message || 'Fallo al enviar correo con Gmail');
  }
  const data = await res.json();
  if (!data?.success || data?.status !== 'sent') {
    throw new Error(data?.error || 'El envio de Gmail sigue pendiente de confirmacion.');
  }
  const providerResponse = data?.receipt?.providerResponse || {};
  if (!providerResponse?.threadId) {
    console.warn('[gmail/send] La respuesta no incluyó threadId; revisar backend/permiso gmail.readonly si luego quieres leer/trackear el hilo.');
  }
  return {
    id: data?.receipt?.providerMessageId || providerResponse?.id || '',
    threadId: providerResponse?.threadId || '',
  };
}
