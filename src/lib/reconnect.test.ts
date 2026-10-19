import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReconnectAlerts, companyKey, emailDomain, reconnectInstruction, reconnectSettings, type ReconnectRow,
} from './reconnect';

const now = new Date('2026-10-19T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const row = (patch: Partial<ReconnectRow> & { id: string }): ReconnectRow => ({
  email: `${patch.id}@empresa-${patch.id}.cl`, name: `Persona ${patch.id}`, company: `Empresa ${patch.id}`, lead_id: `lead-${patch.id}`,
  sent_at: daysAgo(90), replied_at: null, reply_intent: null, conversation_resolved_at: null, ...patch,
});

test('a conversation closed without a deal or kept for later comes back after 60 days; a fresh one does not', () => {
  const alerts = buildReconnectAlerts({ now, rows: [
    row({ id: 'a', sent_at: daysAgo(80), conversation_resolved_at: daysAgo(70), conversation_close_outcome: 'no_deal' }),
    row({ id: 'b', sent_at: daysAgo(65), conversation_resolved_at: daysAgo(64), conversation_close_outcome: 'keep' }),
    row({ id: 'c', sent_at: daysAgo(30), conversation_resolved_at: daysAgo(29), conversation_close_outcome: 'no_deal' }),
  ] });
  assert.deepEqual(alerts.map(alert => [alert.contactedId, alert.kind, alert.daysSince]), [['a', 'closed', 80], ['b', 'kept', 65]]);
  assert.match(alerts[0].reason, /Cerraste sin acuerdo hace 80 días/);
  assert.match(alerts[1].reason, /«Lo retomo yo» hace 65 días/);
});

test('«No interesado», a won deal, a bounce, an unsubscribe or a negative answer never come back', () => {
  const alerts = buildReconnectAlerts({ now, rows: [
    row({ id: 'n', conversation_resolved_at: daysAgo(80), conversation_close_outcome: 'not_interested' }),
    row({ id: 'w', conversation_resolved_at: daysAgo(80), conversation_close_outcome: 'won' }),
    row({ id: 'd', evaluation_status: 'do_not_contact' }),
    row({ id: 'r', campaign_followup_reason: 'not_interested' }),
    row({ id: 'b', bounced_at: daysAgo(89) }),
    row({ id: 'u', replied_at: daysAgo(85), reply_intent: 'unsubscribe' }),
    row({ id: 'g', replied_at: daysAgo(85), reply_intent: 'negative' }),
    row({ id: 'x', email: null }),
  ] });
  assert.deepEqual(alerts, []);
});

test('an older «No interesado» with the same address blocks a newer conversation too', () => {
  const alerts = buildReconnectAlerts({ now, rows: [
    row({ id: 'old', email: 'ana@acme.cl', sent_at: daysAgo(200), conversation_resolved_at: daysAgo(190), conversation_close_outcome: 'not_interested' }),
    row({ id: 'new', email: 'ana@acme.cl', sent_at: daysAgo(80) }),
  ] });
  assert.deepEqual(alerts, []);
});

test('silence: no answer after 45 days, or an answer we replied to and then nothing', () => {
  const alerts = buildReconnectAlerts({ now, rows: [
    row({ id: 'q', sent_at: daysAgo(70), replied_at: daysAgo(60), reply_intent: 'positive', conversation_outbound_at: daysAgo(50) }),
    row({ id: 's', sent_at: daysAgo(100), last_follow_up_at: daysAgo(46) }),
    row({ id: 't', sent_at: daysAgo(100), last_follow_up_at: daysAgo(20) }),
  ] });
  assert.deepEqual(alerts.map(alert => [alert.contactedId, alert.kind, alert.daysSince]), [['q', 'quiet', 50], ['s', 'no_reply', 46]]);
});

test('an answer still waiting for the person is not here: it is in «Lo que te espera»', () => {
  const alerts = buildReconnectAlerts({ now, rows: [row({ id: 'p', sent_at: daysAgo(90), replied_at: daysAgo(60), reply_intent: 'positive' })] });
  assert.deepEqual(alerts, []);
});

