import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverDailyAlert, readAlertFacts, readAlertsEmail, saveAlertsEmail } from './daily-alerts';
import { memory } from './goals-alerts-test-fixtures';

const ORG = 'org-1';
const SCOPE = { organizationId: ORG, userId: 'u-ana' };
const TUESDAY = new Date('2026-10-20T11:30:00.000Z'); // 08:30 in Chile
const WEDNESDAY = new Date('2026-10-21T11:30:00.000Z');
const reply = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: ORG, user_id: 'u-ana', email: `${id}@empresa.cl`, name: `Persona ${id}`,
  company: 'Retail Sur', reply_intent: 'positive', replied_at: at, conversation_resolved_at: null, conversation_outbound_at: null, sent_at: '2026-10-10T12:00:00Z', data: {}, ...extra });
const seed = () => ({
  organization_members: [{ organization_id: ORG, user_id: 'u-ana', role: 'member' }],
  profiles: [{ id: 'u-ana', full_name: 'Ana Soto', email: 'ana@axis.cl', signatures: {} }],
  contacted_leads: [reply('r-old', '2026-10-16T15:00:00Z')],
  enriched_leads: [] as any[],
  outbound_dispatches: [] as any[],
  lead_research_jobs: [] as any[],
  commercial_opportunities: [] as any[],
  opportunity_work: [] as any[],
});
const UNIQUE = { daily_alerts: ['organization_id', 'user_id', 'alert_date'] };
const sender = () => {
  const sent: any[] = [];
  return { sent, send: async (input: any) => { sent.push(input); return { ok: true as const }; } };
};
const deps = (send: any, extra = {}) => ({ send, appUrl: 'https://app.antonia.ai', opportunities: 'none' as const, goalReminders: true, ...extra });

test('the alerts are on unless the person turned them off', async () => {
  assert.equal(readAlertsEmail(null), true);
  assert.equal(readAlertsEmail({ daily_alerts: { email: true } }), true);
  assert.equal(readAlertsEmail({ daily_alerts: { email: false } }), false);
  const { client, tables } = memory(seed());
  await saveAlertsEmail(client, 'u-ana', false);
  assert.deepEqual(tables.profiles[0].signatures, { daily_alerts: { email: false } });
});

test('a day with nothing concrete is kept as quiet and sends nothing', async () => {
  const { client, tables } = memory(seed(), { unique: UNIQUE });
  const { sent, send } = sender();
  // The old reply is still waiting, but it came before the window: alone it is not a reason to write.
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(send), now: TUESDAY }), { status: 'quiet' });
  assert.equal(sent.length, 0);
  assert.equal(tables.daily_alerts[0].status, 'quiet');
  assert.equal(tables.daily_alerts[0].alert_date, '2026-10-20');
});

test('a new reply is sent once, from the window of the last alert', async () => {
  const data = seed();
  data.contacted_leads.push(reply('r-new', '2026-10-19T22:00:00Z'));
  const { client, tables } = memory(data, { unique: UNIQUE });
  const { sent, send } = sender();
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(send), now: TUESDAY }), { status: 'sent' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@axis.cl');
  assert.equal(sent[0].subject, 'Te respondió Persona r-new');
  assert.match(sent[0].text, /Hola, Ana\./);
  assert.match(sent[0].text, /Te espera 1 respuesta de días anteriores/);
  assert.equal(tables.daily_alerts[0].status, 'sent');
  assert.ok(tables.daily_alerts[0].emailed_at);
  // The scheduler runs again the same morning: nothing more.
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(send), now: TUESDAY }), { status: 'already_sent' });
  assert.equal(sent.length, 1);
  // Wednesday: the reply of Monday is no longer new.
  tables.daily_alerts[0].created_at = TUESDAY.toISOString();
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(send, { goalReminders: false }), now: WEDNESDAY }), { status: 'quiet' });
});

