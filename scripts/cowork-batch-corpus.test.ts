// Approving several people on LinkedIn at once (scripts/fixtures/cowork-batch-corpus.ts) played through the real loop with a scripted
// model: a good turn reads the contacts (and the quota for invitations) and proposes one batch with its card, or the single action, or
// nothing; a turn that answers without looking or without saying anything must not pass; and every check has been seen to fail on a good
// turn made one thing worse. Nothing is queued: the proposal is staged like the server does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { BATCH_CORPUS, BATCH_IDS } from './fixtures/cowork-batch-corpus';
import { corpusStageLinkedinJob, runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const { marcela, gerardo, hector, ana, ivan, paz } = BATCH_IDS;
const search = (query: string) => coworkDecisionSchema.parse({ action: 'leads.search', query, leadId: null, answer: null });
const readsAll = () => coworkDecisionSchema.parse({ action: 'reads.parallel', query: null, leadId: null, answer: null,
  reads: [{ action: 'leads.search', input: '' }, { action: 'linkedin.quota', input: '' }] });
const answer = (reply: string, question: string) => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply, document: null, suggestions: [{ label: 'Sí', message: 'Sí, adelante' }], question } });
const inviteBatch = (explanation: string, ids: string[]) => coworkDecisionSchema.parse({ action: 'linkedin.invite_batch', query: null, leadId: null,
  answer: { reply: explanation, document: null }, linkedinBatch: { leads: ids.map(leadId => ({ leadId })) } });
const messageBatch = (explanation: string, leads: Array<{ leadId: string; message: string }>) => coworkDecisionSchema.parse({ action: 'linkedin.message_batch',
  query: null, leadId: null, answer: { reply: explanation, document: null }, linkedinBatch: { leads } });
const single = (explanation: string, leadId: string) => coworkDecisionSchema.parse({ action: 'linkedin.invite', query: null, leadId, answer: { reply: explanation, document: null } });
const after = (first: () => ReturnType<typeof search>, next: () => ReturnType<typeof answer>): CorpusDecider => async context => context.observations.length === 0 ? first() : next();

const INVITE_NOTE = 'Preparé un lote de invitaciones sin nota para tus contactos con perfil de LinkedIn. En la tarjeta ves quién va hoy y quién no sale, puedes quitar a quien no quieras y recién ahí lo apruebas. Quedan en cola y las ejecutas desde tu extensión.';
const MESSAGE_NOTE = 'Preparé un mensaje distinto para cada persona, con sus datos. En la tarjeta los lees, puedes quitar a quien no quieras y recién ahí los apruebas; quedan en cola y se ejecutan desde tu extensión.';
const TEXTS = {
  marcela: 'Hola Marcela, gracias por aceptar mi invitación. Ayudamos a equipos de RR. HH. a revisar antecedentes laborales en minutos. ¿Te sirve una llamada corta esta semana? Saludos, Nicolás',
  hector: 'Hola Héctor, gracias por aceptar mi invitación. Trabajo con jefaturas de personal que contratan en volumen y revisamos antecedentes sin trabajo manual. ¿Conversamos 15 minutos esta semana? Saludos, Nicolás',
  ana: 'Hola Ana, gracias por conectar. Vi que te encargas de selección en Alimentos del Valle y creo que podemos ahorrarte tiempo con los antecedentes de postulantes. ¿Te parece una llamada breve esta semana? Saludos, Nicolás',
};
const messages = (overrides: Partial<Record<keyof typeof TEXTS, string>> = {}) => [
  { leadId: marcela, message: overrides.marcela ?? TEXTS.marcela }, { leadId: hector, message: overrides.hector ?? TEXTS.hector }, { leadId: ana, message: overrides.ana ?? TEXTS.ana },
];

const IDEAL: Record<string, CorpusDecider> = {
  'lote-invitar': async context => context.observations.length === 0 ? readsAll() : inviteBatch(INVITE_NOTE, [marcela, gerardo, hector, ana, ivan]),
  'lote-mensajes': after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages()) as never),
  'lote-una-persona': after(() => search('Héctor Vidal'), () => single('Preparé la invitación para Héctor Vidal, sin nota. Revísala en la tarjeta y, si la apruebas, queda en cola en tu extensión.', hector) as never),
  'lote-sin-perfil': after(() => search('Paz Soto'), () => answer('Paz Soto no tiene un perfil de LinkedIn guardado, así que no puedo invitarla por ahí. Sí tiene correo: puedo proponerte escribirle por correo.', '¿Le preparo un correo a Paz Soto?') as never),
};
const entry = (id: string) => BATCH_CORPUS.find(item => item.id === id)!;
const failing = async (id: string, decide: CorpusDecider) => (await runCorpusCase(entry(id), decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the batch bank has one ideal turn for each of its cases, all with the batch on', () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), BATCH_CORPUS.map(item => item.id).sort());
  assert.equal(new Set(BATCH_CORPUS.map(item => item.id)).size, BATCH_CORPUS.length);
  assert.ok(BATCH_CORPUS.every(item => item.linkedinBatch === true));
});

