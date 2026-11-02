import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { ContactCallError, readCallContacts, readCallsToday, readLastCalls, readPendingCalls, recordCallOutcome, startContactCall } from './contact-calls';

const ORG = 'org-1';
const ANA = { organizationId: ORG, userId: 'u-ana' };
const LEO = { organizationId: ORG, userId: 'u-leo' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-02T15:00:00Z');

const seed = () => ({
  enriched_leads: [
    { id: 'lead-1', organization_id: ORG, user_id: 'u-ana', full_name: 'Ana Rojas', company_name: 'Minera Sur', email: 'Ana@Sur.cl', source_provider_id: 'apollo-1', primary_phone: '+56 9 1111 1111', phone_numbers: null },
    { id: 'lead-2', organization_id: ORG, user_id: 'u-ana', full_name: 'Pedro Díaz', company_name: 'Logística Norte', email: null, source_provider_id: 'apollo-2', primary_phone: null, phone_numbers: [{ sanitized_number: '+56922222222' }] },
    { id: 'lead-3', organization_id: ORG, user_id: 'u-ana', full_name: 'Sin Teléfono', company_name: 'X', email: 'x@x.cl', source_provider_id: null, primary_phone: 'Not Found', phone_numbers: [] },
    { id: 'lead-4', organization_id: ORG, user_id: 'u-ana', full_name: 'Carla Pinto', company_name: 'Retail Sur', email: 'carla@retail.cl', source_provider_id: null, primary_phone: '+56933333333', phone_numbers: null },
    { id: 'lead-other', organization_id: 'org-2', user_id: 'u-x', full_name: 'De Otra Empresa', company_name: 'Otra', email: 'otra@otra.cl', source_provider_id: 'apollo-9', primary_phone: '+56999999999', phone_numbers: null },
  ],
  contact_calls: [] as any[],
});

test('a call keeps the saved contact as it is in the database, never what the request says, and is written once', async () => {
  const { client, tables } = memory(seed());
  const started = await startContactCall(client, ANA, { id: id(1), channel: 'call', leadId: 'lead-1', name: 'Otro Nombre', company: 'Otra' }, NOW);
  assert.deepEqual(started, { id: id(1), leadId: 'lead-1' });
  await startContactCall(client, ANA, { id: id(1), channel: 'call', leadId: 'lead-1' }, NOW);
  assert.equal(tables.contact_calls.length, 1, 'a retried request writes it once');
  const row = tables.contact_calls[0];
  assert.equal(row.contact_name, 'Ana Rojas');
  assert.equal(row.contact_company, 'Minera Sur');
  assert.equal(row.contact_email, 'ana@sur.cl');
  assert.equal(row.user_id, 'u-ana');
  assert.equal(row.organization_id, ORG);
  assert.equal(row.outcome ?? null, null);
});

test('from a search result the call finds the saved contact by the provider\'s id; another company\'s contact is never linked', async () => {
  const { client, tables } = memory(seed());
  await startContactCall(client, ANA, { id: id(2), channel: 'whatsapp', providerPersonId: 'apollo-2', name: 'Pedro' }, NOW);
  assert.equal(tables.contact_calls[0].lead_id, 'lead-2');
  await startContactCall(client, ANA, { id: id(3), channel: 'call', leadId: 'lead-other', name: 'Alguien', company: 'Empresa' }, NOW);
  const foreign = tables.contact_calls.find(row => row.id === id(3));
  assert.equal(foreign.lead_id, null);
  assert.equal(foreign.contact_name, 'Alguien', 'without a saved contact, the name the screen showed');
  await startContactCall(client, ANA, { id: id(4), channel: 'call', providerPersonId: 'apollo-9', name: 'Nadie' }, NOW);
  assert.equal(tables.contact_calls.find(row => row.id === id(4)).lead_id, null);
});

test('a call needs a real id and channel', async () => {
  const { client } = memory(seed());
  await assert.rejects(startContactCall(client, ANA, { id: 'abc', channel: 'call' }), (error: unknown) => error instanceof ContactCallError && error.status === 400);
  await assert.rejects(startContactCall(client, ANA, { id: id(5), channel: 'fax' as any }), (error: unknown) => error instanceof ContactCallError && error.status === 400);
});

test('the result is saved only on the person\'s own call; a meeting leaves the saved contact in the pipeline', async () => {
  const { client, tables } = memory(seed());
  await startContactCall(client, ANA, { id: id(6), channel: 'call', leadId: 'lead-1' }, NOW);
  await startContactCall(client, ANA, { id: id(7), channel: 'call', name: 'Sin ficha' }, NOW);
  const crm: any[] = [];
  const syncCrm = async (_client: unknown, update: any) => { crm.push(update); };
  await assert.rejects(recordCallOutcome(client, LEO, id(6), { outcome: 'answered' }, { syncCrm }, NOW), (error: unknown) => error instanceof ContactCallError && error.status === 404);
  await assert.rejects(recordCallOutcome(client, ANA, id(6), { outcome: 'maybe' as any }, { syncCrm }, NOW), (error: unknown) => error instanceof ContactCallError && error.status === 400);

  const result = await recordCallOutcome(client, ANA, id(6), { outcome: 'meeting', note: '  Martes 10:00  ' }, { syncCrm }, NOW);
  assert.deepEqual(result, { id: id(6), outcome: 'meeting', pipeline: true });
  const row = tables.contact_calls.find(item => item.id === id(6));
  assert.equal(row.outcome, 'meeting');
  assert.equal(row.note, 'Martes 10:00');
  assert.equal(row.outcome_at, NOW.toISOString());
  assert.deepEqual(crm, [{ organizationId: ORG, leadId: 'lead-1', stage: 'meeting', lastAutopilotEvent: 'call_meeting', nextAction: 'Preparar la reunión', nextActionType: 'meeting' }]);

  const noLead = await recordCallOutcome(client, ANA, id(7), { outcome: 'meeting' }, { syncCrm }, NOW);
  assert.equal(noLead.pipeline, false, 'without a saved contact there is nothing to put in the pipeline');
  assert.equal(crm.length, 1);
  const answered = await recordCallOutcome(client, ANA, id(6), { outcome: 'answered' }, { syncCrm }, NOW);
  assert.equal(answered.pipeline, false);
});

test('«Hoy» lists the person\'s recent calls without a result and counts who waits for a call', async () => {
  const data = seed();
  data.contact_calls.push(
    { id: id(10), organization_id: ORG, user_id: 'u-ana', lead_id: 'lead-1', channel: 'call', contact_name: 'Ana Rojas', contact_company: 'Minera Sur', outcome: null, outcome_at: null, started_at: '2026-11-02T14:00:00Z' },
    { id: id(11), organization_id: ORG, user_id: 'u-ana', lead_id: 'lead-2', channel: 'call', contact_name: 'Pedro Díaz', contact_company: null, outcome: 'no_answer', outcome_at: '2026-11-02T13:00:00Z', started_at: '2026-11-02T12:59:00Z' },
    { id: id(12), organization_id: ORG, user_id: 'u-ana', lead_id: 'lead-4', channel: 'whatsapp', contact_name: 'Carla Pinto', contact_company: null, outcome: 'answered', outcome_at: '2026-11-01T13:00:00Z', started_at: '2026-11-01T12:00:00Z' },
    { id: id(13), organization_id: ORG, user_id: 'u-ana', lead_id: null, channel: 'call', contact_name: 'Vieja', contact_company: null, outcome: null, outcome_at: null, started_at: '2026-10-25T12:00:00Z' },
    { id: id(14), organization_id: ORG, user_id: 'u-leo', lead_id: null, channel: 'call', contact_name: 'De Leo', contact_company: null, outcome: null, outcome_at: null, started_at: '2026-11-02T14:30:00Z' },
  );
  const { client } = memory(data);
  const pending = await readPendingCalls(client, ANA, NOW);
  assert.deepEqual(pending.map(row => row.id), [id(10)], 'only her own, without a result, from the last three days');
  assert.deepEqual(pending[0], { id: id(10), channel: 'call', name: 'Ana Rojas', company: 'Minera Sur', leadId: 'lead-1', startedAt: '2026-11-02T14:00:00Z' });

  const today = await readCallsToday(client, ANA, NOW);
  // lead-1 was called without a result yet, lead-2 did not answer, lead-4 answered, lead-3 has no usable phone.
  assert.equal(today.toCall, 2);
  assert.equal(today.partial, false);

  const last = await readLastCalls(client, ORG, ['lead-1', 'lead-4', 'lead-3']);
  assert.deepEqual(last.get('lead-4'), { outcome: 'answered', channel: 'whatsapp', at: '2026-11-01T13:00:00Z' });
  assert.deepEqual(last.get('lead-1'), { outcome: null, channel: 'call', at: '2026-11-02T14:00:00Z' });
  assert.equal(last.has('lead-3'), false);
});

test('the goal counts each person reached by phone or WhatsApp once, and never a wrong number', async () => {
  const data = seed();
  const call = (n: number, user: string, outcome: string | null, at: string, extra: Record<string, unknown> = {}) => ({
    id: id(n), organization_id: ORG, user_id: user, lead_id: null, contact_email: null, channel: 'call', outcome, outcome_at: outcome ? at : null, started_at: at, ...extra,
  });
  data.contact_calls.push(
    call(20, 'u-ana', 'answered', '2026-11-02T12:00:00Z', { contact_email: 'ana@sur.cl', lead_id: 'lead-1' }),
    call(21, 'u-ana', 'no_answer', '2026-11-02T12:30:00Z', { lead_id: 'lead-2' }),
    call(22, 'u-ana', 'wrong_number', '2026-11-02T13:00:00Z', { lead_id: 'lead-4', contact_email: 'carla@retail.cl' }),
    call(23, 'u-ana', null, '2026-11-02T13:30:00Z'),
    call(24, 'u-leo', 'meeting', '2026-11-02T14:00:00Z', { channel: 'whatsapp' }),
    call(25, 'u-ana', 'answered', '2026-10-20T14:00:00Z', { contact_email: 'old@x.cl' }),
  );
  const { client } = memory(data);
  const range = { from: '2026-11-02T03:00:00Z', to: '2026-11-09T03:00:00Z' };
  const all = await readCallContacts(client, ORG, range);
  assert.deepEqual(all.map(row => [row.userId, row.key, row.channel, row.outcome]), [
    ['u-ana', 'ana@sur.cl', 'call', 'answered'],
    ['u-ana', 'lead:lead-2', 'call', 'no_answer'],
    ['u-leo', `call:${id(24)}`, 'whatsapp', 'meeting'],
  ]);
  assert.deepEqual((await readCallContacts(client, ORG, range, 'u-leo')).map(row => row.userId), ['u-leo']);
});

test('before the migration every reader answers as if nobody had called, and a call cannot start', async () => {
  const { client } = memory(seed(), { missing: ['contact_calls'] });
  assert.deepEqual(await readPendingCalls(client, ANA, NOW), []);
  assert.equal((await readLastCalls(client, ORG, ['lead-1'])).size, 0);
  assert.deepEqual(await readCallContacts(client, ORG, { from: '2026-11-02T03:00:00Z', to: '2026-11-09T03:00:00Z' }), []);
  await assert.rejects(startContactCall(client, ANA, { id: id(30), channel: 'call', leadId: 'lead-1' }, NOW),
    (error: unknown) => error instanceof ContactCallError && error.status === 503 && /aún no está disponible/.test(error.message));
});
