import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import {
  COWORK_REVIEWER_RULES, COWORK_WRITER_RULES, coworkDraftIssues, coworkWriterContext, coworkWriterPrompt, runCoworkWriter, type CoworkAgentStep, type CoworkWriteBrief, type CoworkWriterOutput, coworkSignerPreference } from './writer';

const signed = 'Hola {{nombre}},\nEn Yago revisamos antecedentes laborales con AXIS en minutos.\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Yarur\nGerente Comercial, Yago';
const sequence = (bodies: string[]) => ({ type: 'sequence' as const, title: 'Secuencia AXIS', steps: bodies.map((body, index) => ({ day: [1, 3, 7][index] ?? 11, subject: `Asunto ${index + 1}`, body })) });
const context = { signer: 'Nicolás Yarur', prohibited: ['barato'], trialOffer: false };

test('the checks catch what the text alone shows, once per kind and place', () => {
  assert.deepEqual(coworkDraftIssues([sequence([signed, signed, signed])], context), []);
  const shorts = (bodies: string[]) => coworkDraftIssues([sequence(bodies)], context).map(issue => `${issue.where} · ${issue.short}`);
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
  // Tables and figures are not emails.
  assert.deepEqual(coworkDraftIssues([{ type: 'table', title: 'x', columns: ['a'], rows: [['[relleno]']] }], context), []);
});

test('the checks read who signs, the prohibited terms and the trial offer from the turn', () => {
  const observations = [
    { action: 'message.context', input: '', result: { configured: true, context: { prohibitedTerms: ['barato', ' ', 'x'], trialOffer: '14 días' } } },
  ];
  assert.deepEqual(coworkWriterContext({ fullName: ' Nicolás Yarur ' }, observations), { signer: 'Nicolás Yarur', prohibited: ['barato'], trialOffer: true });
  assert.deepEqual(coworkWriterContext(null, []), { signer: null, prohibited: [], trialOffer: false });
});

const brief: CoworkWriteBrief = { kind: 'sequence', recipients: ['Felipe Muñoz', 'Camila Fuentes'], objective: 'Una conversación sobre AXIS', angle: null, tone: 'cercano', steps: 3, notes: null, findings: null };
const output = (bodies: string[]): CoworkWriterOutput => ({
  reply: 'Te dejo la secuencia para Felipe y Camila.', blocks: [sequence(bodies)], question: '¿Creo la campaña pausada?',
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
