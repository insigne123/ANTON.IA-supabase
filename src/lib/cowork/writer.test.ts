import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import {
  COWORK_REVIEWER_RULES, COWORK_WRITER_RULES, coworkDraftIssues, coworkNextStepIssues, coworkPolishDraft, coworkReplyIssues, coworkReplyMatchesDraft, coworkPolishProofs, coworkReviewIssues, coworkSplitOffer, coworkWriterContext, coworkWriterPrompt, runCoworkWriter, type CoworkAgentStep, type CoworkWriteBrief, type CoworkWriterOutput, coworkSignerPreference } from './writer';

const signed = 'Hola {{nombre}},\nEn Yago revisamos antecedentes laborales con AXIS en minutos para {{empresa}}.\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Yarur\nGerente Comercial, Yago';
const sequence = (bodies: string[]) => ({ type: 'sequence' as const, title: 'Secuencia AXIS', steps: bodies.map((body, index) => ({ day: [1, 3, 7][index] ?? 11, subject: `Asunto ${index + 1}`, body })) });
const context = { signer: 'Nicolás Yarur', prohibited: ['barato'], trialOffer: false };

test('the checks catch what the text alone shows, once per kind and place', () => {
  assert.deepEqual(coworkDraftIssues([sequence([signed, signed, signed])], context).map(issue => issue.short), ['momento distinto', 'momento distinto', 'pregunta distinta', 'pregunta distinta']);
  const shorts = (bodies: string[]) => coworkDraftIssues([sequence(bodies)], context).map(issue => `${issue.where} · ${issue.short}`)
    .filter(line => !line.endsWith('pregunta distinta') && !line.endsWith('momento distinto'));
  assert.deepEqual(shorts([`${signed}\n[Nombre del cliente]`, signed, signed]), ['«Secuencia AXIS», correo 1 · sin relleno']);
  assert.deepEqual(shorts([signed.replace('en minutos', 'barato y gratis'), signed, signed]),
    ['«Secuencia AXIS», correo 1 · sin «barato»', '«Secuencia AXIS», correo 1 · sin «gratis»']);
  assert.deepEqual(shorts([signed, `${signed}\nGarantizamos resultados.`, signed]), ['«Secuencia AXIS», correo 2 · sin promesas']);
  const last = signed.replace('¿Te sirve', 'Este es mi último mensaje. ¿Te sirve');
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
  // With several blocks, the one the issue names decides; one that names none goes only when every email is for one person (one per person).
  assert.deepEqual(coworkReviewIssues([fixedName], [one, { ...one, title: 'Correo a Felipe' }]), []);
  assert.deepEqual(coworkReviewIssues([{ ...fixedName, where: 'Saludos de los tres correos' }], [one, { ...one, title: 'Correo a Felipe' }]), []);
  assert.deepEqual(coworkReviewIssues([{ ...fixedName, where: 'correo' }], [one, { ...one, title: 'Correo a Felipe', to: ['a@x.cl', 'b@x.cl'] }]), [{ ...fixedName, where: 'correo' }]);
});

test('a block keeps one way of addressing the reader, and each email of a sequence its own closing question', () => {
  const ask = (question: string) => signed.replace('¿Te sirve verlo 15 minutos esta semana?', question);
  const shorts = (bodies: string[]) => coworkDraftIssues([sequence(bodies)], context).map(issue => `${issue.where} · ${issue.short}`)
    .filter(line => !line.endsWith('momento distinto'));
  const own = [ask('¿Quién revisa hoy los antecedentes de un candidato?'), ask('¿Cuánto le toma a tu equipo revisar a una persona?'), ask('¿Te sirve verlo 15 minutos esta semana?')];
  assert.deepEqual(shorts(own), []);
  // Usted in one email of a sequence that tutea in the others.
  assert.deepEqual(shorts([own[0], own[1], ask('¿Le parece verlo 15 minutos esta semana?')]), ['«Secuencia AXIS» · un solo trato']);
  // All usted, and «ustedes» in a tuteo, are one way each.
  assert.deepEqual(shorts([ask('¿Cuántos lo hacen hoy entre ustedes?'), own[1], own[2]]), []);
  // v17: a question that asks two things, or that takes a paragraph to answer.
  assert.deepEqual(shorts([ask('¿Cómo revisan hoy los antecedentes de un candidato?'), ask('¿Quién lo hace en tu equipo y cuánto le toma?'), own[2]]),
    ['«Secuencia AXIS», correo 1 · pregunta en una línea', '«Secuencia AXIS», correo 2 · pregunta en una línea']);
  const usted = (body: string) => body.replace('¿Cuánto le toma a tu equipo revisar a una persona?', '¿Cuánto le toma a su equipo revisar a una persona?').replace('¿Te sirve', '¿Le sirve');
  assert.deepEqual(shorts([own[0], usted(own[1]), usted(own[2])]), []);
  // Near-identical closings, in other words: the later one is flagged once.
  assert.deepEqual(shorts([ask('¿Quién valida hoy los antecedentes de sus candidatos?'), ask('¿Quién está validando hoy los antecedentes?'), own[2]]),
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
const closings = ['¿Cuántos ingresos revisan al mes?', '¿Quién revisa hoy los antecedentes de un candidato?', '¿Te sirve verlo 15 minutos esta semana?'];
// …and opens with its own moment.
const openings = ['En Yago revisamos antecedentes laborales con AXIS', 'Cuando la nómina llega encima de la fecha, Yago deja el resultado de AXIS listo',
  'Si una jefatura pide un respaldo, Yago lo tiene guardado con AXIS'];
const own = (bodies: string[]) => bodies.map((body, index) => body.replace('¿Te sirve verlo 15 minutos esta semana?', closings[index % closings.length])
  .replace(openings[0], openings[index % openings.length]));
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
  const good = 'Hola Felipe,\n\nEn seguridad privada entran grupos de guardias nuevos, y en Securitas cada uno pasa por la revisión de antecedentes en el PJUD. AXIS consulta el lote completo y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan en una semana normal?\n\nNicolás Y.\nGerente Comercial\nYago SpA';
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
  assert.deepEqual(coworkDraftIssues([twice], withProofs).map(issue => `${issue.where} · ${issue.short}`).filter(line => !line.endsWith('momento distinto')),
    ['«Secuencia AXIS», correo 2 · prueba una vez']);
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
  const good = `Hola Felipe,\n\nEn seguridad privada entran grupos de guardias nuevos, y en Securitas cada uno pasa por la revisión de antecedentes en el PJUD. AXIS consulta el lote completo y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan en una semana normal?${signature}`;
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
  assert.deepEqual(shorts(r04), ['qué hace la oferta', 'una sola capacidad', 'sin pedir reunión']);
  // R15: a closing that offers «more information».
  assert.deepEqual(shorts(good.replace('¿Cuántos ingresos revisan en una semana normal?', '¿Te envío más información sobre AXIS?')), ['pregunta concreta']);
  // R09: the product first, and as if they already used it.
  const r09 = 'Hola {{nombre}},\n\nAXIS está pensado para revisar antecedentes laborales de postulantes. En {{empresa}}, AXIS consulta en el PJUD y consolida resultados; procesa 1.000 personas en unos 30 minutos.\n\n¿Cuánto les toma hoy revisar los antecedentes de una persona?' + signature;
  const campaign = { type: 'email_draft' as const, title: 'Campaña', to: ['a@x.cl', 'b@y.cl'], subject: 'Antecedentes en {{empresa}}', body: r09 };
  // «AXIS consulta en el PJUD y consolida resultados» also says two capabilities in the offer's sentence (v11 reading).
  assert.deepEqual(coworkDraftIssues([campaign], checks).map(issue => issue.short), ['apertura concreta', 'sin suponer que la usan', 'sin frases de catálogo', 'una sola capacidad']);
  assert.deepEqual(coworkDraftIssues([{ ...campaign, body: r09.replace('AXIS está pensado para revisar', 'Te escribo para contarte cómo revisar') }], checks).map(issue => issue.short),
    ['apertura concreta', 'sin suponer que la usan', 'una sola capacidad']);
  // R33: a follow-up that repeats the proof of the first email (and hedges).
  const r33 = 'Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. Si en algún proceso necesitan revisar varias personas, AXIS procesa 1.000 personas en unos 30 minutos.\n\n¿Suelen revisar esos antecedentes uno a uno o por archivo?' + signature;
  assert.deepEqual(coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento', to: null, subject: 'Antecedentes en Sodexo', body: r33 }], checks).map(issue => issue.short),
    ['directo', 'pregunta por un dato', 'ángulo nuevo']);
  // A meeting is fine from the third email of a sequence on, and in a reply inside an open conversation.
  const step = (question: string) => good.replace('Hola Felipe,', 'Hola {{nombre}},').replace('en Securitas', 'en {{empresa}}').replace('¿Cuántos ingresos revisan en una semana normal?', question);
  const meetingLast = sequence([step('¿Cuántos ingresos revisan en una semana normal?'), step('¿Quién revisa hoy esos antecedentes?').replace(/ AXIS consulta[^.]+\./, ''), step('¿Te sirve verlo 15 minutos esta semana?').replace(/ AXIS consulta[^.]+\./, '')]);
  assert.deepEqual(coworkDraftIssues([meetingLast], checks).map(issue => `${issue.where} · ${issue.short}`).filter(line => !line.endsWith('momento distinto')), []);
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
  assert.deepEqual(shorts('En seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes en el PJUD deja turnos sin cubrir.'), []);
  // The product in the first sentence (12 oct matrix: «Para revisar antecedentes…, AXIS consulta…», «Al incorporar personal, AXIS consulta…»).
  assert.deepEqual(shorts('Para revisar antecedentes de guardias en seguridad privada, AXIS consulta en el PJUD por lote.', 'Procesa 1.000 personas en unos 30 minutos.'), ['apertura concreta', 'qué hace la oferta']);
  assert.deepEqual(shorts('En Yago revisamos antecedentes de guardias en minutos.'), ['apertura concreta']);
  // Openings that define the task wherever the verb is.
  for (const defines of ['En seguridad privada, revisar antecedentes laborales es una de las tareas que acompaña la incorporación.',
    'En seguridad privada, revisar antecedentes a mano significa hacer una consulta por cada persona.',
    'En los procesos de selección, revisar antecedentes en el PJUD es parte de evaluar postulantes.'])
    assert.deepEqual(shorts(defines), ['apertura concreta'], defines);
  // A catalog phrase anywhere: in the second email of a sequence too.
  assert.deepEqual(shorts('En seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes deja turnos sin cubrir.',
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
  assert.equal(coworkPolishProofs('AXIS consulta antecedentes por lote, con este resultado: «Procesa 1.000 personas en unos 30 minutos.»\n\n¿Quién lo hace hoy?', proofs),
    'AXIS consulta antecedentes por lote, con este resultado: procesa 1.000 personas en unos 30 minutos.\n\n¿Quién lo hace hoy?');
  assert.equal(coworkPolishProofs('AXIS consulta antecedentes por lote; Procesa 1.000 personas en unos 30 minutos.', proofs), 'AXIS consulta antecedentes por lote; procesa 1.000 personas en unos 30 minutos.');
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
  // A question on its own line starts with a capital (v15), with or without proofs.
  const lower = { ...output, blocks: [{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Demo', body: 'Hola,\n\nAXIS consulta antecedentes.\n\n¿qué día les acomoda una demo?\n\nNicolás Y.' }] };
  assert.match((coworkPolishDraft(lower, []).blocks[0] as { body: string }).body, /\n¿Qué día les acomoda una demo\?\n/);
  // One email for four people is a template: the reply does not call it personalized (round 12).
  const template = { ...output, reply: 'Personalicé el correo para los cuatro contactos con una apertura compartida.', blocks: [{ type: 'email_draft' as const,
    title: 'Correo', to: ['a@x.test', 'b@x.test'], subject: 'Revisión en {{empresa}}', body: 'Hola {{nombre}},\n\nAXIS consulta antecedentes.\n\nSaludos,\nNicolás' }] };
  assert.equal(coworkPolishDraft(template, []).reply, 'Escribí el correo para los cuatro contactos con una apertura compartida.');
  const personal = { ...template, blocks: [{ ...template.blocks[0], to: ['a@x.test'], subject: 'Revisión en Manpower', body: 'Hola Daniela,\n\nAXIS consulta antecedentes.\n\nSaludos,\nNicolás' }] };
  assert.equal(coworkPolishDraft(personal, []).reply, template.reply);
});

test('telling the reader where a figure came from is an internal reference in any wording', () => {
  const email = { type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes en Securitas',
    body: 'Hola Felipe,\n\nAXIS consulta antecedentes laborales en el PJUD; el dato que compartiste para AXIS es que procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás Yarur' };
  assert.ok(coworkDraftIssues([email], context).some(issue => issue.short === 'sin referencias internas'));
});

test('a subject never puts the seller where the reader goes', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: true, products: ['axis', 'yago'] };
  const email = (subject: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject,
    body: 'Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes en el PJUD deja turnos sin cubrir.\n\nAXIS consulta el lote completo.\n\n¿Qué día les acomoda una demo?\n\nNicolás Y.' }], checks).map(issue => issue.short);
  assert.deepEqual(email('Revisión de antecedentes en Yago'), ['asunto con su empresa']);
  assert.deepEqual(email('Revisión de antecedentes para ingresos masivos'), []);
  // v17: the product or the seller anywhere in a first subject; a reply keeps the subject it answers.
  assert.deepEqual(email('AXIS de Yago para RR. HH.'), ['asunto con su empresa']);
  assert.deepEqual(email('Re: AXIS y la demo'), []);
  assert.match(COWORK_WRITER_RULES.join('\n'), /Si el correo pegado saluda sin nombre \(«Hola, les escribo…»\), queda «Hola,»: no lo conviertas en \{\{nombre\}\}/);
});

test('the Reviewer does not undo what the rules ask: the general premise of the opening, the «Hola,» of a pasted email', () => {
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }];
  const checks = { ...context, recipients, meeting: true, products: ['axis'] };
  const issue = (problem: string, short = 'apertura respaldada') => ({ where: '«Correo»', problem, fix: 'Ajusta la apertura.', short });
  const general = issue('La primera frase afirma que revisar antecedentes uno por uno retrasa las incorporaciones, sin respaldo específico para afirmarlo como hecho general.');
  const email = (opening: string, to: string[] | null = ['a@x.cl', 'b@y.cl']) => [{ type: 'email_draft' as const, title: 'Correo', to, subject: 'Antecedentes',
    body: `Hola {{nombre}},\n\n${opening}\n\nAXIS consulta antecedentes por lote.\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás` }];
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

test('the question is asked, not announced, and a closing never asks whether the offer fits (v4 reading)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: true, products: ['axis'] };
  const step = (middle: string, question = '¿Quién se encarga hoy de consultar el PJUD?') => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo',
    to: null, subject: 'Antecedentes', body: `Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.\n\n${middle}\n\n${question}\n\nNicolás Y.` }], checks)
    .map(issue => issue.short);
  assert.deepEqual(step('AXIS consulta antecedentes por lote.'), []);
  for (const filler of ['Para ubicar dónde encaja AXIS, prefiero partir por la persona que lleva esa revisión.', 'Antes de profundizar en AXIS, quiero entender cómo se reparte esa revisión.',
    'Para conversar sobre AXIS, quiero partir por cómo se reparte esa revisión.', 'Quería preguntarte cómo lo organizan hoy en tu equipo.', 'Para entender cómo lo resuelven hoy:',
    'Para ordenar ese paso, importa tener claro quién recibe la lista.'])
    assert.deepEqual(step(filler), ['pregunta directa'], filler);
  assert.deepEqual(step('AXIS consulta antecedentes por lote.', 'Para entender cómo se organiza, ¿cómo distribuyen hoy la revisión?'), ['pregunta directa', 'pregunta en una línea']);
  // «para ver si calza», «cómo podría servir»: a formula, also when the person asked for the meeting.
  assert.deepEqual(step('AXIS consulta antecedentes por lote.', '¿Qué día te acomoda conversar brevemente para ver si calza con tu proceso?'), ['pregunta concreta']);
  assert.deepEqual(step('AXIS consulta antecedentes por lote.', '¿Te acomoda agendar una conversación breve para revisar cómo podría servir en tus procesos?'), ['pregunta concreta']);
  assert.deepEqual(step('AXIS consulta antecedentes por lote.', '¿Qué día te acomoda conversar 15 minutos?'), []);
  assert.deepEqual(step('AXIS consulta antecedentes por lote.', '¿Te sirve verlo con un caso de tu equipo?'), []);
});

