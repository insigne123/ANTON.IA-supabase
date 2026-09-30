import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COWORK_BATCH_REASON, LINKEDIN_BATCH_INVITES_MAX, LINKEDIN_BATCH_MESSAGES_MAX, coworkBatchCompanyKeys, coworkLinkedinBatchKindOf,
  coworkLinkedinBatchLabel, coworkLinkedinBatchLeads, coworkLinkedinBatchSchema, coworkLinkedinBatchSummary, hashCoworkLinkedinBatch,
  planLinkedinBatch, type CoworkLinkedinBatchCandidate,
} from './linkedin-batch';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n: number, company: string | null, extra: Partial<CoworkLinkedinBatchCandidate> = {}): CoworkLinkedinBatchCandidate => ({
  id: id(n), name: `Persona ${n}`, company, title: 'Gerente', canonicalUrl: `https://www.linkedin.com/in/persona-${n}`,
  keys: coworkBatchCompanyKeys({ id: id(n), email: company ? `p${n}@${company.toLowerCase().replace(/\s/g, '')}.cl` : null, company }), ...extra,
});

test('the two batches have their own effect kinds and read back from them', () => {
  assert.equal(coworkLinkedinBatchKindOf('linkedin_invite_batch'), 'invite');
  assert.equal(coworkLinkedinBatchKindOf('linkedin_message_batch'), 'message');
  assert.equal(coworkLinkedinBatchKindOf('linkedin_invite'), null);
  assert.equal(coworkLinkedinBatchKindOf(undefined), null);
});

test('a proposal is a list of observed contacts; nothing else can ride in it', () => {
  assert.equal(coworkLinkedinBatchSchema.safeParse({ leads: [{ leadId: id(1) }] }).success, true);
  assert.equal(coworkLinkedinBatchSchema.safeParse({ leads: [] }).success, false);
  assert.equal(coworkLinkedinBatchSchema.safeParse({ leads: [{ leadId: 'no-uuid' }] }).success, false);
  assert.equal(coworkLinkedinBatchSchema.safeParse({ leads: [{ leadId: id(1), url: 'https://otra.example' }] }).success, false, 'the profile is the saved contact\'s, never the model\'s');
  assert.equal(coworkLinkedinBatchSchema.safeParse({ leads: [{ leadId: id(1) }], extra: 1 }).success, false);
  const many = (count: number) => ({ leads: Array.from({ length: count }, (_, index) => ({ leadId: id(index + 1) })) });
  assert.equal(coworkLinkedinBatchSchema.safeParse(many(LINKEDIN_BATCH_INVITES_MAX)).success, true);
  assert.equal(coworkLinkedinBatchSchema.safeParse(many(LINKEDIN_BATCH_INVITES_MAX + 1)).success, false);
});

test('invitations go without a note and messages each with their own text, never repeating a person', () => {
  assert.deepEqual(coworkLinkedinBatchLeads('invite', { leads: [{ leadId: id(1) }, { leadId: id(2), message: null }] }),
    [{ leadId: id(1), message: null }, { leadId: id(2), message: null }]);
  assert.throws(() => coworkLinkedinBatchLeads('invite', { leads: [{ leadId: id(1), message: 'Hola' }] }), /Las invitaciones van sin nota/);
  assert.deepEqual(coworkLinkedinBatchLeads('message', { leads: [{ leadId: id(1), message: '  Hola Ana  ' }] }), [{ leadId: id(1), message: 'Hola Ana' }]);
  assert.throws(() => coworkLinkedinBatchLeads('message', { leads: [{ leadId: id(1), message: 'Hola' }, { leadId: id(2) }] }), /necesita su propio texto/);
  assert.throws(() => coworkLinkedinBatchLeads('invite', { leads: [{ leadId: id(1) }, { leadId: id(1) }] }), /repetidas/);
  const messages = Array.from({ length: LINKEDIN_BATCH_MESSAGES_MAX + 1 }, (_, index) => ({ leadId: id(index + 1), message: `Hola ${index}` }));
  assert.throws(() => coworkLinkedinBatchLeads('message', { leads: messages }), /hasta 15 personas/);
  assert.equal(coworkLinkedinBatchLeads('invite', { leads: messages.map(({ leadId }) => ({ leadId })) }).length, 16, 'invitations take more people than messages');
});

test('two people are of one company by its domain or its name, and someone with no company known stands alone', () => {
  const keys = (email: string | null, company: string | null, n = 1) => coworkBatchCompanyKeys({ id: id(n), email, company });
  assert.deepEqual(keys('ana@sernorte.cl', 'Servicios Norte'), ['domain:sernorte.cl', 'company:servicios norte']);
  assert.ok(keys('otra@sernorte.cl', null, 2).some(key => keys('ana@sernorte.cl', null).includes(key)));
  assert.deepEqual(keys(null, 'Servicios Norte'), ['company:servicios norte']);
  assert.ok(keys('ana@gmail.com', 'Servicios Norte').every(key => !key.startsWith('domain:')), 'free mail identifies nobody');
  assert.deepEqual(keys(null, null, 7), [`lead:${id(7)}`]);
  assert.notDeepEqual(keys(null, null, 7), keys(null, null, 8));
});

