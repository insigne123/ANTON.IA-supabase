import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import {
  COWORK_REVIEWER_RULES, COWORK_WRITER_RULES, coworkDraftIssues, coworkPolishDraft, coworkPolishProofs, coworkReviewIssues, coworkWriterContext, coworkWriterPrompt, runCoworkWriter, type CoworkAgentStep, type CoworkWriteBrief, type CoworkWriterOutput, coworkSignerPreference } from './writer';

const signed = 'Hola {{nombre}},\nEn Yago revisamos antecedentes laborales con AXIS en minutos para {{empresa}}.\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Yarur\nGerente Comercial, Yago';
const sequence = (bodies: string[]) => ({ type: 'sequence' as const, title: 'Secuencia AXIS', steps: bodies.map((body, index) => ({ day: [1, 3, 7][index] ?? 11, subject: `Asunto ${index + 1}`, body })) });
const context = { signer: 'Nicolás Yarur', prohibited: ['barato'], trialOffer: false };

test('the checks catch what the text alone shows, once per kind and place', () => {
  assert.deepEqual(coworkDraftIssues([sequence([signed, signed, signed])], context).map(issue => issue.short), ['pregunta distinta', 'pregunta distinta']);
  const shorts = (bodies: string[]) => coworkDraftIssues([sequence(bodies)], context).map(issue => `${issue.where} · ${issue.short}`)
    .filter(line => !line.endsWith('pregunta distinta'));
  assert.deepEqual(shorts([`${signed}\n[Nombre del cliente]`, signed, signed]), ['«Secuencia AXIS», correo 1 · sin relleno']);
  assert.deepEqual(shorts([signed.replace('en minutos', 'barato y gratis'), signed, signed]),
    ['«Secuencia AXIS», correo 1 · sin «barato»', '«Secuencia AXIS», correo 1 · sin «gratis»']);
  assert.deepEqual(shorts([signed, `${signed}\nGarantizamos resultados.`, signed]), ['«Secuencia AXIS», correo 2 · sin promesas']);
  const last = signed.replace('Hola {{nombre}},\n', 'Hola {{nombre}},\nEste es mi último mensaje.\n');
  assert.deepEqual(shorts([last, signed, last]), ['«Secuencia AXIS», correo 1 · cierre solo al final']);
  // A text for several people greets with {{nombre}}: never a fixed name, never «Hola,» alone.
  assert.deepEqual(shorts([signed.replace('Hola {{nombre}},', 'Hola Felipe,'), signed, signed]), ['«Secuencia AXIS», correo 1 · saludo con {{nombre}}']);
  assert.deepEqual(shorts([signed, signed.replace('Hola {{nombre}},', 'Hola,'), signed]), ['«Secuencia AXIS», correo 2 · saludo con {{nombre}}']);
  assert.deepEqual(shorts([signed.replace(/Nicolás Yarur\n/, ''), signed, signed]), ['«Secuencia AXIS», correo 1 · firma completa']);
  // Every email opens with a greeting.
  assert.deepEqual(shorts([signed.replace('Hola {{nombre}},\n', ''), signed, signed]), ['«Secuencia AXIS», correo 1 · con saludo']);
  // An email to one person may greet by name; an approved trial offer allows «gratis».
  const email = { type: 'email_draft' as const, title: 'Correo a Felipe', to: ['Felipe'], subject: 'Hola', body: signed.replace('Hola {{nombre}},', 'Hola Felipe,').replace('en minutos', 'gratis') };
  assert.deepEqual(coworkDraftIssues([email], { ...context, trialOffer: true }), []);
  // An email to one person greets by name, never with the campaign variable.
  assert.deepEqual(coworkDraftIssues([{ ...email, body: signed }], { ...context, trialOffer: true }).map(issue => issue.short), ['con su nombre']);
  // Tables and figures are not emails.
  assert.deepEqual(coworkDraftIssues([{ type: 'table', title: 'x', columns: ['a'], rows: [['[relleno]']] }], context), []);
});

test('a Reviewer issue about a fixed name goes when the email is for one person', () => {
  const fixedName = { where: '«Seguimiento a Marcela Rojas», correo', problem: 'El saludo usa un nombre fijo, aunque se enviará por separado a cada persona.',
    fix: 'Usa «Hola {{nombre}},».', short: 'saludo con {{nombre}}' };
  const other = { where: '«Seguimiento a Marcela Rojas», correo', problem: 'No pide nada concreto.', fix: 'Cierra con una pregunta.', short: 'pregunta concreta' };
  const one = { type: 'email_draft' as const, title: 'Seguimiento a Marcela Rojas', to: ['mrojas@sodexo.cl'], subject: 'Re: AXIS', body: 'Hola Marcela,' };
  assert.deepEqual(coworkReviewIssues([fixedName, other], [one]), [other]);
  // To several people, or in a sequence, the issue stands.
  assert.deepEqual(coworkReviewIssues([fixedName], [{ ...one, to: ['a@x.cl', 'b@x.cl'] }]), [fixedName]);
  assert.deepEqual(coworkReviewIssues([fixedName], [sequence([signed])]), [fixedName]);
  // With several blocks, the one the issue names decides.
  assert.deepEqual(coworkReviewIssues([fixedName], [one, { ...one, title: 'Correo a Felipe' }]), []);
  assert.deepEqual(coworkReviewIssues([{ ...fixedName, where: 'correo' }], [one, { ...one, title: 'Correo a Felipe' }]), [{ ...fixedName, where: 'correo' }]);
});

