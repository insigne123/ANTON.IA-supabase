import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthError } from './auth-utils';
import { memory } from './goals-alerts-test-fixtures';
import { approveDropCampaign, editDropEmails, mailDropCampaign, saveDropFeedback } from './lead-drop-campaign';
import { dropLessons } from './lead-drop-finder';

const ORG = 'org-1', USER = 'u-ana', DROP = '11111111-1111-4111-8111-111111111111';
const LEAD = '6accdbfcd5f5d80001cf6901', OTHER = '6accdbfcd5f5d80001cf6902';
const scope = { organizationId: ORG, userId: USER };
const item = (leadId: string, extra: Record<string, unknown> = {}) => ({ leadId, name: 'Pedro Araya', title: 'Gerente HSE', company: 'Minera Andina', domain: null, industry: 'Minería', size: null,
  city: null, hasEmail: true, hasPhone: false, why: 'Calza.', research: [], provider: 'apollo',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche en {{empresa}}?' },
  followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }, { day: 7, subject: 'Planes', body: 'Otra idea.' }, { day: 11, subject: 'Cierro', body: 'Último correo.' }], ...extra });
const seed = (first: Record<string, unknown> = {}) => memory({
  lead_drops: [{ id: DROP, organization_id: ORG, user_id: USER, drop_date: '2026-11-13', status: 'sent', criteria: {}, items: [item(LEAD, first), item(OTHER, { name: 'Luisa Soto' })] }],
  enriched_leads: [{ id: 'e-1', organization_id: ORG, user_id: USER, email: 'Pedro.Araya@MineraAndina.cl' }, { id: 'e-9', organization_id: ORG, user_id: 'u-otro', email: 'x@otra.cl' }],
  profiles: [{ id: USER, email: 'ana@brigadas.cl', full_name: 'Ana Rojas', signatures: {} }],
});
const auth = { supabase: {} as any, user: { id: USER } as any, organizationId: ORG };
const NOW = new Date('2026-11-13T12:00:00.000Z');
const refused = async (work: Promise<unknown>, status: number, message: RegExp) => assert.rejects(work, (error: any) => error.status === status && message.test(error.message));

test('the person\'s own text replaces the emails; the days and how many there are stay, and another person\'s drop is not theirs to change', async () => {
  const { client, tables } = seed();
  const emails = { draft: { subject: ' Turnos de noche ', body: 'Hola {{nombre}}, una pregunta.' }, followUps: [{ subject: 'Uno', body: 'A' }, { subject: 'Dos', body: 'B' }, { subject: 'Tres', body: 'C' }] };
  const { items } = await editDropEmails(client, scope, DROP, LEAD, emails);
  assert.deepEqual(items[0].draft, { subject: 'Turnos de noche', body: 'Hola {{nombre}}, una pregunta.' });
  assert.deepEqual(items[0].followUps, [{ day: 3, subject: 'Uno', body: 'A' }, { day: 7, subject: 'Dos', body: 'B' }, { day: 11, subject: 'Tres', body: 'C' }]);
  assert.equal(items[0].edited, true);
  assert.equal(tables.lead_drops[0].items[1].draft.subject, 'Brigadas en faena', 'the other contact is as it was');
  await refused(editDropEmails(client, scope, DROP, LEAD, { ...emails, followUps: emails.followUps.slice(0, 2) }), 409, /Los correos cambiaron/);
  await refused(editDropEmails(client, scope, DROP, LEAD, { ...emails, draft: { subject: '', body: 'x' } }), 400, /Escribe un asunto/);
  await refused(editDropEmails(client, { ...scope, userId: 'u-otro' }, DROP, LEAD, emails), 404, /No encontramos/);
  await refused(editDropEmails(client, scope, DROP, 'ffffffffffffffffffffffff', emails), 404, /No encontramos ese contacto/);
});

