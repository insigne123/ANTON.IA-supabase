import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthError } from './auth-utils';
import { memory } from './goals-alerts-test-fixtures';
import { signDropLink } from './lead-drop-link';
import { enrichDropLead, mailDropView, resolveDropLink, switchDropCampaign } from './lead-drop-mail';

const ORG = 'org-1', USER = 'u-ana', DROP = '11111111-1111-4111-8111-111111111111';
const LEAD = '6accdbfcd5f5d80001cf6901', OTHER = '6accdbfcd5f5d80001cf6902';
const scope = { organizationId: ORG, userId: USER };
const NOW = new Date('2026-11-13T12:00:00.000Z');
const item = (leadId: string, extra: Record<string, unknown> = {}) => ({ leadId, name: 'Pedro A.', title: 'Gerente HSE', company: 'Minera Andina', domain: 'mineraandina.cl', industry: 'Minería', size: null,
  city: null, hasEmail: true, hasPhone: false, why: 'Calza.', research: [], provider: 'apollo',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}}' }, followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola' }], ...extra });
const seed = (first: Record<string, unknown> = {}, more: Record<string, any[]> = {}) => memory({
  lead_drops: [{ id: DROP, organization_id: ORG, user_id: USER, drop_date: '2026-11-13', status: 'sent', criteria: {}, items: [item(LEAD, first), item(OTHER, { name: 'Luisa S.' })] }],
  organization_members: [{ organization_id: ORG, user_id: USER }],
  enriched_leads: [], leads: [], provider_tokens: [], profiles: [{ id: USER, default_mail_provider: null }], ...more,
});
const refused = async (work: Promise<unknown>, status: number, message: RegExp) => assert.rejects(work, (error: any) => error.status === status && message.test(error.message));

test('a link acts as the drop\'s own person while they are on the team; expired, forged or orphaned, it opens nothing', async () => {
  const previous = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = 'a-secret-for-tests';
  try {
    const { client, tables } = seed();
    const token = signDropLink(DROP, { now: NOW })!;
    const link = await resolveDropLink(client, token, NOW);
    assert.deepEqual({ dropId: link.dropId, scope: link.scope }, { dropId: DROP, scope });
    await refused(resolveDropLink(client, token, new Date(NOW.getTime() + 15 * 86_400_000)), 410, /venció/);
    await refused(resolveDropLink(client, `${token.slice(0, 47)}${token[47] === 'A' ? 'B' : 'A'}`, NOW), 404, /no es válido/);
    await refused(resolveDropLink(client, signDropLink('22222222-2222-4222-8222-222222222222', { now: NOW })!, NOW), 404, /ya no está disponible/);
    // A drop that never got ready, and a person who left the team.
    tables.lead_drops[0].status = 'pending';
    await refused(resolveDropLink(client, token, NOW), 404, /ya no está disponible/);
    tables.lead_drops[0].status = 'ready';
    tables.organization_members.length = 0;
    await refused(resolveDropLink(client, token, NOW), 404, /ya no está disponible/);
  } finally { if (previous === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previous; }
});

test('the page shows each contact, the address of those already looked up (the person\'s own only) and the mailbox that sends', async () => {
  const { client } = seed({ savedLeadId: 'e-1' }, {
    enriched_leads: [{ id: 'e-1', organization_id: ORG, user_id: USER, email: ' Pedro.Araya@MineraAndina.cl ' }, { id: 'e-2', organization_id: ORG, user_id: 'u-otro', email: 'x@otra.cl' }],
    provider_tokens: [{ user_id: USER, provider: 'outlook' }],
  });
  const view = await mailDropView(client, scope, DROP);
  assert.equal(view.date, '2026-11-13');
  assert.deepEqual(view.items.map(entry => entry.leadId), [LEAD, OTHER]);
  assert.deepEqual(view.emails, { [LEAD]: 'pedro.araya@mineraandina.cl' });
  assert.equal(view.mailbox, 'Outlook');
  assert.equal((await mailDropView(seed().client, scope, DROP)).mailbox, null, 'nothing connected yet');
  // Another member's saved contact is never read, even if a drop named it.
  const foreign = seed({ savedLeadId: 'e-2' }, { enriched_leads: [{ id: 'e-2', organization_id: ORG, user_id: 'u-otro', email: 'x@otra.cl' }] });
  assert.deepEqual((await mailDropView(foreign.client, scope, DROP)).emails, {});
  await refused(mailDropView(seed().client, { ...scope, userId: 'u-otro' }, DROP), 404, /No encontramos/);
});

/** The app's lookup route, as the server would answer it: it writes the «Por escribir» row itself, then says what it found. */
const lookupRoute = (tables: Record<string, any[]>, answer: (request: { url: string; headers: Record<string, string>; body: any }) => { status?: number; body: any; persist?: Record<string, unknown> | null }) => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetcher = (async (url: string, init: any) => {
    const request = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(init.body) };
    requests.push(request);
    const result = answer(request);
    if (result.persist) tables.enriched_leads.push({ id: 'e-new', organization_id: ORG, user_id: USER, source_provider_id: LEAD, data: {}, created_at: NOW.toISOString(), ...result.persist });
    return Response.json(result.body, { status: result.status ?? 200 });
  }) as unknown as typeof fetch;
  return { requests, deps: { fetch: fetcher, baseUrl: 'https://app.example.test/', internalSecret: 'internal', now: NOW } };
};