test('a block keeps one way of addressing the reader, and each email of a sequence its own closing question', () => {
  const ask = (question: string) => signed.replace('¿Te sirve verlo 15 minutos esta semana?', question);
  const shorts = (bodies: string[]) => coworkDraftIssues([sequence(bodies)], context).map(issue => `${issue.where} · ${issue.short}`);
  const own = [ask('¿Cómo revisan hoy los antecedentes de un candidato?'), ask('¿Quién lo hace en tu equipo y cuánto le toma?'), ask('¿Te sirve verlo 15 minutos esta semana?')];
  assert.deepEqual(shorts(own), []);
  // Usted in one email of a sequence that tutea in the others.
  assert.deepEqual(shorts([own[0], own[1], ask('¿Le parece verlo 15 minutos esta semana?')]), ['«Secuencia AXIS» · un solo trato']);
  // All usted, and «ustedes» in a tuteo, are one way each.
  assert.deepEqual(shorts([ask('¿Cómo lo hacen ustedes hoy?'), own[1], own[2]]), []);
  const usted = (body: string) => body.replace('¿Quién lo hace en tu equipo y cuánto le toma?', '¿Quién lo hace en su equipo?').replace('¿Te sirve', '¿Le sirve');
  assert.deepEqual(shorts([own[0], usted(own[1]), usted(own[2])]), []);
  // Near-identical closings, in other words: the later one is flagged once.
  assert.deepEqual(shorts([ask('¿Cómo validan hoy los antecedentes de sus candidatos?'), ask('¿Cómo están validando hoy los antecedentes?'), own[2]]),
    ['«Secuencia AXIS», correo 2 · pregunta distinta']);
  // One email alone has nothing to repeat.
  assert.deepEqual(coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Hola', body: own[0] }], context), []);
});

test('the checks read who signs, the prohibited terms and the trial offer from the turn', () => {
  const observations = [
    { action: 'message.context', input: '', result: { configured: true, context: { prohibitedTerms: ['barato', ' ', 'x'], trialOffer: '14 días' } } },
  ];
  assert.deepEqual(coworkWriterContext({ fullName: ' Nicolás Yarur ' }, observations), { signer: 'Nicolás Yarur', prohibited: ['barato'], trialOffer: true, proofs: [], recipients: [], products: [] });
  assert.deepEqual(coworkWriterContext(null, []), { signer: null, prohibited: [], trialOffer: false, proofs: [], recipients: [], products: [] });
});

const brief: CoworkWriteBrief = { kind: 'sequence', recipients: ['Felipe Muñoz', 'Camila Fuentes'], objective: 'Una conversación sobre AXIS', angle: null, tone: 'cercano', steps: 3, notes: null, findings: null };
// Each email of the sequence closes with its own question, as the checks ask; the first two ask nothing of a meeting.
const closings = ['¿Cuántos ingresos revisan al mes?', '¿Cómo revisan hoy los antecedentes de un candidato?', '¿Te sirve verlo 15 minutos esta semana?'];
const own = (bodies: string[]) => bodies.map((body, index) => body.replace('¿Te sirve verlo 15 minutos esta semana?', closings[index % closings.length]));
const output = (bodies: string[]): CoworkWriterOutput => ({
  reply: 'Te dejo la secuencia para Felipe y Camila.', blocks: [sequence(own(bodies))], question: '¿Creo la campaña pausada?',
  suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }],
});

function harness(replies: unknown[]) {
  const calls: Array<{ role: string; stream?: boolean; prompt: string }> = [];
  const steps: CoworkAgentStep[] = [];
  let reviewing = 0;
  let adjusting = 0;
  const run = (extra: Partial<Parameters<typeof runCoworkWriter>[0]> = {}) => runCoworkWriter({
    request: 'armame una secuencia para felipe y camila', brief, userContext: { fullName: 'Nicolás Yarur' }, observations: [],
    generate: async <T extends z.ZodTypeAny>(call: { role: 'writer' | 'reviewer'; schema: T; prompt: string; stream?: boolean }) => {
      calls.push({ role: call.role, stream: call.stream, prompt: call.prompt });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return call.schema.parse(reply);
    },
    step: async step => { steps.push(step); },
    onReview: () => { reviewing++; },
    onAdjust: () => { adjusting++; },
    ...extra,
  });
  return { calls, steps, run, reviewing: () => reviewing, adjusting: () => adjusting };
}

test('a clean draft is reviewed once and comes back as it was', async () => {
  const draft = output([signed, signed, signed]);
  const h = harness([draft, { verdict: 'ok', issues: [] }]);
  assert.deepEqual(await h.run(), draft);
  assert.deepEqual(h.calls.map(call => `${call.role}${call.stream ? ' (en vivo)' : ''}`), ['writer (en vivo)', 'reviewer']);
  assert.deepEqual(h.steps.map(step => `${step.agent}:${step.state}:${step.label}`),
    ['writer:working:Escribiendo 3 correos', 'writer:done:Escribió 3 correos', 'reviewer:working:Revisando 3 correos', 'reviewer:done:Sin ajustes']);
  assert.equal(h.steps.at(-1)?.outcome, 'clean');
  // The page hears that the draft on screen is being reviewed, once; nothing was adjusted.
  assert.equal(h.reviewing(), 1);
  assert.equal(h.adjusting(), 0);
});

