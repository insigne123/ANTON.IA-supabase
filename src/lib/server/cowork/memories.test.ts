import test from 'node:test';
import assert from 'node:assert/strict';
import { CoworkMemoryRefused, forgetCoworkMemory, listCoworkMemories } from './memories';

const ME = '11111111-1111-4111-8111-111111111111';
const TEAMMATE = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-06T12:00:00Z');

type Row = Record<string, unknown>;
/** suplia_memories in memory: equality filters, the «or» of scope and owner, and updates that report what they changed. */
function memories(rows: Row[]) {
  const updates: Array<{ id: unknown; values: Row }> = [];
  const admin = { from: () => {
    const where: Row = {};
    let or: string | null = null;
    let values: Row | null = null;
    const matches = () => rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)
      && (!or || row.scope === 'organization' || `user_id.eq.${row.user_id}` === or.split(',')[1]));
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key, value) => { where[key as string] = value; return chain; },
      or: (filter) => { or = filter as string; return chain; },
      update: (next) => { values = next as Row; return chain; },
      maybeSingle: async () => {
        const found = matches()[0] ?? null;
        if (values && found) { Object.assign(found, values); updates.push({ id: found.id, values }); }
        return { data: found, error: null };
      },
      then: (resolve) => (resolve as (value: unknown) => void)({ data: matches(), error: null }),
    };
    return chain;
  } };
  return { admin: admin as never, updates };
}

const row = (n: number, extra: Row): Row => ({ id: id(n), organization_id: 'org', status: 'approved', memory_type: 'cowork_preference',
  key: null, value: { text: `recuerdo ${n}` }, expires_at: null, updated_at: '2026-10-05T12:00:00Z', ...extra });
const auth = (role: 'owner' | 'admin' | 'member' = 'member') => ({ user: { id: ME }, organizationId: 'org', organizationIds: ['org'], organizationRole: role, supabase: null });

test('the list is what the turns read: yours and the organization\'s, approved and current, never a teammate\'s own', async () => {
  const { admin } = memories([
    row(1, { scope: 'user', user_id: ME, key: 'tono', value: { text: 'tutear a todos' } }),
    row(2, { scope: 'organization', user_id: TEAMMATE }),
    row(3, { scope: 'user', user_id: TEAMMATE }),
    row(4, { scope: 'user', user_id: ME, status: 'proposed' }),
    row(5, { scope: 'user', user_id: ME, expires_at: '2026-10-01T00:00:00Z' }),
    row(6, { scope: 'organization', user_id: ME }),
  ]);
  const list = await listCoworkMemories(auth() as never, admin, NOW);
  assert.deepEqual(list.map(memory => [memory.id, memory.text, memory.scope, memory.mine, memory.canForget]), [
    [id(1), 'tono: tutear a todos', 'personal', true, true],
    [id(2), 'recuerdo 2', 'organization', false, false],
    [id(6), 'recuerdo 6', 'organization', true, true],
  ]);
  assert.equal((await listCoworkMemories(auth('admin') as never, admin, NOW)).find(memory => memory.id === id(2))?.canForget, true);
});

test('forgetting archives the memory; a teammate\'s, or the organization\'s for a member who did not save it, is refused', async () => {
  const { admin, updates } = memories([
    row(1, { scope: 'user', user_id: ME }), row(2, { scope: 'organization', user_id: TEAMMATE }), row(3, { scope: 'user', user_id: TEAMMATE }),
  ]);
  assert.deepEqual(await forgetCoworkMemory(auth() as never, id(1), admin, NOW), { forgotten: true });
  assert.equal(updates[0].values.status, 'archived');
  assert.deepEqual(await forgetCoworkMemory(auth() as never, id(1), admin, NOW), { forgotten: true }, 'twice is harmless');
  await assert.rejects(forgetCoworkMemory(auth() as never, id(2), admin, NOW), (error: unknown) => error instanceof CoworkMemoryRefused && error.status === 403);
  await assert.rejects(forgetCoworkMemory(auth('owner') as never, id(3), admin, NOW), (error: unknown) => error instanceof CoworkMemoryRefused && error.status === 404);
  assert.deepEqual(await forgetCoworkMemory(auth('owner') as never, id(2), admin, NOW), { forgotten: true });
  assert.equal(updates.length, 2);
  await assert.rejects(forgetCoworkMemory(auth() as never, 'nope', admin, NOW));
});
