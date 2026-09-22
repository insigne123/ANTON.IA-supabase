import assert from 'node:assert/strict';
import test from 'node:test';
import { recordDispatchTrackingEvent } from './email-tracking-events';

function clientFixture() {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const values: Record<string, any> = {
    outbound_dispatches: { id: '00000000-0000-4000-8000-000000000001', organization_id: 'org', user_id: 'user', provider: 'gmail', provider_message_id: 'message-exact', status: 'sent', metadata: {} },
    contacted_leads: { id: 'contact-exact', lead_id: 'lead', mission_id: null, provider: 'gmail', thread_key: 'thread-key', opened_at: null, click_count: 3, engagement_score: 5 },
  };
  return {
    calls,
    from(table: string) {
      const query: any = {
        select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return this; },
        eq(...args: unknown[]) { calls.push({ table, method: 'eq', args }); return this; },
        is(...args: unknown[]) { calls.push({ table, method: 'is', args }); return this; },
        update(...args: unknown[]) { calls.push({ table, method: 'update', args }); return this; },
        insert(...args: unknown[]) { calls.push({ table, method: 'insert', args }); return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: values[table], error: null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return query;
    },
  };
}

test('tracking events resolve exact sent dispatch to exact provider message row', async () => {
  const client = clientFixture();
  const result = await recordDispatchTrackingEvent(client, { dispatchKey: '00000000-0000-4000-8000-000000000001', kind: 'email_clicked', destination: 'https://example.test/path' });
  assert.deepEqual(result, { tracked: true, contactedId: 'contact-exact', firstOpen: false });
  assert.ok(client.calls.some(call => call.table === 'contacted_leads' && call.method === 'eq' && call.args[0] === 'message_id' && call.args[1] === 'message-exact'));
  const event = client.calls.find(call => call.table === 'email_events' && call.method === 'insert')?.args[0] as any;
  assert.equal(event.contacted_id, 'contact-exact');
  assert.equal(event.message_id, 'message-exact');
  assert.equal(event.event_source, 'dispatch_tracking');
  const update = client.calls.find(call => call.method === 'update')?.args[0] as any;
  assert.equal('delivery_status' in update, false);
  assert.equal('evaluation_status' in update, false);
});

test('tracking ignores arbitrary or malformed public dispatch keys', async () => {
  const client = clientFixture();
  assert.deepEqual(await recordDispatchTrackingEvent(client, { dispatchKey: 'x', kind: 'email_opened' }), { tracked: false });
  assert.equal(client.calls.length, 0);
});