test('what the checks find is fixed once, without spending the Reviewer, and the page hears what changed', async () => {
  const first = output([signed.replace('en minutos', 'gratis'), signed, signed]);
  const fixed = output([signed, signed, signed]);
  const h = harness([first, fixed]);
  assert.deepEqual(await h.run(), fixed);
  assert.deepEqual(h.calls.map(call => call.role), ['writer', 'writer']);
  assert.match(h.calls[1].prompt, /Ofrece algo «gratis»/);
  assert.deepEqual(h.steps.slice(2).map(step => `${step.agent}:${step.state}:${step.label}`), ['reviewer:working:Aplicando 1 ajuste', 'reviewer:done:1 ajuste']);
  assert.deepEqual(h.steps.at(-1), { agent: 'reviewer', state: 'done', label: '1 ajuste', outcome: 'fixed', changes: ['sin «gratis»'] });
  assert.equal(h.reviewing(), 1);
  // A held draft says it is being adjusted once the correction starts, and not when there is nothing to fix.
  assert.equal(h.adjusting(), 1);
});

const review = { verdict: 'fix', issues: [{ where: 'correo 2', problem: 'Dice que AXIS atiende 500 empresas, dato que no está en los datos.', fix: 'Quita la cifra.', short: 'sin cifras inventadas' }] };

