import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentDigestEmail, assignmentEmail, assignmentWhen } from '@/lib/commercial-opportunities/assignment-email';
import { notifyBulkAssignment, notifyNewParticipants, readParticipantIds, readTeams } from './workspace-assignment-notice';

const ORG = '00000000-0000-4000-8000-000000000001';
const OPP = '00000000-0000-4000-8000-0000000000aa';
const ADMIN = '00000000-0000-4000-8000-000000000010';
const ANA = '00000000-0000-4000-8000-000000000011';
const LUIS = '00000000-0000-4000-8000-000000000012';
const OLD = '00000000-0000-4000-8000-000000000013';
const scope = { organizationId: ORG, userId: ADMIN, role: 'admin' };

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
  opportunity_participants: [{ organization_id: ORG, opportunity_id: OPP, user_id: OLD }, { organization_id: ORG, opportunity_id: OPP, user_id: ANA }, { organization_id: ORG, opportunity_id: OPP, user_id: LUIS }, { organization_id: ORG, opportunity_id: OPP, user_id: ADMIN }],
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de aseo  Hospital Regional', buyer_name: 'Hospital Regional', company_name: null, deadline_at: '2026-10-23T18:00:00Z' }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, objective: 'Revisar las bases y confirmar si postulamos', due_at: '2026-10-22T13:00:00Z', responsible_id: ANA }],
  profiles: [
    { id: ADMIN, email: 'nicolas@yago.cl', full_name: 'Nicolás Yarur', signatures: {} }, { id: ANA, email: 'ana@grupoexpro.cl', full_name: 'Ana Pérez', signatures: {} },
    { id: LUIS, email: 'luis@grupoexpro.cl', full_name: 'Luis Soto', signatures: { daily_alerts: { email: false } } }, { id: OLD, email: 'old@grupoexpro.cl', full_name: 'Ya estaba', signatures: {} },
  ],
  ...extra,
});