test('«Enriquecer» from the inbox: the app\'s own lookup, asked as that member, and the contact lands with its email and its emails', async () => {
  const { client, tables } = seed();
  const route = lookupRoute(tables, request => ({
    persist: { email: 'pedro.araya@mineraandina.cl', full_name: 'Pedro Araya' },
    body: { operationStatus: 'completed', usage: { consumed: 1 }, enriched: [{ id: 'e-new', clientRef: request.body.leads[0].clientRef, email: 'Pedro.Araya@MineraAndina.cl', enrichmentStatus: 'completed', serverPersisted: true }] },
  }));
  const done = await enrichDropLead(client, scope, DROP, LEAD, route.deps);
  assert.deepEqual(done, { outcome: 'found', email: 'pedro.araya@mineraandina.cl', consumed: 1 });
  const [request] = route.requests;
  assert.equal(request.url, 'https://app.example.test/api/opportunities/enrich-apollo');
  assert.equal(request.headers['x-user-id'], USER);
  assert.equal(request.headers['x-organization-id'], ORG);
  assert.equal(request.headers['x-internal-api-secret'], 'internal');
  assert.equal(request.headers['Idempotency-Key'], `lead-drop:${DROP}:${LEAD}:email:0`);
  const [asked] = request.body.leads;
  assert.deepEqual({ ...request.body, leads: undefined }, { leads: undefined, revealEmail: true, revealPhone: false, tableName: 'enriched_leads' }, 'the email only: a phone is never looked up from an email');
  assert.deepEqual({ fullName: asked.fullName, companyName: asked.companyName, companyDomain: asked.companyDomain, sourceProviderId: asked.sourceProviderId },
    { fullName: 'Pedro A.', companyName: 'Minera Andina', companyDomain: 'mineraandina.cl', sourceProviderId: LEAD });
  assert.equal(asked.clientRef, asked.id);
  // Tied to the drop with the surname the lookup brought, in «Por escribir» with the drop's emails, and out of the saved ones.
  const [first, second] = tables.lead_drops[0].items;
  assert.equal(first.savedLeadId, 'e-new');
  assert.equal(first.name, 'Pedro Araya');
  assert.equal(second.savedLeadId, undefined, 'the other contact is as it was');
  assert.equal(tables.enriched_leads[0].data.leadDrop.draft.subject, 'Brigadas en faena');
  assert.deepEqual(tables.leads, []);
  // Asked again: it is already here, and nothing is looked up or paid.
  assert.deepEqual(await enrichDropLead(client, scope, DROP, LEAD, route.deps), { outcome: 'found', email: null, consumed: 0 });
  assert.equal(route.requests.length, 1);
});