test('the Reviewer can ask for a fix, and the page reads what it fixed in a few words', async () => {
  const draft = output([signed, signed, signed]);
  const fixed = output([signed, signed.replace('en minutos', 'en el día'), signed]);
  const h = harness([draft, review, fixed]);
  assert.deepEqual(await h.run(), fixed);
  assert.match(h.calls[2].prompt, /"issues":\[\{"where":"correo 2"/);
  assert.deepEqual(h.steps.at(-1), { agent: 'reviewer', state: 'done', label: '1 ajuste', outcome: 'fixed', changes: ['sin cifras inventadas'] });
  assert.equal(h.adjusting(), 1);
});

test('only the first draft is required: a failed Reviewer or correction, or no time, leaves it and says so', async () => {
  const draft = output([signed, signed, signed]);
  // The correction fails: the first draft stands, and what the Reviewer found is still to look at.
  const failing = harness([draft, review, new Error('timeout')]);
  assert.deepEqual(await failing.run(), draft);
  assert.deepEqual(failing.steps.at(-1), { agent: 'reviewer', state: 'done', label: '1 punto por revisar', outcome: 'pending',
    changes: ['correo 2: Dice que AXIS atiende 500 empresas, dato que no está en los datos'] });
  // The Reviewer fails: the draft stands, not reviewed.
  const silent = harness([draft, new Error('budget')]);
  assert.deepEqual(await silent.run(), draft);
  assert.deepEqual(silent.steps.at(-1), { agent: 'reviewer', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped', changes: [] });
  // No time for a review: a clean draft goes out as it is, with no Reviewer step and nothing marked as reviewed.
  const tight = harness([draft]);
  assert.deepEqual(await tight.run({ canReview: () => false }), draft);
  assert.deepEqual(tight.calls.map(call => call.role), ['writer']);
  assert.deepEqual(tight.steps.map(step => step.agent), ['writer', 'writer']);
  assert.equal(tight.reviewing(), 0);
  // No time to correct what the checks found: it goes out, and the page says what to look at.
  const late = harness([output([signed.replace('en minutos', 'gratis'), signed, signed])]);
  await late.run({ canReview: () => false });
  assert.deepEqual(late.steps.at(-1), { agent: 'reviewer', state: 'done', label: '1 punto por revisar', outcome: 'pending',
    changes: ['«Secuencia AXIS», correo 1: Ofrece algo «gratis» sin una oferta de prueba aprobada'] });
});

test('a correction that breaks more than it fixes is not kept', async () => {
  const first = output([signed.replace('en minutos', 'gratis'), signed, signed]);
  const worse = output([signed.replace('en minutos', 'gratis'), signed.replace('en minutos', 'gratis'), signed]);
  const h = harness([first, worse]);
  assert.deepEqual(await h.run(), first);
  assert.equal(h.steps.at(-1)?.outcome, 'pending');
  assert.deepEqual(h.steps.at(-1)?.changes, ['«Secuencia AXIS», correo 1: Ofrece algo «gratis» sin una oferta de prueba aprobada']);
});

test('a Writer answer without an email is refused, and a Writer that gives up closes its row', async () => {
  const h = harness([{ ...output([signed]), blocks: [{ type: 'table', title: 'x', columns: ['a'], rows: [['b']] }] }]);
  await assert.rejects(h.run(), /Writer returned no email/);
  assert.deepEqual(h.steps.at(-1), { agent: 'writer', state: 'done', label: 'No alcanzó a escribir', outcome: 'skipped', changes: [] });
  const failed = harness([new Error('timeout')]);
  await assert.rejects(failed.run(), /timeout/);
  assert.deepEqual(failed.steps.map(step => `${step.agent}:${step.state}:${step.label}`), ['writer:working:Escribiendo 3 correos', 'writer:done:No alcanzó a escribir']);
});

test('the Writer gets what the coordinator found, to tell the person along with the emails', () => {
  const findings = 'Felipe y Camila tienen correo y nunca recibieron nada; Marcela queda fuera porque ya le escribiste.';
  const prompt = JSON.parse(coworkWriterPrompt({ request: 'armame una secuencia', brief: { ...brief, findings }, userContext: null, observations: [] }));
  assert.equal(prompt.brief.findings, findings);
  assert.equal(prompt.issues, undefined);
});

test('the Writer knows an answer inside an open conversation: «Re: » and the subject of the send, one draft per person, never a campaign or all approved together', () => {
  const rule = COWORK_WRITER_RULES.find(line => line.startsWith('Respuestas dentro de conversaciones ya abiertas'));
  assert.ok(rule, 'the rule is in the Writer\'s prompt');
  assert.match(rule!, /notes lo dice y observations trae el replies\.thread de cada persona/);
  assert.match(rule!, /un bloque email_draft por persona, con to su correo y asunto «Re: » más el asunto del envío original tal como lo trae su lectura, sin cambiarlo/);
  assert.match(rule!, /sin inventar precios, plazos ni fechas, y lo que debe decidir el usuario no va en el texto/);
  assert.match(rule!, /No es una campaña: question no la ofrece; ofrece el paso que dicen notes o findings, con esas palabras: si es proponer el envío de la primera respuesta, «¿Propongo enviar primero la de <nombre>\?» \(no «¿Apruebas…\?»: aún no hay tarjeta que aprobar\)/);
  assert.match(rule!, /nunca aprobar todas juntas\. Los borradores no se aprueban: no digas que se aprueban en su tarjeta; di que cada envío se aprueba cuando se proponga/);
});

test('an email the person pasted for a group stays one email to that group: their names, the plural, no campaign (Plan 13)', () => {
  // Seen with the real model (ur-mejorar-correo): «Estimados Marcela, Romualdo y Verónica» came back as «Hola {{nombre}},» in the
  // singular, with a campaign offered for them or for other contacts.
  const rules = COWORK_WRITER_RULES.join('\n');
  assert.match(rules, /a un grupo que lo recibe junto, sus nombres, como en el correo del usuario; a varias por separado o en una secuencia, «Hola \{\{nombre\}\},»/);
  assert.match(rules, /Un correo que el usuario pegó para mejorarlo y que va a varias personas juntas \(«Estimados Marcela, Romualdo y Verónica»\) es un solo correo a ese grupo, no una campaña: conserva el saludo con sus nombres, el plural/);
  assert.match(rules, /Si mejoraste un correo que el usuario pegó y enviará él .*question no ofrece una campaña, ni para ellos ni para otros contactos: va null/);
  assert.match(COWORK_REVIEWER_RULES.join('\n'), /un correo que el usuario escribió para un grupo que lo recibe junto conserva sus nombres y el plural/);
  // Without addresses the group email is not a campaign text: the checks do not ask for {{nombre}}.
  const group = { type: 'email_draft' as const, title: 'Propuesta', to: null, subject: 'Comentarios sobre la propuesta',
    body: 'Estimados Marcela, Romualdo y Verónica:\n\nLes adjunto la propuesta. ¿Tienen comentarios o vemos una reunión?\n\nNicolás' };
  assert.deepEqual(coworkDraftIssues([group], coworkWriterContext({ fullName: 'Nicolás Yarur' }, [], null)), []);
});

test('a signature the person asked for replaces the profile name, from the request, the brief or a remembered preference', () => {
  assert.equal(coworkSignerPreference(['escríbeme un correo y recuerda que siempre firmo como Nico']), 'Nico');
  assert.equal(coworkSignerPreference([null, 'Firma exactamente como «Nico». No inventes datos.']), 'Nico');
  assert.equal(coworkSignerPreference(['un correo para Ana', null, 'Firmo como Nicolás Y.']), 'Nicolás Y');
  assert.equal(coworkSignerPreference(['firma con fullName', 'escríbele a Ana']), null);
  // Without a preference, the check asks for the profile's name; with «firmo como Nico», «Nico» is the signature.
  const email = { type: 'email_draft' as const, title: 'Invitación', to: null, subject: 'Una reunión breve', body: 'Hola {{nombre}},\n\n¿Conversamos?\n\nNico' };
  const unsigned = (body: string, signer: string | null) => coworkDraftIssues([{ ...email, body }], coworkWriterContext({ fullName: 'Nicolás Yarur' }, [], signer))
    .some(issue => issue.short === 'firma completa');
  assert.equal(unsigned(email.body, null), true);
  assert.equal(unsigned(email.body, 'Nico'), false);
  assert.equal(unsigned('Hola {{nombre}},\n\n¿Conversamos?\n\nAna', 'Nico'), true);
});

test('the checks catch what made the measured emails generic or wrong (12 oct reading)', () => {
  const proofs = ['Procesa 1.000 personas en unos 30 minutos.'];
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }];
  const withProofs = { ...context, signer: 'Nicolás Y.', proofs, recipients };
  const felipe = (body: string, subject = 'Antecedentes de guardias en Securitas') =>
    coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: ['Felipe Muñoz'], subject, body }], withProofs).map(issue => issue.short);
  const good = 'Hola Felipe,\n\nEn seguridad privada entran guardias nuevos todas las semanas, y en Securitas cada uno pasa por la revisión de antecedentes en el PJUD. AXIS consulta el lote completo y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan en una semana normal?\n\nNicolás Y.\nGerente Comercial\nYago SpA';
  assert.deepEqual(felipe(good), []);
  // R11: «Según el dato de nuestro perfil» inside the email.
  assert.deepEqual(felipe(good.replace('AXIS consulta', 'Según el dato de nuestro perfil, AXIS consulta')), ['sin referencias internas']);
  // R05: the proof turned into a past achievement, or a bigger claim.
  assert.deepEqual(felipe(good.replace('procesa 1.000 personas', 'hemos procesado 1.000 personas')), ['prueba tal cual']);
  assert.deepEqual(felipe(good.replace('procesa 1.000 personas', 'procesa más de 1.000 personas')), ['prueba tal cual']);
  // R07 and R15: a roundabout phrase and a caveat.
  assert.deepEqual(felipe(good.replace('AXIS consulta', 'Esto puede sumar trabajo. AXIS consulta')), ['directo']);
  assert.deepEqual(felipe(good.replace('30 minutos.', '30 minutos; el tiempo puede variar según cada operación.')), ['sin cautelas']);
  // R01: an opening that defines the task.
  const defines = good.replace(/En seguridad privada[^.]+\./, 'Revisar los antecedentes laborales de postulantes implica comprobar información en el PJUD en Securitas.');
  assert.deepEqual(felipe(defines), ['apertura concreta']);
  // R15: a stray line before the signature; a sign-off is not one.
  assert.deepEqual(felipe(good.replace('\n\nNicolás Y.', '\n\nAXIS\n\nNicolás Y.')), ['sin líneas sueltas']);
  assert.deepEqual(felipe(good.replace('\n\nNicolás Y.', '\n\nSaludos,\nNicolás Y.')), []);
  // An email to one person that never names his company could go to anyone.
  assert.deepEqual(felipe(good.replace(', y en Securitas cada uno', ', y cada uno'), 'Antecedentes en el PJUD'), ['con su empresa']);
  // A campaign text names each person's company with {{empresa}}.
  const campaign = { type: 'email_draft' as const, title: 'Campaña RR. HH.', to: ['a@x.cl', 'b@y.cl'], subject: 'Ingresos en {{empresa}}',
    body: good.replace('Hola Felipe,', 'Hola {{nombre}},').replace(', y en Securitas cada uno', ', y cada uno') };
  assert.deepEqual(coworkDraftIssues([campaign], withProofs).map(issue => issue.short), []);
  assert.deepEqual(coworkDraftIssues([{ ...campaign, subject: 'Ingresos de guardias' }], withProofs).map(issue => issue.short), ['con {{empresa}}']);
  // A sequence cites its proof once.
  const step = (body: string) => body.replace('Hola Felipe,', 'Hola {{nombre}},').replace('en Securitas', 'en {{empresa}}');
  const twice = sequence([step(good), step(good).replace('¿Cuántos ingresos revisan en una semana normal?', '¿Quién revisa hoy esos antecedentes?')]);
  assert.deepEqual(coworkDraftIssues([twice], withProofs).map(issue => `${issue.where} · ${issue.short}`), ['«Secuencia AXIS», correo 2 · prueba una vez']);
});

