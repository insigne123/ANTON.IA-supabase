import { createHash } from 'node:crypto';
import { linkedinSlugConflictsWithName, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

/** Fase 5: puente Cowork <-> extension de LinkedIn. Todo puro y determinista:
 * la ejecucion real ocurre en el navegador del usuario y solo un resultado
 * confirmado en destino cuenta como envio. Nada aqui pulsa Enviar. */

// Limite semanal de invitaciones observado en cuentas gratuitas (~100/sem).
// Es una estimacion operativa documentada, no un limite oficial de LinkedIn:
// el servidor la aplica de forma conservadora y la revision humana prevalece.
export const LINKEDIN_WEEKLY_INVITE_LIMIT = 100;
// Segundos contactos: minimo 7 dias desde el envio confirmado y siempre con
// informacion nueva (contenido distinto). Politica propia, no de LinkedIn.
export const LINKEDIN_FOLLOWUP_COOLDOWN_DAYS = 7;
export const LINKEDIN_MESSAGE_MAX = 1200;
// Un trabajo en cola jamas se auto-ejecuta: pasado este plazo se considera
// vencido y debe re-proponerse. Se calcula al leer, sin escritores magicos.
export const LINKEDIN_JOB_EXPIRY_DAYS = 7;
// Una accion por perfil y dia como tope de seguridad del programador.
export const LINKEDIN_DAILY_PROFILE_CAP = 1;

export function inviteIdempotencyKey(organizationId: string, userId: string, canonicalUrl: string) {
  return createHash('sha256')
    .update(`linkedin|invite|${organizationId}|${userId}|${normalizeLinkedinProfileUrl(canonicalUrl).toLowerCase()}`).digest('hex');
}

export function messageIdempotencyKey(organizationId: string, userId: string, canonicalUrl: string, message: string) {
  return createHash('sha256')
    .update(`linkedin|message|${organizationId}|${userId}|${normalizeLinkedinProfileUrl(canonicalUrl).toLowerCase()}|${message.trim()}`).digest('hex');
}

function nameTokens(value: unknown): string[] {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^a-z0-9]+/i).filter(word => word.length >= 2);
}

export type IdentityEvidence =
  | { kind: 'saved_lead'; url: string | null; name: string | null }
  | { kind: 'extension_capture'; url: string | null; name: string | null };

export type IdentityCheck = { urlMatch: boolean; nameCheck: 'verified' | 'unverified' | 'conflict' };

/** 5.5: verificacion de identidad antes de actuar. La URL canonica manda;
 * el nombre cruza slug y nombre guardado. Cualquier conflicto rechaza con
 * mensaje explicito: el buscador ya ofrecio dos veces a la persona equivocada. */
export function verifyLinkedinIdentity(
  target: { url: string; name?: string | null },
  evidence: IdentityEvidence,
): IdentityCheck {
  const canonical = normalizeLinkedinProfileUrl(target.url);
  if (!canonical) throw new Error('La URL de perfil LinkedIn no es válida.');
  const reference = normalizeLinkedinProfileUrl(evidence.url);
  if (!reference || reference !== canonical) {
    throw new Error('El perfil no coincide con el contacto observado. Revisa la URL antes de actuar.');
  }
  const slugConflict = linkedinSlugConflictsWithName(canonical, evidence.name);
  const targetTokens = nameTokens(target.name);
  const evidenceTokens = nameTokens(evidence.name);
  const shared = targetTokens.filter(token => evidenceTokens.includes(token));
  if (slugConflict || (targetTokens.length >= 2 && evidenceTokens.length >= 2 && !shared.length)) {
    throw new Error(`El nombre no corresponde a este perfil (slug/registro en conflicto). No se actúa sobre ${evidence.kind === 'saved_lead' ? 'el contacto guardado' : 'la captura'}.`);
  }
  return { urlMatch: true,
    nameCheck: targetTokens.length >= 2 && evidenceTokens.length >= 2 ? 'verified' : 'unverified' };
}

export type InviteQuota = { pending: number; sent7d: number; limit: number; allowed: boolean; reason: string };

/** 5.6: contar pendientes, no enviadas. Las invitaciones en cola o reclamadas
 * ocupan cupo porque LinkedIn limita tambien las pendientes de aceptacion. */
export function classifyInviteQuota(pending: number, sent7d: number, limit = LINKEDIN_WEEKLY_INVITE_LIMIT): InviteQuota {
  const used = pending + sent7d;
  if (used >= limit) {
    return { pending, sent7d, limit, allowed: false,
      reason: `Cupo semanal cubierto (${used}/${limit} entre pendientes y enviadas de 7 días). Retira pendientes o espera al próximo ciclo.` };
  }
  return { pending, sent7d, limit, allowed: true, reason: `Cupo disponible (${used}/${limit}).` };
}

export type FollowupInput = {
  lastConfirmedAt: string | null; lastInboundAt: string | null; crmStages: string[];
  lastMessageHash: string | null; newMessageHash: string | null; now: number;
};

export type FollowupVerdict = { eligible: boolean; reasons: string[] };

/** 5.7: segundo contacto solo con historial fiable, sin negativas ni
 * negociacion activa, con espera cumplida y con informacion nueva (hash
 * distinto al ultimo mensaje confirmado). */
export function followupEligible(input: FollowupInput): FollowupVerdict {
  const reasons: string[] = [];
  if (!input.lastConfirmedAt || !Number.isFinite(Date.parse(input.lastConfirmedAt))) {
    reasons.push('no_confirmed_send');
  }
  if (input.lastInboundAt && Number.isFinite(Date.parse(input.lastInboundAt))) {
    reasons.push('inbound_reply_observed');
  }
  if (input.crmStages.some(stage => stage === 'negotiation' || stage === 'meeting')) {
    reasons.push('negotiation_hold');
  }
  if (input.crmStages.some(stage => stage === 'closed_won' || stage === 'closed_lost' || stage === 'do_not_contact')) {
    reasons.push('closed_or_opted_out');
  }
  if (input.lastConfirmedAt && Number.isFinite(Date.parse(input.lastConfirmedAt))) {
    const days = (input.now - Date.parse(input.lastConfirmedAt)) / 86400000;
    if (days < LINKEDIN_FOLLOWUP_COOLDOWN_DAYS) reasons.push('cooldown_active');
  }
  if (!input.newMessageHash) {
    reasons.push('missing_new_message');
  } else if (input.lastMessageHash && input.newMessageHash === input.lastMessageHash) {
    reasons.push('repeated_content');
  }
  return { eligible: !reasons.length, reasons };
}

export function jobExpired(queuedAt: string, now: number): boolean {
  const queued = Date.parse(queuedAt);
  if (!Number.isFinite(queued)) return true;
  return now - queued > LINKEDIN_JOB_EXPIRY_DAYS * 86400000;
}