test('a second tap while the first lookup is out repeats that operation; only one that ended without an email starts a new one', async () => {
  const { client, tables } = seed();
  let found = false;
  const route = lookupRoute(tables, request => found
    ? { persist: { email: 'pedro@mineraandina.cl' }, body: { usage: { consumed: 1 }, enriched: [{ clientRef: request.body.leads[0].clientRef, email: 'pedro@mineraandina.cl', enrichmentStatus: 'completed' }] } }
    : { body: { usage: { consumed: 0 }, enriched: [{ clientRef: request.body.leads[0].clientRef, enrichmentStatus: 'completed' }] } });
  // Nothing found: said as such, the saved contact is marked «Sin correo», and the card knows.
  assert.deepEqual(await enrichDropLead(client, scope, DROP, LEAD, route.deps), { outcome: 'not_found', email: null, consumed: 0 });
  assert.equal(tables.leads.length, 1);
  assert.deepEqual(tables.leads[0].email_enrichment, { enriched: false, status: 'not_found', attemptedAt: NOW.toISOString() });
  assert.deepEqual(tables.lead_drops[0].items[0].lookup, { attempt: 1, at: NOW.toISOString(), missed: true });
  assert.equal(tables.lead_drops[0].items[0].savedLeadId, undefined);
  // The next tap is a new operation, and this time the provider has it.
  found = true;
  assert.equal((await enrichDropLead(client, scope, DROP, LEAD, route.deps)).outcome, 'found');
  assert.deepEqual(route.requests.map(request => request.headers['Idempotency-Key']), [`lead-drop:${DROP}:${LEAD}:email:0`, `lead-drop:${DROP}:${LEAD}:email:1`]);

  // No answer in time: the same operation is asked again by the next tap (the app's route answers what it already did, and charges once).
  const slow = seed();
  let calls = 0;
  const keys: string[] = [];
  const hanging = { ...lookupRoute(slow.tables, () => ({ body: {} })).deps, fetch: (async (_url: string, init: any) => { keys.push(init.headers['Idempotency-Key']); calls++; throw new Error('timeout'); }) as unknown as typeof fetch };
  await refused(enrichDropLead(slow.client, scope, DROP, LEAD, hanging), 504, /no se cobra dos veces/);
  await refused(enrichDropLead(slow.client, scope, DROP, LEAD, { ...hanging, now: new Date(NOW.getTime() + 60_000) }), 504, /tarda más/);
  assert.equal(calls, 2);
  assert.deepEqual(keys, [`lead-drop:${DROP}:${LEAD}:email:0`, `lead-drop:${DROP}:${LEAD}:email:0`]);
  // A lookup that never answered is given up for after a quarter of an hour.
  await refused(enrichDropLead(slow.client, scope, DROP, LEAD, { ...hanging, now: new Date(NOW.getTime() + 20 * 60_000) }), 504, /tarda más/);
  assert.equal(keys[2], `lead-drop:${DROP}:${LEAD}:email:1`);
});

