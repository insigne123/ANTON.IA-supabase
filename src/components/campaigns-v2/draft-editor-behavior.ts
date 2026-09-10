export type RewriteProposal = { subject: string; body: string; expectedVersionId: string };

export const versionConflictMessage = 'Existe una versión más reciente. Tus cambios se conservan aquí. Copia tu texto antes de recargar y comparar con la versión guardada.';

export function readRewriteProposal(payload: unknown, expectedVersionId: string, preservedBody?: string): RewriteProposal {
  const proposal = (payload as { proposal?: RewriteProposal } | null)?.proposal;
  if (!expectedVersionId.trim() || !proposal || typeof proposal.subject !== 'string' || !proposal.subject.trim()
    || proposal.subject.length > 998
    || typeof proposal.body !== 'string' || !proposal.body.trim()
    || proposal.body.length > 100_000
    || proposal.expectedVersionId !== expectedVersionId) {
    throw new Error('No recibimos una propuesta compatible. No se ha aplicado ningún cambio desde este editor. Comprueba la versión guardada antes de continuar.');
  }
  return { ...proposal, body: preservedBody ?? proposal.body };
}

/** A response may update the saved baseline, never text typed after its request started. */
export function reconcileSavedText(
  current: { subject: string; body: string },
  submitted: { subject: string; body: string },
  saved: { subject: string; body: string },
) {
  return {
    subject: current.subject === submitted.subject ? saved.subject : current.subject,
    body: current.body === submitted.body ? saved.body : current.body,
  };
}

export const quickRewrites = [
  { label: 'Más natural', subjectOnly: false, instruction: 'Haz el tono más natural y conversacional, sin añadir hechos.' },
  { label: 'Más breve', subjectOnly: false, instruction: 'Acorta el mensaje conservando los hechos y una sola llamada a la acción.' },
  { label: 'Solo asunto', subjectOnly: true, instruction: 'Mejora únicamente el asunto. Conserva el cuerpo exactamente sin cambios.' },
] as const;
