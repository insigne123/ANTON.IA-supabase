// Fachada cliente para envío Gmail idempotente mediante el backend.
import { emailSignatureStorage } from './email-signature-storage';
import { applySignatureHTML } from './signature-apply';
import { stripHtmlToText } from './email-outbound';

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
  idempotencyKey?: string;
  trackingId?: string;
  tracking?: {
    pixel?: boolean;
    linkTracking?: boolean;
  };
};

export async function sendGmailEmail(input: GmailSendInput): Promise<{ id: string; threadId: string; }> {
  // Aplica firma si está habilitada para Gmail
  const sig = await emailSignatureStorage.get('gmail');
  const finalHtml = applySignatureHTML(input.html || '', sig?.html);

  // El sender consolidado aun emite HTML simple, no un MIME multipart alternativo.
  const htmlDerivedText = stripHtmlToText(finalHtml);
  if (input.text !== undefined && input.text.trim() !== htmlDerivedText) {
    throw new Error('Gmail no admite una parte de texto distinta del HTML en el envio consolidado.');
  }
  const finalPlainText = input.text?.trim() ?? htmlDerivedText;

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
      to: input.to,
      subject: input.subject,
      htmlBody: finalHtml,
      textBody: finalPlainText,
      leadId: input.leadId,
      researchSnapshotId: input.researchSnapshotId,
      idempotencyKey: input.idempotencyKey,
      trackingId: input.trackingId,
      tracking: input.tracking,
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