test('the reply to the person carries no internal jargon (v6 reading: «no confirma la cobertura del buzón»)', () => {
  assert.deepEqual(coworkReplyIssues('El registro muestra que no hay respuesta, pero no confirma la cobertura del buzón; avísame si contestó.').map(issue => issue.short), ['respuesta sin jerga']);
  assert.deepEqual(coworkReplyIssues('Revisé leads.search y armé el correo.').map(issue => issue.short), ['respuesta sin jerga']);
  assert.deepEqual(coworkReplyIssues('No veo si respondió porque tu correo no está conectado a ANTON.IA.'), []);
});

test('the v6 reading: no announcing in other words, no talking about the email itself, no word said twice in the opening', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis'] };
  const issues = (body: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\n${body}\n\nNicolás Y.` }], checks);
  const shorts = (body: string) => issues(body).map(issue => issue.short);
  const opening = 'Cuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.';
  const question = '¿Quién se encarga hoy de esa revisión?';
  assert.deepEqual(shorts(`${opening}\n\nAXIS consulta antecedentes por lote.\n\n${question}`), []);
  for (const filler of ['Para situar AXIS en ese trabajo, quiero entender quién se encarga de esa revisión.', 'Me interesa entender cómo se reparte.'])
    assert.deepEqual(shorts(`${opening}\n\n${filler}\n\n${question}`), ['pregunta directa'], filler);
  for (const itself of ['Con este correo cierro la secuencia.', 'Cierro con un uso concreto: AXIS consulta antecedentes por lote.', 'Cierro estos mensajes con un caso de AXIS.'])
    assert.deepEqual(shorts(`${opening}\n\n${itself}\n\n${question}`), ['sin hablar del correo'], itself);
  // The last email may still say it is the last one.
  assert.deepEqual(shorts(`${opening}\n\nAXIS consulta antecedentes por lote. Este es mi último mensaje sobre esto.\n\n${question}`), []);
  for (const [said, words] of [['Cuando entran muchas personas a la vez, revisar uno por uno los antecedentes alarga la revisión.', 'revisar… revision'],
    ['Cuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja esperando al equipo de personas.', 'personas… personas'],
    ['Cuando coinciden varios ingresos en {{empresa}}, revisarlos uno por uno deja cada ingreso esperando turno.', 'ingresos… ingreso']]) {
    assert.deepEqual(shorts(`${said}\n\nAXIS consulta antecedentes por lote.\n\n${question}`), ['apertura sin repetir'], said);
    assert.match(issues(`${said}\n\nAXIS consulta antecedentes por lote.\n\n${question}`)[0].problem, new RegExp(words));
  }
  // The rules ask for one email per person for two or three people, and a single text with {{nombre}} for more.
  assert.match(COWORK_WRITER_RULES.join('\n'), /para 2 o 3 personas con correo observado va en un bloque por persona/);
  assert.match(COWORK_WRITER_RULES.join('\n'), /Para 4 o más personas, en una secuencia o si el usuario pide un solo texto para todos, va un solo bloque/);
});

test('a correction never tells the person what it changed: the first draft\'s reply stays (v6 reading)', async () => {
  const first = output([signed.replace('en minutos', 'gratis'), signed, signed]);
  const fixed = { ...output([signed, signed, signed]), reply: 'Ajusté el segundo correo para no atribuir tareas al equipo de la persona.' };
  const result = await harness([first, fixed]).run();
  assert.equal(result.reply, first.reply);
  assert.deepEqual(result.blocks, fixed.blocks);
  // An answer that already told what it changed in the person's own email keeps the correction's words.
  const edit = { ...first, reply: 'Cambié la invitación abierta por una pregunta concreta.' };
  const editFixed = { ...fixed, reply: 'Cambié el cierre por una pregunta sobre qué día les acomoda.' };
  assert.equal((await harness([edit, editFixed]).run()).reply, editFixed.reply);
});

test('the v7 reading: benefits said in the abstract, «es una alternativa», «si calza», «basta con saber» and replies that apologize', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis'] };
  const opening = 'Cuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.';
  const shorts = (middle: string, question = '¿Quién se encarga hoy de esa revisión?', first = opening) => coworkDraftIssues([{ type: 'email_draft' as const,
    title: 'Correo', to: null, subject: 'Antecedentes', body: `Hola,\n\n${first}\n\n${middle}\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  assert.deepEqual(shorts('AXIS consulta antecedentes por lote.'), []);
  for (const vague of ['Tener los resultados de las consultas reunidos ayuda a revisar los antecedentes.', 'AXIS procesa 1.000 personas para apoyar esa revisión.',
    'Contar con el respaldo de cada consulta facilita dejar registro.'])
    assert.deepEqual(shorts(vague), ['sin beneficios vagos'], vague);
  // A capability that «permite» something is what the offer does, not a vague benefit.
  assert.deepEqual(shorts('AXIS permite cargar la nómina por archivo.'), []);
  assert.deepEqual(shorts('AXIS es una alternativa para esa revisión.'), ['sin frases de catálogo']);
  for (const formula of ['¿Te sirve revisar si AXIS calza con tus ingresos?', '¿Les sería relevante revisar antecedentes con AXIS?', '¿Es relevante para tu equipo?'])
    assert.deepEqual(shorts('AXIS consulta antecedentes por lote.', formula), ['pregunta concreta'], formula);
  assert.deepEqual(shorts('Para ubicar dónde encaja AXIS, basta con saber quién lleva esa parte.'), ['pregunta directa']);
  // An opening that defines the task is flagged in any email of a sequence, but not the line that reopens a follow-up.
  assert.deepEqual(coworkDraftIssues([sequence([0, 1].map(index => `Hola {{nombre}},\n\n${index ? 'Cuando coinciden varias incorporaciones, las consultas en el PJUD forman parte de la coordinación.' : opening} AXIS consulta antecedentes por lote.\n\n${['¿Cuántos ingresos revisan al mes en {{empresa}}?', '¿Quién lo hace hoy en tu equipo?'][index]}\n\nNicolás Yarur`))],
    { ...checks, signer: 'Nicolás Yarur' }).map(issue => `${issue.where} · ${issue.short}`), ['«Secuencia AXIS», correo 2 · apertura concreta']);
  for (const excuse of ['El correo queda genérico porque no se indicó un destinatario.', 'La secuencia es genérica para gerentes de Personas.', 'Preparé el correo, planteada como una situación general.'])
    assert.deepEqual(coworkReplyIssues(excuse).map(issue => issue.short), ['respuesta sin excusas'], excuse);
  assert.deepEqual(coworkReplyIssues('Escribí un correo para Felipe, Jefe de Reclutamiento de Securitas Chile.'), []);
});