test('a failed send is kept with its error, and the alerts off keep it unsent', async () => {
  const data = seed();
  data.contacted_leads.push(reply('r-new', '2026-10-19T22:00:00Z'));
  const { client, tables } = memory(data, { unique: UNIQUE });
  const failing = async () => ({ ok: false as const, error: 'Conecta Gmail u Outlook en «Conexiones» para recibirlo por correo.' });
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(failing), now: TUESDAY }), { status: 'failed' });
  assert.equal(tables.daily_alerts[0].status, 'failed');
  assert.match(tables.daily_alerts[0].email_error, /Conecta Gmail/);

  const off = seed();
  off.profiles[0].signatures = { daily_alerts: { email: false } };
  off.contacted_leads.push(reply('r-new', '2026-10-19T22:00:00Z'));
  const quiet = memory(off, { unique: UNIQUE });
  const { sent, send } = sender();
  assert.deepEqual(await deliverDailyAlert(quiet.client, SCOPE, { ...deps(send), now: TUESDAY }), { status: 'stored' });
  assert.equal(sent.length, 0);
});

test('another run that stored the alert first wins: no second email', async () => {
  const data = seed();
  data.contacted_leads.push(reply('r-new', '2026-10-19T22:00:00Z'));
  const { client, tables } = memory(data, { unique: UNIQUE });
  tables.daily_alerts.push({ organization_id: ORG, user_id: 'u-ana', alert_date: '2026-10-20', status: 'sent', created_at: TUESDAY.toISOString() });
  // When this run looked, the other run's row was not there yet; it is when this run inserts.
  const from = client.from;
  let looked = false;
  client.from = (name: string) => {
    if (name !== 'daily_alerts' || looked) return from(name);
    looked = true;
    return from(name).eq('alert_date', 'not yet');
  };
  const { sent, send } = sender();
  assert.deepEqual(await deliverDailyAlert(client, SCOPE, { ...deps(send), now: TUESDAY }), { status: 'already_sent' });
  assert.equal(sent.length, 0);
  assert.equal(tables.daily_alerts.length, 1);
});

test('the facts: contacts that got an email, research and opportunities by role', async () => {
  const data = seed();
  data.enriched_leads.push(
    { id: 'l1', organization_id: ORG, user_id: 'u-ana', email: 'nuevo@x.cl', full_name: 'Pedro Rojas', created_at: '2026-10-19T18:00:00Z' },
    { id: 'l2', organization_id: ORG, user_id: 'u-ana', email: 'r-old@empresa.cl', full_name: 'Ya escrito', created_at: '2026-10-19T18:00:00Z' },
    { id: 'l3', organization_id: ORG, user_id: 'u-ana', email: 'antiguo@x.cl', full_name: 'Viejo', created_at: '2026-10-01T18:00:00Z' },
  );
  data.lead_research_jobs.push({ organization_id: ORG, user_id: 'u-ana', lead_id: 'l1', company_name: 'Retail Sur', email: 'nuevo@x.cl', status: 'completed', completed_at: '2026-10-20T02:00:00Z' },
    { organization_id: ORG, user_id: 'u-ana', lead_id: 'l9', company_name: 'Minera Norte', email: null, status: 'failed', completed_at: '2026-10-20T02:00:00Z' });
  const opportunity = (id: string, at: string, evaluation: string) => ({ id, organization_id: ORG, kind: 'tender', title: `Licitación ${id}`, deadline_at: at, data: { evaluation } });
  data.commercial_opportunities.push(opportunity('o-mine', '2026-10-22T18:00:00Z', 'review'), opportunity('o-free', '2026-10-23T18:00:00Z', 'recommended'),
    opportunity('o-out', '2026-10-22T18:00:00Z', 'excluded'), opportunity('o-late', '2026-10-30T18:00:00Z', 'recommended'), opportunity('o-won', '2026-10-22T18:00:00Z', 'recommended'));
  data.opportunity_work.push({ organization_id: ORG, opportunity_id: 'o-mine', state: 'in_progress', responsible_id: 'u-ana' },
    { organization_id: ORG, opportunity_id: 'o-won', state: 'won', responsible_id: 'u-ana' });
  const { client } = memory(data);
  const since = '2026-10-19T11:30:00.000Z';
  const facts = await readAlertFacts(client, SCOPE, { now: TUESDAY, since, opportunities: 'manager' });
  assert.equal(facts.name, 'Ana');
  assert.deepEqual(facts.newReady, { count: 1, yesterday: true });
  assert.equal(facts.ready, 2);
  assert.deepEqual(facts.research, [{ leadId: 'l1', name: 'Pedro Rojas' }]);
  assert.deepEqual(facts.closing.map(item => [item.id, item.mine, item.recommended]), [['o-mine', true, false], ['o-free', false, true]]);
  const member = await readAlertFacts(client, SCOPE, { now: TUESDAY, since, opportunities: 'mine' });
  assert.deepEqual(member.closing.map(item => item.id), ['o-mine']);
  const none = await readAlertFacts(client, SCOPE, { now: TUESDAY, since, opportunities: 'none' });
  assert.deepEqual(none.closing, []);
  assert.equal(none.goal?.source, 'default');
});

