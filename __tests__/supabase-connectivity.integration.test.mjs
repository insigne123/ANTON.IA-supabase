import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from '../scripts/assert-test-target.mjs';

test('safe Supabase schema is reachable with the test service role', async () => {
  const target = assertSafeTestTarget();
  assert.ok(['local', 'nonprod'].includes(target.kind));

  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required for integration tests');

  const supabase = createClient(target.supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase
    .from('organizations')
    .select('id', { head: true, count: 'exact' })
    .limit(1);

  assert.equal(error, null);
});