test('an email the person pasted keeps the meeting it asks for, and a formula closing becomes a question by day when they asked for one (v8 reading)', () => {
  const pasted = 'mejorame este correo: "Hola, somos Yago y tenemos un software buenisimo para RRHH, es el mejor del mercado y te ahorra 80% del tiempo. Agendemos."';
  const base = coworkWriterContext({ fullName: 'Nicolás Y.' }, [], null, pasted);
  assert.equal(base.keepsAsk, true);
  assert.equal(coworkWriterContext({ fullName: 'Nicolás Y.' }, [], null, `${pasted} Quita la reunión.`).keepsAsk, false);
  assert.equal(coworkWriterContext({ fullName: 'Nicolás Y.' }, [], null, 'escríbele a Felipe pidiendo una reunión').keepsAsk, false);
  const checks = { ...base, products: ['axis'] };
  const email = (question: string) => [{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote.\n\n${question}\n\nNicolás Y.` }];
  assert.deepEqual(coworkDraftIssues(email('¿Qué día te acomoda conversar?'), checks), []);
  assert.deepEqual(coworkDraftIssues(email('¿Cuánto les toma hoy revisar una nómina?'), checks).map(issue => issue.short), ['conserva lo que pide']);
  const formula = coworkDraftIssues(email('¿Te acomoda agendar una conversación para ver si calza con tu proceso?'), checks);
  assert.deepEqual(formula.map(issue => issue.short), ['pregunta concreta']);
  assert.match(formula[0].fix, /¿Qué día te acomoda conversar\?/);
  // Without a meeting asked, the formula's fix asks for something answered in a line, and nothing else is required.
  assert.doesNotMatch(coworkDraftIssues(email('¿Te sirve ver si calza con tu proceso?'), { ...checks, meeting: false, keepsAsk: false })[0].fix, /qué día/i);
});

test('the v8 reading: the second email of a sequence does not describe the offer, and questions before the last ask about their work', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const step = (middle: string, question: string) => `Hola {{nombre}},\n\nCuando la nómina llega encima de la fecha de ingreso en {{empresa}}, revisarla uno por uno deja turnos sin cubrir.${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const three = (second: string, secondQuestion = '¿Quién prepara hoy la nómina?') => coworkDraftIssues([sequence([
    step(' AXIS consulta antecedentes por lote.', '¿Cuántos ingresos revisan al mes en {{empresa}}?'), step(second, secondQuestion), step(' AXIS deja evidencia de cada consulta.', '¿Te sirve verlo con un caso de AXIS?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`).filter(line => !line.endsWith('pregunta distinta') && !line.endsWith('apertura sin repetir') && !line.endsWith('momento distinto'));
  assert.deepEqual(three(''), []);
  assert.deepEqual(three(' AXIS permite cargar la nómina por archivo.'), ['«Secuencia AXIS», correo 2 · correo 2 sin la oferta']);
  assert.deepEqual(three('', '¿Quién en tu equipo prepara el archivo para cargar los nombres en AXIS?'), ['«Secuencia AXIS», correo 2 · pregunta sobre su trabajo']);
  // «¿es un tema relevante?» is a formula; «dejar claro… ayuda al» a vague benefit.
  const one = (middle: string, question: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.\n\n${middle}\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  assert.deepEqual(one('AXIS consulta antecedentes por lote.', '¿Revisar antecedentes es un tema relevante para ti?'), ['pregunta concreta']);
  assert.deepEqual(one('Dejar claro qué consulta se hizo ayuda al revisar el ingreso.', '¿Quién guarda hoy esos respaldos?'), ['sin beneficios vagos']);
});

test('a first email says what the offer does, not only its proof (v9 reading: «AXIS procesa 1.000 personas en unos 30 minutos.»)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: ['Procesa 1.000 personas en unos 30 minutos'], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const issues = (middle: string, opening = 'Cuando entra un grupo de guardias, revisar sus antecedentes uno a uno retrasa que tomen turno.') =>
    coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: null, subject: 'Guardias en Securitas',
      body: `Hola Felipe,\n\n${opening}\n\n${middle}\n\n¿Cuántos guardias incorporan al mes en Securitas?\n\nNicolás Y.\nGerente Comercial\nYago SpA` }], checks)
      .map(issue => issue.short);
  assert.deepEqual(issues('AXIS procesa 1.000 personas en unos 30 minutos.'), ['qué hace la oferta']);
  assert.deepEqual(issues('AXIS, de Yago, procesa 1.000 personas en unos 30 minutos.'), ['qué hace la oferta']);
  assert.match(coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Guardias',
    body: 'Hola Felipe,\n\nCuando entra un grupo de guardias, revisarlos uno a uno retrasa que tomen turno.\n\nAXIS procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos guardias incorporan al mes?\n\nNicolás Y.' }], checks)
    .find(issue => issue.short === 'qué hace la oferta')?.fix ?? '', /^Di qué hace AXIS/);
  assert.deepEqual(issues('AXIS consulta antecedentes por lote en el PJUD y procesa 1.000 personas en unos 30 minutos.'), []);
  assert.deepEqual(issues('AXIS automatiza esas consultas. Procesa 1.000 personas en unos 30 minutos.'), []);
  assert.deepEqual(issues('En Yago desarrollamos AXIS, que consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.'), []);
  // v15 (independent reading): how it works is not what it does. v16: naming only the source is not the object either.
  for (const how of ['En Yago desarrollamos AXIS, que consulta por lote y procesa 1.000 personas en unos 30 minutos.',
    'AXIS consulta por lote y procesa 1.000 personas en unos 30 minutos.', 'AXIS, de Yago, consulta por lote y procesa 1.000 personas en unos 30 minutos.',
    'AXIS carga la nómina por archivo y procesa 1.000 personas en unos 30 minutos.', 'AXIS consulta en el PJUD por lote y procesa 1.000 personas en unos 30 minutos.',
    'AXIS consulta por lote en el PJUD y procesa 1.000 personas en unos 30 minutos.'])
    assert.deepEqual(issues(how), ['qué hace la oferta'], how);
  assert.deepEqual(issues('AXIS consulta antecedentes laborales en el PJUD y procesa 1.000 personas en unos 30 minutos.'), []);
  // A follow-up does not cite the proof again, and an email without the proof has nothing to check here.
  assert.deepEqual(issues('AXIS deja evidencia de cada consulta.'), []);
});

test('the consequence is what is delayed in their business, not a cost in the abstract, and «¿Están evaluando…?» is a formula (v8 reading)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const issues = (opening: string, question = '¿Cuántos guardias incorporan al mes en Securitas?') =>
    coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: null, subject: 'Guardias en Securitas',
      body: `Hola Felipe,\n\n${opening}\n\nAXIS consulta antecedentes por lote en el PJUD.\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA` }], checks)
      .map(issue => issue.short);
  assert.deepEqual(issues('Cuando entra un grupo de guardias, revisar sus antecedentes uno a uno suma trabajo manual al equipo.'), ['consecuencia concreta']);
  assert.deepEqual(issues('En seguridad privada, revisar antecedentes uno por uno ocupa tiempo que el equipo necesita para otros ingresos.'), ['consecuencia concreta']);
  assert.deepEqual(issues('Cuando se juntan postulantes, revisarlos uno por uno concentra el trabajo manual en cada ingreso.'), ['consecuencia concreta']);
  // Said with what is delayed, the same cost is fine.
  assert.deepEqual(issues('Cuando entra un grupo de guardias, revisar sus antecedentes uno a uno suma horas y retrasa que tomen turno.'), []);
  assert.deepEqual(issues('Cuando entra un grupo de guardias, revisarlos uno a uno los deja esperando para tomar su turno.'), []);
  // A follow-up: the consequence is the sentence after «Te escribí…».
  assert.deepEqual(issues('Te escribí el 19 de septiembre sobre los antecedentes. Cuando se agrupan postulantes, procesar cada caso por separado suma pasos antes de tener los resultados.'),
    ['consecuencia concreta']);
  assert.deepEqual(issues('Cuando entra un grupo de guardias, revisarlos uno a uno retrasa que tomen turno.', '¿Están evaluando ese proceso en Securitas?'), ['pregunta concreta']);
});

test('the v10 reading: delays said of «the process», a question that repeats the opening, a sequence that never presents the offer, and replies in jargon', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const email = (opening: string, question = '¿Cuántos ingresos revisan al mes en Securitas?') => coworkDraftIssues([{ type: 'email_draft' as const,
    title: 'Correo para Felipe', to: null, subject: 'Guardias en Securitas',
    body: `Hola Felipe,\n\n${opening}\n\nAXIS consulta antecedentes por lote en el PJUD.\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA` }], checks).map(issue => issue.short);
  for (const vague of ['En seguridad privada, cuando se incorporan guardias, revisar sus antecedentes uno por uno retrasa el proceso de ingreso.',
    'Cuando llegan varias personas a la vez, revisarlas una por una atrasa el avance de los postulantes en el proceso.',
    'Cuando ingresan varios guardias a la vez, revisar uno por uno sus antecedentes en el PJUD requiere trabajo manual.'])
    assert.deepEqual(email(vague), ['consecuencia concreta'], vague);
  // Said with who waits, it is concrete; v17: «alarga el proceso» beside it still reads flat.
  assert.deepEqual(email('En seguridad privada, revisarlos uno por uno deja turnos sin cubrir.'), []);
  assert.deepEqual(email('En seguridad privada, revisarlos uno por uno alarga el proceso y deja turnos sin cubrir.'), ['consecuencia concreta']);
  // The question says the opening again, phrase and all.
  assert.deepEqual(email('En seguridad privada, consultar uno por uno los antecedentes laborales en el PJUD deja al guardia esperando su turno.',
    '¿Cuánto tiempo les toma hoy consultar antecedentes laborales en el PJUD en tu equipo?'), ['pregunta sin repetir']);
  assert.deepEqual(email('En seguridad privada, cuando entran guardias nuevos, revisarlos uno por uno deja turnos sin cubrir.',
    '¿Cuántos ingresos revisan en una semana normal?'), []);
  // v17: how often it happens, said without a fact.
  assert.deepEqual(email('En seguridad privada, cuando entran guardias nuevos todas las semanas, revisarlos uno por uno deja turnos sin cubrir.',
    '¿Cuántos ingresos revisan en una semana normal?'), ['sin suponer frecuencia']);
  // The first email of a sequence presents the offer.
  const step = (middle: string, question: string) => `Hola {{nombre}},\n\nCuando entran muchas personas a la vez en {{empresa}}, revisarlas una por una deja turnos sin cubrir.${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const sequenceIssues = (first: string) => coworkDraftIssues([sequence([step(first, '¿Cuánto les toma hoy esa revisión en {{empresa}}?'),
    step('', '¿Quién prepara hoy la nómina?'), step('\n\nAXIS deja evidencia de cada consulta.', '¿Te sirve verlo con un caso tuyo?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`).filter(line => !line.endsWith('pregunta distinta') && !line.endsWith('apertura sin repetir') && !line.endsWith('momento distinto'));
  assert.deepEqual(sequenceIssues(''), ['«Secuencia AXIS», correo 1 · qué hace la oferta']);
  assert.deepEqual(sequenceIssues('\n\nAXIS consulta antecedentes por lote en el PJUD.'), []);
  // A reply that hides behind the brief.
  assert.deepEqual(coworkReplyIssues('Como no hay destinatarios observados, el correo queda dirigido de forma general.').map(issue => issue.short), ['respuesta sin excusas']);
});

