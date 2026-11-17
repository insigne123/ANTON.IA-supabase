import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { mailDropCalls, mailDropCallsForCallback, mailDropReady, prepareDropCalls } from './lead-drop-ready';

const ORG = 'org-1', USER = 'u-ana', DROP = '11111111-1111-4111-8111-111111111111';
const A = '6accdbfcd5f5d80001cf6901', B = '6accdbfcd5f5d80001cf6902', C = '6accdbfcd5f5d80001cf6903';
const scope = { organizationId: ORG, userId: USER };
const NOW = new Date('2026-11-16T14:00:00.000Z');
const ENV = { INTERNAL_API_SECRET: 'a-secret-for-tests' };
const item = (leadId: string, name: string, extra: Record<string, unknown> = {}) => ({ leadId, name, title: 'Gerente HSE', company: 'Minera Andina', domain: null, industry: 'Minería', size: null,
  city: null, hasEmail: true, hasPhone: false, why: 'Calza.', research: [], provider: 'apollo',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche en {{empresa}}?' }, followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }], ...extra });
const lead = (id: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: ORG, user_id: USER, email: `${id}@mineraandina.cl`, primary_phone: null, phone_numbers: [], enrichment_status: 'completed',
  updated_at: '2026-11-16T13:58:00.000Z', created_at: '2026-11-16T13:58:00.000Z', ...extra });
const seed = (items: unknown[], leads: unknown[], extra: Record<string, unknown[]> = {}) => memory({
  lead_drops: [{ id: DROP, organization_id: ORG, user_id: USER, drop_date: '2026-11-16', status: 'sent', criteria: {}, items, updated_at: '2026-11-16T13:00:00.000Z' }],
  enriched_leads: leads, profiles: [{ id: USER, email: 'ana@brigadas.cl', full_name: 'Ana Rojas', signatures: {} }], ...extra,
});
const outbox = (ok = true) => { const sent: any[] = []; return { sent, send: async (input: any) => { sent.push(input); return { ok }; } }; };
const deps = (send: any, extra: Record<string, unknown> = {}) => ({ now: NOW, appUrl: 'https://app.ejemplo.cl', env: ENV, mailbox: async () => ({ resolved: 'google' as const }), send, ...extra });
const script = { points: ['Turnos de noche: quién responde.', 'Ampliación 2027.'], opening: 'Hola Pedro, te llamo por las brigadas.', questions: ['¿Cómo cubren la noche?', '¿Quién decide?'], objections: [],
  voicemail: 'Hola Pedro, soy Ana. Te escribo.', whatsapp: 'Hola Pedro, soy Ana. ¿Te llamo mañana?' };

test('«Listos»: after looking several up at once, one email in the morning conversation with every contact found; each goes in it once', async () => {
  const { client, tables } = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1' }), item(B, 'Luisa Soto', { savedLeadId: 'e-2' }), item(C, 'Raúl P.', { lookup: { attempt: 1, at: NOW.toISOString(), missed: true } })],
    [lead('e-1'), lead('e-2'), { ...lead('e-9'), user_id: 'u-otro' }]);
  const { sent, send } = outbox();
  assert.deepEqual(await mailDropReady(client, scope, DROP, { phones: true }, deps(send)), { sent: true, count: 2 });
  const [email] = sent;
  assert.equal(email.to, 'ana@brigadas.cl');
  assert.equal(email.subject, 'Re: 3 contactos nuevos para ti');
  assert.equal(email.headers.References, `<contactos.${DROP}@contactos.anton-ia.yago.cl>`);
  assert.equal(Buffer.from(email.headers['Thread-Index'], 'base64').length, 27, 'an answer in the conversation');
  assert.match(email.text, /^Hola, Ana\. Encontramos el correo de 2 de tus 3 contactos\.\nLa campaña de cada uno está lista: léela y apruébala\. Sale desde tu Gmail/);
  assert.match(email.text, /Correo: e-1@mineraandina\.cl/);
  assert.match(email.text, /Correo: e-2@mineraandina\.cl/);
  assert.match(email.text, /Sus teléfonos llegan en unos minutos/);
  assert.match(email.text, /No encontramos un correo para Raúl P\. de Minera Andina\./);
  // Its buttons open the page that needs no session, at the contact.
  assert.match(email.html, new RegExp(`href="https://app\\.ejemplo\\.cl/contactos/[A-Za-z0-9_-]{48}\\?c=${A}"`));
  const [first, second, third] = tables.lead_drops[0].items;
  assert.equal(first.campaignMailedAt, NOW.toISOString());
  assert.equal(second.campaignMailedAt, NOW.toISOString());
  assert.equal(third.campaignMailedAt, undefined);
  // The page asking again, or another tab: nothing new.
  assert.deepEqual(await mailDropReady(client, scope, DROP, {}, deps(send)), { sent: false, reason: 'not_due' });
  assert.equal(sent.length, 1);
});

