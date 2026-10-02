/**
 * «Cerrar conversación» (Plan 5, PR-9a): how a conversation ended and what that means for the contact. It replaces
 * «Marcar resuelto», which only hid the conversation for its sender. Pure: the dialog, the route and their tests share it.
 * With collaboration on, the outcome also decides who in the team may contact the person next
 * (close_organization_contact_thread_v1); without it, it only changes the conversation, the pipeline and follow-ups.
 */
export const CONVERSATION_CLOSE_OUTCOMES = ['no_deal', 'won', 'not_interested', 'keep'] as const;
export type ConversationCloseOutcome = typeof CONVERSATION_CLOSE_OUTCOMES[number];

export type ConversationCloseOption = {
  outcome: ConversationCloseOutcome;
  label: string;
  /** What happens, in one line, when the person works alone. */
  solo: string;
  /** What happens, in one line, when the organization works as a team. */
  team: string;
  /** The pipeline stage the person chooses with this outcome; null keeps the current one. */
  stage: 'closed_won' | 'closed_lost' | null;
  /** Stops every follow-up to this person from this account. */
  doNotContact: boolean;
};

export const CONVERSATION_CLOSE_OPTIONS: ConversationCloseOption[] = [
  {
    outcome: 'no_deal', label: 'Sin acuerdo', stage: 'closed_lost', doNotContact: false,
    solo: 'Pasa a Perdido en el pipeline.',
    team: 'Pasa a Perdido y queda libre: cualquiera del equipo puede volver a contactarlo.',
  },
  {
    outcome: 'won', label: 'Ganado', stage: 'closed_won', doNotContact: false,
    solo: 'Pasa a Ganado en el pipeline.',
    team: 'Pasa a Ganado. Nadie del equipo vuelve a prospectarlo; un administrador puede reabrirlo.',
  },
  {
    outcome: 'not_interested', label: 'No interesado', stage: 'closed_lost', doNotContact: true,
    solo: 'Pasa a Perdido y no vuelves a escribirle: se detienen sus seguimientos.',
    team: 'Pasa a Perdido y nadie del equipo vuelve a contactarlo.',
  },
  {
    outcome: 'keep', label: 'Lo retomo yo', stage: null, doNotContact: false,
    solo: 'Sale de «Por responder». La etapa no cambia.',
    team: 'Sigue siendo tuyo: nadie más del equipo puede contactarlo. La etapa no cambia.',
  },
];

export function isConversationCloseOutcome(value: unknown): value is ConversationCloseOutcome {
  return typeof value === 'string' && (CONVERSATION_CLOSE_OUTCOMES as readonly string[]).includes(value);
}

export function conversationCloseOption(outcome: ConversationCloseOutcome): ConversationCloseOption {
  return CONVERSATION_CLOSE_OPTIONS.find(option => option.outcome === outcome)!;
}

/** The team lock as the dialog shows it: only an active thread changes when the conversation closes. */
export type ConversationTeamLock = { enabled: boolean; status: string | null; mine: boolean };

/** Plain words for what the database refuses when closing the team thread. */
export function conversationCloseRefusal(error: { code?: string | null; message?: string | null }): { status: number; message: string } | null {
  const message = String(error.message || '');
  if (error.code === '42501') return { status: 403, message: 'Esta conversación la lleva otra persona del equipo: solo ella o un administrador pueden cerrarla.' };
  if (error.code === '55000' && /in-flight/i.test(message)) return { status: 409, message: 'Hay un envío en curso a esta persona. Espera a que termine y vuelve a intentarlo.' };
  if (error.code === '55000') return { status: 409, message: 'El equipo ya no tiene esta conversación abierta. Actualiza la vista.' };
  if (error.code === '22023') return { status: 400, message: 'Elige cómo terminó la conversación.' };
  return null;
}
