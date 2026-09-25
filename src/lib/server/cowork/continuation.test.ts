import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkContinuationArgs } from './continuation';
import { deterministicCoworkUuid } from './operations';

test('a continuation names every admission argument so the database can pick one function', () => {
  const scope = { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' };
  const runId = '00000000-0000-4000-8000-000000000003';
  const args = coworkContinuationArgs(scope, runId, 'Continúa con el resultado.', 'approval');
  // Without p_reset_depth, PostgREST sees the 6- and 7-argument versions and answers PGRST203.
  assert.deepEqual(args, {
    p_user_id: scope.userId, p_organization_id: scope.organizationId,
    p_request_id: deterministicCoworkUuid(`cowork:continuation:${runId}`),
    p_message: 'Continúa con el resultado.', p_mode: 'approval', p_parent_run_id: runId, p_reset_depth: false,
  });
});