test('the context reads the proofs of the profile and the people the turn read, with their company', () => {
  const observations = [{ action: 'leads.search', input: 'con correo', result: { items: [
    { id: 'x', name: 'Felipe Muñoz', title: 'Jefe de Reclutamiento', company: 'Securitas Chile', email: 'FMunoz@securitas.cl' },
    { id: 'y', name: 'Sin Empresa', title: 'Analista', company: null, email: 'a@b.cl' },
  ] } }];
  const read = coworkWriterContext({ fullName: 'Nicolás Y.', proofPoints: ['Procesa 1.000 personas en unos 30 minutos.', 7, ''] }, observations);
  assert.deepEqual(read.proofs, ['Procesa 1.000 personas en unos 30 minutos.']);
  assert.deepEqual(read.recipients, [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }]);
});

test('the checks catch what kept the 12 oct candidate from a 4: hedges, meetings, lists, glued questions, the seller first', () => {
  const proofs = ['Procesa 1.000 personas en unos 30 minutos.'];
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }];
  const checks = { ...context, signer: 'Nicolás Y.', proofs, recipients, meeting: false, products: ['axis', 'yago'] };
  const shorts = (body: string, subject = 'Antecedentes de guardias en Securitas', extra: Partial<typeof checks> = {}) =>
    coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: ['Felipe Muñoz'], subject, body }], { ...checks, ...extra }).map(issue => issue.short);
  const signature = '\n\nNicolás Y.\nGerente Comercial\nYago SpA';
  const good = `Hola Felipe,\n\nEn seguridad privada entran guardias nuevos todas las semanas, y en Securitas cada uno pasa por la revisión de antecedentes en el PJUD. AXIS consulta el lote completo y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan en una semana normal?${signature}`;
  assert.deepEqual(shorts(good), []);
  // R01: «puede volverse una carga», a meeting in disguise and the question glued to the paragraph.
  const r01 = `Hola Felipe,\n\nEn seguridad privada, revisar antecedentes laborales en el PJUD puede volverse una carga cuando hay varias incorporaciones en curso en Securitas. AXIS entrega resultados consolidados; procesa 1.000 personas en unos 30 minutos. ¿Te interesa evaluar brevemente si AXIS sirve para tus procesos de incorporación masiva?${signature}`;
  assert.deepEqual(shorts(r01), ['directo', 'sin pedir reunión', 'pregunta aparte']);
  // The person asked for a meeting, or did not say (the request is unknown): a meeting is not flagged.
  assert.deepEqual(shorts(r01, undefined, { meeting: true }), ['directo', 'pregunta aparte']);
  assert.deepEqual(shorts(r01, undefined, { meeting: undefined }), ['directo', 'pregunta aparte']);
  // Every way of saying what could happen: «puede atrasar», «puede quitarle tiempo», «si en algún proceso».
  for (const hedge of ['revisarlos uno por uno puede atrasar el ingreso', 'revisarlos uno por uno puede quitarle tiempo a RR. HH.', 'si en algún proceso necesitan revisar a varios'])
    assert.deepEqual(shorts(good.replace('cada uno pasa por la revisión de antecedentes en el PJUD', hedge)), ['directo'], hedge);
  // A proof that says «puede» itself is cited as it is.
  const hedgedProof = good.replace('procesa 1.000 personas en unos 30 minutos', 'puede procesar 1.000 personas en unos 30 minutos');
  assert.deepEqual(shorts(hedgedProof, undefined, { proofs: ['Puede procesar 1.000 personas en unos 30 minutos.'] }), []);
  // R04: a list of functions and «¿Te viene bien coordinar una conversación breve…?».
  const r04 = good.replace('AXIS consulta el lote completo', 'AXIS consulta en el PJUD por persona o por lote y consolida los resultados; admite carga por archivo o correo y deja evidencia auditable de cada consulta. AXIS')
    .replace('¿Cuántos ingresos revisan en una semana normal?', '¿Te viene bien coordinar una conversación breve para conocer cómo revisan hoy esos antecedentes?');
  assert.deepEqual(shorts(r04), ['una sola capacidad', 'sin pedir reunión']);
  // R15: a closing that offers «more information».
  assert.deepEqual(shorts(good.replace('¿Cuántos ingresos revisan en una semana normal?', '¿Te envío más información sobre AXIS?')), ['pregunta concreta']);
  // R09: the product first, and as if they already used it.
  const r09 = 'Hola {{nombre}},\n\nAXIS está pensado para revisar antecedentes laborales de postulantes. En {{empresa}}, AXIS consulta en el PJUD y consolida resultados; procesa 1.000 personas en unos 30 minutos.\n\n¿Cuánto les toma hoy revisar los antecedentes de una persona?' + signature;
  const campaign = { type: 'email_draft' as const, title: 'Campaña', to: ['a@x.cl', 'b@y.cl'], subject: 'Antecedentes en {{empresa}}', body: r09 };
  assert.deepEqual(coworkDraftIssues([campaign], checks).map(issue => issue.short), ['apertura concreta', 'sin suponer que la usan', 'sin frases de catálogo']);
  assert.deepEqual(coworkDraftIssues([{ ...campaign, body: r09.replace('AXIS está pensado para revisar', 'Te escribo para contarte cómo revisar') }], checks).map(issue => issue.short),
    ['apertura concreta', 'sin suponer que la usan']);
  // R33: a follow-up that repeats the proof of the first email (and hedges).
  const r33 = 'Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. Si en algún proceso necesitan revisar varias personas, AXIS procesa 1.000 personas en unos 30 minutos.\n\n¿Suelen revisar esos antecedentes uno a uno o por archivo?' + signature;
  assert.deepEqual(coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento', to: null, subject: 'Antecedentes en Sodexo', body: r33 }], checks).map(issue => issue.short),
    ['directo', 'ángulo nuevo']);
  // A meeting is fine from the third email of a sequence on, and in a reply inside an open conversation.
  const step = (question: string) => good.replace('Hola Felipe,', 'Hola {{nombre}},').replace('en Securitas', 'en {{empresa}}').replace('¿Cuántos ingresos revisan en una semana normal?', question);
  const meetingLast = sequence([step('¿Cuántos ingresos revisan en una semana normal?'), step('¿Quién revisa hoy esos antecedentes?').replace(/ AXIS consulta[^.]+\./, ''), step('¿Te sirve verlo 15 minutos esta semana?').replace(/ AXIS consulta[^.]+\./, '')]);
  assert.deepEqual(coworkDraftIssues([meetingLast], checks).map(issue => `${issue.where} · ${issue.short}`), []);
  assert.deepEqual(shorts(good.replace('¿Cuántos ingresos revisan en una semana normal?', '¿Te acomoda una llamada el jueves?'), 'Re: Antecedentes de guardias'), []);
});

