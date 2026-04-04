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
  // Try to get client session silently. If not available, we fall back to server-side token.
  const session = googleAuthService.getSession();
  const accessToken = (session?.accessToken && session.scope.includes('https://www.googleapis.com/auth/gmail.send'))
    ? session.accessToken
    : '';

  const from = await googleAuthService.getUserEmail() || undefined;

  // Aplica firma si está habilitada para Gmail
  const sig = await emailSignatureStorage.get('gmail');
  const finalHtml = applySignatureHTML(input.html || '', sig?.html);

  // Genera versión de texto plano a partir del HTML final (con firma)
  const finalPlainText = stripHtmlToText(finalHtml);

  const res = await fetch('/api/gmail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken ? `Bearer ${accessToken}` : '', // Send empty if no token
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
