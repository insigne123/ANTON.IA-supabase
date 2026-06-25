export type CommercialEventKind =
  | 'lead_created'
  | 'lead_enriched'
  | 'research_completed'
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'reply_received'
  | 'bounce_detected'
  | 'crm_updated'
  | 'privacy_blocked'
  | 'note';

export type CommercialEventTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type CommercialTimelineEvent = {
  id: string;
  kind: CommercialEventKind;
  tone: CommercialEventTone;
  title: string;
  description?: string | null;
  occurredAt: string;
  source?: string | null;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export type CommercialEntityIdentity = {
  leadId?: string | null;
  gid?: string | null;
  email?: string | null;
  name?: string | null;
  company?: string | null;
  companyDomain?: string | null;
};

export type ContactabilityStatus = 'ok' | 'warning' | 'blocked' | 'missing_email' | 'unknown';

export type ContactabilityResult = {
  status: ContactabilityStatus;
  label: string;
  description: string;
  reasons: string[];
};

export type TrustCenterTone = 'healthy' | 'attention' | 'paused';

export function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function cleanDomain(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

export function inferCompanyDomain(input: CommercialEntityIdentity) {
  const explicit = cleanDomain(input.companyDomain);
  if (explicit) return explicit;
  const email = normalizeEmail(input.email);
  const emailDomain = email.includes('@') ? email.split('@')[1] : '';
  if (!emailDomain) return '';
  if (['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(emailDomain)) return '';
  return cleanDomain(emailDomain);
}

export function eventToneForKind(kind: CommercialEventKind): CommercialEventTone {
  if (kind === 'reply_received' || kind === 'lead_enriched' || kind === 'research_completed') return 'success';
  if (kind === 'email_opened' || kind === 'email_clicked' || kind === 'email_sent') return 'info';
  if (kind === 'bounce_detected' || kind === 'privacy_blocked') return 'danger';
  return 'neutral';
}

export function getContactabilityCopy(status: ContactabilityStatus): Pick<ContactabilityResult, 'label' | 'description'> {
  switch (status) {
    case 'ok':
      return { label: 'Contactable', description: 'No encontramos bloqueos para este contacto.' };
    case 'warning':
      return { label: 'Revisar antes de contactar', description: 'Hay senales que conviene revisar antes de enviar.' };
    case 'blocked':
      return { label: 'No contactar', description: 'Este contacto o dominio esta bloqueado para envios.' };
    case 'missing_email':
      return { label: 'Sin email', description: 'Necesitas un email valido antes de contactar.' };
    default:
      return { label: 'Estado no disponible', description: 'No pudimos verificar el estado de contacto ahora.' };
  }
}

export function getTrustCenterTone(input: {
  autopilotEnabled?: boolean | null;
  openExceptions?: number;
  approvalsPending?: number;
  tasksProcessing?: number;
}) : TrustCenterTone {
  if (!input.autopilotEnabled) return 'paused';
  if ((input.openExceptions || 0) > 0 || (input.approvalsPending || 0) > 0) return 'attention';
  return 'healthy';
}

export function getTrustCenterCopy(tone: TrustCenterTone) {
  if (tone === 'healthy') {
    return {
      label: 'Operando con normalidad',
      description: 'ANTONIA no tiene bloqueos importantes y puede seguir trabajando con los guardrails actuales.',
    };
  }
  if (tone === 'attention') {
    return {
      label: 'Necesita una revision breve',
      description: 'Hay aprobaciones, excepciones o leads calientes que conviene atender antes de aumentar automatizacion.',
    };
  }
  return {
    label: 'Autopilot pausado o asistido',
    description: 'ANTONIA puede preparar trabajo, pero no deberia operar sola hasta ajustar la configuracion.',
  };
}