test('«Listos» goes to nobody who should not get it, and a send that fails leaves the contacts for the next try', async () => {
  const items = () => [item(A, 'Pedro Araya', { savedLeadId: 'e-1' }), item(B, 'Luisa Soto', { savedLeadId: 'e-2' })];
  const { send, sent } = outbox();
  const off = seed(items(), [lead('e-1'), lead('e-2')]);
  assert.deepEqual(await mailDropReady(off.client, scope, DROP, {}, deps(send, { env: { ...ENV, LEAD_DROPS_CAMPAIGN_EMAIL: 'off' } })), { sent: false, reason: 'off' });
  // One contact a day: its morning email is the day's alert, not a conversation of its own.
  assert.deepEqual(await mailDropReady(seed([items()[0]], [lead('e-1')]).client, scope, DROP, {}, deps(send)), { sent: false, reason: 'single' });
  // A test address, alerts turned off, or no way in without a session.
  const test_ = seed(items(), [lead('e-1'), lead('e-2')]);
  test_.tables.profiles[0].email = 'ana@example.com';
  assert.deepEqual(await mailDropReady(test_.client, scope, DROP, {}, deps(send)), { sent: false, reason: 'unreachable' });
  assert.deepEqual(await mailDropReady(seed(items(), [lead('e-1'), lead('e-2')]).client, scope, DROP, {}, deps(send, { env: {} })), { sent: false, reason: 'unreachable' });
  // Already approved, already sent, or without an address yet: not due.
  const done = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1', campaign: { id: 'c', provider: 'google', approvedAt: NOW.toISOString() } }), item(B, 'Luisa Soto', { savedLeadId: 'e-2', campaignMailedAt: NOW.toISOString() })], [lead('e-1'), lead('e-2')]);
  assert.deepEqual(await mailDropReady(done.client, scope, DROP, {}, deps(send)), { sent: false, reason: 'not_due' });
  assert.deepEqual(await mailDropReady(seed(items(), [lead('e-1', { email: null }), lead('e-2', { email: '' })]).client, scope, DROP, {}, deps(send)), { sent: false, reason: 'not_due' });
  assert.equal(sent.length, 0);
  // The sender refused it: the mark is given back, and the next try sends.
  const failing = seed(items(), [lead('e-1'), lead('e-2')]);
  assert.deepEqual(await mailDropReady(failing.client, scope, DROP, {}, deps(outbox(false).send)), { sent: false, reason: 'send_failed' });
  assert.equal(failing.tables.lead_drops[0].items[0].campaignMailedAt, undefined);
  assert.deepEqual(await mailDropReady(failing.client, scope, DROP, {}, deps(send)), { sent: true, count: 2 });
});

