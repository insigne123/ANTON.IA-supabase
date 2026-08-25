export type CampaignInboxItemAction =
  | { kind: 'prepare' | 'open'; label: string }
  | { kind: 'none'; guidance: string };

function normalizedState(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function campaignInboxItemAction(state: string, nextAction?: string): CampaignInboxItemAction {
  switch (normalizedState(state)) {
    case 'ready_to_prepare':
      return { kind: 'prepare', label: 'Preparar borrador' };
    case 'review_required':
      return { kind: 'open', label: 'Revisar correo' };
    case 'approved':
      return { kind: 'open', label: 'Revisar y enviar' };
    case 'pending_initial_send':
      if (normalizedState(nextAction || '') === 'send') return { kind: 'open', label: 'Revisar y enviar' };
      return { kind: 'none', guidance: 'Espera la confirmación del envío inicial.' };
    case 'drafting':
      return { kind: 'none', guidance: 'El borrador se está preparando. Actualiza la bandeja en unos minutos.' };
    case 'dispatch_pending':
      return { kind: 'open', label: 'Retomar envío' };
    case 'sending':
      return { kind: 'none', guidance: 'El envío está en curso. No lo repitas mientras se confirma.' };
    case 'deferred':
      return { kind: 'open', label: 'Retomar envío' };
    case 'failed':
      return { kind: 'none', guidance: 'El intento falló y no tiene un reintento seguro disponible.' };
    case 'unknown':
      return { kind: 'none', guidance: 'El resultado aún no está confirmado. No vuelvas a enviarlo.' };
    case 'blocked':
      return { kind: 'none', guidance: 'Este seguimiento está bloqueado y no puede continuar desde aquí.' };
    case 'not_due':
      return { kind: 'none', guidance: 'Este seguimiento todavía no está listo.' };
    default:
      return { kind: 'none', guidance: 'Este seguimiento no tiene una acción segura disponible.' };
  }
}
