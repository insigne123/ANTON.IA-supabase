import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionEmail } from '@/lib/commercial-opportunities/decision-email';
import { notifyDecisionByEmail } from './workspace-decision-notice';

const ORG = '00000000-0000-4000-8000-000000000001';
const OPP = '00000000-0000-4000-8000-0000000000aa';
const DIEGO = '00000000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000010';
const OTHER_ADMIN = '00000000-0000-4000-8000-000000000012';
const ANA = '00000000-0000-4000-8000-000000000013';

type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  return { from(table: string) {
    let rows = [...(tables[table] || [])];
    const chain: any = {
      select() { return chain; }, limit() { return chain; },
      eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === undefined || row[column] === value); return chain; },
      in(column: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[column])); return chain; },
      async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return chain;
  } } as never;
}
const world = (extra: Record<string, Row[]> = {}) => ({
  organization_members: [{ organization_id: ORG, user_id: ADMIN, role: 'owner' }, { organization_id: ORG, user_id: OTHER_ADMIN, role: 'admin' }, { organization_id: ORG, user_id: DIEGO, role: 'member' }, { organization_id: ORG, user_id: ANA, role: 'member' }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, responsible_id: ANA }],
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de aseo  Hospital Regional' }],
  profiles: [{ id: ADMIN, email: 'nicolas@yago.cl', full_name: 'Nicolás Yarur', signatures: {} }, { id: OTHER_ADMIN, email: 'otra@grupoexpro.cl', full_name: 'Carla Díaz', signatures: { daily_alerts: { email: false } } },
    { id: DIEGO, email: 'diego@grupoexpro.cl', full_name: 'Diego Fuentes', signatures: {} }, { id: ANA, email: 'ana@grupoexpro.cl', full_name: 'Ana Pérez', signatures: {} }],
  ...extra,
});
const send = () => { const sent: any[] = []; return { sent, send: async (email: any) => { sent.push(email); return { ok: true }; } }; };

test('the email says who asks what, by when, and opens the opportunity', () => {
  const ask = decisionEmail({ name: 'Nicolás Yarur', actor: 'Diego Fuentes', kind: 'ask', title: 'Servicio de aseo Hospital Regional', text: '¿Ofrecemos el módulo opcional de turnos?',
    dueAt: '2026-10-23T18:00:00Z', opportunityId: OPP, appUrl: 'https://app.antonia.ai/' });
  assert.equal(ask.subject, 'Diego Fuentes pide una decisión: Servicio de aseo Hospital Regional');
  assert.match(ask.text, /Hola, Nicolás Yarur\. Diego Fuentes necesita que decidan algo sobre esta oportunidad, para el viernes 23 de octubre\./);
  assert.match(ask.text, /«¿Ofrecemos el módulo opcional de turnos\?»/);
  assert.match(ask.text, /Responder: https:\/\/app\.antonia\.ai\/opportunities\?op=00000000-0000-4000-8000-0000000000aa/);
  assert.match(ask.html, />Responder</);
  const blocked = decisionEmail({ name: '', actor: null, kind: 'blocked', title: '<b>Aseo</b>', text: 'Falta la boleta de garantía', dueAt: null, opportunityId: OPP, appUrl: 'https://app.antonia.ai' });
  assert.equal(blocked.subject, 'Oportunidad bloqueada: <b>Aseo</b>');
  assert.match(blocked.text, /^Hola\. Alguien del equipo marcó esta oportunidad como bloqueada\./);
  assert.match(blocked.html, /&lt;b&gt;Aseo&lt;\/b&gt;/);
  assert.equal(decisionEmail({ name: 'Diego', actor: 'Nicolás', kind: 'reply', title: 'Aseo', text: 'Sí, ofrécelo', dueAt: null, opportunityId: OPP, appUrl: 'https://x' }).subject, 'Respondieron tu decisión: Aseo');
  assert.equal(decisionEmail({ name: '', actor: 'Diego', kind: 'no_go', title: 'Aseo', text: 'No llegamos', dueAt: null, opportunityId: OPP, appUrl: 'https://x' }).subject, 'Diego propone no postular: Aseo');
});

test('a decision asked goes to the administrators and whoever is in charge, never to whoever asked, and respects the off switch', async () => {
  const mail = send();
  const result = await notifyDecisionByEmail(fakeClient(world()), { organizationId: ORG, userId: DIEGO, role: 'member' }, OPP, { kind: 'ask', text: '¿Ofrecemos el módulo?', dueAt: null },
    { send: mail.send, appUrl: 'https://app.antonia.ai', env: {} });
  assert.deepEqual(mail.sent.map(email => email.to).sort(), ['ana@grupoexpro.cl', 'nicolas@yago.cl'], 'Carla turned the emails off');
  assert.match(mail.sent[0].subject, /^Diego Fuentes pide una decisión: Servicio de aseo Hospital Regional$/);
  assert.deepEqual(result, { sent: 2, skipped: 1, failed: 0 });
});

test('an answer goes to whoever asked and whoever is in charge; nothing goes out when it is switched off', async () => {
  const mail = send();
  await notifyDecisionByEmail(fakeClient(world()), { organizationId: ORG, userId: ADMIN, role: 'owner' }, OPP, { kind: 'reply', text: 'Sí', asker: DIEGO }, { send: mail.send, env: {} });
  assert.deepEqual(mail.sent.map(email => email.to).sort(), ['ana@grupoexpro.cl', 'diego@grupoexpro.cl']);
  const never = async () => { throw new Error('must not send'); };
  assert.deepEqual(await notifyDecisionByEmail(fakeClient(world()), { organizationId: ORG, userId: DIEGO }, OPP, { kind: 'blocked', text: 'x' }, { send: never, env: { OPPORTUNITY_DECISION_EMAIL: 'off' } }),
    { sent: 0, skipped: 0, failed: 0 });
});