test('«Para llamar»: nothing while a mobile just asked is on its way; then one email with each number and its script, and those that did not come', async () => {
  const asked = { attempt: 0, at: '2026-11-16T13:58:00.000Z' };
  const { client, tables } = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1', phoneLookup: asked, call: { script, at: NOW.toISOString() } }), item(B, 'Luisa Soto', { savedLeadId: 'e-2', phoneLookup: asked }),
    item(C, 'Raúl Pinto', { savedLeadId: 'e-3', phoneLookup: asked }), item('6accdbfcd5f5d80001cf6904', 'Sin Pedir', { savedLeadId: 'e-4' })],
    [lead('e-1', { primary_phone: '+56 9 8765 4321' }), lead('e-2', { enrichment_status: 'pending_phone', updated_at: '2026-11-16T13:58:00.000Z' }), lead('e-3'), lead('e-4', { primary_phone: '+56911112222' })]);
  const { sent, send } = outbox();
  const prepared: string[] = [];
  const mine = deps(send, { prepare: async (leadId: string) => { prepared.push(leadId); return { script: { ...script, opening: 'Hola Luisa, te llamo por las brigadas.' } }; } });
  assert.deepEqual(await mailDropCalls(client, scope, DROP, mine), { sent: false, reason: 'waiting' });
  assert.equal(sent.length, 0);
  // Its answer lands: all of them go together.
  Object.assign(tables.enriched_leads[1], { primary_phone: '+56 2 2345 6789', enrichment_status: 'completed' });
  assert.deepEqual(await mailDropCalls(client, scope, DROP, mine), { sent: true, count: 2 });
  const [email] = sent;
  assert.equal(email.subject, 'Re: 4 contactos nuevos para ti');
  assert.equal(email.headers.References, `<contactos.${DROP}@contactos.anton-ia.yago.cl>`);
  assert.match(email.text, /^Hola, Ana\. Ya tienes el teléfono de 2 de tus contactos, con el guion de cada llamada\.\nNo encontramos un teléfono para Raúl Pinto de Minera Andina\./);
  assert.match(email.text, /Teléfono: \+56 9 8765 4321/);
  assert.match(email.text, /Hola Pedro, te llamo por las brigadas\./);
  assert.match(email.text, /Teléfono: \+56 2 2345 6789/);
  assert.match(email.text, /Hola Luisa, te llamo por las brigadas\./);
  assert.ok(!email.text.includes('Sin Pedir') && !email.text.includes('+56911112222'), 'a mobile nobody asked from the drop is not news');
  assert.deepEqual(prepared, [B], 'only the script that was not written yet');
  assert.deepEqual(tables.lead_drops[0].items.map((entry: any) => Boolean(entry.callMailedAt)), [true, true, true, false]);
  // Another answer of the provider, or the page read again: nothing new.
  assert.deepEqual(await mailDropCalls(client, scope, DROP, mine), { sent: false, reason: 'not_due' });
  assert.equal(sent.length, 1);
});

test('a mobile asked long ago that never came holds no other back, and a send that fails is tried again', async () => {
  const { client, tables } = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1', phoneLookup: { attempt: 0, at: '2026-11-16T13:59:00.000Z' }, call: { script, at: NOW.toISOString() } }),
    item(B, 'Luisa Soto', { savedLeadId: 'e-2', phoneLookup: { attempt: 0, at: '2026-11-16T13:30:00.000Z' } })],
    [lead('e-1', { primary_phone: '+56987654321' }), lead('e-2', { enrichment_status: 'pending_phone', updated_at: '2026-11-16T13:30:00.000Z' })]);
  assert.deepEqual(await mailDropCalls(client, scope, DROP, deps(outbox(false).send, { prepare: false })), { sent: false, reason: 'send_failed' });
  assert.equal(tables.lead_drops[0].items[0].callMailedAt, undefined);
  const { sent, send } = outbox();
  assert.deepEqual(await mailDropCalls(client, scope, DROP, deps(send, { prepare: false })), { sent: true, count: 1 });
  assert.match(sent[0].text, /^Hola, Ana\. Ya tienes el teléfono de Pedro Araya de Minera Andina, con el guion de su llamada\./);
  assert.ok(!sent[0].text.includes('Luisa'), 'still on its way: neither found nor missed');
  assert.equal(tables.lead_drops[0].items[1].callMailedAt, undefined, 'it goes when it lands');
  // It lands, late: its own email.
  Object.assign(tables.enriched_leads[1], { primary_phone: '+56223456789', enrichment_status: 'completed' });
  assert.deepEqual(await mailDropCalls(client, scope, DROP, deps(send, { prepare: false })), { sent: true, count: 1 });
  assert.match(sent[1].text, /Ya tienes el teléfono de Luisa Soto de Minera Andina\./);
});

