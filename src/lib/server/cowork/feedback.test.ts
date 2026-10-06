import test from 'node:test';
import assert from 'node:assert/strict';
import { CoworkFeedbackRefused, COWORK_FEEDBACK_PER_RUN, recordCoworkFeedback } from './feedback';

const RUN = '33333333-3333-4333-8333-333333333333';

/** Your own client reads the run (and only yours); the service client records what it is asked to insert. */
function clients(run: { status: string } | null, feedbackEvents = 0) {
  const inserted: Array<Record<string, unknown>> = [];
  const own = { from(table: string) {
    const where: Record<string, unknown> = {};
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key, value) => { where[key as string] = value; return chain; },
      maybeSingle: async () => ({ data: run && where.user_id === 'u1' && where.organization_id === 'o1' ? { id: RUN, message: 'hola', mode: 'approval', ...run, parent_run_id: null } : null, error: null }),
      then: (resolve) => (resolve as (value: unknown) => void)({ data: table === 'cowork_run_events'
        ? Array.from({ length: feedbackEvents }, (_, index) => ({ sequence: index + 1, kind: 'answer.feedback', payload: { rating: 'up' }, created_at: '' })) : [], error: null }),
    };
    return chain;
  } };
  const admin = { from: () => ({ insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }) };
  return { auth: { user: { id: 'u1' }, organizationId: 'o1', organizationIds: ['o1'], supabase: own }, admin: admin as never, inserted };
}

test('your 👎 with its reason is kept as an event of your own finished run', async () => {
  const { auth, admin, inserted } = clients({ status: 'completed' });
  const saved = await recordCoworkFeedback(auth, RUN, { rating: 'down', reason: 'too_long', comment: 'Pedí algo breve' }, admin);
  assert.deepEqual(saved, { rating: 'down', reason: 'too_long', comment: 'Pedí algo breve' });
  assert.deepEqual(inserted, [{ run_id: RUN, user_id: 'u1', organization_id: 'o1', kind: 'answer.feedback', payload: saved }]);
  // A 👍 carries no reason.
  assert.equal((await recordCoworkFeedback(auth, RUN, { rating: 'up', reason: 'too_long' }, admin)).reason, null);
});

test('an answer that is not yours, not finished or already rated many times is refused', async () => {
  await assert.rejects(recordCoworkFeedback(clients(null).auth, RUN, { rating: 'up' }, clients(null).admin), (error: unknown) => error instanceof CoworkFeedbackRefused && error.status === 404);
  const running = clients({ status: 'running' });
  await assert.rejects(recordCoworkFeedback(running.auth, RUN, { rating: 'up' }, running.admin), (error: unknown) => error instanceof CoworkFeedbackRefused && error.status === 409);
  const many = clients({ status: 'completed' }, COWORK_FEEDBACK_PER_RUN);
  await assert.rejects(recordCoworkFeedback(many.auth, RUN, { rating: 'up' }, many.admin), (error: unknown) => error instanceof CoworkFeedbackRefused && error.status === 429);
  assert.equal(running.inserted.length + many.inserted.length, 0);
});
