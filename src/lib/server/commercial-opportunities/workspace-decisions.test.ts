import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyManagers, recordDecision, replyToDecision } from './workspace-decisions';

const ORG = '00000000-0000-4000-8000-000000000001';
const OPP = '00000000-0000-4000-8000-0000000000aa';
const ADMIN = '00000000-0000-4000-8000-000000000010';
const OWNER = '00000000-0000-4000-8000-000000000014';
const ANA = '00000000-0000-4000-8000-000000000011';
const LUIS = '00000000-0000-4000-8000-000000000012';

type Row = Record<string, any>;
/** A service client over tables that records what is written; `canRead` answers opportunity_can_read. */
function fakeClient(tables: Record<string, Row[]>, canRead = true) {
  const writes: Array<{ table: string; rows: Row[] }> = [];
  const client = {
    writes,
    rpc: async () => ({ data: canRead, error: null }),
    from(table: string) {
      let rows = [...(tables[table] || [])];
      const chain: any = {
        select() { return chain; }, limit() { return chain; }, order() { return chain; },
        eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === undefined || row[column] === value); return chain; },
        in(column: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[column])); return chain; },
        upsert(value: Row | Row[]) { writes.push({ table, rows: Array.isArray(value) ? value : [value] }); return Promise.resolve({ data: null, error: null }); },
        async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      };
      return chain;
    },
  };
  return client;
}
const tables = (extra: Record<string, Row[]> = {}) => ({
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de guardias   Municipalidad' }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, responsible_id: ANA }],
  organization_members: [{ organization_id: ORG, user_id: ADMIN, role: 'admin' }, { organization_id: ORG, user_id: OWNER, role: 'owner' }, { organization_id: ORG, user_id: ANA, role: 'member' }, { organization_id: ORG, user_id: LUIS, role: 'member' }],
  ...extra,
});
const scopeOf = (userId: string, role: string) => ({ organizationId: ORG, userId, role });

test('a decision put by a member stays in the activity and tells the administrators and whoever is in charge', async () => {
  const client = fakeClient(tables());
  await recordDecision(client as never, scopeOf(LUIS, 'member'), OPP, { type: 'no_go', text: 'El plazo no alcanza para la garantía', dueAt: '2026-10-25T12:00:00-03:00' });
  const activity = client.writes.find(write => write.table === 'opportunity_activity')!.rows[0];
  assert.deepEqual([activity.kind, activity.body, activity.actor_id], ['decision', 'Propone no postular: El plazo no alcanza para la garantía', LUIS]);
  assert.deepEqual(activity.data, { type: 'no_go', dueAt: '2026-10-25T12:00:00-03:00' });
  const notices = client.writes.find(write => write.table === 'opportunity_notifications')!.rows;
  assert.deepEqual(notices.map(row => row.user_id).sort(), [ADMIN, OWNER, ANA].sort(), 'admins, owner and the responsible; not the one who asked');
  assert.ok(notices.every(row => row.title === 'Propuesta de no postular: Servicio de guardias Municipalidad' && row.kind === 'task' && row.event_key === activity.event_key));
});

test('a request for a decision does not tell the person who made it', async () => {
  const client = fakeClient(tables());
  await recordDecision(client as never, scopeOf(ANA, 'member'), OPP, { type: 'ask', text: 'Quién firma la boleta de garantía', dueAt: null });
  const notices = client.writes.find(write => write.table === 'opportunity_notifications')!.rows;
  assert.deepEqual(notices.map(row => row.user_id).sort(), [ADMIN, OWNER].sort(), 'the responsible asked, so she is not told');
  assert.match(notices[0].title, /^Decisión pedida: /);
});

test('without access to the opportunity nothing is written', async () => {
  const client = fakeClient(tables(), false);
  await assert.rejects(recordDecision(client as never, scopeOf(LUIS, 'member'), OPP, { type: 'ask', text: 'Una duda cualquiera', dueAt: null }), /No encontramos esa oportunidad/);
  assert.equal(client.writes.length, 0);
});

test('an administrator answers the open decision and the person who asked is told; with none open there is nothing to answer', async () => {
  const asked = { id: 'a1', kind: 'decision', body: 'Pide una decisión: Quién firma', actor_id: LUIS, created_at: '2026-10-22T10:00:00Z', data: { type: 'ask', dueAt: null }, organization_id: ORG, opportunity_id: OPP };
  const client = fakeClient(tables({ opportunity_activity: [asked] }));
  await replyToDecision(client as never, scopeOf(ADMIN, 'admin'), OPP, { text: 'Firma Nicolás, con la boleta del banco' });
  const activity = client.writes.find(write => write.table === 'opportunity_activity')!.rows[0];
  assert.deepEqual([activity.kind, activity.body, activity.data], ['decision', 'Respuesta a la decisión: Firma Nicolás, con la boleta del banco', { type: 'reply', to: 'a1' }]);
  const notices = client.writes.find(write => write.table === 'opportunity_notifications')!.rows;
  assert.deepEqual(notices.map(row => row.user_id).sort(), [LUIS, ANA].sort());
  assert.match(notices[0].title, /^Respondieron tu decisión: /);
  const answered = fakeClient(tables({ opportunity_activity: [{ ...asked, id: 'a2', created_at: '2026-10-22T11:00:00Z', data: { type: 'reply' } }, asked] }));
  await assert.rejects(replyToDecision(answered as never, scopeOf(ADMIN, 'admin'), OPP, { text: 'Otra respuesta' }), /No hay una decisión pendiente/);
  assert.equal(answered.writes.length, 0);
});

test('managers are told once per event and never the person who caused it', async () => {
  const client = fakeClient(tables());
  await notifyManagers(client as never, scopeOf(ADMIN, 'admin'), OPP, 'Oportunidad bloqueada', `blocked:${OPP}:3`);
  const rows = client.writes.find(write => write.table === 'opportunity_notifications')!.rows;
  assert.deepEqual(rows.map(row => row.user_id).sort(), [OWNER, ANA].sort());
  assert.ok(rows.every(row => row.event_key === `blocked:${OPP}:3`));
});
