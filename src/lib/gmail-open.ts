// Abre un hilo de Gmail por threadId en una pestaña nueva.
// accountIndex: 0 para la primera sesión de Gmail abierta en el navegador,
// 1 para la segunda, etc.
export function openGmailThreadWebLink(threadId: string, accountIndex = 0) {
  if (!threadId || typeof window === 'undefined') {
    throw new Error('threadId requerido para abrir el hilo de Gmail.');
  }
  const url = `https://mail.google.com/mail/u/${accountIndex}/#inbox/${encodeURIComponent(threadId)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
