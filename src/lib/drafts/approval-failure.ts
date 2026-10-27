/**
 * What «Confirmar y enviar» says when the review cannot be confirmed: the server's reason (/api/native-drafts/[id]/approve),
 * not «Revisa el correo e inténtalo nuevamente». On 23 Oct 2026 a person retried an email of 221 words over and over without
 * learning that the limit was the length.
 */
export function approvalFailureText(payload: unknown) {
  const body = payload && typeof payload === 'object' ? payload as { error?: unknown; message?: unknown } : {};
  const message = typeof body.message === 'string' ? body.message.replace(/\s+/g, ' ').trim() : '';
  switch (body.error) {
    case 'NATIVE_DRAFT_PREFLIGHT_FAILED':
      return message ? message.slice(0, 400) : 'El correo no pasó la revisión. Ajústalo e inténtalo de nuevo.';
    case 'NATIVE_DRAFT_VERSION_CONFLICT':
      return 'El correo cambió en otra pestaña. Recarga para ver la última versión.';
    case 'NATIVE_DRAFT_PRIVACY_SUPPRESSED':
      return 'Este contacto pidió no recibir correos.';
    case 'NATIVE_DRAFT_GENERATION_IN_PROGRESS':
      return 'Se está escribiendo una versión nueva de este correo. Espera unos segundos y vuelve a intentarlo.';
    case 'NATIVE_DRAFT_SNAPSHOT_NOT_FOUND':
      return 'No encontramos la investigación de este correo. Vuelve a investigar al contacto.';
    default:
      return 'Revisa el correo e inténtalo nuevamente.';
  }
}
