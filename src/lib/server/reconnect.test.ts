import assert from 'node:assert/strict';
import test from 'node:test';
import { markReconnect, prepareReconnectDraft, readReconnectAlerts, ReconnectError, saveReconnectSettings } from './reconnect';

const now = new Date('2026-10-19T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const scope = { organizationId: 'org-1', userId: 'user-ana' };

type Tables = Record<string, any[]>;

/** A small in-memory PostgREST: filters, order, limit, upsert, update and delete, with errors per table. */
function memory(tables: Tables, options: { missing?: string[]; missingColumn?: string } = {}) {
  const log: Array<{ table: string; action: string; payload?: any }> = [];
  const from = (table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action = 'select'; let payload: any = null; let columns = '';
    const run = () => {
      log.push({ table, action, payload });
      if (options.missing?.includes(table)) return { data: null, error: { code: '42P01', message: 'missing table' } };
      if (options.missingColumn && action === 'select' && columns.includes(options.missingColumn)) return { data: null, error: { code: '42703', message: 'missing column' } };
      const rows = tables[table] ||= [];
      const match = (row: any) => filters.every(filter => filter(row));
      if (action === 'upsert') {
        const index = rows.findIndex(row => row.user_id === payload.user_id && row.contacted_id === payload.contacted_id);
        if (index >= 0) rows[index] = { ...rows[index], ...payload }; else rows.push({ ...payload });
        return { data: null, error: null };
      }
      if (action === 'update') { rows.filter(match).forEach(row => Object.assign(row, payload)); return { data: null, error: null }; }
      if (action === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return { data: null, error: null }; }
      return { data: rows.filter(match), error: null };
    };
    const builder: any = {
      select: (value: string) => { columns = value || ''; return builder; },
      upsert: (value: any) => { action = 'upsert'; payload = value; return builder; },
      update: (value: any) => { action = 'update'; payload = value; return builder; },
      delete: () => { action = 'delete'; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return builder; },
      gte: (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return builder; },
      not: (key: string, _op: string, value: unknown) => { filters.push(row => row[key] !== value && row[key] !== undefined); return builder; },
      order: () => builder, limit: () => builder,
      maybeSingle: async () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { client: { from } as any, log, tables };
}

const contacted = (patch: Record<string, unknown>) => ({
  organization_id: 'org-1', user_id: 'user-ana', lead_id: `lead-${patch.id}`, name: `Persona ${patch.id}`, company: `Empresa ${patch.id}`,
  email: `${patch.id}@empresa${patch.id}.cl`, sent_at: daysAgo(90), replied_at: null, reply_intent: null, conversation_resolved_at: null,
  subject: 'Propuesta de aseo', ...patch,
});

test('the alerts read only the person\'s own conversations in this workspace, with company signals and their setting', async () => {
  const { client } = memory({
    contacted_leads: [
      contacted({ id: 'a', conversation_resolved_at: daysAgo(80), conversation_close_outcome: 'no_deal' }),
      contacted({ id: 'b', user_id: 'user-otro' }),
      contacted({ id: 'c', organization_id: 'org-2' }),
      contacted({ id: 'd', company: 'Acme', sent_at: daysAgo(20) }),
    ],
    commercial_opportunities: [{ organization_id: 'org-1', kind: 'hiring', title: 'Jefe de bodega', company_name: 'ACME SpA', first_seen_at: daysAgo(2), status: 'new' }],
    profiles: [{ id: 'user-ana', signatures: { reconnect: { afterDays: 60 } } }],
    contact_reconnect_marks: [],
  });
  const result = await readReconnectAlerts(client, scope, now);
  assert.deepEqual(result.alerts.map(alert => [alert.contactedId, alert.kind]), [['d', 'signal'], ['a', 'closed']], 'news first');
  assert.equal(result.total, 2);
  assert.equal(result.afterDays, 60);
  assert.equal(result.canPostpone, true);
});

test('before the migration: without the outcome column and the marks table, the alerts still work and cannot be postponed', async () => {
  const { client } = memory({ contacted_leads: [contacted({ id: 'a' })], profiles: [] }, { missing: ['contact_reconnect_marks'], missingColumn: 'conversation_close_outcome' });
  const result = await readReconnectAlerts(client, scope, now);
  assert.deepEqual(result.alerts.map(alert => alert.kind), ['no_reply']);
  assert.equal(result.canPostpone, false);
});

test('postpone, «No retomar» and undo touch only the owner\'s conversation', async () => {
  const { client, tables } = memory({ contacted_leads: [contacted({ id: 'a' }), contacted({ id: 'z', user_id: 'user-otro' })], contact_reconnect_marks: [] });
  const snoozed = await markReconnect(client, scope, { contactedId: 'a', action: 'snooze' }, now);
  assert.equal(snoozed.state, 'snoozed');
  assert.equal(snoozed.until, new Date(now.getTime() + 30 * 86_400_000).toISOString());
  await markReconnect(client, scope, { contactedId: 'a', action: 'dismiss' }, now);
  assert.deepEqual(tables.contact_reconnect_marks.map(row => [row.contacted_id, row.state, row.until]), [['a', 'dismissed', null]]);
  await markReconnect(client, scope, { contactedId: 'a', action: 'restore' }, now);
  assert.equal(tables.contact_reconnect_marks.length, 0);
  await assert.rejects(markReconnect(client, scope, { contactedId: 'z', action: 'dismiss' }, now), (error: any) => error instanceof ReconnectError && error.status === 404);
});

test('the setting keeps the other preferences of the profile', async () => {
  const { client, tables } = memory({ profiles: [{ id: 'user-ana', signatures: { gmail: { enabled: true } } }] });
  await saveReconnectSettings(client, scope, 90);
  assert.deepEqual(tables.profiles[0].signatures, { gmail: { enabled: true }, reconnect: { afterDays: 90 } });
  await assert.rejects(saveReconnectSettings(client, scope, 45), /30, 60 o 90/);
});

test('«Retomar» asks the writer for a new email with the reason, once a day, and sends nothing', async () => {
  const { client } = memory({ contacted_leads: [contacted({ id: 'a', conversation_resolved_at: daysAgo(80), conversation_close_outcome: 'keep' })] });
  const calls: any[] = [];
  const result = await prepareReconnectDraft(client, scope, 'a', {
    findSnapshot: async (_scope, leadId) => (leadId === 'lead-a' ? 'snap-1' : null),
    createDraft: async (input) => { calls.push(input); return { status: 'drafted', draft: { draftId: 'draft-9' } }; },
  }, now);
  assert.deepEqual(result, { status: 'drafted', draftId: 'draft-9' });
  assert.equal(calls[0].snapshotId, 'snap-1');
  assert.equal(calls[0].idempotencyKey, 'reconnect:a:2026-10-19');
  assert.match(calls[0].userInstruction, /hace 90 días sobre «Propuesta de aseo»\. Quedamos en retomarlo más adelante\./);
});

test('«Retomar» without research sends the person to research; never for whoever said no', async () => {
  const { client } = memory({ contacted_leads: [
    contacted({ id: 'a' }),
    contacted({ id: 'n', conversation_resolved_at: daysAgo(80), conversation_close_outcome: 'not_interested' }),
  ] });
  const deps = { findSnapshot: async () => null, createDraft: async () => { throw new Error('not called'); } };
  assert.deepEqual(await prepareReconnectDraft(client, scope, 'a', deps, now), { status: 'needs_research', leadId: 'lead-a' });
  await assert.rejects(prepareReconnectDraft(client, scope, 'n', deps, now), (error: any) => error.status === 409);
  await assert.rejects(prepareReconnectDraft(client, scope, 'nadie', deps, now), (error: any) => error.status === 404);
});