test('the v10 reading of Claude: a pasted meeting asked by the day, one subject in the offer, a question of their own for each person, and the offer in its own paragraph', () => {
  const pasted = 'Mejora este correo para que sea más claro y fácil de responder: "Hola, les escribo de Yago. Tenemos AXIS, una solución para RRHH que ayuda mucho. Nos encantaría mostrarles una demo cuando puedan. Saludos."';
  const checks = { ...coworkWriterContext({ fullName: 'Nicolás Y.' }, [], null, pasted), products: ['axis', 'yago'] };
  const email = (question: string, offer = 'AXIS consulta antecedentes por lote.') => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja puestos sin cubrir mientras el equipo consulta.\n\n${offer}\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  for (const yesNo of ['¿Les interesa que les muestre una demo?', '¿Te acomoda agendar una conversación breve?', '¿Les acomoda una demo breve esta semana?'])
    assert.deepEqual(email(yesNo), ['pregunta por el día'], yesNo);
  for (const byDay of ['¿Qué día les acomoda una demo?', '¿Les acomoda una demo el martes?', '¿Qué día les acomoda una demo, o quién en su equipo ve este tema?'])
    assert.deepEqual(email(byDay), [], byDay);
  // Without a pasted email that asks for it, a yes-or-no meeting is not this check's business.
  assert.deepEqual(coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: 'Hola,\n\nCuando entran muchas personas a la vez, revisarlas una por una deja puestos sin cubrir.\n\nAXIS consulta antecedentes por lote.\n\n¿Les interesa una demo?\n\nNicolás Y.' }],
  { ...checks, keepsAsk: false, meeting: true }).map(issue => issue.short), []);
  // «Con AXIS cargas… y procesa…» changes subject halfway.
  assert.deepEqual(email('¿Qué día les acomoda una demo?', 'Con AXIS cargas la nómina completa y procesa 1.000 personas en unos 30 minutos.'), ['un solo sujeto']);
  for (const one of ['Con AXIS cargas la nómina y recibes los resultados consolidados.', 'AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.',
    'Con AXIS, tu equipo sube la nómina en un archivo y recibe los resultados consolidados.'])
    assert.deepEqual(email('¿Qué día les acomoda una demo?', one), [], one);
  // One email per person: each asks its own question, told apart without the names of their companies.
  const personal = (title: string, question: string) => ({ type: 'email_draft' as const, title, to: [`${title.toLowerCase()}@empresa.cl`], subject: 'Antecedentes',
    body: `Hola ${title},\n\nCuando entra un grupo grande, revisar uno por uno los antecedentes deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote.\n\n${question}\n\nNicolás Y.` });
  const own = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  assert.deepEqual(coworkDraftIssues([personal('Felipe', '¿Cuánto les toma hoy revisar los antecedentes de un grupo en Securitas Chile?'),
    personal('Rodrigo', '¿Cuánto les toma hoy revisar los antecedentes de un grupo en Transportes Andes?'),
    personal('Camila', '¿Cuántos postulantes revisan por semana en Adecco?')], own).map(issue => `${issue.where} · ${issue.short}`), ['«Rodrigo» · pregunta propia']);
  assert.deepEqual(coworkDraftIssues([personal('Felipe', '¿Cuántos ingresos revisan al mes en Securitas?'),
    personal('Rodrigo', '¿Cuántos conductores nuevos incorporan al mes en Transportes Andes?')], own), []);
  // A reply that hides behind the brief's words.
  for (const excuse of ['No tengo su correo observado, así que el borrador queda sin destinatario.', 'El encargo no trae destinatarios, así que queda lista para tus contactos con correo.'])
    assert.deepEqual(coworkReplyIssues(excuse).map(issue => issue.short), ['respuesta sin excusas'], excuse);
  // The offer named after the opening in the same paragraph starts a paragraph of its own; nothing else moves.
  assert.equal(coworkSplitOffer('Hola,\n\nCuando entran muchas personas a la vez, revisarlas una por una atrasa el ingreso. AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.\n\n¿Qué día les acomoda una demo?\n\nNicolás Y.', ['axis', 'yago']),
    'Hola,\n\nCuando entran muchas personas a la vez, revisarlas una por una atrasa el ingreso.\n\nAXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.\n\n¿Qué día les acomoda una demo?\n\nNicolás Y.');
  assert.equal(coworkSplitOffer('Hola Marcela,\n\nTe escribí el 19 de septiembre sobre AXIS. Cuando llega un grupo grande, cada revisión a mano retrasa a quienes ya están aprobados. AXIS consulta el lote completo en el PJUD.\n\n¿Quién lleva hoy esa revisión en Sodexo?\n\nNicolás Y.', ['axis']),
    'Hola Marcela,\n\nTe escribí el 19 de septiembre sobre AXIS. Cuando llega un grupo grande, cada revisión a mano retrasa a quienes ya están aprobados.\n\nAXIS consulta el lote completo en el PJUD.\n\n¿Quién lleva hoy esa revisión en Sodexo?\n\nNicolás Y.');
  for (const kept of ['Hola,\n\nCuando entran muchas personas a la vez, revisarlas una por una atrasa el ingreso.\n\nAXIS consulta antecedentes por lote.\n\n¿Qué día les acomoda una demo?',
    'Hola,\n\nEn Yago desarrollamos AXIS. Cuando entran muchas personas, revisarlas atrasa el ingreso.\n\n¿Qué día les acomoda una demo?', signed])
    assert.equal(coworkSplitOffer(kept, ['axis', 'yago']), kept);
  const output = { reply: 'Listo.', question: null, suggestions: [], blocks: [{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: 'Hola,\n\nCuando entran muchas personas a la vez, revisarlas una por una atrasa el ingreso. AXIS consulta antecedentes por lote.\n\n¿Qué día les acomoda una demo?\n\nNicolás Y.' }] } as unknown as CoworkWriterOutput;
  assert.match((coworkPolishDraft(output, [], ['axis']).blocks[0] as { body: string }).body, /el ingreso\.\n\nAXIS consulta antecedentes por lote\./);
});

test('each email of a sequence opens with its own moment (v10 reading: the same «nómina encima de la fecha» in the second and the third)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const step = (opening: string, middle: string, question: string) => `Hola {{nombre}},\n\n${opening}${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const issues = (second: string, third: string) => coworkDraftIssues([sequence([
    step('Cuando se incorporan muchas personas a la vez en {{empresa}}, revisarlas una por una deja turnos sin cubrir.', '\n\nAXIS consulta antecedentes por lote.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step(second, '', '¿Quién se encarga hoy de revisar los antecedentes en tu equipo?'),
    step(third, '\n\nAXIS tiene los resultados de todos juntos.', '¿Te sirve verlo con un caso de tu equipo?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`);
  assert.deepEqual(issues('Cuando la nómina de postulantes llega cerca de la fecha de ingreso, el equipo corre para tener los antecedentes listos.',
    'Cuando la nómina llega encima de la fecha de ingreso, buscar a cada persona por separado retrasa al grupo que espera empezar.'), ['«Secuencia AXIS», correo 3 · momento distinto']);
  assert.deepEqual(issues('Cuando la nómina de postulantes llega cerca de la fecha de ingreso, el equipo corre para tener los antecedentes listos.',
    'Cuando alguien pregunta meses después si se revisó a una persona, armar ese respaldo a mano se lleva una tarde entera.'), []);
});

test('the v11 reading: the hiring delayed with nobody waiting, two capabilities in the offer, and later emails that open with the product or the farewell', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: ['Procesa 1.000 personas en unos 30 minutos.'], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const email = (opening: string, offer = 'AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.') => coworkDraftIssues([{ type: 'email_draft' as const,
    title: 'Correo', to: null, subject: 'Antecedentes', body: `Hola,\n\n${opening}\n\n${offer}\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás Y.` }], checks)
    .map(issue => issue.short);
  for (const plain of ['Cuando entran muchas personas a la vez, revisar sus antecedentes en el PJUD retrasa el ingreso de cada una.',
    'Cuando entra un grupo grande de personas a la vez, revisar sus antecedentes uno por uno en el PJUD alarga la contratación.',
    'Cuando llegan varios postulantes, revisar sus antecedentes uno por uno retrasa su incorporación.'])
    assert.deepEqual(email(plain), ['consecuencia concreta'], plain);
  // v15 (independent reading): someone waiting to start is not yet what the business loses.
  assert.deepEqual(email('Cuando entran muchas personas a la vez, revisar uno por uno sus antecedentes retrasa el ingreso de quienes ya están contratados.'),
    ['pérdida en el negocio']);
  for (const concrete of ['Cuando entran muchas personas a la vez, revisar uno por uno sus antecedentes deja puestos sin cubrir mientras el equipo consulta.',
    'Cuando entra un grupo de guardias, revisar uno por uno sus antecedentes atrasa el ingreso y deja turnos sin cubrir.',
    'En alimentación, cuando entra personal nuevo cerca del inicio de un servicio, revisar la nómina uno por uno retrasa su llegada a cocina.'])
    assert.deepEqual(email(concrete), [], concrete);
  // Two capabilities in the sentence that names the offer; a noun («cada consulta») is not one.
  const opening = 'Cuando entran muchas personas a la vez, revisar uno por uno sus antecedentes deja turnos sin cubrir.';
  assert.deepEqual(email(opening, 'AXIS consulta antecedentes por lote en el PJUD y entrega resultados consolidados; procesa 1.000 personas en unos 30 minutos.'),
    ['una sola capacidad']);
  // v15: a second service tacked on with «y la nómina se carga…» (independent reading of a third email).
  assert.deepEqual(email(opening, 'AXIS guarda la evidencia de cada consulta y la nómina se carga por archivo o por correo.'), ['una sola capacidad']);
  // v15: receiving the list is how it works, not what it does.
  assert.deepEqual(email(opening, 'AXIS recibe la nómina por archivo o por correo, consulta en el PJUD y procesa 1.000 personas en unos 30 minutos.'),
    ['qué hace la oferta', 'una sola capacidad']);
  for (const one of ['AXIS deja evidencia auditable de cada consulta al PJUD.', 'AXIS hace la consulta judicial por archivo y procesa 1.000 personas en unos 30 minutos.'])
    assert.deepEqual(email(opening, one), [], one);
  // From the third email of a sequence on: a moment first, and the farewell next to the question.
  const step = (body: string, question: string) => `Hola {{nombre}},\n\n${body}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const third = (body: string) => coworkDraftIssues([sequence([
    step('Cuando entran muchas personas a la vez en {{empresa}}, revisarlas una por una deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre para tener los antecedentes listos.', '¿Quién prepara hoy esa lista?'),
    step(body, '¿Te sirve verlo con una nómina tuya?')])], checks).map(issue => `${issue.where} · ${issue.short}`);
  assert.deepEqual(third('Antes de confirmar quién parte, AXIS entrega resultados consolidados de los postulantes.'), ['«Secuencia AXIS», correo 3 · apertura concreta']);
  assert.deepEqual(third('Este es mi último mensaje sobre esto.\n\nCuando alguien pregunta por un ingreso, buscar el respaldo toma horas.\n\nAXIS deja evidencia auditable de cada consulta.'),
    ['«Secuencia AXIS», correo 3 · cierre junto a la pregunta']);
  assert.deepEqual(third('Cuando alguien pregunta por un ingreso, buscar el respaldo toma horas.\n\nAXIS deja evidencia auditable de cada consulta. Este es mi último mensaje.'), []);
});

test('the v12 reading: long closing questions, the brief\'s words in the reply, and a next step for emails with an address', async () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: true, products: ['axis'] };
  const ask = (question: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\nCuando entran muchas personas a la vez, revisar uno por uno los antecedentes deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote.\n\n${question}\n\nNicolás Y.` }], checks)
    .map(issue => issue.short);
  for (const long of ['¿Qué día de esta semana les acomoda una conversación breve para ver cómo lo harían con sus postulantes?',
    '¿Te acomoda una llamada de 15 minutos el martes o el miércoles para ver cómo lo harías con tus postulantes?'])
    assert.deepEqual(ask(long), ['pregunta corta'], long);
  assert.deepEqual(ask('¿Qué día de esta semana te acomoda una reunión breve para verlo?'), []);
  // The words of the brief and the reads are not the person's: «observados», «este encargo».
  for (const reply of ['Mantuve el saludo al grupo; como no hay nombres observados, queda «Hola,».', 'No lo asigné a destinatarios porque no hay contactos en este encargo.'])
    assert.deepEqual(coworkReplyIssues(reply).map(issue => issue.short), ['respuesta sin jerga'], reply);
  assert.deepEqual(coworkReplyIssues('Mantuve el saludo al grupo y la invitación a la demo.'), []);
  // v15 (independent reading): the rules' words in the reply.
  for (const reply of ['Presenta AXIS con una sola capacidad y el resultado que cargaste en tu Perfil.', 'Cada correo incluye el dato de procesamiento disponible.'])
    assert.deepEqual(coworkReplyIssues(reply).map(issue => issue.short), ['respuesta sin jerga'], reply);
  // Emails with an address offer the next step: the paused campaign, or in an open conversation, sending the first reply.
  const to = (subject: string, address: string[] | null) => [{ type: 'email_draft' as const, title: 'Correo para Felipe', to: address, subject, body: 'Hola Felipe,' }];
  assert.deepEqual(coworkNextStepIssues({ blocks: to('Antecedentes en Securitas', ['fmunoz@securitas.cl']), question: null }).map(issue => issue.short), ['paso siguiente']);
  // One reply is proposed by name; with several, the first one (v15: «¿Propongo enviar primero la de Marcela?» read oddly with one).
  assert.match(coworkNextStepIssues({ blocks: to('Re: Antecedentes', ['fmunoz@securitas.cl']), question: null })[0].fix, /¿Propongo enviárselo a <nombre>\?/);
  assert.match(coworkNextStepIssues({ blocks: [...to('Re: Antecedentes', ['fmunoz@securitas.cl']), ...to('Re: Antecedentes', ['cfuentes@adecco.cl'])], question: null })[0].fix,
    /¿Propongo enviar primero/);
  assert.deepEqual(coworkNextStepIssues({ blocks: to('Antecedentes en Securitas', ['fmunoz@securitas.cl']), question: '¿Creo la campaña pausada para Felipe?' }), []);
  assert.deepEqual(coworkNextStepIssues({ blocks: to('Antecedentes', null), question: null }), []);
  // In a turn, the Writer is asked for it, unless the person asked for the campaign in the request (the coordinator proposes it next).
  const felipe = 'Hola Felipe,\n\nEn seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote.\n\n¿Cuántos ingresos revisan al mes en Securitas?\n\nSaludos,\nNicolás Yarur\nGerente Comercial, Yago';
  const lone: CoworkWriterOutput = { reply: 'Escribí el correo para Felipe.', question: null, suggestions: [{ label: 'Hazlo más corto', message: 'Hazlo más corto' }],
    blocks: [{ type: 'email_draft', title: 'Correo para Felipe', to: ['fmunoz@securitas.cl'], subject: 'Antecedentes en Securitas', body: felipe }] };
  const asked = { ...lone, question: '¿Creo la campaña pausada para Felipe?' };
  const email: CoworkWriteBrief = { ...brief, kind: 'email', recipients: ['Felipe Muñoz'], steps: null };
  const h = harness([lone, asked]);
  assert.deepEqual(await h.run({ brief: email }), asked);
  assert.match(h.calls[1].prompt, /no propone el paso siguiente/);
  const campaign = harness([lone, { verdict: 'ok', issues: [] }]);
  assert.deepEqual(await campaign.run({ brief: { ...email, campaign: true } }), lone);
  assert.deepEqual(campaign.calls.map(call => call.role), ['writer', 'reviewer']);
  // An email the person pasted to improve is sent by them: no campaign to offer.
  const pasted = harness([lone, { verdict: 'ok', issues: [] }]);
  assert.deepEqual(await pasted.run({ brief: email, request: 'mejora este correo: "Hola Felipe, te escribo de Yago para contarte de AXIS, que revisa antecedentes. Saludos."' }), lone);
  assert.deepEqual(pasted.calls.map(call => call.role), ['writer', 'reviewer']);
});