test('a new signal of the company brings someone back sooner, never within two weeks of the last email', () => {
  const signals = [
    { company: 'Acme SpA', domain: null, title: 'Jefe de Operaciones', kind: 'hiring' as const, seenAt: daysAgo(3) },
    { company: null, domain: 'www.beta.cl', title: 'Servicio de aseo 2027', kind: 'tender' as const, seenAt: daysAgo(5) },
    { company: 'Gamma', domain: null, title: 'Antiguo', kind: 'hiring' as const, seenAt: daysAgo(60) },
  ];
  const alerts = buildReconnectAlerts({ now, signals, rows: [
    row({ id: 'acme', company: 'ACME S.A.', email: 'ana@gmail.com', sent_at: daysAgo(20) }),
    row({ id: 'beta', company: 'Beta', email: 'luis@beta.cl', sent_at: daysAgo(30) }),
    row({ id: 'recent', company: 'Acme', email: 'otra@acme.cl', sent_at: daysAgo(5) }),
    row({ id: 'gamma', company: 'Gamma', email: 'x@gamma.cl', sent_at: daysAgo(20) }),
  ] });
  assert.deepEqual(alerts.map(alert => [alert.contactedId, alert.kind]), [['beta', 'signal'], ['acme', 'signal']], 'the longest waiting first');
  assert.match(alerts[1].reason, /ACME S\.A\. está contratando: «Jefe de Operaciones»\. Hablaron hace 20 días\./);
  assert.match(alerts[0].reason, /publicó una licitación/);
});

test('postponed stays hidden until its date; «No retomar» for good; turned off, nothing comes back', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
  const alerts = buildReconnectAlerts({ now, rows, marks: [
    { contactedId: 'a', state: 'snoozed', until: daysAgo(-10) },
    { contactedId: 'b', state: 'snoozed', until: daysAgo(1) },
    { contactedId: 'c', state: 'dismissed', until: null },
  ] });
  assert.deepEqual(alerts.map(alert => alert.contactedId), ['b'], 'b was postponed until yesterday');
  assert.deepEqual(buildReconnectAlerts({ now, rows, settings: reconnectSettings({ afterDays: 0 }) }), []);
});

test('settings take only the choices of the card', () => {
  assert.deepEqual(reconnectSettings(null), { afterClosedDays: 60, afterQuietDays: 45 });
  assert.deepEqual(reconnectSettings({ afterDays: 30 }), { afterClosedDays: 30, afterQuietDays: 30 });
  assert.deepEqual(reconnectSettings({ afterDays: 90 }), { afterClosedDays: 90, afterQuietDays: 45 });
  assert.deepEqual(reconnectSettings({ afterDays: 7 }), { afterClosedDays: 60, afterQuietDays: 45 });
  assert.deepEqual(reconnectSettings({ afterDays: 0 }), { afterClosedDays: 0, afterQuietDays: 0 });
});

test('companies and domains compare the way people write them', () => {
  assert.equal(companyKey('Grupo Expro SpA'), companyKey('grupoexpro'));
  assert.equal(companyKey('Constructora Ñuñoa Ltda.'), 'constructoranunoa');
  assert.equal(emailDomain('Ana@Acme.CL'), 'acme.cl');
  assert.equal(emailDomain('ana@gmail.com'), null);
});

test('the writer is told why now and what not to repeat', () => {
  const text = reconnectInstruction({ kind: 'signal', daysSince: 40, signal: { kind: 'hiring', title: 'Jefe de bodega' } }, 'Re: Re: Propuesta de aseo');
  assert.match(text, /hace 40 días sobre «Propuesta de aseo»/);
  assert.match(text, /está contratando \(«Jefe de bodega»\)/);
  assert.match(text, /una sola pregunta/);
  assert.ok(text.length <= 1000, 'fits the instruction limit of the writer');
  assert.match(reconnectInstruction({ kind: 'no_reply', daysSince: 50 }), /No respondió a los correos anteriores/);
});
