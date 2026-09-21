import test from 'node:test';
import assert from 'node:assert/strict';
import { claimExtensionSend, finishExtensionSend, extensionSendId } from './extension-sends';
function database() {
  const rows = new Map<string, any>();
  return { rows, from() {
    const filters: Array<(row: any) => boolean> = [];
    let insert: any, update: any;
    const query: any = {
      upsert(row: any) { insert = row; return query; }, update(row: any) { update = row; return query; },
      select() { return query; }, eq(key: string, value: any) { filters.push(row => row[key] === value); return query; },
      async single() { const data = [...rows.values()].find(row => filters.every(fn => fn(row))); return { data, error: data ? null : new Error('not found') }; },
      then(resolve: any) {
        if (insert) {
          if (rows.has(insert.id)) return Promise.resolve({ data: [], error: null }).then(resolve);
          const row = { status: 'pending', ...insert }; rows.set(row.id, row);
          return Promise.resolve({ data: [row], error: null }).then(resolve);
        }
        const data = [...rows.values()].filter(row => filters.every(fn => fn(row)));
        if (update) data.forEach(row => Object.assign(row, update));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    }; return query;
  } };
}
const scope = { organizationId: 'org', userId: 'user' };
const lead = { id: 'lead', linkedin_url: 'https://www.linkedin.com/in/ana' };
test('concurrent identical sends grant only one claim and survive a new worker', async () => {
  const db = database();
  const results = await Promise.all([claimExtensionSend(scope, lead, 'Hola', db as any), claimExtensionSend(scope, lead, 'Hola', db as any)]);
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal((await claimExtensionSend(scope, lead, 'Hola', db as any)).claimed, false);
  assert.notEqual(extensionSendId(scope, lead.linkedin_url, 'Hola'), extensionSendId({ ...scope, organizationId: 'other' }, lead.linkedin_url, 'Hola'));
});
test('only scoped claim holder can finish; terminal result is immutable and sync idempotent', async () => {
  const db = database();
  const claim = await claimExtensionSend(scope, lead, 'Hola', db as any);
  const result = { id: claim.id, claimToken: claim.claimToken!, status: 'confirmed' as const, eventId: 'event' };
  await assert.rejects(finishExtensionSend({ ...scope, userId: 'other' }, result, db as any));
  await assert.rejects(finishExtensionSend(scope, { ...result, claimToken: 'wrong' }, db as any));
  assert.equal((await finishExtensionSend(scope, result, db as any)).status, 'confirmed');
  assert.equal((await finishExtensionSend(scope, result, db as any)).status, 'confirmed');
  await assert.rejects(finishExtensionSend(scope, { ...result, status: 'not_sent' }, db as any));
  assert.equal((await claimExtensionSend(scope, lead, 'Hola', db as any)).claimed, false);
});
