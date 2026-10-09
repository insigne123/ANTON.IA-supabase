import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkQueueKey, readCoworkQueue } from './queued-message';
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
test('queued message and admission identity survive reload only in the exact user/workspace/thread scope', () => {
  const key = coworkQueueKey({ userId: id(1), organizationId: id(2), rootId: id(3) })!;
  const values = new Map([[key, JSON.stringify({ text: 'Continuar con la misma selección', requestId: id(4) })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(readCoworkQueue(storage, key)?.requestId, id(4));
  assert.equal(readCoworkQueue(storage, coworkQueueKey({ userId: id(1), organizationId: id(9), rootId: id(3) })), null);
  assert.equal(coworkQueueKey({ userId: id(1), rootId: id(3) }), null);
  values.set(key, '{broken'); assert.equal(readCoworkQueue(storage, key), null);
});