test('the v12 reading: the Reviewer\'s «sin respaldo» on a trade\'s consequence goes, and a correction that narrates keeps the first reply', async () => {
  const recipients = [{ name: 'Felipe Muñoz', email: 'fmunoz@securitas.cl', company: 'Securitas Chile' }, { name: 'Camila Fuentes', email: 'cfuentes@adecco.cl', company: 'Adecco' }];
  const checks = { ...context, recipients, meeting: false, products: ['axis'] };
  const body = (name: string, opening: string) => `Hola ${name},\n\n${opening}\n\nAXIS consulta antecedentes por lote toda la nómina.\n\n¿Quién revisa hoy los antecedentes?\n\nNicolás`;
  const blocks = (camila: string) => [
    { type: 'email_draft' as const, title: 'Correo para Felipe', to: ['fmunoz@securitas.cl'], subject: 'Antecedentes en Securitas', body: body('Felipe', 'En seguridad privada, cuando entra un grupo de guardias, revisarlos uno por uno deja turnos sin cubrir.') },
    { type: 'email_draft' as const, title: 'Correo para Camila', to: ['cfuentes@adecco.cl'], subject: 'Antecedentes en Adecco', body: body('Camila', camila) }];
  const trade = 'En servicios transitorios, cuando un cliente pide personal para pronto, cada antecedente pendiente es un candidato que no llega a tiempo.';
  // Named by the person and her first paragraph, or by a quote of the opening: the premise of the trade goes.
  const byPlace = { where: 'Primer correo a Camila Fuentes, Adecco — primer párrafo', problem: 'Afirmas como hecho que cada antecedente pendiente hará que un candidato no llegue a tiempo, sin respaldo.', fix: 'Suavízalo.', short: 'sin afirmaciones' };
  const byQuote = { where: 'Primer correo a Camila Fuentes', problem: 'La frase «cada antecedente pendiente es un candidato que no llega a tiempo» atribuye una consecuencia concreta a Adecco sin respaldo.', fix: 'Quítala.', short: 'sin consecuencia inventada' };
  assert.deepEqual(coworkReviewIssues([byPlace, byQuote], blocks(trade), checks), []);
  // Said of their company it stays, and so does a claim about the offer («toda la nómina»).
  assert.deepEqual(coworkReviewIssues([byPlace], blocks(trade.replace('En servicios transitorios', 'En Adecco')), checks), [byPlace]);
  const offer = { where: 'Correo para Camila — cuerpo', problem: '«Toda la nómina» no está respaldado y puede leerse como una garantía.', fix: 'Quítalo.', short: 'sin garantías' };
  assert.deepEqual(coworkReviewIssues([offer], blocks(trade), checks), [offer]);
  // A figure in the opening is not the trade's premise: it stays for the Writer to fix.
  const figure = { ...byQuote, problem: 'La frase «cada mes llegan 200 candidatos» inventa una cifra sin respaldo.' };
  assert.deepEqual(coworkReviewIssues([figure], blocks('En servicios transitorios, cada mes llegan 200 candidatos y cada antecedente pendiente es uno que no llega a tiempo.'), checks), [figure]);
  // A follow-up's premise is the sentence after «Te escribí…».
  const followUp = [{ type: 'email_draft' as const, title: 'Seguimiento a Marcela', to: ['mrojas@sodexo.cl'], subject: 'Re: Antecedentes',
    body: 'Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. En alimentación, revisar la nómina uno por uno atrasa que lleguen a sus puestos.\n\nAXIS recibe la nómina por archivo.\n\n¿Quién prepara hoy la nómina en Sodexo?\n\nNicolás' }];
  const reopened = { where: 'Seguimiento a Marcela Rojas, correo', problem: '«atrasa que lleguen a sus puestos» atribuye a Sodexo un efecto concreto no respaldado.', fix: 'Quítalo.', short: 'sin efecto inventado' };
  assert.deepEqual(coworkReviewIssues([reopened], followUp, { ...checks, recipients: [{ name: 'Marcela Rojas', email: 'mrojas@sodexo.cl', company: 'Sodexo Chile' }] }), []);
  // A correction that says what it adjusted («Ajusté la consecuencia…») keeps the first draft's reply.
  const first = output([signed.replace('en minutos', 'gratis'), signed, signed]);
  const fixed = { ...output([signed, signed, signed]), reply: 'Ajusté la consecuencia para mostrar qué pasa con los postulantes cuando la revisión se demora.' };
  assert.equal((await harness([first, fixed]).run()).reply, first.reply);
  assert.match(COWORK_REVIEWER_RULES.join('\n'), /«cada antecedente pendiente es un conductor que no sale a ruta», «el puesto sigue vacío»\) es el planteamiento del correo/);
  assert.match(COWORK_WRITER_RULES.join('\n'), /fácil de responder en una línea y de menos de 15 palabras/);
});

test('each email of a sequence loses something of its own (v13 reading: «…lleguen a sus puestos» in the first and the third)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis'] };
  const step = (opening: string, middle: string, question: string) => `Hola {{nombre}},\n\n${opening}${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const issues = (third: string) => coworkDraftIssues([sequence([
    step('Cuando ingresan muchas personas a la vez en {{empresa}}, revisar sus antecedentes uno por uno retrasa que lleguen a sus puestos.', '\n\nAXIS consulta antecedentes por lote.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre para tener los antecedentes listos.', '', '¿Quién prepara hoy esa lista?'),
    step(third, '\n\nAXIS deja evidencia auditable de cada consulta.', '¿Te sirve verlo con un caso de tu equipo?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`);
  assert.deepEqual(issues('Cuando recibes una nómina justo antes de una jornada de ingresos, revisarla se vuelve parte de los preparativos para que las personas lleguen a sus puestos.'),
    ['«Secuencia AXIS», correo 3 · consecuencia distinta']);
  assert.deepEqual(issues('Cuando alguien pregunta meses después cómo se revisó a una persona, armar ese respaldo a mano se lleva una tarde entera.'), []);
  // Waiting and the people are what every opening shares: «deja a la gente esperando» twice is not the same consequence.
  assert.deepEqual(issues('Cuando el cliente pide gente para mañana, revisar cada antecedente deja a la gente esperando en la puerta.'), []);
});

test('the v13 reading: a capability added after the proof, the farewell apart from its question, and a follow-up whose offer does not answer its moment', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: ['Procesa 1.000 personas en unos 30 minutos.'], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const opening = 'En seguridad privada, cuando entra un grupo de guardias, revisar uno por uno sus antecedentes deja turnos sin cubrir.';
  const email = (offer: string, first = opening) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo', to: null, subject: 'Antecedentes',
    body: `Hola,\n\n${first}\n\n${offer}\n\n¿Cuántos ingresos revisan al mes?\n\nNicolás Y.` }], checks).map(issue => issue.short);
  for (const tail of ['AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos, con los resultados consolidados.',
    'Con AXIS cargas la nómina por archivo o por correo y recibes los resultados consolidados, con evidencia de cada consulta.'])
    assert.deepEqual(email(tail), ['una sola capacidad'], tail);
  assert.deepEqual(email('AXIS entrega resultados consolidados de las consultas judiciales y procesa 1.000 personas en unos 30 minutos.'), []);
  // The opening's verbs say what is lost, not what the offer does.
  assert.deepEqual(email('AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.',
    'En servicios transitorios, cuando llegan varios postulantes, revisar sus antecedentes uno por uno demora la entrega de candidatos y deja al cliente esperando.'), []);
  // «candidato por candidato», the trade that frames the sentence and the people of the scene are not a word said twice.
  for (const first of ['Cuando llega una nómina grande, alguien del equipo se queda horas consultando candidato por candidato y el resto espera.',
    'En servicios transitorios, cuando una empresa pide muchas personas para el lunes, cada postulante que espera su revisión no llega a cubrir el servicio.',
    'En selección, cuando un cliente pide cubrir muchas vacantes a la vez, el candidato que espera su revisión no llega al cliente a tiempo.'])
    assert.deepEqual(email('AXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.', first), [], first);
  // The last email says it is the last one on its question's line.
  const step = (body: string, question: string) => `Hola {{nombre}},\n\n${body}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const third = (body: string, question = '¿Te sirve verlo con una nómina tuya?') => coworkDraftIssues([sequence([
    step('Cuando entran muchas personas a la vez en {{empresa}}, revisarlas una por una deja turnos sin cubrir.\n\nAXIS consulta antecedentes por lote y procesa 1.000 personas en unos 30 minutos.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre para tener los antecedentes listos.', '¿Quién prepara hoy esa lista?'),
    step(body, question)])], checks).map(issue => `${issue.where} · ${issue.short}`);
  const moment = 'Cuando alguien pregunta meses después cómo se revisó a una persona, armar ese respaldo a mano se lleva una tarde entera.';
  for (const apart of [`${moment}\n\nAXIS deja evidencia auditable de cada consulta. Este es mi último mensaje:`, `${moment}\n\nAXIS deja evidencia auditable de cada consulta.\n\nEste es mi último mensaje.`])
    assert.deepEqual(third(apart), ['«Secuencia AXIS», correo 3 · cierre junto a la pregunta'], apart);
  assert.deepEqual(third(`${moment}\n\nAXIS deja evidencia auditable de cada consulta. Este es mi último mensaje.`), []);
  assert.deepEqual(third(`${moment}\n\nAXIS deja evidencia auditable de cada consulta.`, 'Este es el último mensaje sobre esto, así que te pregunto directo: ¿quién aprueba hoy un ingreso atrasado?'), []);
  // A follow-up that opens with a delay offers what answers it; the evidence goes with the moment someone asks for it.
  const followUp = (consequence: string, offer: string, question = '¿Quién reúne hoy esos respaldos en Sodexo?') => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento a Marcela', to: null, subject: 'Re: Antecedentes',
    body: `Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. ${consequence}\n\n${offer}\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  assert.deepEqual(followUp('En alimentación, cuando entra un grupo grande de personal, cada revisión a mano retrasa a quienes ya tienen turno asignado.',
    'AXIS deja evidencia auditable de cada consulta.'), ['ángulo coherente']);
  assert.deepEqual(followUp('En alimentación, cuando auditoría pregunta cómo se revisó a alguien ya contratado, buscar el respaldo toma una tarde.',
    'AXIS deja evidencia auditable de cada consulta.'), []);
  // «Piden respaldar la revisión» is the moment the evidence answers, even when what follows is a delay (v14 reading).
  assert.deepEqual(followUp('En alimentación, cuando piden respaldar la revisión de alguien que entra a cocina, buscar la consulta a mano obliga a revisar registro por registro.',
    'AXIS deja evidencia auditable de cada consulta.'), []);
  assert.deepEqual(followUp('En alimentación, cuando entra un grupo grande de personal, cada revisión a mano retrasa a quienes ya tienen turno asignado.',
    'Con AXIS, la lista llega por correo y el equipo no la sube a mano.', '¿Quién revisa hoy esos antecedentes en Sodexo?'), []);
  // A follow-up reopens the first email (v15); an email that is not a follow-up does not need to.
  const evidence = 'En alimentación, cuando un cliente pide cómo se revisó a alguien que ya entró a cocina, reunir ese respaldo a mano obliga a buscar consulta por consulta.';
  const marcela = (body: string, followUp: boolean) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento a Marcela', to: ['mrojas@sodexo.cl'], subject: 'Re: Antecedentes',
    body: `Hola Marcela,\n\n${body}\n\nAXIS deja evidencia auditable de cada consulta.\n\n¿Quién reúne hoy esos respaldos en Sodexo Chile?\n\nNicolás Y.` }], { ...checks, followUp }).map(issue => issue.short);
  assert.deepEqual(marcela(evidence, true), ['retoma el primero']);
  assert.deepEqual(marcela(`Te escribí el 19 de septiembre sobre antecedentes laborales. ${evidence}`, true), []);
  assert.deepEqual(marcela(evidence, false), []);
});

