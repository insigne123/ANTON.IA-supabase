import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { dropPhones, findDropPhone, prepareDropCall, withDropPhones } from './lead-drop-call';

const ORG = 'org-1', USER = 'u-ana', DROP = '11111111-1111-4111-8111-111111111111';
const LEAD = '6accdbfcd5f5d80001cf6901', OTHER = '6accdbfcd5f5d80001cf6902';
const scope = { organizationId: ORG, userId: USER };
const NOW = new Date('2026-11-15T15:00:00.000Z');
const item = (leadId: string, extra: Record<string, unknown> = {}) => ({ leadId, name: 'Pedro Araya', title: 'Gerente HSE', company: 'Minera Andina', domain: 'mineraandina.cl', industry: 'Minería', size: 900,
  city: 'Antofagasta', country: 'Chile', hasEmail: true, hasPhone: true, why: 'Calza con tu cliente ideal por su cargo.', research: [], provider: 'apollo', reasons: ['Responde por la seguridad de las faenas.'],
  brief: { company: 'Minera Andina procesa cobre.', news: { text: 'Amplía su planta en 2027.', date: '2026-10-01', source: 'Minería Chilena', url: 'https://example.com/n' }, fit: null, role: 'Decide los proveedores de emergencia.', opener: null },
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}}' }, ...extra });
const enriched = (id: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: ORG, user_id: USER, full_name: 'Pedro Araya', title: 'Gerente HSE', linkedin_url: 'https://linkedin.com/in/pedro',
  company_name: 'Minera Andina', organization_domain: 'mineraandina.cl', source_provider: 'apollo', source_provider_id: LEAD, primary_phone: null, phone_numbers: [], enrichment_status: 'completed',
  updated_at: '2026-11-15T14:00:00.000Z', created_at: '2026-11-15T14:00:00.000Z', ...extra });
const seed = (first: Record<string, unknown> = {}, rows: any[] = []) => memory({
  lead_drops: [{ id: DROP, organization_id: ORG, user_id: USER, drop_date: '2026-11-13', status: 'sent', criteria: {}, items: [item(LEAD, first), item(OTHER, { name: 'Luisa S.' })] }],
  enriched_leads: rows, profiles: [], organization_members: [{ organization_id: ORG, user_id: USER }],
});
const refused = async (work: Promise<unknown>, status: number, message: RegExp) => assert.rejects(work, (error: any) => error.status === status && message.test(error.message));
const deps = (answer: (request: { url: string; headers: Record<string, string>; body: any }) => { status: number; body: unknown } | Promise<never>, calls: any[]) => ({
  baseUrl: 'https://app.test/', internalSecret: 's3cret', now: NOW,
  fetch: (async (url: string, init: any) => {
    const request = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body) };
    calls.push(request);
    const result = await answer(request);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch,
});

test('each saved contact shows where its mobile stands, read from «Por escribir» (the person\'s own only) and never kept in the drop', async () => {
  const { client, tables } = seed({ savedLeadId: 'e-1' }, [enriched('e-1', { primary_phone: '+56 9 8765 4321' }), { ...enriched('e-9'), user_id: 'u-otro', primary_phone: '+56911111111' }]);
  const items = tables.lead_drops[0].items;
  assert.deepEqual(await dropPhones(client, scope, items, NOW), { [LEAD]: { state: 'found', number: '+56 9 8765 4321', more: 0 } });
  const shown = await withDropPhones(client, scope, items, NOW);
  assert.deepEqual(shown[0].phone, { state: 'found', number: '+56 9 8765 4321', more: 0 });
  assert.equal(shown[1].phone, undefined, 'a contact not looked up yet has nothing to show');
  assert.equal(items[0].phone, undefined, 'the drop itself is left as it was');
  // Someone else's row is not this person's contact.
  const other = seed({ savedLeadId: 'e-9' }, [{ ...enriched('e-9'), user_id: 'u-otro', primary_phone: '+56911111111' }]);
  assert.deepEqual(await dropPhones(other.client, scope, other.tables.lead_drops[0].items, NOW), { [LEAD]: { state: 'none', missed: false } });
});