test('one company a day: the first of each company goes and the rest wait with the reason', () => {
  const plan = planLinkedinBatch('message', [
    person(1, 'Servicios Norte', { message: 'Hola 1' }), person(2, 'Servicios Norte', { message: 'Hola 2' }),
    person(3, 'Casino Central', { message: 'Hola 3' }), person(4, 'Alimentos del Valle', { message: 'Hola 4' }),
  ]);
  assert.deepEqual(plan.items.map(item => item.id), [id(1), id(3), id(4)]);
  assert.deepEqual(plan.deferred, [{ id: id(2), name: 'Persona 2', company: 'Servicios Norte', reason: COWORK_BATCH_REASON.companyInBatch }]);
  assert.equal(plan.items[0].message, 'Hola 1', 'a message keeps its text');
});

test('a company already touched today by email or LinkedIn waits, and so does anyone the single guards stop', () => {
  const today = new Set(['domain:casinocentral.cl']);
  const plan = planLinkedinBatch('invite', [
    person(1, 'Servicios Norte'), person(2, 'Casino Central'), person(3, 'Alimentos del Valle', { blocked: 'Ya hay una invitación registrada para este perfil (estado: queued). No se duplica.' }),
  ], { companiesToday: today });
  assert.deepEqual(plan.items.map(item => item.id), [id(1)]);
  assert.deepEqual(plan.deferred.map(item => [item.id, item.reason]), [
    [id(2), COWORK_BATCH_REASON.companyToday],
    [id(3), 'Ya hay una invitación registrada para este perfil (estado: queued). No se duplica.'],
  ]);
  // A blocked person does not take their company's place for the day.
  const second = planLinkedinBatch('invite', [person(1, 'Servicios Norte', { blocked: 'Sin perfil.' }), person(2, 'Servicios Norte')]);
  assert.deepEqual(second.items.map(item => item.id), [id(2)]);
});

test('invitations stop at what is left of the weekly quota, messages do not use it', () => {
  const invites = [1, 2, 3, 4].map(n => person(n, `Empresa ${n}`));
  const plan = planLinkedinBatch('invite', invites, { quotaLeft: 2 });
  assert.deepEqual(plan.items.map(item => item.id), [id(1), id(2)]);
  assert.deepEqual(plan.deferred.map(item => item.reason), [COWORK_BATCH_REASON.quota, COWORK_BATCH_REASON.quota]);
  assert.equal(planLinkedinBatch('invite', invites, { quotaLeft: 0 }).items.length, 0);
  assert.equal(planLinkedinBatch('invite', invites, { quotaLeft: null }).items.length, 4);
  assert.equal(planLinkedinBatch('message', invites.map(candidate => ({ ...candidate, message: 'Hola' })), { quotaLeft: 0 }).items.length, 4);
});

test('an invitation item carries no message key at all, which is what the table requires', () => {
  const [item] = planLinkedinBatch('invite', [person(1, 'Servicios Norte', { message: 'no debería viajar' })]).items;
  assert.equal('message' in item, false);
  assert.deepEqual(Object.keys(item).sort(), ['canonicalUrl', 'company', 'id', 'name', 'title']);
});

test('the hash binds who, which profile and which text, and not the names shown on the card', () => {
  const base = [{ id: id(1), canonicalUrl: 'https://www.linkedin.com/in/ana', message: 'Hola Ana' }, { id: id(2), canonicalUrl: 'https://www.linkedin.com/in/luis', message: 'Hola Luis' }];
  const hash = hashCoworkLinkedinBatch('run-1', 'message', base);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashCoworkLinkedinBatch('run-1', 'message', base.map(item => ({ ...item, name: 'Otro nombre' } as typeof item))), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-2', 'message', base), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-1', 'invite', base), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-1', 'message', [base[0]]), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-1', 'message', [{ ...base[0], message: 'Hola Ana, ¿hablamos?' }, base[1]]), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-1', 'message', [{ ...base[0], canonicalUrl: 'https://www.linkedin.com/in/otra' }, base[1]]), hash);
  assert.notEqual(hashCoworkLinkedinBatch('run-1', 'message', [...base].reverse()), hash, 'the order is part of what was reviewed');
});

test('the label and the reply count people and say what is left to do', () => {
  assert.equal(coworkLinkedinBatchLabel('invite', 12), 'Invitar a 12 personas en LinkedIn');
  assert.equal(coworkLinkedinBatchLabel('message', 1), 'Escribir a 1 persona en LinkedIn');
  const results = [
    { id: id(1), name: 'Ana', status: 'queued' as const }, { id: id(2), name: 'Luis', status: 'reused' as const },
    { id: id(3), name: 'Eva', status: 'skipped' as const, reason: 'La empresa ya respondió.' }, { id: id(4), name: 'Teo', status: 'removed' as const },
  ];
  assert.equal(coworkLinkedinBatchSummary('invite', results),
    'Quedaron en cola 2 de 4 invitaciones. Ejecútalas desde la extensión ante cada perfil; vencen en 7 días. 1 no salió: el motivo está en cada persona. Quitaste a 1 persona de la lista.');
  assert.match(coworkLinkedinBatchSummary('message', results.slice(0, 2)), /^Quedaron en cola 2 de 2 mensajes\. Ejecútalos desde la extensión/);
  assert.equal(coworkLinkedinBatchSummary('invite', [results[2]]), 'Quedaron en cola 0 de 1 invitaciones. 1 no salió: el motivo está en cada persona.');
});