test('the email says who assigned it, what it is, when it closes and what is expected first', () => {
  const email = assignmentEmail({ name: 'Ana Pérez', assignedBy: 'Nicolás Yarur', opportunityId: OPP, title: 'Servicio de aseo Hospital Regional', buyer: 'Hospital Regional',
    deadlineAt: '2026-10-23T18:00:00Z', nextActionAt: '2026-10-22T13:00:00Z', objective: 'Revisar las bases', responsible: true, appUrl: 'https://app.antonia.ai/' });
  assert.equal(email.subject, 'Quedaste a cargo: Servicio de aseo Hospital Regional');
  assert.match(email.text, /Hola, Ana Pérez\. Nicolás Yarur te dejó a cargo de esta oportunidad\./);
  assert.match(email.text, /Cierra: viernes 23 de octubre, 15:00/, 'Chile time (UTC-3 in October)');
  assert.match(email.text, /Próxima acción: jueves 22 de octubre, 10:00/);
  assert.match(email.text, /Qué se espera: Revisar las bases/);
  assert.match(email.text, /https:\/\/app\.antonia\.ai\/opportunities\?op=00000000-0000-4000-8000-0000000000aa/);
  assert.match(email.html, /Abrir la oportunidad/);
  assert.match(email.html, /background:#ffffff/, 'on the white card of the app\'s other emails');
  const plain = assignmentEmail({ name: '', assignedBy: null, opportunityId: OPP, title: '<b>Aseo</b> & más', buyer: null, deadlineAt: null, nextActionAt: null, objective: '', responsible: false, appUrl: 'https://app.antonia.ai' });
  assert.equal(plain.subject, 'Te asignaron: <b>Aseo</b> & más');
  assert.match(plain.text, /^Hola\. Un administrador te asignó esta oportunidad\./);
  assert.doesNotMatch(plain.text, /Cierra|Próxima acción|Qué se espera|Organismo/);
  assert.match(plain.html, /&lt;b&gt;Aseo&lt;\/b&gt; &amp; más/, 'the title is escaped in the html');
  assert.equal(assignmentWhen(null), ''); assert.equal(assignmentWhen('mañana'), '');
});

test('the team before the assignment is read to know who is new', async () => {
  assert.deepEqual((await readParticipantIds(fakeClient(world()), scope, OPP)).sort(), [ADMIN, ANA, LUIS, OLD].sort());
});

test('only whoever joined the team hears about it, and not the one who assigned', async () => {
  const sent: any[] = [];
  const result = await notifyNewParticipants(fakeClient(world({ opportunity_work: world().opportunity_work.map(row => ({ ...row, responsible_id: ANA })) })), scope, OPP, [OLD],
    { send: async email => { sent.push(email); return { ok: true }; }, appUrl: 'https://app.antonia.ai', env: {} });
  assert.deepEqual(sent.map(email => email.to), ['ana@grupoexpro.cl'], 'Luis turned the app\'s emails off, the old member is not new, the admin made the assignment');
  assert.equal(sent[0].userId, ANA);
  assert.match(sent[0].subject, /^Quedaste a cargo: Servicio de aseo Hospital Regional$/, 'the title is read whole, with its spaces tidied');
  assert.match(sent[0].text, /Nicolás Yarur te dejó a cargo/);
  assert.deepEqual(result, { sent: 1, skipped: 1, failed: 0 });
});

test('nothing goes out when nobody is new, when it is switched off, or to addresses that cannot get one', async () => {
  const never = async () => { throw new Error('must not send'); };
  assert.deepEqual(await notifyNewParticipants(fakeClient(world()), scope, OPP, [OLD, ANA, LUIS], { send: never, env: {} }), { sent: 0, skipped: 0, failed: 0 });
  assert.deepEqual(await notifyNewParticipants(fakeClient(world()), scope, OPP, [], { send: never, env: { OPPORTUNITY_ASSIGNMENT_EMAIL: 'off' } }), { sent: 0, skipped: 0, failed: 0 });
  const tests = world({ profiles: world().profiles.map(row => (row.id === ANA ? { ...row, email: 'ana@example.com' } : row.id === LUIS ? { ...row, email: '', signatures: {} } : row)) });
  assert.deepEqual(await notifyNewParticipants(fakeClient(tests), scope, OPP, [OLD], { send: never, env: {} }), { sent: 0, skipped: 2, failed: 0 });
});

test('a send that fails or throws is counted and the others still go out', async () => {
  const sent: string[] = [];
  const everyone = world({ profiles: world().profiles.map(row => (row.id === LUIS ? { ...row, signatures: {} } : row)) });
  const result = await notifyNewParticipants(fakeClient(everyone), scope, OPP, [OLD], { env: {}, send: async email => {
    if (email.to.startsWith('ana')) throw new Error('mailbox down');
    sent.push(email.to); return { ok: false };
  } });
  assert.deepEqual(sent, ['luis@grupoexpro.cl']);
  assert.deepEqual(result, { sent: 0, skipped: 0, failed: 2 });
});

test('several assigned in one go are one email per person: the soonest to close first, each with its link and whether it is theirs', () => {
  const email = assignmentDigestEmail({ name: 'Ana Pérez', assignedBy: 'Nicolás Yarur', appUrl: 'https://app.antonia.ai/', items: [
    { opportunityId: 'a', title: 'Aseo Hospital Regional', buyer: 'Hospital Regional', deadlineAt: '2026-10-30T18:00:00Z', responsible: false },
    { opportunityId: 'b', title: 'Guardias  Municipalidad', buyer: null, deadlineAt: '2026-10-23T18:00:00Z', responsible: true },
    { opportunityId: 'c', title: '<b>Sin fecha</b>', buyer: null, deadlineAt: null, responsible: false }] });
  assert.equal(email.subject, 'Te asignaron 3 oportunidades');
  assert.match(email.text, /^Hola, Ana Pérez\. Nicolás Yarur te asignó 3 oportunidades; quedaste a cargo de una\./);
  assert.ok(email.text.indexOf('Guardias Municipalidad') < email.text.indexOf('Aseo Hospital Regional'), 'the one that closes first goes first');
  assert.ok(email.text.indexOf('Aseo Hospital Regional') < email.text.indexOf('<b>Sin fecha</b>'), 'without a deadline, last');
  assert.match(email.text, /cierra el viernes 23 de octubre, 15:00 · a tu cargo/);
  assert.match(email.text, /https:\/\/app\.antonia\.ai\/opportunities\?op=b/);
  assert.match(email.html, /&lt;b&gt;Sin fecha&lt;\/b&gt;/);
  assert.match(email.html, /Ver mis oportunidades/);
});

test('a bulk assignment emails each person who joined once, with what they joined; the single email when it was one', async () => {
  const OPP2 = '00000000-0000-4000-8000-0000000000bb';
  const both = world({
    opportunity_participants: [...world().opportunity_participants, { organization_id: ORG, opportunity_id: OPP2, user_id: ANA }, { organization_id: ORG, opportunity_id: OPP2, user_id: OLD }],
    commercial_opportunities: [...world().commercial_opportunities, { organization_id: ORG, id: OPP2, title: 'Guardias Puerto Montt', buyer_name: null, company_name: 'Municipalidad', deadline_at: null }],
  });
  const before = await readTeams(fakeClient(world()), scope, [OPP, OPP2]);
  assert.deepEqual(before.get(OPP2), [], 'an opportunity without a team yet');
  const sent: any[] = [];
  const result = await notifyBulkAssignment(fakeClient(both), scope, new Map([[OPP, [OLD]], [OPP2, []]]), { send: async email => { sent.push(email); return { ok: true }; }, appUrl: 'https://app.antonia.ai', env: {} });
  // Ana joined both (one email with both); the old member joined only the second (the single email); Luis turned the emails off.
  assert.deepEqual(sent.map(email => [email.to, email.subject]).sort(), [['ana@grupoexpro.cl', 'Te asignaron 2 oportunidades'], ['old@grupoexpro.cl', 'Te asignaron: Guardias Puerto Montt']]);
  assert.deepEqual(result, { sent: 2, skipped: 1, failed: 0 });
  assert.deepEqual(await notifyBulkAssignment(fakeClient(both), scope, new Map([[OPP, []]]), { send: async () => { throw new Error('must not send'); }, env: { OPPORTUNITY_ASSIGNMENT_EMAIL: 'off' } }), { sent: 0, skipped: 0, failed: 0 });
});