test('«Buscar su teléfono»: the app\'s own lookup, asked as that member for the mobile only; on its way it is not asked twice, and a refusal is said as it came', async () => {
  // Not in «Por escribir» yet: its email comes first.
  const before = seed();
  await refused(findDropPhone(before.client, scope, DROP, LEAD, deps(() => ({ status: 200, body: {} }), [])), 409, /Primero enriquece/);

  const calls: any[] = [];
  const { client, tables } = seed({ savedLeadId: 'e-1' }, [enriched('e-1')]);
  const asking = deps(() => {
    // The provider took the request: the mobile lands later, by its own webhook.
    Object.assign(tables.enriched_leads[0], { enrichment_status: 'pending_phone', updated_at: new Date().toISOString() });
    return { status: 202, body: { usage: { consumed: 8 }, enriched: [{ id: 'e-1', enrichmentStatus: 'pending_phone' }] } };
  }, calls);
  assert.deepEqual(await findDropPhone(client, scope, DROP, LEAD, asking), { outcome: 'pending', consumed: 8 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.test/api/opportunities/enrich-apollo');
  assert.deepEqual([calls[0].headers['x-user-id'], calls[0].headers['x-organization-id'], calls[0].headers['x-internal-api-secret']], [USER, ORG, 's3cret']);
  assert.equal(calls[0].headers['Idempotency-Key'], `lead-drop:${DROP}:${LEAD}:phone:0`);
  assert.deepEqual([calls[0].body.revealEmail, calls[0].body.revealPhone, calls[0].body.tableName], [false, true, 'enriched_leads']);
  assert.deepEqual(calls[0].body.leads, [{ fullName: 'Pedro Araya', linkedinUrl: 'https://linkedin.com/in/pedro', title: 'Gerente HSE', companyName: 'Minera Andina', companyDomain: 'mineraandina.cl',
    clientRef: 'e-1', existingRecordId: 'e-1', sourceProvider: 'apollo', sourceProviderId: LEAD }]);
  assert.deepEqual(tables.lead_drops[0].items[0].phoneLookup, { attempt: 0, at: NOW.toISOString() });
  // A second tap while it is on its way asks nothing and pays nothing.
  assert.deepEqual(await findDropPhone(client, scope, DROP, LEAD, { ...asking, now: new Date() }), { outcome: 'pending', consumed: 0 });
  assert.equal(calls.length, 1);
  // It landed: the card has it, and asking again answers with it.
  Object.assign(tables.enriched_leads[0], { enrichment_status: 'completed', primary_phone: '+56987654321' });
  assert.deepEqual(await findDropPhone(client, scope, DROP, LEAD, asking), { outcome: 'found', consumed: 0 });
  assert.equal(calls.length, 1);

  // Searched and nothing: said so, and the next try is another operation.
  const none = seed({ savedLeadId: 'e-1', phoneLookup: { attempt: 0, at: '2026-11-14T15:00:00.000Z' } }, [enriched('e-1')]);
  const again: any[] = [];
  assert.deepEqual(await findDropPhone(none.client, scope, DROP, LEAD, deps(() => ({ status: 200, body: { usage: { consumed: 0 }, enriched: [{ id: 'e-1' }] } }), again)), { outcome: 'not_found', consumed: 0 });
  assert.equal(again[0].headers['Idempotency-Key'], `lead-drop:${DROP}:${LEAD}:phone:1`);
  // The team's credits ran out, or today's quota did: what the lookup says, not a generic failure.
  const refusal = seed({ savedLeadId: 'e-1' }, [enriched('e-1')]);
  await refused(findDropPhone(refusal.client, scope, DROP, LEAD, deps(() => ({ status: 409, body: { error: 'APOLLO_CREDITS_ALLOCATION_USED', message: 'Tu equipo no tiene créditos para esta búsqueda.' } }), [])),
    409, /no tiene créditos/);
  await refused(findDropPhone(refusal.client, scope, DROP, LEAD, deps(() => ({ status: 429, body: {} }), [])), 429, /cupo de búsquedas de hoy/);
  await refused(findDropPhone(refusal.client, scope, DROP, LEAD, deps(() => Promise.reject(new Error('timeout')), [])), 504, /no se cobra dos veces/);
  await refused(findDropPhone(refusal.client, scope, DROP, 'ffffffffffffffffffffffff', deps(() => ({ status: 200, body: {} }), [])), 404, /No encontramos ese contacto/);
});

const SCRIPT = { points: ['Turnos de noche: quién responde ante una emergencia.', 'Ampliación de la planta en 2027: más gente en faena.'],
  opening: 'Hola Pedro, soy Ana. Te llamo por las brigadas de emergencia en faena. ¿Cómo cubren hoy los turnos de noche?',
  questions: ['¿Cuántas personas quedan a cargo de noche?', '¿Cómo registran cada inspección?'], objections: [],
  voicemail: 'Hola Pedro, soy Ana. Te llamaba por las brigadas de emergencia en faena. Te escribo un correo con el detalle.',
  whatsapp: 'Hola Pedro, soy Ana. Apoyamos a faenas con brigadas de emergencia. ¿Te sirve conversar esta semana?' };

test('the script of a call is prepared once from what the drop knows of the contact and kept with it; «Otra versión» asks again, and a model that fails says so', async () => {
  const { client, tables } = seed();
  const asked: any[] = [];
  const generate = async (options: any) => { asked.push(options); return asked.length === 1 ? SCRIPT : { ...SCRIPT, opening: 'Hola Pedro, te llamo por la ampliación de la planta. ¿Quién ve hoy las emergencias en faena?' }; };
  const first = await prepareDropCall(client, scope, DROP, LEAD, { generate, now: NOW });
  assert.deepEqual(first.script, SCRIPT);
  assert.deepEqual(tables.lead_drops[0].items[0].call, { script: SCRIPT, at: NOW.toISOString() });
  assert.equal(first.items[0].call?.script.opening, SCRIPT.opening);
  // What the model read: the contact, the research's lines and the first email; nothing it was not given.
  const data = JSON.parse(String(asked[0].prompt).split('\n').pop()!);
  assert.deepEqual([data.contacto.nombre, data.contacto.cargo, data.contacto.empresa], ['Pedro Araya', 'Gerente HSE', 'Minera Andina']);
  assert.equal(data.lo_que_sabemos.novedad, 'Amplía su planta en 2027.');
  assert.deepEqual(data.lo_que_sabemos.razones, ['Responde por la seguridad de las faenas.', 'Calza con tu cliente ideal por su cargo.']);
  assert.equal(data.primer_correo.asunto, 'Brigadas en faena');
  // Asked again: the one kept, without another call to the model.
  assert.deepEqual((await prepareDropCall(client, scope, DROP, LEAD, { generate })).script, SCRIPT);
  assert.equal(asked.length, 1);
  const fresh = await prepareDropCall(client, scope, DROP, LEAD, { generate, fresh: true });
  assert.match(fresh.script.opening, /ampliación de la planta/);
  assert.equal(asked.length, 2);
  // The other contact is untouched, and a script that does not fit the contract is not kept.
  assert.equal(tables.lead_drops[0].items[1].call, undefined);
  await refused(prepareDropCall(client, scope, DROP, OTHER, { generate: async () => ({ points: [] }) }), 503, /No pudimos preparar el guion/);
  await refused(prepareDropCall(client, scope, DROP, OTHER, { generate: async () => { throw new Error('down'); } }), 503, /No pudimos preparar el guion/);
  assert.equal(tables.lead_drops[0].items[1].call, undefined);
});
