import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyReport, deliverWeeklyReport, readOpportunityManagers, reportRoles, saveOpportunityManagers, saveReportEmail } from './weekly-report';

/** The tables in memory, with the query methods the report uses. A table listed in `missing` answers as not created yet. */
function memory(seed: Record<string, any[]>, missing: string[] = []) {
  const tables: Record<string, any[]> = { weekly_reports: [], organization_report_roles: [], ...seed };
  let serial = 0;
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any; conflict?: string[] } = { kind: 'select' };
    let one: 'single' | 'maybe' | null = null; let limit = Infinity; let range: [number, number] | null = null;
    const run = () => {
      if (missing.includes(name)) return { data: null, error: { code: '42P01', message: 'missing' } };
      const rows = tables[name] ||= [];
      if (action.kind === 'insert' || action.kind === 'upsert') {
        const values = (Array.isArray(action.values) ? action.values : [action.values]).map((value: any) => ({ id: `${name}-${++serial}`, ...value }));
        const written: any[] = [];
        for (const value of values) {
          const clash = action.conflict && rows.find(row => action.conflict!.every(key => row[key] === value[key]));
          if (clash) { Object.assign(clash, value, { id: clash.id }); written.push(clash); continue; }
          rows.push(value); written.push(value);
        }
        return { data: one ? written[0] ?? null : written, error: null };
      }
      const found = rows.filter(row => filters.every(filter => filter(row)));
      if (action.kind === 'update') { found.forEach(row => Object.assign(row, action.values)); return { data: null, error: null }; }
      if (action.kind === 'delete') { tables[name] = rows.filter(row => !found.includes(row)); return { data: null, error: null }; }
      const page = range ? found.slice(range[0], range[1] + 1) : found.slice(0, limit);
      if (one === 'single') return page.length ? { data: page[0], error: null } : { data: null, error: { code: 'PGRST116' } };
      if (one === 'maybe') return { data: page[0] ?? null, error: null };
      return { data: page, error: null };
    };
    const value = (row: any, key: string) => key.split('->').reduce((current, part) => current?.[part.replace(/^>/, '')], row);
    const chain: any = {
      select: () => chain,
      insert: (values: any) => { action = { kind: 'insert', values }; return chain; },
      upsert: (values: any, options: any) => { action = { kind: 'upsert', values, conflict: options?.onConflict?.split(',') }; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      delete: () => { action = { kind: 'delete' }; return chain; },
      eq: (key: string, expected: any) => { filters.push(row => String(value(row, key)) === String(expected)); return chain; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return chain; },
      gte: (key: string, bound: any) => { filters.push(row => row[key] != null && Date.parse(row[key]) >= Date.parse(bound)); return chain; },
      lt: (key: string, bound: any) => { filters.push(row => row[key] != null && Date.parse(row[key]) < Date.parse(bound)); return chain; },
      not: (key: string) => { filters.push(row => value(row, key) != null); return chain; },
      order: () => chain,
      limit: (n: number) => { limit = n; return chain; },
      range: (fromIndex: number, toIndex: number) => { range = [fromIndex, toIndex]; return chain; },
      single: () => { one = 'single'; return chain; },
      maybeSingle: () => { one = 'maybe'; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  };
  return { tables, client: { from } as any };
}

const ORG = 'org-1';
const NOW = new Date('2026-10-20T12:00:00.000Z'); // Monday 20 Oct, 09:00 in Chile: last week is 12–18 Oct.
const dispatch = (id: string, userId: string, at: string, email: string) => ({ id, organization_id: ORG, user_id: userId, status: 'sent', channel: 'email', completed_at: at,
  reconciliation_details: null, metadata: { recipient: { email } } });
const reply = (id: string, userId: string, at: string, intent: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: ORG, user_id: userId, email: `${id}@empresa.cl`,
  name: `Persona ${id}`, company: 'Retail Sur', reply_intent: intent, replied_at: at, conversation_resolved_at: null, conversation_outbound_at: null, data: {}, ...extra });