test('the facts on Oportunidades: what was assigned and the reports since the last alert, and what waits for an administrator', async () => {
  const data: any = seed();
  const at = (id: string, title: string) => ({ id, organization_id: ORG, kind: 'tender', title, deadline_at: '2026-11-30T18:00:00Z', data: { evaluation: 'review' } });
  data.commercial_opportunities.push(at('o-1', 'Aseo Hospital Regional'), at('o-2', 'Guardias Puerto Montt'), at('o-3', 'Casino Minera'), at('o-4', 'Ya cerrada'));
  data.opportunity_work.push({ organization_id: ORG, opportunity_id: 'o-2', state: 'blocked', responsible_id: 'u-diego', updated_at: '2026-10-15T12:00:00Z' },
    { organization_id: ORG, opportunity_id: 'o-4', state: 'lost', responsible_id: 'u-diego', updated_at: '2026-10-15T12:00:00Z' });
  data.profiles.push({ id: 'u-diego', full_name: 'Diego Fuentes', email: 'diego@axis.cl', signatures: {} });
  data.opportunity_notifications = [
    { organization_id: ORG, user_id: 'u-ana', opportunity_id: 'o-1', kind: 'assignment', title: 'Oportunidad asignada: Aseo Hospital Regional', created_at: '2026-10-19T20:00:00Z' },
    { organization_id: ORG, user_id: 'u-ana', opportunity_id: 'o-1', kind: 'assignment', title: 'Oportunidad asignada: Aseo Hospital Regional', created_at: '2026-10-19T21:00:00Z' },
    { organization_id: ORG, user_id: 'u-ana', opportunity_id: 'o-3', kind: 'report', title: 'Informe listo: Casino Minera', created_at: '2026-10-20T01:00:00Z' },
    // A draft of the offer someone asked for and awaits: not news for the morning.
    { organization_id: ORG, user_id: 'u-ana', opportunity_id: 'o-1', kind: 'report', title: 'Borrador de oferta listo: Aseo Hospital Regional', created_at: '2026-10-20T02:00:00Z' },
    { organization_id: ORG, user_id: 'u-ana', opportunity_id: 'o-3', kind: 'assignment', title: 'Oportunidad asignada: Casino Minera', created_at: '2026-10-10T01:00:00Z' },
    { organization_id: ORG, user_id: 'u-other', opportunity_id: 'o-2', kind: 'assignment', title: 'Oportunidad asignada: Guardias Puerto Montt', created_at: '2026-10-19T20:00:00Z' },
  ];
  const decision = (id: string, opportunity: string, type: string, created: string, extra = {}) => ({ id, organization_id: ORG, opportunity_id: opportunity, kind: 'decision', actor_id: 'u-diego',
    body: 'Pide una decisión: ¿módulo opcional?', created_at: created, data: { type, dueAt: null, ...extra } });
  data.opportunity_activity = [
    decision('d-1', 'o-1', 'ask', '2026-10-17T12:00:00Z'),
    // Answered: no longer waits.
    decision('d-2', 'o-3', 'ask', '2026-10-16T12:00:00Z'), { ...decision('d-3', 'o-3', 'reply', '2026-10-18T12:00:00Z'), actor_id: 'u-ana' },
    // On a closed one: no longer waits for anyone.
    decision('d-4', 'o-4', 'no_go', '2026-10-14T12:00:00Z'),
  ];
  const { client } = memory(data);
  const since = '2026-10-19T11:30:00.000Z';
  const manager = await readAlertFacts(client, SCOPE, { now: TUESDAY, since, opportunities: 'manager' });
  assert.deepEqual(manager.assigned, [{ id: 'o-1', title: 'Aseo Hospital Regional' }], 'once each, only since the last alert, only the person\'s own');
  assert.deepEqual(manager.reports, [{ id: 'o-3', title: 'Casino Minera' }]);
  assert.deepEqual(manager.waiting?.map(item => [item.id, item.kind, item.who]), [['o-2', 'blocked', 'Alguien del equipo'], ['o-1', 'ask', 'Diego']], 'the oldest first');
  const member = await readAlertFacts(client, SCOPE, { now: TUESDAY, since, opportunities: 'mine' });
  assert.equal(member.waiting, undefined, 'what waits for an administrator is theirs');
  assert.deepEqual(member.assigned?.map(item => item.id), ['o-1']);
});