test('the v15 independent reading: an offer that lists its ways of working, the same loss twice in a sequence and the rules\' words in the reply (v16)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: ['Procesa 1.000 personas en unos 30 minutos'], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const offer = (middle: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: null, subject: 'Guardias en Securitas',
    body: `Hola Felipe,\n\nCuando entra un grupo de guardias, revisar sus antecedentes uno a uno retrasa que tomen turno.\n\n${middle}\n\n¿Cuántos guardias incorporan al mes en Securitas?\n\nNicolás Y.\nGerente Comercial\nYago SpA` }], checks)
    .map(issue => issue.short);
  // «por persona o por lote», «por archivo o correo» and evidence added after the proof read as a list of functions.
  for (const listed of ['AXIS consulta antecedentes laborales en el PJUD por persona o por lote y procesa 1.000 personas en unos 30 minutos.',
    'AXIS consulta antecedentes laborales en el PJUD con la nómina por archivo o correo y procesa 1.000 personas en unos 30 minutos.',
    'AXIS consulta antecedentes laborales en el PJUD y procesa 1.000 personas en unos 30 minutos, y queda evidencia de cada consulta.'])
    assert.deepEqual(offer(listed), ['una sola capacidad'], listed);
  assert.deepEqual(offer('AXIS consulta antecedentes laborales en el PJUD y procesa 1.000 personas en unos 30 minutos.'), []);
  // A sequence that comes back to the loss of an earlier email with other words: «deja turnos sin cubrir» and «deja el puesto sin cubrir».
  const step = (opening: string, middle: string, question: string) => `Hola {{nombre}},\n\n${opening}${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const third = (opening: string) => coworkDraftIssues([sequence([
    step('Cuando entran muchas personas a la vez en {{empresa}}, revisar uno por uno los antecedentes deja turnos sin cubrir mientras los nuevos ingresos esperan confirmación.', '\n\nAXIS consulta antecedentes laborales en el PJUD.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre para tener los antecedentes listos.', '', '¿Quién prepara hoy esa lista?'),
    step(opening, '\n\nAXIS deja evidencia auditable de cada consulta.', '¿Te sirve verlo con un caso de tu equipo?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`);
  assert.deepEqual(third('Cuando piden respaldo de los antecedentes de alguien que está por entrar, buscar cada registro a mano deja el puesto sin cubrir.'),
    ['«Secuencia AXIS», correo 3 · consecuencia distinta']);
  assert.deepEqual(third('Cuando te piden respaldo de una consulta en medio de nuevas incorporaciones, buscarla una por una deja al candidato esperando la confirmación de ingreso.'),
    ['«Secuencia AXIS», correo 3 · consecuencia distinta']);
  assert.deepEqual(third('Cuando alguien pregunta meses después cómo se revisó a una persona, armar ese respaldo a mano se lleva una tarde entera.'), []);
  // The rules' and the reads' words in the reply to the seller.
  for (const reply of ['La búsqueda consultada no muestra envíos registrados para Felipe.', 'Lo registrado muestra el correo a Marcela del 19 de septiembre.',
    'Conservé el dato de procesamiento como capacidad, no como garantía.'])
    assert.deepEqual(coworkReplyIssues(reply).map(issue => issue.short), ['respuesta sin jerga'], reply);
  assert.deepEqual(coworkReplyIssues('Presenta AXIS con el resultado que cargaste en tu perfil.'), []);
});

test('a correction that still leaves points gets a second one, kept only when it leaves fewer (v16)', async () => {
  const altered = (body: string) => body.replace('en minutos', 'gratis');
  const first = output([altered(signed), altered(signed), signed]);
  const once = output([signed, altered(signed), signed]);
  const clean = output([signed, signed, signed]);
  const h = harness([first, once, clean]);
  assert.deepEqual(await h.run(), clean);
  assert.deepEqual(h.calls.map(call => call.role), ['writer', 'writer', 'writer']);
  assert.equal(h.steps.at(-1)?.outcome, 'fixed');
  // A second correction that leaves as many points is not kept: the first one stands, with its point to review.
  const same = harness([first, once, once]);
  assert.deepEqual(await same.run(), once);
  assert.equal(same.steps.at(-1)?.outcome, 'pending');
  // Without time left after the first correction, there is no second one.
  let turns = 2;
  const late = harness([first, once]);
  assert.deepEqual(await late.run({ canReview: () => turns-- > 0 }), once);
  assert.deepEqual(late.calls.map(call => call.role), ['writer', 'writer']);
});

test('the v16 independent reading: «capacidad» in the reply, and a sequence whose loss comes back in the second sentence (v17)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  for (const reply of ['Presenta AXIS con una capacidad y la prueba de tu perfil.', 'El correo deja la capacidad principal de AXIS.'])
    assert.deepEqual(coworkReplyIssues(reply).map(issue => issue.short), ['respuesta sin jerga'], reply);
  assert.deepEqual(coworkReplyIssues('Presenta AXIS con lo que hace y la prueba de tu perfil.'), []);
  const step = (opening: string, middle: string, question: string) => `Hola {{nombre}},\n\n${opening}${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const second = (opening: string) => coworkDraftIssues([sequence([
    step('Cuando entra un grupo de guardias en {{empresa}}, revisar uno por uno sus antecedentes deja el turno sin cubrir mientras el postulante espera la confirmación.', '\n\nAXIS consulta antecedentes laborales en el PJUD.', '¿Cuánto les toma hoy revisar una nómina grande?'),
    step(opening, '', '¿Quién prepara hoy esa lista?'),
    step('Cuando alguien pregunta meses después cómo se revisó a una persona, armar ese respaldo a mano se lleva una tarde entera.', '\n\nAXIS deja evidencia auditable de cada consulta.', '¿Te sirve verlo con un caso de tu equipo?')])], checks)
    .map(issue => `${issue.where} · ${issue.short}`);
  // The loss said again in the second sentence of the opening paragraph.
  assert.deepEqual(second('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre con los antecedentes. Esa carrera deja al postulante esperando la confirmación.'),
    ['«Secuencia AXIS», correo 2 · consecuencia distinta']);
  // The paragraph after it is not the opening.
  assert.deepEqual(second('Cuando la lista de ingreso llega el jueves para empezar el lunes, el equipo corre con los antecedentes.\n\nEl cliente ve el puesto vacío el lunes.'), []);
});

test('the first email says what the business loses after the task done by hand, its question asks for a fact, and the reply keeps the record out of it (v18)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: [], recipients: [], meeting: false, products: ['axis', 'yago'] };
  const email = (opening: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Correo para Felipe', to: null, subject: 'Guardias en Securitas',
    body: `Hola Felipe,\n\n${opening}\n\nAXIS consulta antecedentes laborales en el PJUD.\n\n¿Cuántos ingresos revisan al mes en Securitas?\n\nNicolás Y.\nGerente Comercial\nYago SpA` }], checks).map(issue => issue.short);
  // What follows «uno por uno» or «a mano» is a step of the process, not a loss.
  for (const flat of ['En seguridad privada, cuando entra un grupo de guardias, revisarlos uno por uno deja la habilitación pendiente.',
    'En selección, cuando avanzan muchos postulantes a la vez, revisar sus antecedentes a mano distrae al equipo.'])
    assert.deepEqual(email(flat), ['pérdida en el negocio'], flat);
  for (const loss of ['En seguridad privada, cuando entra un grupo de guardias, cada antecedente revisado a mano es un guardia que no toma su turno.',
    'En transporte, cuando entran conductores nuevos, revisarlos uno por uno deja camiones sin salir a ruta.',
    'En alimentación, cuando piden respaldar cómo se revisó a alguien, buscar cada consulta a mano obliga a ir registro por registro.'])
    assert.deepEqual(email(loss), [], loss);
  for (const reply of ['El registro muestra que le escribiste el 19 de septiembre.', 'Añadí el dato de capacidad de AXIS que compartiste.'])
    assert.deepEqual(coworkReplyIssues(reply).map(issue => issue.short), ['respuesta sin jerga'], reply);
  // A closing answered with yes or no, before the last email of its block and without a meeting asked for.
  const ask = (question: string) => coworkDraftIssues([{ type: 'email_draft' as const, title: 'Seguimiento a Marcela', to: ['mrojas@sodexo.cl'], subject: 'Re: Antecedentes',
    body: `Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. En alimentación, cuando piden respaldar cómo se revisó a alguien, buscar la consulta a mano se lleva una tarde.\n\nAXIS deja evidencia auditable de cada consulta.\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  for (const yesNo of ['¿Les piden ese respaldo en Sodexo Chile?', '¿Tu equipo revisa antecedentes para incorporaciones masivas?'])
    assert.deepEqual(ask(yesNo), ['pregunta por un dato'], yesNo);
  for (const fact of ['¿Quién guarda hoy ese respaldo en Sodexo Chile?', '¿Cada cuánto les piden ese respaldo?', '¿En qué momento les piden ese respaldo?'])
    assert.deepEqual(ask(fact), [], fact);
  assert.match(COWORK_WRITER_RULES.join('\n'), /dicha como una imagen de su rubro, con tus palabras y sin copiar estos ejemplos/);
});