test('the Reviewer cannot ask for a meeting the person did not want, nor for more functions', () => {
  const draft = [{ type: 'email_draft' as const, title: 'Correo para Felipe', to: ['fmunoz@securitas.cl'], subject: 'Antecedentes en Securitas', body: 'Hola Felipe,' }];
  const issue = (short: string, fix: string) => ({ where: '«Correo para Felipe»', problem: 'El cierre no pide nada concreto.', fix, short });
  const meeting = issue('proponer evaluación concreta', 'Propón una evaluación breve de AXIS para sus procesos.');
  const conversation = issue('coordinar conversación', 'Cierra pidiendo coordinar una conversación de 15 minutos.');
  const functions = issue('funciones omitidas', 'Agrega las funciones de carga por archivo y evidencia auditable.');
  const noMeeting = issue('sin reunión inicial', 'Quita la reunión del primer correo y pregunta cuántos ingresos revisan.');
  const other = issue('pregunta más concreta', 'Pregunta cuántos ingresos revisan al mes.');
  const all = [meeting, conversation, functions, noMeeting, other];
  assert.deepEqual(coworkReviewIssues(all, draft, { ...context, meeting: false }), [noMeeting, other]);
  // When the person asked for the meeting, the Reviewer may ask for it but not take it out; more functions are never asked.
  assert.deepEqual(coworkReviewIssues(all, draft, { ...context, meeting: true }), [meeting, conversation, other]);
});