const seed = () => ({
  organization_members: [{ organization_id: ORG, user_id: 'u-admin', role: 'admin' }, { organization_id: ORG, user_id: 'u-ana', role: 'member' }],
  profiles: [{ id: 'u-admin', full_name: 'Nicolás Yarur', email: 'nico@axis.cl', signatures: { weekly_report: { email: true }, other: 1 } },
    { id: 'u-ana', full_name: 'Ana Soto', email: 'ana@axis.cl', signatures: {} }],
  outbound_dispatches: [
    dispatch('d1', 'u-admin', '2026-10-13T15:00:00Z', 'a@x.cl'), dispatch('d2', 'u-admin', '2026-10-14T15:00:00Z', 'b@x.cl'), dispatch('d3', 'u-admin', '2026-10-15T15:00:00Z', 'b@x.cl'),
    dispatch('d4', 'u-admin', '2026-10-07T15:00:00Z', 'c@x.cl'), // the week before
    dispatch('d5', 'u-ana', '2026-10-16T15:00:00Z', 'd@x.cl'),
  ],
  contacted_leads: [
    reply('r1', 'u-admin', '2026-10-15T18:00:00Z', 'meeting_request'),
    reply('r2', 'u-admin', '2026-10-16T18:00:00Z', 'auto_reply'),
    reply('r3', 'u-admin', '2026-10-17T18:00:00Z', 'positive', { conversation_outbound_at: '2026-10-18T12:00:00Z' }), // already answered
    { id: 'k1', organization_id: ORG, user_id: 'u-admin', name: 'Rosa Díaz', company: 'Logística Norte', data: { commitment: { title: 'Demo', dueAt: '2026-10-23T13:00:00Z' } } },
    { id: 'k2', organization_id: ORG, user_id: 'u-admin', name: 'Hecho', company: null, data: { commitment: { title: 'Ya', dueAt: '2026-10-21T13:00:00Z', completedAt: '2026-10-19T10:00:00Z' } } },
  ],
  commercial_opportunities: [
    { id: 'o1', organization_id: ORG, kind: 'tender', title: 'Aseo hospital', buyer_name: 'Hospital de Talca', deadline_at: '2026-10-22T20:00:00Z', amount: 800000000, currency: 'CLP', created_at: '2026-10-14T10:00:00Z', data: { evaluation: 'recommended' } },
    { id: 'o2', organization_id: ORG, kind: 'compra_agil', title: 'Guardias', buyer_name: 'Municipalidad', deadline_at: '2026-10-24T20:00:00Z', amount: null, currency: null, created_at: '2026-10-15T10:00:00Z', data: { evaluation: 'review' } },
    { id: 'o3', organization_id: ORG, kind: 'tender', title: 'Descartada', buyer_name: 'X', deadline_at: '2026-10-23T20:00:00Z', amount: null, currency: null, created_at: '2026-10-15T10:00:00Z', data: { evaluation: 'excluded' } },
  ],
  opportunity_work: [{ organization_id: ORG, opportunity_id: 'o1', state: 'working', updated_at: '2026-10-16T10:00:00Z' }],
});
const canSee = async () => true;

test('«Tu semana» counts confirmed sends, people and replies against the week before, and lists what waits', async () => {
  const { client } = memory(seed(), ['contact_touches']);
  const { report, admin } = await buildWeeklyReport(client, { organizationId: ORG, userId: 'u-admin' }, { which: 'previous', canSeeOpportunities: canSee, now: NOW });
  assert.equal(admin, true);
  assert.deepEqual(report.roles, ['personal', 'team', 'opportunities'], 'an admin with no managers named also gets Oportunidades');
  assert.equal(report.name, 'Nicolás');
  assert.deepEqual([report.personal.sent, report.personal.contacted], [{ now: 3, before: 1 }, { now: 2, before: 1 }]);
  assert.deepEqual([report.personal.replies.now, report.personal.meetings], [2, 1], 'an auto-reply is not a reply');
  assert.deepEqual(report.personal.pending.map(item => item.id), ['r1'], 'answered conversations do not wait');
  assert.deepEqual(report.personal.commitments.map(item => item.title), ['Demo'], 'a done commitment is not listed');
  assert.equal(report.personal.touches, null, 'without «Llamadas y LinkedIn» the report goes on');
  assert.deepEqual(report.team!.members.map(member => [member.name, member.sent, member.pending]), [['Nicolás Yarur', 3, 1], ['Ana Soto', 1, 0]]);
  assert.deepEqual(report.opportunities!.found, { total: 2, recommended: 1, byKind: [{ kind: 'tender', label: 'Licitaciones', count: 1 }, { kind: 'compra_agil', label: 'Compras Ágiles', count: 1 }] });
  assert.deepEqual(report.opportunities!.closing.map(item => [item.id, item.assigned]), [['o1', true], ['o2', false]], 'an excluded one does not close');
  assert.equal(report.opportunities!.unassignedClosing, 1);
});

