// Fachada cliente → backend para envío Gmail
// - Prepara payload RFC822 (en backend) y manda token en Authorization
import { googleAuthService } from './google-auth-service';
import { emailSignatureStorage } from './email-signature-storage';
import { applySignatureHTML } from './signature-apply';

export type GmailSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ name: string; contentBytes: string; contentType?: string }>;
};

// Helper para derivar texto plano desde HTML
function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


export async function sendGmailEmail(input: GmailSendInput): Promise<{ id: string; threadId: string; }> {
  const accessToken = await googleAuthService.getSendToken();
  const from = await googleAuthService.getUserEmail();
  if (!from) {
    throw new Error('No se pudo obtener el email del usuario desde la sesión de Google. Por favor, vuelve a conectar tu cuenta.');
  }

  // Aplica firma si está habilitada para Gmail
  const sig = await emailSignatureStorage.get('gmail');
  const finalHtml = applySignatureHTML(input.html || '', sig?.html);

  // Genera versión de texto plano a partir del HTML final (con firma)
  const finalPlainText = stripHtmlToText(finalHtml);

  const res = await fetch('/api/gmail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      // Si tienes un userId para cuota/telemetría, puedes pasarlo sin romper nada:
      'x-user-id': from ? `gmail:${from}` : '',
    },
    body: JSON.stringify({ ...input, from, html: finalHtml, text: finalPlainText }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[gmail/send] backend error', res.status, text);
    throw new Error(text || 'Fallo al enviar correo con Gmail');
  }
  const data = await res.json();
  if (!data?.threadId) {
    console.warn('[gmail/send] La respuesta no incluyó threadId; revisar backend/permiso gmail.readonly si luego quieres leer/trackear el hilo.');
  }
  return data;
}