test('the context knows whether the person asked for a meeting and the names of the offer', () => {
  const userContext = { fullName: 'Nicolás Y.', companyName: 'Yago SpA', offer: 'AXIS consulta en el PJUD por persona o por lote.', services: ['AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD)'] };
  assert.deepEqual(coworkWriterContext(userContext, []).products, ['axis', 'yago']);
  assert.equal(coworkWriterContext(userContext, []).meeting, undefined);
  assert.equal(coworkWriterContext(userContext, [], null, 'redáctame un correo para felipe de securitas ofreciendo axis').meeting, false);
  assert.equal(coworkWriterContext(userContext, [], null, 'escríbele a felipe para agendar una reunión').meeting, true);
  assert.equal(coworkWriterContext(userContext, [], null, 'mejorame este correo: "Hola, somos Yago. Agendemos."').meeting, true);
});

test('the checks catch what the matrix reading still found: the product in the first sentence, openings that define, catalog phrases', () => {
  const proofs = ['Procesa 1.000 personas en unos 30 minutos.'];
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }];
  const checks = { ...context, signer: 'Nicolás Y.', proofs, recipients, meeting: false, products: ['axis', 'yago'] };
  const signature = '\n\nNicolás Y.\nGerente Comercial\nYago SpA';
  const shorts = (opening: string, rest = 'AXIS consulta el lote completo y procesa 1.000 personas en unos 30 minutos.') =>
    coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: ['Felipe Muñoz'], subject: 'Antecedentes de guardias en Securitas',
      body: `Hola Felipe,\n\n${opening} ${rest}\n\n¿Cuántos ingresos revisan en una semana normal?${signature}` }], checks).map(issue => issue.short);
  assert.deepEqual(shorts('En seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes en el PJUD atrasa el ingreso.'), []);
  // The product in the first sentence (12 oct matrix: «Para revisar antecedentes…, AXIS consulta…», «Al incorporar personal, AXIS consulta…»).
  assert.deepEqual(shorts('Para revisar antecedentes de guardias en seguridad privada, AXIS consulta en el PJUD por lote.', 'Procesa 1.000 personas en unos 30 minutos.'), ['apertura concreta']);
  assert.deepEqual(shorts('En Yago revisamos antecedentes de guardias en minutos.'), ['apertura concreta']);
  // Openings that define the task wherever the verb is.
  for (const defines of ['En seguridad privada, revisar antecedentes laborales es una de las tareas que acompaña la incorporación.',
    'En seguridad privada, revisar antecedentes a mano significa hacer una consulta por cada persona.',
    'En los procesos de selección, revisar antecedentes en el PJUD es parte de evaluar postulantes.'])
    assert.deepEqual(shorts(defines), ['apertura concreta'], defines);
  // A catalog phrase anywhere: in the second email of a sequence too.
  assert.deepEqual(shorts('En seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes atrasa el ingreso.',
    'AXIS está pensado para empresas que incorporan personal de forma masiva.'), ['sin frases de catálogo']);
  // A follow-up may name the offer in its first sentence: it reopens what was sent.
  const followUp = coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento', to: null, subject: 'Re: AXIS para Securitas',
    body: `Hola Felipe,\n\nTe escribí el 19 de septiembre sobre AXIS. Con AXIS, cargas la lista de postulantes desde un archivo.\n\n¿Quién revisa hoy esos antecedentes en Securitas?${signature}` }], checks);
  assert.deepEqual(followUp.map(issue => issue.short), []);
});