test('whoever only works Oportunidades gets no prospecting goal; whoever prospects, or has no Oportunidades, keeps it', async () => {
  const data: any = { ...seed(), contacted_leads: [], leads: [] };
  const since = '2026-10-19T11:30:00.000Z';
  const tenders = await readAlertFacts(memory(data).client, SCOPE, { now: TUESDAY, since, opportunities: 'mine' });
  assert.equal(tenders.goal, null, 'nobody saved, given an email or written to');
  assert.equal((await readAlertFacts(memory(data).client, SCOPE, { now: TUESDAY, since, opportunities: 'none' })).goal?.source, 'default');
  const saver = { ...data, leads: [{ id: 'lead-1', organization_id: ORG, user_id: 'u-ana' }] };
  assert.equal((await readAlertFacts(memory(saver).client, SCOPE, { now: TUESDAY, since, opportunities: 'manager' })).goal?.source, 'default', 'a contact saved is prospecting');
  const other = { ...data, leads: [{ id: 'lead-2', organization_id: ORG, user_id: 'u-diego' }] };
  assert.equal((await readAlertFacts(memory(other).client, SCOPE, { now: TUESDAY, since, opportunities: 'mine' })).goal, null, 'someone else\'s contacts are not hers');
});

test('whoever is in charge hears a week ahead once, then in the last three days', async () => {
  const data: any = seed();
  const at = (id: string, deadline: string) => ({ id, organization_id: ORG, kind: 'tender', title: `Licitación ${id}`, deadline_at: deadline, data: { evaluation: 'review' } });
  data.commercial_opportunities.push(at('mon', '2026-10-26T18:00:00Z'), at('tue', '2026-10-27T18:00:00Z'), at('wed', '2026-10-28T18:00:00Z'), at('far', '2026-10-30T18:00:00Z'), at('soon', '2026-10-22T18:00:00Z'));
  for (const id of ['mon', 'tue', 'wed', 'far', 'soon']) data.opportunity_work.push({ organization_id: ORG, opportunity_id: id, state: 'working', responsible_id: 'u-ana' });
  const since = '2026-10-19T11:30:00.000Z';
  const ids = async (now: Date) => (await readAlertFacts(memory(data).client, SCOPE, { now, since, opportunities: 'mine' })).closing.map(item => item.id);
  // Tuesday 20: «soon» closes on Thursday; Monday 26 is six days ahead (its seventh was Monday 19, with no alert) and Tuesday 27 seven.
  assert.deepEqual(await ids(TUESDAY), ['soon', 'mon', 'tue']);
  // Wednesday 21: Tuesday 27 is six days ahead and was already said on Tuesday; Wednesday 28 is seven.
  assert.deepEqual(await ids(WEDNESDAY), ['soon', 'wed']);
});