test('the roles: a member has only their week; a named manager gets Oportunidades and the admins stop getting it', async () => {
  const { client, tables } = memory(seed());
  const member = await reportRoles(client, { organizationId: ORG, userId: 'u-ana' }, canSee);
  assert.deepEqual(member.roles, ['personal']);
  await assert.rejects(saveOpportunityManagers(client, { organizationId: ORG, userId: 'u-ana' }, ['u-ana']), /Solo un administrador/);
  await assert.rejects(saveOpportunityManagers(client, { organizationId: ORG, userId: 'u-admin' }, ['00000000-0000-4000-8000-000000000009']), /Elige personas/);
  await saveOpportunityManagers(client, { organizationId: ORG, userId: 'u-admin' }, ['u-ana']);
  assert.deepEqual(tables.organization_report_roles.map(row => [row.user_id, row.role, row.assigned_by]), [['u-ana', 'opportunities', 'u-admin']]);
  assert.deepEqual((await reportRoles(client, { organizationId: ORG, userId: 'u-ana' }, canSee)).roles, ['personal', 'opportunities']);
  assert.deepEqual((await reportRoles(client, { organizationId: ORG, userId: 'u-admin' }, canSee)).roles, ['personal', 'team']);
  assert.deepEqual((await reportRoles(client, { organizationId: ORG, userId: 'u-ana' }, async () => false)).roles, ['personal'], 'only whoever may see Oportunidades');
  await assert.rejects(reportRoles(client, { organizationId: ORG, userId: 'u-stranger' }, canSee), /No perteneces/);
  // Before the migration, nobody is a manager and the admins keep the section.
  const before = memory(seed(), ['organization_report_roles']);
  assert.deepEqual(await readOpportunityManagers(before.client, ORG), []);
});

test('Monday: stored once, sent once from the person\'s own mailbox, and only to whoever turned it on', async () => {
  const { client, tables } = memory(seed());
  const sent: any[] = [];
  const send = async (input: any) => { sent.push(input); return { ok: true as const }; };
  const first = await deliverWeeklyReport(client, { organizationId: ORG, userId: 'u-admin' }, { send, appUrl: 'https://app.example', canSeeOpportunities: canSee, now: NOW });
  assert.equal(first.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'nico@axis.cl');
  assert.equal(sent[0].subject, 'Tu informe semanal · 12–18 oct');
  assert.equal(tables.weekly_reports.length, 1);
  assert.equal(tables.weekly_reports[0].week_start, '2026-10-12');
  assert.ok(tables.weekly_reports[0].emailed_at);
  const again = await deliverWeeklyReport(client, { organizationId: ORG, userId: 'u-admin' }, { send, appUrl: 'https://app.example', canSeeOpportunities: canSee, now: NOW });
  assert.equal(again.status, 'already_sent');
  assert.equal(sent.length, 1, 'a second run the same Monday sends nothing');

  const off = await deliverWeeklyReport(client, { organizationId: ORG, userId: 'u-ana' }, { send, appUrl: 'https://app.example', canSeeOpportunities: canSee, now: NOW });
  assert.equal(off.status, 'stored', 'with the email off it is kept and not sent');

  const failing = memory(seed());
  const result = await deliverWeeklyReport(failing.client, { organizationId: ORG, userId: 'u-admin' }, { send: async () => ({ ok: false as const, error: 'Reconecta tu correo en «Conexiones».' }), appUrl: 'https://app.example', canSeeOpportunities: canSee, now: NOW });
  assert.equal(result.status, 'failed');
  assert.equal(failing.tables.weekly_reports[0].emailed_at, undefined);
  assert.equal(failing.tables.weekly_reports[0].email_error, 'Reconecta tu correo en «Conexiones».', 'the next run tries again');
});

test('turning the email on keeps the rest of the signatures', async () => {
  const { client, tables } = memory(seed());
  await saveReportEmail(client, 'u-admin', false);
  assert.deepEqual(tables.profiles[0].signatures, { weekly_report: { email: false }, other: 1 });
});
