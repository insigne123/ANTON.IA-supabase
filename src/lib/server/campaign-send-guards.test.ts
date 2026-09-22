import test from 'node:test';
import assert from 'node:assert/strict';
import { findCompanyReply, findNegotiationHold, findCompanySendToday, reserveCompanySendDays } from './campaign-send-guards';

function mockClient(rows: Record<string, unknown[]>, conflict = false) {
  const tables: string[] = [];
  const resolving = { from(table: string) {
    tables.push(table);
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      ilike() { return chain; },
      eq(key: unknown, value: unknown) { if (key === 'organization_id') assert.equal(value, 'org'); return chain; },
      neq() { return chain; },
      not() { return chain; },
      gte() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return { data: null, error: null }; },
      async insert() {
        if (conflict) return { error: { code: '23505' } };
        return { error: null };
      },
      then(resolve: (value: unknown) => void) { resolve({ data: rows[table] || [], error: null }); },
    };
    return chain;
  } };
  return { client: resolving, tables };
}

const scope = { userId: 'owner', organizationId: 'org' };

test('reply from another address of the same company stops the account', async () => {
  const { client } = mockClient({ contacted_leads: [
    { email: 'jefa@acme.cl', company: 'Acme', replied_at: '2026-09-20T10:00:00Z', reply_intent: 'positive' },
  ] });
  const stop = await findCompanyReply(client as never, scope, 'ana@acme.cl', 'Acme');
  assert.equal(stop.stopped, true);
  assert.equal(stop.email, 'jefa@acme.cl');
});

test('exact-address reply is not required: unrelated companies never stop', async () => {
  const { client } = mockClient({ contacted_leads: [
    { email: 'otro@beta.cl', company: 'Beta', replied_at: '2026-09-20T10:00:00Z', reply_intent: 'positive' },
  ] });
  const stop = await findCompanyReply(client as never, scope, 'ana@acme.cl', 'Acme');
  assert.equal(stop.stopped, false);
  assert.equal(stop.truncated, false);
});

test('free-mail senders only match their own address', async () => {
  const { client } = mockClient({ contacted_leads: [
    { email: 'otro@gmail.com', company: null, replied_at: '2026-09-20T10:00:00Z', reply_intent: 'positive' },
  ] });
  const stop = await findCompanyReply(client as never, scope, 'ana@gmail.com', null);
  assert.equal(stop.stopped, false);
});

test('negotiation stage holds the account with its evidence', async () => {
  const client = { from(table: string) {
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      ilike() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      limit() { return chain; },
      then(resolve: (value: unknown) => void) {
        if (table === 'leads') resolve({ data: [{ id: 'lead-1', company: 'Acme' }], error: null });
        else resolve({ data: [{ id: 'lead_saved|lead-1', stage: 'negotiation' }], error: null });
      },
    };
    return chain;
  } };
  const hold = await findNegotiationHold(client as never, scope, 'ana@acme.cl', 'Acme');
  assert.equal(hold.held, true);
  assert.deepEqual(hold.stages, ['negotiation']);
});

test('qualified stage never holds the account', async () => {
  const client = { from(table: string) {
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      ilike() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      limit() { return chain; },
      then(resolve: (value: unknown) => void) {
        if (table === 'leads') resolve({ data: [{ id: 'lead-1', company: 'Acme' }], error: null });
        else resolve({ data: [{ id: 'lead_saved|lead-1', stage: 'qualified' }], error: null });
      },
    };
    return chain;
  } };
  const hold = await findNegotiationHold(client as never, scope, 'ana@acme.cl', 'Acme');
  assert.equal(hold.held, false);
});

test('same-day send to the same company collides before the provider', async () => {
  const { client } = mockClient({ contacted_leads: [
    { email: '-colega@acme.cl', company: 'Acme', sent_at: '2026-09-22T09:00:00Z' },
  ], outbound_dispatches: [] });
  const hit = await findCompanySendToday(client as never, scope, 'ana@acme.cl', 'Acme', '2026-09-22T00:00:00Z');
  assert.equal(hit.collided, true);
  assert.equal(hit.source, 'contacted_leads');
  const { client: other } = mockClient({ contacted_leads: [], outbound_dispatches: [] });
  const clear = await findCompanySendToday(other as never, scope, 'ana@acme.cl', 'Acme', '2026-09-22T00:00:00Z');
  assert.equal(clear.collided, false);
});

test('concurrent reservations conflict instead of double-booking', async () => {
  const { client } = mockClient({}, true);
  await assert.rejects(reserveCompanySendDays(client as never, scope,
    [{ email: 'a@acme.cl', companyKey: 'company:acme', sendDay: '2026-09-22' }],
    { campaignId: '00000000-0000-4000-8000-000000000001', runId: '00000000-0000-4000-8000-000000000002' }),
    /ya reservo esa empresa/);
});

test('truncated replies and CRM scans fail closed, never assert absence', async () => {
  const replies = mockClient({ contacted_leads: Array.from({ length: 200 }, () => ({ email: 'x@beta.cl', company: 'Beta' })) });
  await assert.rejects(findCompanyReply(replies.client as never, scope, 'ana@acme.cl', 'Acme'), /incompleto/);
  const leads = mockClient({ leads: Array.from({ length: 500 }, (_, i) => ({ id: String(i), company: 'Beta' })) });
  await assert.rejects(findNegotiationHold(leads.client as never, scope, 'ana@acme.cl', 'Acme'), /toda/);
});

test('company aliases and mixed-case CRM peers stop the account', async () => {
  const fixture = mockClient({
    contacted_leads: [{ email: 'jefa@acme.cl', company: null, replied_at: '2026-09-20T10:00:00Z' }],
    leads: [{ id: 'peer', email: 'JEFA@ACME.CL', company: 'ACME SPA' }],
    unified_crm_data: [{ id: 'lead_saved|peer', stage: 'negotiation' }],
  });
  assert.equal((await findCompanyReply(fixture.client as never, scope, 'ana@acme.cl', 'Acme')).stopped, true);
  assert.equal((await findNegotiationHold(fixture.client as never, scope, 'ana@acme.cl', 'Acme')).held, true);
});

test('dispatch alone collides even with a named company and the same recipient', async () => {
  const fixture = mockClient({ outbound_dispatches: [{ metadata: { recipient: { email: 'ana@acme.cl' } }, completed_at: '2026-09-22T12:00:00Z' }] });
  assert.equal((await findCompanySendToday(fixture.client as never, scope, 'ana@acme.cl', 'Acme', '2026-09-22T03:00:00Z')).collided, true);
});
