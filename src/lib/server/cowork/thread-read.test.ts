import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkReplyThread } from './thread-read';
import { COWORK_DOMAIN_ENTITY_READS, COWORK_DOMAIN_FIXED_READS, isCoworkDomainRead } from '@/lib/cowork/domain-reads';
import { coworkActionInfo, coworkReadFinding } from '@/lib/cowork/presentation';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const ID = '00000000-0000-4000-8000-0000000000c1';
const NOW = Date.parse('2026-09-30T15:00:00Z');
const row = {
  id: ID, lead_id: 'l-1', name: 'Marcela Rojas', email: 'mrojas@sernorte.cl', company: 'Servicios Norte', provider: 'gmail',
  subject: 'Antecedentes laborales en minutos', sent_at: '2026-09-22T14:00:00Z', status: 'sent', delivery_status: 'delivered',
  message_id: 'm-1', thread_id: 't-1', replied_at: '2026-09-28T13:00:00Z', reply_intent: 'meeting_request',
  last_reply_text: 'Hola, me interesa. ¿Podemos hablar el jueves?', conversation_outbound_at: null,
};

/** A client that records what was asked and answers with the given row (or error). */
function recorder(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, (...args: any[]) => any> = {};
  for (const name of ['select', 'eq', 'in', 'order', 'limit']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  chain.maybeSingle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  return { client: { from: (table: string) => { calls.push(['from', table]); return chain; } } as never, calls };
}

test('the thread is read for this person only: their organization, their sends and that one conversation', async () => {
  const { client, calls } = recorder({ data: row });
  const thread = await readCoworkReplyThread(client, scope, ID, undefined, NOW) as { available: boolean; advice: string; reply: { text: string } };
  assert.equal(thread.available, true);
  assert.equal(thread.advice, 'reply');
  assert.match(thread.reply.text, /jueves/);
  assert.deepEqual(calls.filter(call => call[0] === 'from'), [['from', 'contacted_leads']]);
  const filters = calls.filter(call => call[0] === 'eq').map(call => `${call[1]}=${call[2]}`).sort();
  assert.deepEqual(filters, [`id=${ID}`, 'organization_id=org-1', 'user_id=user-1']);
  const columns = String(calls.find(call => call[0] === 'select')![1]);
  assert.match(columns, /last_reply_text/);
  assert.doesNotMatch(columns, /\*/);
});

test('a conversation that is not this person\'s, or no longer exists, is not available and says why', async () => {
  const { client } = recorder({ data: null });
  const result = await readCoworkReplyThread(client, scope, ID, undefined, NOW) as { available: boolean; reason: string; scope: string };
  assert.equal(result.available, false);
  assert.equal(result.scope, 'own_reply_thread');
  assert.match(result.reason, /no es tuya|no existe/);
});

test('a database error is generic and an id that is not a UUID is refused before any query', async () => {
  const failing = recorder({ error: { message: 'relation "contacted_leads" is broken: secret detail' } });
  await assert.rejects(readCoworkReplyThread(failing.client, scope, ID, undefined, NOW), (error: Error) => {
    assert.equal(error.message, 'No se pudo consultar la conversación.');
    return true;
  });
  const untouched = recorder({ data: row });
  await assert.rejects(readCoworkReplyThread(untouched.client, scope, 'not-a-uuid', undefined, NOW));
  assert.deepEqual(untouched.calls, []);
});

test('someone who unsubscribed is not written to, whatever the intent was classified as; a check that fails is unknown, not clear', async () => {
  const asked: string[] = [];
  const unsubscribed = await readCoworkReplyThread(recorder({ data: row }).client, scope, ID, async email => { asked.push(email); return true; }, NOW) as { advice: string; suppressed: boolean | null };
  assert.deepEqual(asked, ['mrojas@sernorte.cl']);
  assert.equal(unsubscribed.suppressed, true);
  assert.equal(unsubscribed.advice, 'unsubscribe_do_not_write');
  const clear = await readCoworkReplyThread(recorder({ data: row }).client, scope, ID, async () => false, NOW) as { advice: string; suppressed: boolean | null };
  assert.equal(clear.suppressed, false);
  assert.equal(clear.advice, 'reply');
  const unknown = await readCoworkReplyThread(recorder({ data: row }).client, scope, ID, async () => { throw new Error('down'); }, NOW) as { advice: string; suppressed: boolean | null };
  assert.equal(unknown.suppressed, null);
  assert.equal(unknown.advice, 'reply');
  const unchecked = await readCoworkReplyThread(recorder({ data: row }).client, scope, ID, undefined, NOW) as { suppressed: boolean | null };
  assert.equal(unchecked.suppressed, null);
});

test('replies.thread is a read by id with its own plan label and finding', () => {
  assert.ok((COWORK_DOMAIN_ENTITY_READS as readonly string[]).includes('replies.thread'));
  assert.ok(!(COWORK_DOMAIN_FIXED_READS as readonly string[]).includes('replies.thread'));
  assert.equal(isCoworkDomainRead('replies.thread'), true);
  assert.equal(coworkActionInfo('replies.thread').label, 'Leyó la conversación con un contacto');
  assert.deepEqual(coworkReadFinding({ action: 'replies.thread', result: { available: true, reply: { text: 'hola' } } }), { count: null, label: 'con su respuesta' });
  assert.deepEqual(coworkReadFinding({ action: 'replies.thread', result: { available: true, reply: null } }), { count: null, label: 'sin respuesta aún' });
  assert.deepEqual(coworkReadFinding({ action: 'replies.thread', result: { available: false } }), { count: null, label: 'no es tuya' });
});