test('the provider\'s answer finds the drop of the contact it was for; anything else does nothing', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const callback = (extra: Record<string, unknown> = {}) => ({ token_hash: hash, user_id: USER, organization_id: ORG, target_table: 'enriched_leads', target_lead_id: 'e-1', reveal_phone: true, ...extra });
  const items = () => [item(A, 'Pedro Araya', { savedLeadId: 'e-1', phoneLookup: { attempt: 0, at: '2026-11-16T13:58:00.000Z' }, call: { script, at: NOW.toISOString() } }), item(B, 'Luisa Soto')];
  const { sent, send } = outbox();
  const found = seed(items(), [lead('e-1', { primary_phone: '+56987654321' })], { apollo_enrichment_callbacks: [callback()] });
  assert.deepEqual(await mailDropCallsForCallback(found.client, token, deps(send)), { sent: true, count: 1 });
  assert.match(sent[0].text, /Ya tienes el teléfono de Pedro Araya/);
  // A lookup of another table, one without a mobile, a contact of no drop, a token nobody gave: nothing.
  for (const row of [callback({ target_table: 'people_search_leads' }), callback({ reveal_phone: false }), callback({ target_lead_id: 'e-404' })]) {
    const other = seed(items(), [lead('e-1', { primary_phone: '+56987654321' })], { apollo_enrichment_callbacks: [row] });
    assert.deepEqual(await mailDropCallsForCallback(other.client, token, deps(send)), { sent: false, reason: 'not_a_drop' });
  }
  assert.deepEqual(await mailDropCallsForCallback(seed(items(), []).client, token, deps(send)), { sent: false, reason: 'not_a_drop' });
  assert.deepEqual(await mailDropCallsForCallback(found.client, 'no', deps(send)), { sent: false, reason: 'unknown' });
  assert.equal(sent.length, 1);
});

test('with their mobiles asked, the script of each saved contact is written at once, three at a time, and only where there is none', async () => {
  const { client } = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1', call: { script, at: NOW.toISOString() } }), item(B, 'Luisa Soto', { savedLeadId: 'e-2' }), item(C, 'Raúl Pinto', { savedLeadId: 'e-3' }), item('6accdbfcd5f5d80001cf6904', 'Sin Guardar')], []);
  const asked: string[] = [];
  assert.deepEqual(await prepareDropCalls(client, scope, DROP, async leadId => { asked.push(leadId); if (leadId === C) throw new Error('model down'); }), { ready: 1, asked: 2 });
  assert.deepEqual(asked.sort(), [B, C]);
});

test('the answer keeps the subject the morning email left with, when it was written to bring the person back (18 nov)', async () => {
  const { client, tables } = seed([item(A, 'Pedro Araya', { savedLeadId: 'e-1' }), item(B, 'Luisa Soto', { savedLeadId: 'e-2' })], [lead('e-1'), lead('e-2')]);
  tables.lead_drops[0].criteria = { subject: 'Gerente HSE en Minera Andina y 1 contacto más, con su correo ya escrito' };
  const { sent, send } = outbox();
  assert.deepEqual(await mailDropReady(client, scope, DROP, {}, deps(send)), { sent: true, count: 2 });
  assert.equal(sent[0].subject, 'Re: Gerente HSE en Minera Andina y 1 contacto más, con su correo ya escrito');
  assert.equal(sent[0].headers['Thread-Topic'], 'Gerente HSE en Minera Andina y 1 contacto más, con su correo ya escrito');
});
