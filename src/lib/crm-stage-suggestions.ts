import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';

/**
 * Pipeline stage suggestions (Plan 5, PR-10): events (a send, a reply, a meeting request, a bounce) propose the stage and
 * a person confirms it, one by one or with «Aceptar todas». Pure: the server, the pipeline and their tests share it.
 */
export type CrmStageSuggestion = {
  id: string;
  crm_id: string;
  from_stage: string | null;
  to_stage: PipelineStage;
  reason: string;
  source: string;
  created_at: string;
};

const EVENT_REASONS: Record<string, string> = {
  delivered: 'Se entregó el correo.',
  open: 'Abrió el correo.',
  click: 'Hizo clic en el correo.',
  bounce: 'El correo rebotó.',
  hard_bounce: 'El correo rebotó.',
  delivery_failed: 'El correo no se pudo entregar.',
  positive: 'Respondió con interés.',
  positive_reply: 'Respondió con interés.',
  interested: 'Respondió con interés.',
  meeting_request: 'Pidió una reunión.',
  reply_negotiation: 'Pidió una propuesta, un precio o un contrato.',
  reply_won: 'Confirmó que quiere comprar.',
  not_interested: 'Respondió que no le interesa.',
  unsubscribe: 'Pidió no recibir más correos.',
  reply_review_required: 'Respondió; conviene leer qué dijo.',
  suplia_crm_update_stage: 'SUPL.IA propone este cambio.',
};

/** Why the stage is suggested, in plain words: the event when it is known, otherwise what the event wrote as a note. */
export function stageSuggestionReason(event?: string | null, notes?: string | null): string {
  const known = EVENT_REASONS[String(event || '').trim()];
  if (known) return known;
  const note = String(notes || '').replace(/\s+/g, ' ').trim();
  return note ? note.slice(0, 300) : 'Se registró un evento de contacto.';
}

export function stageLabel(stage?: string | null): string {
  return PIPELINE_STAGES.find(item => item.id === stage)?.label || 'Nuevos';
}

/** «Contactado → Interesado». */
export function describeStageMove(suggestion: Pick<CrmStageSuggestion, 'from_stage' | 'to_stage'>): string {
  return `${stageLabel(suggestion.from_stage)} → ${stageLabel(suggestion.to_stage)}`;
}

export function isStageSuggestionDecision(value: unknown): value is 'accept' | 'dismiss' {
  return value === 'accept' || value === 'dismiss';
}

/** What the page says after deciding, in one line. */
export function stageDecisionNotice(result: { accepted?: number; dismissed?: number; superseded?: number }): string {
  const parts: string[] = [];
  if (result.accepted) parts.push(`${result.accepted} ${result.accepted === 1 ? 'etapa actualizada' : 'etapas actualizadas'}`);
  if (result.dismissed) parts.push(`${result.dismissed} ${result.dismissed === 1 ? 'sugerencia descartada' : 'sugerencias descartadas'}`);
  if (result.superseded) parts.push(`${result.superseded} ya ${result.superseded === 1 ? 'estaba' : 'estaban'} más avanzada${result.superseded === 1 ? '' : 's'} y no se ${result.superseded === 1 ? 'movió' : 'movieron'}`);
  return parts.length ? `${parts.join(' · ')}.` : 'No había sugerencias pendientes.';
}