test('«Me sirve» and «No me sirve» are kept with the reason, and the finder learns from them', async () => {
  const { client, tables } = seed();
  await saveDropFeedback(client, scope, DROP, LEAD, { useful: false, reason: ' El cargo no decide ' }, NOW);
  await saveDropFeedback(client, scope, DROP, OTHER, { useful: true }, NOW);
  assert.deepEqual(tables.lead_drops[0].items.map((entry: any) => entry.feedback), [
    { useful: false, reason: 'El cargo no decide', at: '2026-11-13T12:00:00.000Z' }, { useful: true, reason: null, at: '2026-11-13T12:00:00.000Z' }]);
  assert.deepEqual(dropLessons(tables.lead_drops), { liked: ['Gerente HSE · Minería'], disliked: ['Gerente HSE · Minería (El cargo no decide)'] });
  // Changing their mind replaces what they said.
  await saveDropFeedback(client, scope, DROP, LEAD, { useful: true }, NOW);
  assert.equal(tables.lead_drops[0].items[0].feedback.useful, true);
  await refused(saveDropFeedback(client, scope, DROP, LEAD, { useful: 'sí' }), 400, /no válida/);
});

test('«Aprobar y programar»: a campaign of one person, from the mailbox that sends, with each follow-up so many days after the one before', async () => {
  const { client, tables } = seed({ savedLeadId: 'e-1' });
  const saved: any[] = [], reviewed: any[] = [];
  const deps = {
    enabled: true, now: NOW, mailbox: async () => ({ resolved: 'outlook' as const }),
    save: (async (context: any, definition: any, id: unknown, revision: number, creationId: string) => {
      saved.push({ context, definition, id, revision, creationId });
      return { id: creationId, status: 'draft', revision: 1, review_hash: 'a'.repeat(64) };
    }) as any,
    review: (async (_context: any, id: string, input: any) => { reviewed.push({ id, input }); return { id, status: 'approved' }; }) as any,
  };
  const done = await approveDropCampaign(auth, client, DROP, LEAD, deps);
  const [{ definition, context, creationId, id, revision }] = saved;
  assert.deepEqual(definition.emails, ['pedro.araya@mineraandina.cl']);
  assert.equal(definition.provider, 'outlook');
  assert.equal(definition.name, 'Contacto del día · Pedro Araya · Minera Andina');
  assert.deepEqual(definition.messages.map((message: any) => [message.subject, message.delayDays]), [['Brigadas en faena', 0], ['Re: brigadas', 3], ['Planes', 4], ['Cierro', 4]],
    'days 1, 3, 7 and 11 as the Writer named them, and from a Friday the first follow-up waits for Monday');
  assert.equal(definition.criteria.relationship, 'never_contacted');
  assert.deepEqual(context.organizationIds, [ORG]);
  assert.equal(id, undefined);
  assert.equal(revision, 0);
  assert.match(creationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(reviewed, [{ id: creationId, input: { action: 'approve', revision: 1, reviewHash: 'a'.repeat(64) } }]);
  assert.deepEqual(done.campaign, { id: creationId, provider: 'outlook', approvedAt: '2026-11-13T12:00:00.000Z' });
  assert.equal(done.provider, 'Outlook');
  assert.deepEqual(done.schedule, ['2026-11-13', '2026-11-16', '2026-11-20', '2026-11-24']);
  assert.deepEqual(tables.lead_drops[0].items[0].campaign, done.campaign);

  // Asked again (a second click, another tab): the campaign it made, and nothing new.
  const again = await approveDropCampaign(auth, client, DROP, LEAD, deps);
  assert.equal(again.campaign.id, creationId);
  assert.equal(saved.length, 1);
  // Once approved, its emails are the campaign's.
  await refused(editDropEmails(client, scope, DROP, LEAD, { draft: { subject: 'x', body: 'y' }, followUps: [{ subject: 'a', body: 'b' }, { subject: 'a', body: 'b' }, { subject: 'a', body: 'b' }] }), 409, /ya está aprobada/);
});

test('what stops a campaign is said as what to do: no email yet, no mailbox, a recipient the campaign refuses', async () => {
  const never = { save: (async () => { throw new Error('must not be reached'); }) as any, review: (async () => { throw new Error('must not be reached'); }) as any };
  const ready = { enabled: true, now: NOW, mailbox: async () => ({ resolved: 'google' as const }) };
  const fresh = seed();
  await refused(approveDropCampaign(auth, fresh.client, DROP, LEAD, { ...ready, ...never }), 409, /Primero enriquece el contacto/);
  const noEmail = seed({ savedLeadId: 'e-9' }); // a saved contact of someone else is not this person's
  await refused(approveDropCampaign(auth, noEmail.client, DROP, LEAD, { ...ready, ...never }), 409, /todavía no tiene correo/);
  const withEmail = seed({ savedLeadId: 'e-1' });
  await refused(approveDropCampaign(auth, withEmail.client, DROP, LEAD, { ...ready, ...never, mailbox: async () => ({ resolved: null }) }), 409, /Conecta Gmail u Outlook/);
  await refused(approveDropCampaign(auth, withEmail.client, DROP, LEAD, { ...ready, ...never, enabled: false }), 409, /no están habilitadas/);
  await refused(approveDropCampaign(auth, seed({ savedLeadId: 'e-1', draft: null }).client, DROP, LEAD, { ...ready, ...never }), 409, /no tiene un correo escrito/);
  // The campaign's own refusals reach the person as it words them.
  const gone = { ...ready, review: never.review, save: (async () => { throw new AuthError('pedro.araya@mineraandina.cl ya no está disponible para esta audiencia. Vuelve a buscar.', 409); }) as any };
  await refused(approveDropCampaign(auth, withEmail.client, DROP, LEAD, gone), 409, /ya no está disponible para esta audiencia/);
  const noName = { ...ready, review: never.review, save: (async () => { throw new Error('Falta nombre para pedro.araya@mineraandina.cl. Ajusta el mensaje o la audiencia.'); }) as any };
  await refused(approveDropCampaign(auth, withEmail.client, DROP, LEAD, noName), 422, /Falta nombre/);
  const broken = { ...ready, review: never.review, save: (async () => { throw new Error('connection reset'); }) as any };
  await refused(approveDropCampaign(auth, withEmail.client, DROP, LEAD, broken), 503, /No pudimos programar la campaña/);
  assert.equal(withEmail.tables.lead_drops[0].items[0].campaign, undefined, 'nothing is marked approved when it was not');
});

test('once its email is found, the campaign goes to the person\'s inbox to read: once, in full, and only where the card can approve it', async () => {
  const { client, tables } = seed({ savedLeadId: 'e-1' });
  const sent: any[] = [];
  const deps = { now: NOW, appUrl: 'https://app.ejemplo.cl', env: {}, mailbox: async () => ({ resolved: 'google' as const }), send: async (input: any) => { sent.push(input); return { ok: true }; } };
  assert.deepEqual(await mailDropCampaign(client, scope, DROP, LEAD, deps), { sent: true });
  const [email] = sent;
  assert.equal(email.userId, USER);
  assert.equal(email.to, 'ana@brigadas.cl');
  assert.equal(email.subject, 'Campaña lista para aprobar: Pedro Araya · Minera Andina');
  assert.match(email.text, /^Hola, Ana\. Encontramos el correo de Pedro Araya: pedro\.araya@mineraandina\.cl\./);
  assert.match(email.text, /sale desde tu Gmail/);
  assert.ok(email.text.includes('Hola Pedro,\n\n¿Cómo cubren los turnos de noche en Minera Andina?'), 'the first email in full, as its reader would get it');
  assert.equal((email.text.match(/^— Seguimiento \d · /gm) || []).length, 3);
  assert.ok(email.html.includes(`https://app.ejemplo.cl/search/contactos/${DROP}?c=${LEAD}`));
  assert.equal(tables.lead_drops[0].items[0].campaignMailedAt, '2026-11-13T12:00:00.000Z');
  // «Enriquecer» asked again, or the page linking twice: no second email.
  assert.deepEqual(await mailDropCampaign(client, scope, DROP, LEAD, deps), { sent: false, reason: 'not_due' });
  assert.equal(sent.length, 1);
  // With a secret to sign with, the button opens the drop's own page, which needs no session (lead-drop-link.ts).
  const open = seed({ savedLeadId: 'e-1' });
  await mailDropCampaign(open.client, scope, DROP, LEAD, { ...deps, env: { INTERNAL_API_SECRET: 'a-secret-for-tests' } });
  assert.match(sent[1].html, new RegExp(`href="https://app\\.ejemplo\\.cl/contactos/[A-Za-z0-9_-]{48}\\?c=${LEAD}"`));
  assert.ok(!sent[1].html.includes('/search/contactos/') && !sent[1].text.includes('/search/contactos/'));

  const none = async (seeded: ReturnType<typeof seed>, reason: string, extra: Record<string, unknown> = {}) => {
    const before = sent.length;
    assert.deepEqual(await mailDropCampaign(seeded.client, scope, DROP, LEAD, { ...deps, ...extra }), { sent: false, reason });
    assert.equal(sent.length, before, reason);
    assert.equal(seeded.tables.lead_drops[0].items[0].campaignMailedAt, undefined, reason);
  };
  await none(seed(), 'not_due'); // its email is still to look up
  await none(seed({ savedLeadId: 'e-1', draft: null }), 'not_due');
  await none(seed({ savedLeadId: 'e-1', campaign: { id: 'c-1', provider: 'google', approvedAt: NOW.toISOString() } }), 'not_due');
  await none(seed({ savedLeadId: 'e-9' }), 'no_contact_email'); // saved, and its email was not found
  await none(seed({ savedLeadId: 'e-1' }), 'off', { env: { LEAD_DROPS_CAMPAIGN_EMAIL: 'off' } });
  const quiet = seed({ savedLeadId: 'e-1' });
  quiet.tables.profiles[0].signatures = { daily_alerts: { email: false } };
  await none(quiet, 'unreachable');
  const testing = seed({ savedLeadId: 'e-1' });
  testing.tables.profiles[0].email = 'ana@example.com';
  await none(testing, 'unreachable');
  // The drop of one contact keeps its own way («Enriquecer y guardar» to «Por escribir»): its page has nothing to approve.
  const alone = seed({ savedLeadId: 'e-1' });
  alone.tables.lead_drops[0].items = alone.tables.lead_drops[0].items.slice(0, 1);
  await none(alone, 'single');
});

test('an email that did not go out is not marked as sent, no mailbox is said in it, and an approval made meanwhile is kept', async () => {
  const failed = seed({ savedLeadId: 'e-1' });
  const base = { now: NOW, appUrl: 'https://app.ejemplo.cl', env: {}, mailbox: async () => ({ resolved: null }) };
  assert.deepEqual(await mailDropCampaign(failed.client, scope, DROP, LEAD, { ...base, send: async () => ({ ok: false }) }), { sent: false, reason: 'send_failed' });
  assert.equal(failed.tables.lead_drops[0].items[0].campaignMailedAt, undefined);

  const racing = seed({ savedLeadId: 'e-1' });
  const campaign = { id: 'c-1', provider: 'outlook', approvedAt: NOW.toISOString() };
  let text = '';
  const send = async (input: any) => {
    text = input.text;
    // The person approves on the page while the email is on its way: another request writes the row.
    const row = racing.tables.lead_drops[0];
    racing.tables.lead_drops[0] = { ...row, items: row.items.map((entry: any) => entry.leadId === LEAD ? { ...entry, campaign } : entry) };
    return { ok: true };
  };
  assert.deepEqual(await mailDropCampaign(racing.client, scope, DROP, LEAD, { ...base, send }), { sent: true });
  assert.match(text, /Para aprobarla, conecta Gmail u Outlook en «Conexiones»\./);
  const [first, second] = racing.tables.lead_drops[0].items;
  assert.deepEqual(first.campaign, campaign, 'the stamp does not undo the approval');
  assert.equal(first.campaignMailedAt, '2026-11-13T12:00:00.000Z');
  assert.equal(second.campaignMailedAt, undefined, 'the other contact is as it was');
});