test('a follow-up that offers the evidence says it in their trade, with what stops, and asks about that evidence; a sequence opens with a loss, not a feeling (v19)', () => {
  const checks = { ...context, signer: 'Nicolás Y.', proofs: ['Procesa 1.000 personas en unos 30 minutos'], recipients: [], meeting: false, products: ['axis', 'yago'], followUp: true };
  const marcela = (moment: string, question = '¿Quién reúne hoy ese respaldo en Sodexo Chile?', subject = 'Re: Antecedentes laborales') => coworkDraftIssues([{ type: 'email_draft' as const,
    title: 'Seguimiento a Marcela', to: ['mrojas@sodexo.cl'], subject,
    body: `Hola Marcela,\n\nTe escribí el 19 de septiembre sobre antecedentes laborales. ${moment}\n\nAXIS deja evidencia auditable de cada consulta.\n\n${question}\n\nNicolás Y.` }], checks).map(issue => issue.short);
  const good = 'En alimentación, cuando un cliente pide cómo se revisó a alguien que entra a cocina, buscar cada consulta a mano deja su ingreso detenido mientras se reúne la evidencia.';
  assert.deepEqual(marcela(good), []);
  assert.deepEqual(marcela('Cuando alguien pide respaldo de una revisión, buscar cada consulta a mano deja su ingreso detenido.'), ['con su rubro']);
  assert.deepEqual(marcela('En alimentación, cuando un cliente pide respaldo de una revisión, buscarlo consulta por consulta suma trabajo manual.'), ['consecuencia concreta']);
  assert.deepEqual(marcela(good, '¿Cuántos ingresos revisan al mes en Sodexo Chile?'), ['pregunta del ángulo']);
  assert.deepEqual(marcela(good, undefined, 'Ingresos masivos en Sodexo Chile'), ['asunto del correo']);
  assert.deepEqual(marcela(good, undefined, 'Respaldo de antecedentes en Sodexo Chile'), []);
  // A sequence: the third email opens with how the team feels, and the second comes back to the empty post of the first.
  const step = (opening: string, middle: string, question: string) => `Hola {{nombre}},\n\n${opening}${middle}\n\n${question}\n\nNicolás Y.\nGerente Comercial\nYago SpA`;
  const shorts = (second: string, third: string) => coworkDraftIssues([sequence([
    step('Cuando entra un grupo grande de postulantes en {{empresa}}, cada antecedente que se revisa a mano es un puesto que sigue vacío un día más.', '\n\nAXIS consulta antecedentes laborales en el PJUD.', '¿Cuántos ingresos revisan al mes?'),
    step(second, '', '¿Quién prepara hoy esa nómina en tu equipo?'),
    step(third, '\n\nAXIS deja evidencia auditable de cada consulta.', '¿Te sirve verlo con un caso tuyo?')])], { ...checks, followUp: false })
    .map(issue => `${issue.where} · ${issue.short}`).filter(line => !line.endsWith('momento distinto') && !line.endsWith('pregunta distinta'));
  const lateList = 'Cuando la nómina llega el jueves y el lunes ya parten, alguien se queda buscando nombre por nombre mientras el resto del equipo espera.';
  const audit = 'Cuando un jefe de área pide cómo se revisó a alguien que ya entró, juntar ese respaldo a mano toma una tarde de buscar consulta por consulta.';
  assert.deepEqual(shorts(lateList, audit), []);
  assert.deepEqual(shorts(lateList, 'Para un equipo de personas, tener el respaldo de una revisión importa cuando alguien lo solicita.'), ['«Secuencia AXIS», correo 3 · consecuencia concreta']);
  assert.deepEqual(shorts('Cuando la nómina llega cerca de la fecha de ingreso, cada revisión pendiente deja una vacante esperando.', audit), ['«Secuencia AXIS», correo 2 · consecuencia distinta']);
});


test('an email pasted after a colon is the person\'s own email: its meeting is kept', () => {
  const colon = 'mejora este correo: Hola, somos Yago y tenemos una plataforma llamada AXIS que revisa causas judiciales. ¿Tienes 30 minutos esta semana para una demo?';
  assert.equal(coworkWriterContext(null, [], null, colon).keepsAsk, true);
  assert.equal(coworkWriterContext(null, [], null, 'mejora el correo para que sea más corto').keepsAsk, false, 'no pasted email, nothing to keep');
});

test('the reply never promises a meeting the final email does not ask for', () => {
  const email = 'Hola Daniela,\n\nCuando entra un grupo grande de postulantes, revisar uno por uno sus antecedentes deja puestos vacíos.\n\n¿Cuántos postulantes revisan al mes en Manpower?\n\nNicolás';
  const reply = 'Escribí una presentación de AXIS para Daniela Rojas. Abro con la revisión manual de antecedentes y propongo una conversación de 15 minutos. La campaña queda para tu aprobación.';
  assert.equal(coworkReplyMatchesDraft(reply, [email]), 'Escribí una presentación de AXIS para Daniela Rojas. La campaña queda para tu aprobación.');
  assert.equal(coworkReplyMatchesDraft('Mantuve la invitación a una demo de 30 minutos esta semana. El correo es más corto.', [email]), 'El correo es más corto.');
  // Why there is no meeting is worth saying; and an email that asks for one keeps the reply as it is.
  const explains = 'Saqué la demo: queda para cuando respondan. El correo pregunta por su volumen.';
  assert.equal(coworkReplyMatchesDraft(explains, [email]), explains);
  assert.equal(coworkReplyMatchesDraft(reply, [`${email}\n\n¿Te acomoda una conversación de 15 minutos el jueves?`]), reply);
  assert.equal(coworkPolishDraft({ reply, question: null, suggestions: [], blocks: [{ type: 'email_draft', title: 'Correo', to: ['daniela.rojas@manpower.test'], subject: 'Manpower', body: email }] }, []).reply,
    'Escribí una presentación de AXIS para Daniela Rojas. La campaña queda para tu aprobación.', 'the polish step applies it');
});

test('a draft goes to the people the brief names, at the address the turn read (round 2 readings)', async () => {
  const { coworkAddressDrafts, coworkSameName } = await import('./writer');
  assert.equal(coworkSameName('Francisca Muñoz (Falabella)', 'Francisca Muñoz'), true);
  assert.equal(coworkSameName('Daniela Rojas de Manpower', 'Daniela Rojas'), true);
  assert.equal(coworkSameName('Francisca', 'Francisca Muñoz'), true);
  assert.equal(coworkSameName('Rodrigo Pérez', 'Francisca Muñoz'), false);
  const people = [
    { name: 'Francisca Muñoz', email: 'francisca.munoz@falabella.test', company: 'Falabella' },
    { name: 'Rodrigo Pérez', email: 'rodrigo.perez@securitas.test', company: 'Securitas Chile' },
    { name: 'Carlos Soto', email: null, company: 'Adecco' },
  ];
  const draft = (to: string[] | null, body = 'Hola Francisca,\n\nTexto.\n\n¿Cuántos postulantes revisan?\n\nNicolás') => ({ reply: 'Listo.', question: null,
    suggestions: [{ label: 'Más corto', message: 'Hazlo más corto' }],
    blocks: [{ type: 'email_draft' as const, title: 'Correo a Francisca', to, subject: 'Antecedentes en Falabella', body }] });
  const one = coworkAddressDrafts(draft(null), { recipients: ['Francisca Muñoz (Falabella)'] }, people);
  assert.deepEqual((one.blocks[0] as { to: string[] }).to, ['francisca.munoz@falabella.test']);
  const named = coworkAddressDrafts(draft(['Francisca Muñoz']), { recipients: ['Francisca Muñoz'] }, people);
  assert.deepEqual((named.blocks[0] as { to: string[] }).to, ['francisca.munoz@falabella.test']);
  const group = coworkAddressDrafts(draft(null, 'Hola {{nombre}},\n\nTexto.'), { recipients: ['Francisca Muñoz', 'Rodrigo Pérez', 'Carlos Soto'] }, people);
  assert.deepEqual((group.blocks[0] as { to: string[] }).to, ['francisca.munoz@falabella.test', 'rodrigo.perez@securitas.test']);
  // Nobody named, or nobody read with an address: nothing changes.
  const plain = draft(null);
  assert.equal(coworkAddressDrafts(plain, { recipients: null }, people), plain);
  const unknown = draft(null);
  assert.equal(coworkAddressDrafts(unknown, { recipients: ['Carlos Soto'] }, people), unknown);
});

test('a follow-up stays in the thread of the first email and an edit keeps what the first one had', async () => {
  const { coworkEarlierThread } = await import('./writer');
  const earlier = [{ to: ['daniela.rojas@manpower.test'], subject: 'Manpower y la revisión de antecedentes', body: 'Hola Daniela,\n\nTexto.\n\n¿Cuántos postulantes revisan al mes en Manpower?' }];
  const followUp = { reply: 'Listo.', question: null, suggestions: [{ label: 'Más corto', message: 'Hazlo más corto' }],
    blocks: [{ type: 'email_draft' as const, title: 'Seguimiento', to: ['daniela.rojas@manpower.test'], subject: 'Re: revisión de antecedentes en Manpower', body: 'Hola Daniela,\n\nTe escribí sobre…' }] };
  const threaded = coworkEarlierThread(followUp, { earlier, followUp: true });
  assert.equal((threaded.blocks[0] as { subject: string }).subject, 'Re: Manpower y la revisión de antecedentes');
  // An edit of a pasted email without recipients: «Hola,» stays, and no campaign is offered for it.
  const pasted = [{ to: [], subject: 'Revisión de antecedentes', body: 'Hola,\n\nCuando llegan muchos postulantes…' }];
  const shorter = { reply: 'Listo.', question: '¿Creo la campaña pausada para tus contactos de RR. HH.?',
    suggestions: [{ label: 'Sí, crear campaña', message: 'Sí, crea la campaña pausada' }, { label: 'Sin demo', message: 'Quítale la demo' }],
    blocks: [{ type: 'email_draft' as const, title: 'Correo corto', to: null, subject: 'Antecedentes', body: 'Hola {{nombre}},\n\nTexto corto.' }] };
  const edited = coworkEarlierThread(shorter, { earlier: pasted, edit: true });
  assert.match((edited.blocks[0] as { body: string }).body, /^Hola,\n/);
  assert.equal(edited.question, null);
  assert.deepEqual(edited.suggestions.map(item => item.label), ['Sin demo']);
  // «Más corto» says how much, counting what the person reads (no greeting, no signature), and drops the note about the recipient.
  const long = [{ to: [], subject: 'Antecedentes', body: 'Hola,\n\nCuando llega un grupo de postulantes, revisar uno por uno sus antecedentes deja vacantes abiertas.\n\nAXIS consulta el PJUD de forma automática. Te propongo una demo.\n\n¿Qué día te acomoda una demo de 30 minutos?\n\nNicolás Yarur\nGerente Comercial\nYago SpA' }];
  const cut = { reply: 'Como todavía no tiene destinatario, el correo va sin dirección. Quité los adjetivos de venta.', question: null, suggestions: [],
    blocks: [{ type: 'email_draft' as const, title: 'Corto', to: null, subject: 'Antecedentes', body: 'Hola,\n\nRevisar antecedentes uno por uno deja vacantes abiertas.\n\n¿Qué día te acomoda una demo de 30 minutos?\n\nNicolás Yarur\nGerente Comercial\nYago SpA' }] };
  assert.equal(coworkEarlierThread(cut, { earlier: long, edit: true, shorter: true }).reply, 'Lo dejé en 17 palabras; antes tenía 35. Quité los adjetivos de venta.');
  // Not shorter, or not asked: no figure; a recipient the email has keeps its note.
  assert.equal(coworkEarlierThread(cut, { earlier: long, edit: true }).reply, 'Quité los adjetivos de venta.');
  const onlyNote = { ...cut, reply: 'Como todavía no tiene destinatario, el correo va sin dirección.' };
  assert.equal(coworkEarlierThread(onlyNote, { earlier: long, edit: true }).reply, onlyNote.reply);
});

