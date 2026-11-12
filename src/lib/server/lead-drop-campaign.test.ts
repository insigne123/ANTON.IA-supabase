import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthError } from './auth-utils';
import { memory } from './goals-alerts-test-fixtures';
import { approveDropCampaign, editDropEmails, saveDropFeedback } from './lead-drop-campaign';
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
  assert.deepEqual(definition.messages.map((message: any) => [message.subject, message.delayDays]), [['Brigadas en faena', 0], ['Re: brigadas', 2], ['Planes', 4], ['Cierro', 4]],
    'days 1, 3, 7 and 11 as the Writer named them');
  assert.equal(definition.criteria.relationship, 'never_contacted');
  assert.deepEqual(context.organizationIds, [ORG]);
  assert.equal(id, undefined);
  assert.equal(revision, 0);
  assert.match(creationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(reviewed, [{ id: creationId, input: { action: 'approve', revision: 1, reviewHash: 'a'.repeat(64) } }]);
  assert.deepEqual(done.campaign, { id: creationId, provider: 'outlook', approvedAt: '2026-11-13T12:00:00.000Z' });
  assert.equal(done.provider, 'Outlook');
  assert.deepEqual(done.schedule, ['2026-11-13', '2026-11-15', '2026-11-19', '2026-11-23']);
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