test('the world is what the app reads: saved contacts with their profile (one without), two of one company, and the weekly quota', () => {
  const world = entry('lote-invitar').world!;
  const all = world.read('leads.search', '') as { items: Array<{ id: string; linkedin_url: string | null; company: string }> };
  assert.equal(all.items.length, 6);
  assert.equal(all.items.filter(lead => lead.linkedin_url).length, 5);
  assert.equal(all.items.filter(lead => lead.company === 'Servicios Norte').length, 2);
  assert.equal((world.read('leads.search', 'Héctor') as { items: unknown[] }).items.length, 1);
  assert.deepEqual(world.read('linkedin.quota', ''), { scope: 'own_linkedin_quota', pending: 8, sent7d: 12, limit: 100, windowDays: 7, allowed: true,
    remaining: 80, reason: 'Cupo disponible: quedan 80 de 100 esta semana (20 usadas entre pendientes y enviadas de 7 días).', limitation: 'Límite operativo observado en cuentas gratuitas, no oficial de LinkedIn.' });
});

for (const item of BATCH_CORPUS) {
  test(`${item.id}: a good turn passes every check`, async () => {
    const outcome = await runCorpusCase(item, IDEAL[item.id]);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  });

  test(`${item.id}: answering without looking fails at least three checks`, async () => {
    const naive: CorpusDecider = async () => answer('Listo, ya les envié las invitaciones a todos.', '¿Algo más?');
    const missed = await failing(item.id, naive);
    assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
  });

  test(`${item.id}: looking and saying nothing fails at least three checks`, async () => {
    const vacuous: CorpusDecider = async context => context.observations.length === 0 ? search('') : answer('Revisé tus contactos y hay cosas por hacer.', '¿Seguimos?');
    const missed = await failing(item.id, vacuous);
    assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

test('the proposal the server would stage is what the card lists: who goes, who waits and why, and the text of each message', async () => {
  const invites = await runCorpusCase(entry('lote-invitar'), IDEAL['lote-invitar']);
  const batch = invites.result.proposal!.linkedinBatch!;
  assert.equal(invites.result.proposal!.label, 'Invitar a 4 personas en LinkedIn');
  assert.deepEqual(batch.items.map(item => item.id), [marcela, hector, ana, ivan]);
  assert.deepEqual(batch.deferred.map(person => person.id), [gerardo]);
  assert.match(batch.deferred[0].reason, /Otra persona de esa empresa va hoy en este lote: una empresa por día/);
  assert.ok(batch.items.every(item => !('message' in item)), 'an invitation carries no note');
  const written = await runCorpusCase(entry('lote-mensajes'), IDEAL['lote-mensajes']);
  assert.equal(written.result.proposal!.label, 'Escribir a 3 personas en LinkedIn');
  assert.deepEqual(written.result.proposal!.linkedinBatch!.items.map(item => item.message), [TEXTS.marcela, TEXTS.hector, TEXTS.ana]);
});

test('a batch for a contact with no profile, or for someone who is not saved, never becomes a proposal', async () => {
  const onlyPaz = await runCorpusCase(entry('lote-invitar'), async context => context.observations.length === 0 ? readsAll() : inviteBatch('Preparé el lote; revísalo en la tarjeta.', [paz]));
  assert.equal(onlyPaz.result.proposal, null);
  assert.equal(onlyPaz.passed, false);
  const stranger = await runCorpusCase(entry('lote-invitar'), async context => context.observations.length === 0 ? readsAll()
    : inviteBatch('Preparé el lote; revísalo en la tarjeta.', ['00000000-0000-4000-8000-0000000000bf']));
  assert.equal(stranger.result.proposal, null);
  assert.equal(stranger.passed, false);
});

test('lote-sin-perfil: an invitation proposed for someone with no profile is refused with the server\'s sentence, and a model that then says so passes', async () => {
  const refusals: string[] = [];
  const outcome = await runCorpusCase(entry('lote-sin-perfil'), async context => {
    if (context.observations.length === 0) return search('Paz Soto');
    const rejected = (context as { rejectedDecisions?: Array<{ reason?: string }> }).rejectedDecisions;
    if (rejected?.length) {
      refusals.push(...rejected.map(item => String(item.reason || '')));
      return answer('Paz Soto no tiene un perfil de LinkedIn guardado, así que no puedo invitarla por ahí. Sí tiene correo: puedo proponerte escribirle por correo.', '¿Le preparo un correo a Paz Soto?');
    }
    return single('Preparé la invitación para Paz Soto; revísala en la tarjeta.', paz);
  });
  assert.ok(refusals.some(text => text.includes('El contacto no tiene una URL de perfil LinkedIn válida.')), `the model did not read the refusal: ${refusals.join(' | ') || 'none'}`);
  assert.equal(outcome.result.proposal, null);
  assert.deepEqual(outcome.checks.filter(check => !check.passed).map(check => check.label), []);
});

test('the single action of a world that does not model profiles is taken as it is: only a contact that says it has none is refused', () => {
  const read = (action: string) => action === 'leads.search' ? { items: [{ id: 'with' }, { id: 'none', linkedin_url: null }, { id: 'bad', linkedin_url: 'https://www.linkedin.com/company/x' }, { id: 'ok', linkedin_url: 'https://www.linkedin.com/in/ana-ruiz' }] } : null;
  assert.doesNotThrow(() => corpusStageLinkedinJob({ leadId: 'with' }, read));
  assert.doesNotThrow(() => corpusStageLinkedinJob({ leadId: 'ok' }, read));
  assert.doesNotThrow(() => corpusStageLinkedinJob({ leadId: 'unknown' }, read));
  assert.throws(() => corpusStageLinkedinJob({ leadId: 'none' }, read), /no tiene una URL de perfil LinkedIn válida/);
  assert.throws(() => corpusStageLinkedinJob({ leadId: 'bad' }, read), /no tiene una URL de perfil LinkedIn válida/);
});

test('lote-invitar: a sentence about the quota is a fact the read gave, not how many go', async () => {
  const quota = 'Hay cupo disponible: aparecen 8 invitaciones pendientes y el límite es 100 en los últimos 7 días.';
  const ok = await failing('lote-invitar', async context => context.observations.length === 0 ? readsAll() : inviteBatch(`${INVITE_NOTE} ${quota}`, [marcela, gerardo, hector, ana, ivan]));
  assert.ok(!ok.includes('no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta'), `the quota sentence was taken for a count: ${ok.join(' | ')}`);
  for (const count of ['Encontré 5 contactos guardados con perfil de LinkedIn.', 'Hay cupo: 4 invitaciones saldrán hoy.', 'Invito a las 5 personas con perfil.']) {
    const missed = await failing('lote-invitar', async context => context.observations.length === 0 ? readsAll() : inviteBatch(`${INVITE_NOTE} ${count}`, [marcela, gerardo, hector, ana, ivan]));
    assert.ok(missed.includes('no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta'), `«${count}» was not taken for a count`);
  }
});

test('lote-sin-perfil: every honest way of saying the person has no saved profile counts', async () => {
  for (const reply of ['Paz Soto no tiene un perfil de LinkedIn guardado. Sí tiene correo.', 'Paz Soto tiene correo guardado, pero no un perfil de LinkedIn. Puedo escribirle por correo.',
    'No hay perfil de LinkedIn guardado para Paz Soto; puedo escribirle por correo.']) {
    const missed = await failing('lote-sin-perfil', after(() => search('Paz Soto'), () => answer(reply, '¿Le preparo un correo a Paz Soto?') as never));
    assert.ok(!missed.includes('dice que no tiene perfil de LinkedIn guardado'), `«${reply}» was not taken for saying it`);
  }
  const silent = await failing('lote-sin-perfil', after(() => search('Paz Soto'), () => answer('Paz Soto trabaja en Transportes Sur. Puedo escribirle por correo.', '¿Le preparo un correo a Paz Soto?') as never));
  assert.ok(silent.includes('dice que no tiene perfil de LinkedIn guardado'));
});

// A check nobody ever saw fail proves nothing: each of these makes one thing worse in a good turn and names the check that must notice.
const MUTATIONS: Array<{ id: string; what: string; decide: CorpusDecider; notices: string }> = [
  { id: 'lote-invitar', what: 'includes someone with no profile', notices: 'no incluye a quien no tiene perfil de LinkedIn guardado',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch(INVITE_NOTE, [marcela, hector, ana, ivan, paz]) },
  { id: 'lote-invitar', what: 'leaves a whole company out', notices: 'cubre a las personas con perfil, una de cada empresa como mínimo',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch(INVITE_NOTE, [marcela, ana, ivan]) },
  { id: 'lote-invitar', what: 'proposes without reading the quota', notices: 'consulta linkedin.quota antes de proponer',
    decide: async context => context.observations.length === 0 ? search('') : inviteBatch(INVITE_NOTE, [marcela, hector, ana, ivan]) },
  { id: 'lote-invitar', what: 'says it already sent them', notices: 'no dice que ya se enviaron ni que ya salieron',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch(INVITE_NOTE.replace('Preparé un lote', 'Ya se enviaron. Preparé un lote'), [marcela, gerardo, hector, ana, ivan]) },
  { id: 'lote-invitar', what: 'does not say the card is where it is approved', notices: 'dice que lo revisas o lo apruebas en la tarjeta antes de que salga',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch('Invitaré a todos tus contactos con perfil de LinkedIn.', [marcela, gerardo, hector, ana, ivan]) },
  { id: 'lote-invitar', what: 'gives a figure the server sets', notices: 'no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch(`${INVITE_NOTE} Cuatro invitaciones saldrán hoy.`, [marcela, gerardo, hector, ana, ivan]) },
  { id: 'lote-invitar', what: 'says how many people have a profile', notices: 'no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta',
    decide: async context => context.observations.length === 0 ? readsAll() : inviteBatch('Propongo invitar a tus cinco contactos con perfil; revísalo en la tarjeta antes de aprobar.', [marcela, gerardo, hector, ana, ivan]) },
  { id: 'lote-mensajes', what: 'says how many messages go', notices: 'no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE.replace('para cada persona', 'para cada una de las 3 personas'), messages()) as never) },
  { id: 'lote-mensajes', what: 'leaves a placeholder in a text', notices: 'ningún mensaje deja un marcador por completar ni pide el dato de otra persona',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages({ marcela: TEXTS.marcela.replace('Saludos, Nicolás', 'Saludos, [tu nombre] Nicolás') })) as never) },
  { id: 'lote-mensajes', what: 'sends the same text to two people', notices: 'cada mensaje es distinto',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages({ hector: TEXTS.marcela })) as never) },
  { id: 'lote-mensajes', what: 'does not sign with the real name', notices: 'cada mensaje va firmado con el nombre real de quien escribe',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages({ ana: TEXTS.ana.replace('Saludos, Nicolás', 'Saludos') })) as never) },
  { id: 'lote-mensajes', what: 'writes a long message', notices: 'cada mensaje es breve: hasta 600 caracteres',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages({ ana: `${TEXTS.ana} ${'Además trabajamos con empresas de muchos rubros y acompañamos cada proceso paso a paso. '.repeat(8)}` })) as never) },
  { id: 'lote-mensajes', what: 'promises a price', notices: 'ningún mensaje promete precio ni plazo',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, messages({ hector: TEXTS.hector.replace('¿Conversamos', 'Sale $990 por persona. ¿Conversamos') })) as never) },
  { id: 'lote-mensajes', what: 'adds someone who was not asked', notices: 'es para las tres personas pedidas, y solo ellas',
    decide: after(() => search(''), () => messageBatch(MESSAGE_NOTE, [...messages(), { leadId: ivan, message: 'Hola Iván, gracias por conectar. ¿Te sirve una llamada breve? Saludos, Nicolás' }]) as never) },
  { id: 'lote-una-persona', what: 'turns one person into a batch', notices: 'propone la invitación individual, no un lote',
    decide: after(() => search('Héctor Vidal'), () => inviteBatch('Preparé la invitación; revísala en la tarjeta.', [hector]) as never) },
  // The server refuses an invitation for someone with no profile (the runner says its sentence) and the loop hands it back: a model that
  // insists never tells the person, and the turn ends without an answer.
  { id: 'lote-sin-perfil', what: 'insists on inviting someone with no profile', notices: 'dice que no tiene perfil de LinkedIn guardado',
    decide: after(() => search('Paz Soto'), () => single('Preparé la invitación para Paz Soto; revísala en la tarjeta.', paz) as never) },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: ${mutation.what}, and a check notices`, async () => {
    const missed = await failing(mutation.id, mutation.decide);
    assert.ok(missed.includes(mutation.notices), `«${mutation.notices}» did not fail; failing: ${missed.join(' | ') || 'none'}`);
  });
}
