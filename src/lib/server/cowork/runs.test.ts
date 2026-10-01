import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@/lib/server/auth-utils';

import { listCoworkRuns } from './runs';
import { deterministicCoworkUuid } from './operations';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('a notice that research finished reads as an automatic turn with its reason; the request id never leaves the server', async () => {
  const rows = [
    { id: id(1), message: 'Busca gerentes', mode: 'approval', status: 'completed', created_at: '2026-10-01T15:00:00Z', parent_run_id: null, request_id: id(91) },
    { id: id(2), message: 'Continúa…', mode: 'approval', status: 'completed', created_at: '2026-10-01T15:01:00Z', parent_run_id: id(1),
      request_id: deterministicCoworkUuid(`cowork:continuation:${id(1)}`) },
    { id: id(3), message: 'Terminaron las investigaciones…', mode: 'approval', status: 'queued', created_at: '2026-10-01T15:20:00Z', parent_run_id: id(2),
      request_id: deterministicCoworkUuid(`cowork:research-notice:${id(2)}`) },
    { id: id(4), message: 'Ahora escríbeles', mode: 'approval', status: 'queued', created_at: '2026-10-01T15:21:00Z', parent_run_id: id(3), request_id: id(94) },
  ];
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: rows, error: null }) };
  const auth = { user: { id: 'u' }, organizationId: 'o', supabase: { from: () => chain } } as unknown as AuthContext;
  const runs: Array<Record<string, unknown> & { automatic?: boolean; automaticReason?: string }> = await listCoworkRuns(auth);
  assert.deepEqual(runs.map(run => [run.automatic, 'automaticReason' in run ? run.automaticReason : null]),
    [[false, null], [true, null], [true, 'research'], [false, null]]);
  assert.ok(runs.every(run => !('request_id' in run)));
});