test('a lookup the provider is still answering, a refusal and a failure are each said as they are', async () => {
  // Still looking: the contact is already in «Por escribir», its address lands by itself.
  const waiting = seed();
  const pending = lookupRoute(waiting.tables, request => ({ status: 202, persist: { email: null, enrichment_status: 'pending_email' },
    body: { operationStatus: 'submitted', usage: { consumed: 1 }, enriched: [{ clientRef: request.body.leads[0].clientRef, enrichmentStatus: 'pending_email' }] } }));
  assert.deepEqual(await enrichDropLead(waiting.client, scope, DROP, LEAD, pending.deps), { outcome: 'pending', email: null, consumed: 1 });
  assert.equal(waiting.tables.lead_drops[0].items[0].savedLeadId, 'e-new');

  // The team's share of credits is used up, or another member holds the person: the app's own words.
  const short = seed();
  const refusal = lookupRoute(short.tables, () => ({ status: 409, body: { error: 'APOLLO_CREDITS_ALLOCATION_USED', message: 'Tu equipo usó sus créditos de este mes.' } }));
  await refused(enrichDropLead(short.client, scope, DROP, LEAD, refusal.deps), 409, /^Tu equipo usó sus créditos de este mes\.$/);
  assert.equal(short.tables.lead_drops[0].items[0].lookup.attempt, 1, 'a refused lookup is over: the next one is new');
  const quota = seed();
  await refused(enrichDropLead(quota.client, scope, DROP, LEAD, lookupRoute(quota.tables, () => ({ status: 429, body: {} })).deps), 429, /cupo de búsquedas/);
  const down = seed();
  await refused(enrichDropLead(down.client, scope, DROP, LEAD, lookupRoute(down.tables, () => ({ status: 500, body: { error: 'x' } })).deps), 503, /No pudimos buscar su correo/);

  // Never without the server's own secret and address, never another person's drop, never a contact that is not in it.
  const { client, tables } = seed();
  const route = lookupRoute(tables, () => ({ body: {} }));
  await refused(enrichDropLead(client, scope, DROP, LEAD, { ...route.deps, internalSecret: '' }), 503, /No pudimos buscar su correo/);
  await refused(enrichDropLead(client, { ...scope, userId: 'u-otro' }, DROP, LEAD, route.deps), 404, /No encontramos/);
  await refused(enrichDropLead(client, scope, DROP, 'ffffffffffffffffffffffff', route.deps), 404, /No encontramos ese contacto/);
  assert.equal(route.requests.length, 0);
  assert.deepEqual(tables.leads, []);
});

test('«Detener» and «Reanudar»: the campaign approved from the drop stops and goes on, once, as the person it belongs to', async () => {
  const campaign = { id: 'c-1', provider: 'google', approvedAt: NOW.toISOString() };
  const { client, tables } = seed({ savedLeadId: 'e-1', campaign });
  let status = 'approved';
  const reviewed: any[] = [];
  const deps = {
    now: NOW,
    get: (async (auth: any, id: string) => { assert.deepEqual([auth.user.id, auth.organizationId, auth.organizationIds, id], [USER, ORG, [ORG], 'c-1']); return { id, status, revision: 4, review_hash: 'b'.repeat(64) }; }) as any,
    review: (async (_auth: any, id: string, input: any) => { reviewed.push({ id, input }); status = input.action === 'pause' ? 'paused' : 'approved'; }) as any,
  };
  await switchDropCampaign(client, scope, DROP, LEAD, 'pause', deps);
  assert.deepEqual(reviewed, [{ id: 'c-1', input: { action: 'pause', revision: 4, reviewHash: 'b'.repeat(64) } }]);
  assert.equal(tables.lead_drops[0].items[0].campaign.pausedAt, NOW.toISOString());
  await switchDropCampaign(client, scope, DROP, LEAD, 'pause', deps);
  assert.equal(reviewed.length, 1, 'already stopped: nothing is asked again');
  await switchDropCampaign(client, scope, DROP, LEAD, 'resume', deps);
  assert.equal(reviewed[1].input.action, 'resume');
  assert.equal(tables.lead_drops[0].items[0].campaign.pausedAt, null);
  // A campaign that is neither going nor stopped (rejected, or changed elsewhere) is not touched.
  status = 'draft';
  await refused(switchDropCampaign(client, scope, DROP, LEAD, 'pause', deps), 409, /ya terminó o cambió/);
  await refused(switchDropCampaign(client, scope, DROP, OTHER, 'pause', deps), 409, /todavía no tiene una campaña/);
  await refused(switchDropCampaign(client, scope, DROP, LEAD, 'pause', { ...deps, get: (async () => { throw new AuthError('Campaña no encontrada.', 404); }) as any }), 404, /no encontrada/);
  await refused(switchDropCampaign(client, scope, DROP, LEAD, 'resume', { ...deps, get: (async () => { throw new Error('boom'); }) as any }), 503, /No pudimos reanudar/);
});
