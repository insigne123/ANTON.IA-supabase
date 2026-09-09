export type CampaignAttempt = {
  draft_id: string;
  state: 'retry_wait' | 'attention' | 'sent';
  code: string;
  message: string;
  retry_at: string | null;
  updated_at: string | null;
};

/** Success markers survive dispatch retention: a confirmed send is never recomputed as pending. */
export function withSentAttemptsAsDeliveries(
  deliveries: Array<{ draft_id: string; status: string; completed_at: string | null; error_message: string | null }>,
  attempts: CampaignAttempt[],
) {
  const merged = [...deliveries];
  for (const attempt of attempts) {
    if (attempt.state !== 'sent') continue;
    if (merged.some(row => row.draft_id === attempt.draft_id)) continue;
    merged.push({ draft_id: attempt.draft_id, status: 'sent', completed_at: attempt.updated_at, error_message: null });
  }
  return merged;
}

export function campaignAttemptAllowsRetry(attempt: CampaignAttempt | undefined, now = Date.now()) {
  if (!attempt || attempt.state === 'sent') return true;
  return attempt.state === 'retry_wait' && attempt.retry_at !== null && Date.parse(attempt.retry_at) <= now;
}

/** Persist product copy, never raw provider responses, credentials, or contact data from exceptions. */
export function describeCampaignFailure(code: string): { retryable: boolean; message: string; delayMs: number } {
  const fixed: Record<string, string> = {
    BULK_CAMPAIGN_CONTACT_BLOCKED: 'El contacto respondió, se dio de baja o está marcado como no contactar.',
    BULK_CAMPAIGN_ALREADY_CONTACTED: 'Esta persona ya fue contactada. Revisa su historial.',
    BULK_CAMPAIGN_ALREADY_SENT: 'Este correo ya fue enviado. No se repetirá.',
    BULK_CAMPAIGN_REVIEW_CHANGED: 'El borrador cambió después de la aprobación. Revisa la campaña.',
    BULK_CAMPAIGN_NOT_FOUND: 'La campaña ya no está disponible.',
    recipient_suppressed: 'El contacto se dio de baja.',
  };
  if (fixed[code]) return { retryable: false, message: fixed[code], delayMs: 0 };
  const temporary: Record<string, string> = {
    provider_connection_unavailable: 'Reconecta tu cuenta de correo. Volveremos a comprobar la conexión.',
    daily_quota_exceeded: 'Se alcanzó el límite diario. Se volverá a comprobar la cuota.',
    campaign_paused: 'La campaña está en pausa.',
    BULK_CAMPAIGN_NOT_APPROVED: 'La campaña está en pausa o pendiente de aprobación.',
    BULK_CAMPAIGN_NOT_DUE: 'Todavía no corresponde enviar este mensaje.',
    BULK_CAMPAIGN_BUSY: 'La campaña está siendo actualizada.',
    BULK_CAMPAIGN_CONTACT_BUSY: 'Se está actualizando el contacto.',
  };
  return { retryable: true, message: temporary[code] || 'No se pudo completar la comprobación. Se volverá a intentar.', delayMs: 3600000 };
}