test('a proof cited inside a sentence reads as part of it: lowercase after a colon and without quotes', () => {
  const proofs = ['Procesa 1.000 personas en unos 30 minutos.'];
  assert.equal(coworkPolishProofs('AXIS automatiza esas consultas: Procesa 1.000 personas en unos 30 minutos.', proofs),
    'AXIS automatiza esas consultas: procesa 1.000 personas en unos 30 minutos.');
  assert.equal(coworkPolishProofs('AXIS consulta por lote, con este resultado: «Procesa 1.000 personas en unos 30 minutos.»\n\n¿Quién lo hace hoy?', proofs),
    'AXIS consulta por lote, con este resultado: procesa 1.000 personas en unos 30 minutos.\n\n¿Quién lo hace hoy?');
  assert.equal(coworkPolishProofs('AXIS consulta por lote; Procesa 1.000 personas en unos 30 minutos.', proofs), 'AXIS consulta por lote; procesa 1.000 personas en unos 30 minutos.');
  // A new sentence keeps its capital, and nothing else changes.
  assert.equal(coworkPolishProofs('AXIS consulta en el PJUD. Procesa 1.000 personas en unos 30 minutos.', proofs), 'AXIS consulta en el PJUD. Procesa 1.000 personas en unos 30 minutos.');
  assert.equal(coworkPolishProofs('Hola, ¿cómo estás?', []), 'Hola, ¿cómo estás?');
  // Every email of the answer, in cards and sequences.
  const output: CoworkWriterOutput = { reply: 'Listo.', question: null, suggestions: [{ label: 'Sí', message: 'Sí' }], blocks: [
    { type: 'email_draft', title: 'Correo', to: null, subject: 'Asunto', body: 'AXIS automatiza esas consultas: Procesa 1.000 personas en unos 30 minutos.' },
    { type: 'sequence', title: 'Secuencia', steps: [{ day: 1, subject: 'Uno', body: 'AXIS por lote: «Procesa 1.000 personas en unos 30 minutos.»' }] }] };
  const polished = coworkPolishDraft(output, proofs);
  assert.equal((polished.blocks[0] as { body: string }).body, 'AXIS automatiza esas consultas: procesa 1.000 personas en unos 30 minutos.');
  assert.equal((polished.blocks[1] as { steps: Array<{ body: string }> }).steps[0].body, 'AXIS por lote: procesa 1.000 personas en unos 30 minutos.');
  assert.equal(coworkPolishDraft(output, []), output, 'without proofs the answer is untouched');
});

test('telling the reader where a figure came from is an internal reference in any wording', () => {
  const email = { type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes en Securitas',
    body: 'Hola Felipe,\n\nAXIS consulta antecedentes laborales en el PJUD; el dato que compartiste para AXIS es que procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás Yarur' };
  assert.ok(coworkDraftIssues([email], context).some(issue => issue.short === 'sin referencias internas'));
});

test('a subject never puts the seller where the reader goes', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: true, products: ['axis', 'yago'] };
  const email = (subject: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject,
    body: 'Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes en el PJUD atrasa el ingreso.\n\nAXIS consulta el lote completo.\n\n¿Qué día les acomoda una demo?\n\nNicolás Y.' }], checks).map(issue => issue.short);
  assert.deepEqual(email('Revisión de antecedentes en Yago'), ['asunto con su empresa']);
  assert.deepEqual(email('Revisión de antecedentes para ingresos masivos'), []);
  assert.match(COWORK_WRITER_RULES.join('\n'), /Si el correo pegado saluda sin nombre \(«Hola, les escribo…»\), queda «Hola,»: no lo conviertas en \{\{nombre\}\}/);
});

test('the Reviewer does not undo what the rules ask: the general premise of the opening, the «Hola,» of a pasted email', () => {
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }];
  const checks = { ...context, recipients, meeting: true, products: ['axis'] };
  const issue = (problem: string, short = 'apertura respaldada') => ({ where: '«Correo»', problem, fix: 'Ajusta la apertura.', short });
  const general = issue('La primera frase afirma que revisar antecedentes uno por uno retrasa las incorporaciones, sin respaldo específico para afirmarlo como hecho general.');
  const email = (opening: string, to: string[] | null = ['a@x.cl', 'b@y.cl']) => [{ type: 'email_draft' as const, title: 'Correo', to, subject: 'Antecedentes',
    body: `Hola {{nombre}},\n\n${opening}\n\nAXIS consulta por lote.\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás` }];
  // A general premise goes; the same claim about their company stays for the Writer to fix.
  assert.deepEqual(coworkReviewIssues([general], email('Cuando entran muchas personas a la vez, revisarlas una por una atrasa el ingreso.'), checks), []);
  assert.deepEqual(coworkReviewIssues([general], email('En {{empresa}} revisar uno por uno atrasa el ingreso.'), checks), [general]);
  assert.deepEqual(coworkReviewIssues([general], email('En Securitas revisar uno por uno atrasa el ingreso.'), checks), [general]);
  // A pasted email without names, with no addresses, keeps «Hola,»; a campaign text still greets with {{nombre}}.
  const nameless = issue('El saludo «Hola,» no lleva nombre y el correo está dirigido a empresas de forma individual.', 'saludo con nombre');
  const pasted = [{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes', body: 'Hola,\n\nCuando entran muchas personas…\n\n¿Qué día les acomoda una demo?\n\nNicolás' }];
  assert.deepEqual(coworkReviewIssues([nameless], pasted, checks), []);
  assert.deepEqual(coworkReviewIssues([nameless], [{ ...pasted[0], to: ['a@x.cl', 'b@y.cl'] }], checks), [nameless]);
  // «Omite dos detalles de AXIS» asks for more functions.
  const omits = { where: '«Correo»', problem: 'Omite dos detalles de AXIS: los resultados consolidados y la evidencia auditable.', fix: 'Agrégalos en la segunda frase.', short: 'con detalles de AXIS' };
  assert.deepEqual(coworkReviewIssues([omits], pasted, checks), []);
});
