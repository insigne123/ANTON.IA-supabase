import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { COWORK_FEEDBACK_EVENT, coworkFeedbackSchema, type CoworkFeedback } from '@/lib/cowork/turn-actions';
import { getCoworkRun } from './runs';

/** Enough to change your mind a few times; beyond it the run's trace stays readable. */
export const COWORK_FEEDBACK_PER_RUN = 20;

export class CoworkFeedbackRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * 👍 or 👎 on an answer of yours (Plan 13), kept as an event of its run: the page shows it with the answer and the team can read
 * what helped and what did not, without a table of its own. The run is read with your own client first, so you can only rate
 * your own finished answers; the event is written with the service client, as campaign edits are.
 */
export async function recordCoworkFeedback(auth: AuthContext, runId: string, body: unknown, admin = getSupabaseAdminClient()): Promise<CoworkFeedback> {
  const input = coworkFeedbackSchema.parse(body);
  const state = await getCoworkRun(auth, runId);
  if (!state) throw new CoworkFeedbackRefused('Esa respuesta ya no está disponible.', 404);
  if (state.run.status !== 'completed') throw new CoworkFeedbackRefused('Podrás valorar la respuesta cuando termine.', 409);
  if (state.events.filter((event: { kind: string }) => event.kind === COWORK_FEEDBACK_EVENT).length >= COWORK_FEEDBACK_PER_RUN) {
    throw new CoworkFeedbackRefused('Ya guardamos tu opinión sobre esta respuesta.', 429);
  }
  const feedback = input.rating === 'down' ? input : { ...input, reason: null };
  const { error } = await admin.from('cowork_run_events').insert({
    run_id: runId, user_id: auth.user.id, organization_id: auth.organizationId, kind: COWORK_FEEDBACK_EVENT, payload: feedback,
  });
  if (error) throw new Error('No se pudo guardar tu opinión.');
  return feedback;
}