test('a follow-up that asks the first question again, and a «más corto» that is not, are caught', () => {
  const earlier = [{ to: ['daniela.rojas@manpower.test'], subject: 'Manpower', body: 'Hola Daniela,\n\nCuando entra un grupo grande de postulantes, revisar uno por uno deja puestos vacíos.\n\nAXIS consulta el PJUD.\n\n¿Cuántos postulantes revisan al mes en Manpower?\n\nNicolás Yarur' }];
  const followUp = { type: 'email_draft' as const, title: 'Seguimiento', to: ['daniela.rojas@manpower.test'], subject: 'Re: Manpower',
    body: 'Hola Daniela,\n\nTe escribí sobre la revisión de antecedentes. En servicios transitorios, cada antecedente pendiente deja a un cliente esperando.\n\n¿Cuántos postulantes revisan al mes en Manpower?\n\nNicolás Yarur' };
  const shorts = coworkDraftIssues([followUp], { ...context, earlier, followUp: true }).map(issue => issue.short);
  assert.ok(shorts.includes('pregunta nueva'));
  const longer = { ...followUp, body: `${earlier[0].body}\n\nSi te interesa, te muestro cómo funciona en una demo.` };
  assert.ok(coworkDraftIssues([longer], { ...context, earlier, edit: true, shorter: true }).some(issue => issue.short === 'más corto'));
});

test('the reply says the variables in plain words and drops the brief\'s words', async () => {
  const { coworkPlainReply } = await import('./writer');
  assert.equal(coworkPlainReply('Escribí el correo para Francisca. Como no tenemos su correo observado, to queda vacío.'), 'Escribí el correo para Francisca.');
  assert.equal(coworkPlainReply('El asunto usa {{empresa}} en vez de nombrar un rubro.'), 'El asunto usa el nombre de su empresa en vez de nombrar un rubro.');
  assert.equal(coworkPlainReply('Hice un solo correo para los cuatro. La campaña reemplaza {{nombre}} y {{empresa}} con sus datos. Abre con el momento de su rubro.'),
    'Hice un solo correo para los cuatro. Abre con el momento de su rubro.');
  assert.equal(coworkPlainReply('Un correo para Ana.\n\nVa con su nombre.'), 'Un correo para Ana.\n\nVa con su nombre.');
});

test('a follow-up of an email nobody sent yet offers the campaign with both', () => {
  const block = { type: 'email_draft' as const, title: 'Seguimiento', to: ['daniela.rojas@manpower.test'], subject: 'Re: Manpower', body: 'Hola Daniela,\n\nTe escribí…' };
  const earlier = [{ to: ['daniela.rojas@manpower.test'], subject: 'Manpower', body: 'Hola Daniela,\n\nPrimero.' }];
  const issues = coworkNextStepIssues({ blocks: [block], question: '¿Propongo enviárselo a Daniela?' }, { earlier, followUp: true });
  assert.deepEqual(issues.map(issue => issue.short), ['campaña con los dos']);
  assert.match(issues[0].fix, /para Daniela con los dos correos/);
  assert.deepEqual(coworkNextStepIssues({ blocks: [block], question: '¿Creo la campaña pausada para Daniela con los dos correos?' }, { earlier, followUp: true }), []);
});

test('an edit keeps the demo the email asked for unless the person asked to drop it', () => {
  const earlier = [{ to: [], subject: 'Antecedentes', body: 'Hola,\n\nTexto.\n\n¿Qué día te acomoda una demo de 30 minutos esta semana?\n\nNicolás Yarur' }];
  const shorter = { type: 'email_draft' as const, title: 'Corto', to: null, subject: 'Antecedentes', body: 'Hola,\n\nTexto.\n\n¿Cuántos postulantes revisan al mes?\n\nNicolás Yarur' };
  const shorts = (request: string) => coworkDraftIssues([shorter], { ...context, earlier, edit: true, shorter: true, request }).map(issue => issue.short);
  assert.ok(shorts('más corto').includes('conserva la demo'));
  assert.ok(!shorts('más corto y sin la demo').includes('conserva la demo'));
  // «Menos vendedor» may trade it for a lighter question (said in the reply by coworkEarlierThread).
  assert.ok(!shorts('más corto y menos vendedor').includes('conserva la demo'));
});

test('a reply does not describe a meeting the email does not ask for, whatever the verb', () => {
  const bodies = ['Hola {{nombre}},\n\nTexto.\n\n¿Cuánto les toma hoy revisar esos antecedentes?\n\nNicolás'];
  assert.equal(coworkReplyMatchesDraft('Preparé un correo para los 4. La pregunta de cierre busca una respuesta fácil sobre una conversación de 15 minutos. Los otros 3 quedan fuera.', bodies),
    'Preparé un correo para los 4. Los otros 3 quedan fuera.');
  assert.equal(coworkReplyMatchesDraft('Preparé un correo para los 4. La demo queda para cuando respondan.', bodies), 'Preparé un correo para los 4. La demo queda para cuando respondan.');
});

test('a new email\'s reply does not describe changes to an email nobody had; an edit or a pasted email may', async () => {
  const { coworkNewEmailReply } = await import('./writer');
  const output = { reply: 'Lo que más mejora ahora es que el correo lleva tu firma: agregué Nicolás Yarur al final. El resto queda igual. Va a tus 4 contactos con correo.',
    question: null, suggestions: [], blocks: [{ type: 'email_draft' as const, title: 'Primer correo', to: null, subject: 'A', body: 'Hola,\n\nTexto.' }] };
  assert.equal(coworkNewEmailReply(output, { pasted: false }).reply, 'Va a tus 4 contactos con correo.');
  assert.equal(coworkNewEmailReply(output, { pasted: true }), output);
  assert.equal(coworkNewEmailReply(output, { pasted: false, earlier: [{ to: [], subject: 'A', body: 'Hola' }] }), output);
  assert.equal(coworkNewEmailReply(output, {}), output, 'without the request nothing is known');
  const onlyChanges = { ...output, reply: 'Agregué tu firma al final.' };
  assert.equal(coworkNewEmailReply(onlyChanges, { pasted: false }), onlyChanges, 'a reply is never left empty');
});

test('an edit that drops the demo it was not asked to drop gets its closing question back', async () => {
  const { coworkEarlierThread } = await import('./writer');
  const earlier = [{ to: [], subject: 'Antecedentes', body: 'Hola,\n\nRevisar uno por uno deja vacantes abiertas.\n\nAXIS consulta el PJUD. Te propongo una demo.\n\n¿Qué día de esta semana te acomoda una demo de 30 minutos?\n\nNicolás Yarur' }];
  const output = { reply: 'Cambié la demo por una pregunta más liviana. Quité los adjetivos de venta.', question: null, suggestions: [],
    blocks: [{ type: 'email_draft' as const, title: 'Corto', to: null, subject: 'Antecedentes', body: 'Hola,\n\nRevisar uno por uno deja vacantes abiertas.\n\n¿Cuántos postulantes revisan al mes?\n\nNicolás Yarur' }] };
  const kept = coworkEarlierThread(output, { earlier, edit: true, shorter: true, request: 'más corto' });
  assert.match((kept.blocks[0] as { body: string }).body, /\n¿Qué día de esta semana te acomoda una demo de 30 minutos\?\n/);
  assert.doesNotMatch((kept.blocks[0] as { body: string }).body, /Cuántos postulantes/);
  assert.doesNotMatch(kept.reply, /Cambié la demo/);
  assert.match(kept.reply, /Quité los adjetivos de venta\./);
  // Asked to drop it, it stays out.
  const dropped = coworkEarlierThread(output, { earlier, edit: true, request: 'sin la demo' });
  assert.match((dropped.blocks[0] as { body: string }).body, /Cuántos postulantes/);
  // «Menos vendedor» may trade it for a lighter question: said in the reply, with a chip to keep it.
  const softer = coworkEarlierThread({ ...output, reply: 'Quité los adjetivos de venta.' }, { earlier, edit: true, shorter: true, request: 'más corto y menos vendedor' });
  assert.match((softer.blocks[0] as { body: string }).body, /Cuántos postulantes/);
  assert.match(softer.reply, /La demo queda para más adelante: cerré con una pregunta más liviana\.$/);
  // The polish keeps it: it says why there is no meeting.
  assert.match(coworkReplyMatchesDraft(softer.reply, [(softer.blocks[0] as { body: string }).body]), /La demo queda para más adelante/);
  assert.equal(softer.suggestions[0].label, 'Mantener la demo');
  // Its own sentence about the demo gives way to ours (round 14: it was dropped and only the word count was left).
  const told = coworkEarlierThread(output, { earlier, edit: true, shorter: true, request: 'más corto y menos vendedor' });
  assert.doesNotMatch(told.reply, /Cambié la demo/);
  assert.match(told.reply, /Quité los adjetivos de venta\. La demo queda para más adelante: cerré con una pregunta más liviana\.$/);
});

test('emails with recipients and no closing question get the campaign offer', async () => {
  const { coworkWithNextStep } = await import('./writer');
  const draft = { reply: 'Escribí el correo.', question: null, suggestions: [{ label: 'Más cercano', message: 'Hazlo más cercano' }],
    blocks: [{ type: 'email_draft' as const, title: 'Correo', to: ['r@x.test', 'd@x.test', 'f@x.test', 'j@x.test'], subject: 'Antecedentes',
      body: 'Hola {{nombre}},\n\nAXIS consulta el PJUD.\n\n¿Cuánto les toma?\n\nSaludos,\nNicolás' }] };
  assert.equal(coworkWithNextStep(draft).question, '¿Creo la campaña pausada para estos 4 contactos?');
  const one = { ...draft, blocks: [{ ...draft.blocks[0], to: ['d@x.test'], body: 'Hola Daniela,\n\nAXIS.\n\nSaludos,\nNicolás' }] };
  assert.equal(coworkWithNextStep(one).question, '¿Creo la campaña pausada para Daniela?');
  const asked = { ...one, question: '¿Lo ajusto?' };
  assert.equal(coworkWithNextStep(asked), asked);
});

test('an email that ends with the signature and no closing word gets «Saludos,»; one that has it, or another signer, does not', async () => {
  const { coworkWithSignOff } = await import('./writer');
  const body = 'Hola José,\n\nTexto.\n\n¿Cuántos postulantes revisan al mes?\n\nNicolás Yarur\nGerente Comercial\nYago SpA';
  assert.equal(coworkWithSignOff(body, 'Nicolás Yarur'), 'Hola José,\n\nTexto.\n\n¿Cuántos postulantes revisan al mes?\n\nSaludos,\nNicolás Yarur\nGerente Comercial\nYago SpA');
  const signed = body.replace('\n\nNicolás', '\n\nSaludos,\nNicolás');
  assert.equal(coworkWithSignOff(signed, 'Nicolás Yarur'), signed);
  assert.equal(coworkWithSignOff(body.replace('¿Cuántos postulantes revisan al mes?', 'Gracias.'), 'Nicolás Yarur'), body.replace('¿Cuántos postulantes revisan al mes?', 'Gracias.'));
  assert.equal(coworkWithSignOff(body, 'Carla Soto'), body);
  assert.equal(coworkWithSignOff(body, null), body);
});

test('an edit\'s reply carries the real word count and never claims a greeting or signature it changed', async () => {
  const { coworkEarlierThread } = await import('./writer');
  const earlier = [{ to: [], subject: 'A', body: 'Hola,\n\nRevisar uno por uno deja vacantes abiertas un día más en temporada alta.\n\n¿Qué día te acomoda una demo de 30 minutos?\n\nSaludos,\nNicolás Yarur' }];
  const output = { reply: 'Lo dejé en menos de 42 palabras. Conservé el saludo y la firma. Quité los adjetivos de venta.', question: null, suggestions: [],
    blocks: [{ type: 'email_draft' as const, title: 'Corto', to: null, subject: 'A', body: 'Hola,\n\nRevisar uno por uno deja vacantes abiertas.\n\n¿Qué día te acomoda una demo de 30 minutos?\n\nNicolás Yarur\nGerente Comercial' }] };
  const edited = coworkEarlierThread(output, { earlier, edit: true, shorter: true, request: 'más corto' });
  assert.equal(edited.reply, 'Lo dejé en 16 palabras; antes tenía 22. Quité los adjetivos de venta.');
  // A greeting and a signature that did stay may be said.
  const same = { ...output, reply: 'Conservé el saludo. Quité los adjetivos de venta.', blocks: [{ ...output.blocks[0], body: `${output.blocks[0].body.split('\n\nNicolás')[0]}\n\nSaludos,\nNicolás Yarur` }] };
  assert.match(coworkEarlierThread(same, { earlier, edit: true, request: 'menos vendedor' }).reply, /^Conservé el saludo\./);
});
