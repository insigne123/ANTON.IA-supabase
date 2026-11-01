/**
 * Whether an email is safe to send to, read from the status Apollo returns with it (audit P4, 1 Nov 2026). Apollo marks
 * «verified» only after checking the mailbox; «unknown», «extrapolated», «guessed» or no status mean it did not, and those
 * are the ones that bounce. Pure: Por escribir, Redactar and the tests share it.
 */
export type EmailDeliverability = { verified: boolean; label: string; hint: string | null };

export function emailDeliverability(status: unknown): EmailDeliverability {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'verified') return { verified: true, label: 'Verificado', hint: null };
  return {
    verified: false,
    label: 'Sin verificar',
    hint: 'Apollo no pudo verificar este correo y podría rebotar. Revisa la dirección antes de enviar.',
  };
}
