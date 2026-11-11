import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkWriterOutput } from '@/lib/cowork/writer';
import { coworkVoicePass, splitCoworkEmail } from './writer-voice';

// A fictional seller, product and recipients.
const signature = 'Saludos,\nCarla Soto\nEjecutiva comercial\nServiPro';
const first = `Hola Ana,\n\nEn seguridad privada, cuando entra un grupo de guardias nuevos, cada antecedente pendiente es un guardia que no toma su turno.\n\nRevisa consulta antecedentes laborales en el PJUD y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan al mes en Vigilancia Andes?\n\n${signature}`;
const second = `Hola Ana,\n\nEn seguridad privada, cuando un cliente pide el respaldo de una revisión, reunirlo a mano obliga a buscar consulta por consulta.\n\nRevisa deja evidencia de cada consulta.\n\n¿Quién reúne hoy ese respaldo?\n\n${signature}`;
const output: CoworkWriterOutput = {
  reply: 'Escribí dos correos para Ana.',
  blocks: [{ type: 'sequence', title: 'Secuencia para Ana', steps: [{ day: 1, subject: 'Ingresos en Vigilancia Andes', body: first }, { day: 3, subject: 'El respaldo de cada revisión', body: second }] }],
  question: null,
  suggestions: [{ label: 'Hazlo más corto', prompt: 'Hazlo más corto' }] as never,
};
const options = {
  request: 'Escríbele a Ana Rojas un primer correo y un seguimiento.',
  brief: { kind: 'sequence' as const, recipients: ['Ana Rojas'], objective: 'Abrir conversación', angle: null, tone: null, steps: 2, notes: null, findings: null },
  userContext: { fullName: 'Carla Soto', companyName: 'ServiPro', offer: 'Revisa consulta antecedentes laborales en el PJUD.', proofPoints: ['Procesa 1.000 personas en unos 30 minutos.'] },
  observations: [{ action: 'leads.recommend', input: '', result: { leads: [{ name: 'Ana Rojas', company: 'Vigilancia Andes', email: 'ana@vigilanciaandes.example' }] } }],
};

/** A model that rewrites the paragraphs it is given with `change`. */
function rewriting(change: (paragraphs: string[]) => string[]) {
  const prompts: string[] = [];
  const generate = (async (call: { prompt: string; schema: { parse: (value: unknown) => unknown } }) => {
    prompts.push(call.prompt);
    const email = JSON.parse(call.prompt.split('\n').find((line) => line.startsWith('{"subject"')) || '{}') as { subject: string; paragraphs: string[] };
    return { data: call.schema.parse({ subject: email.subject, paragraphs: change(email.paragraphs) }), telemetry: { modelName: 'gpt-6-luna', usage: null, durationMs: 1 } };
  }) as never;
  return { prompts, generate };
}
const toYou = (paragraphs: string[]) => paragraphs.map((paragraph) => paragraph
  .replace('En seguridad privada, cuando entra un grupo de guardias nuevos, cada antecedente pendiente es un guardia que no toma su turno.',
    'En seguridad privada, cuando te entra un grupo de guardias nuevos, cada antecedente que te falta es un guardia que no toma su turno.')
  .replace('En seguridad privada, cuando un cliente pide el respaldo de una revisión, reunirlo a mano obliga a buscar consulta por consulta.',
    'En seguridad privada, cuando un cliente te pide el respaldo de una revisión, tu equipo tiene que buscarlo consulta por consulta.'));

test('an email is its greeting, what it says, the question it closes with and its signature', () => {
  const parts = splitCoworkEmail(first);
  assert.equal(parts.greeting, 'Hola Ana,');
  assert.equal(parts.content.length, 2);
  assert.equal(parts.question, '¿Cuántos ingresos revisan al mes en Vigilancia Andes?');
  assert.deepEqual(parts.signature, [signature]);
  assert.equal(parts.assemble(parts.content), first, 'put back together, it is the same email');
  assert.equal(parts.assemble(['Uno.', 'Dos.']), `Hola Ana,\n\nUno.\n\nDos.\n\n¿Cuántos ingresos revisan al mes en Vigilancia Andes?\n\n${signature}`);
  assert.deepEqual(splitCoworkEmail('Hola {{nombre}},\n\nTe escribo por la temporada.\n\n¿Cómo lo ven hoy?\n\nUn abrazo,\n\nNico').signature, ['Un abrazo,', 'Nico']);
  const bare = splitCoworkEmail('Te escribo por la temporada. ¿Cómo lo ven hoy?');
  assert.deepEqual([bare.greeting, bare.content, bare.question, bare.signature], [null, ['Te escribo por la temporada. ¿Cómo lo ven hoy?'], null, []]);
});

test('single line breaks, a greeting in any word and a question inside a paragraph are read as they are', () => {
  // The greeting over its paragraph and the signature under the question, with one line break each.
  const tight = 'Hola {{nombre}},\nCuando en {{empresa}} entran varias personas la misma semana, cada antecedente pendiente es un puesto vacío.\n¿Cuántos ingresos revisan al mes?\nCarla Soto';
  const parts = splitCoworkEmail(tight);
  assert.deepEqual([parts.greeting, parts.content.length, parts.question, parts.signature], ['Hola {{nombre}},', 1, '¿Cuántos ingresos revisan al mes?', ['Carla Soto']]);
  assert.equal(parts.assemble(['Otra frase.']), 'Hola {{nombre}},\nOtra frase.\n¿Cuántos ingresos revisan al mes?\nCarla Soto');
  // «Olá» ends in a letter «\b» does not see: it is a greeting all the same, and so is a name with a comma.
  assert.equal(splitCoworkEmail('Olá {{nombre}},\n\nCuando llega la temporada, faltan manos.\n\nSaludos,\nCarla').greeting, 'Olá {{nombre}},');
  assert.equal(splitCoworkEmail('Ana:\n\nCuando llega la temporada, faltan manos.\n\nSaludos,\nCarla').greeting, 'Ana:');
  // A question that shares its line with a sentence is not a closing question on its own.
  const inside = splitCoworkEmail('Hola Ana,\n\nCuando llega la temporada, faltan manos. ¿Cómo lo cubren hoy?\n\nSaludos,\nCarla');
  assert.deepEqual([inside.question, inside.content], [null, ['Cuando llega la temporada, faltan manos. ¿Cómo lo cubren hoy?']]);
});

test('each email of the Writer comes back in the person\'s voice, between the same greeting and signature', async () => {
  const { prompts, generate } = rewriting(toYou);
  const voiced = await coworkVoicePass(output, { ...options, generate });
  const steps = (voiced.blocks[0] as { steps: Array<{ subject: string; body: string }> }).steps;
  assert.equal(prompts.length, 2, 'one call per email, at the same time');
  assert.match(steps[0].body, /^Hola Ana,\n\nEn seguridad privada, cuando te entra un grupo/);
  assert.ok(steps[0].body.endsWith(signature));
  assert.match(steps[0].body, /procesa 1\.000 personas en unos 30 minutos/);
  assert.match(steps[1].body, /tu equipo tiene que buscarlo consulta por consulta/);
  assert.equal(steps[0].subject, 'Ingresos en Vigilancia Andes', 'the subject is the Writer\'s');
  assert.equal(voiced.reply, output.reply);
  assert.match(steps[0].body, /\n\n¿Cuántos ingresos revisan al mes en Vigilancia Andes\?\n\nSaludos,/, 'the closing question is the Writer\'s, word for word');
  assert.match(prompts[0], /Sin preguntas ni invitaciones/);
  assert.match(prompts[0], /cierra con esta pregunta, que se agrega después tal como está: «¿Cuántos ingresos revisan al mes en Vigilancia Andes\?»/);
  assert.ok(!JSON.parse(prompts[0].split('\n').find((line) => line.startsWith('{"subject"')) || '{}').paragraphs.join(' ').includes('?'), 'the question never reaches the pass');
  assert.match(prompts[0], /de tú en todo el correo/);
  assert.match(prompts[0], /ASÍ SUENA/);
  assert.match(prompts[1], /Es un correo posterior/);
  assert.ok(!prompts[0].includes('Saludos,'), 'the signature never reaches the pass');
});

test('the organization\'s own voice examples give the shape instead of the built-in sample', async () => {
  const { prompts, generate } = rewriting(toYou);
  await coworkVoicePass(output, { ...options, generate, observations: [...options.observations,
    { action: 'message.context', input: '', result: { configured: true, context: { voiceExamples: [{ label: 'Carla', text: 'Hola Pedro, te cuento que partimos el lunes con la faena y quería saber quién ve hoy los turnos de noche en tu equipo.' }] } } }] });
  assert.match(prompts[0], /ASÍ ESCRIBES TÚ/);
  assert.match(prompts[0], /partimos el lunes con la faena/);
});

test('what the person wrote or asked to edit, and an email in another language, keep the Writer\'s words', async () => {
  const { prompts, generate } = rewriting(toYou);
  const pasted = await coworkVoicePass(output, { ...options, generate, request: `Mejora este correo: "${first.replace(/\n/g, ' ')}"` });
  assert.equal(pasted, output);
  const english = { ...output, blocks: [{ type: 'email_draft' as const, title: 'Email for Ana', to: ['ana@vigilanciaandes.example'], subject: 'Checks at Vigilancia Andes',
    body: 'Hi Ana,\n\nWhen a group of new guards joins, every pending check is a guard who cannot take the shift, and your team has to chase each one.\n\nHow many do you review each month?\n\nBest,\nCarla' }] };
  assert.equal(await coworkVoicePass(english, { ...options, generate }), english);
  assert.equal(await coworkVoicePass(output, { ...options, generate, hasTime: () => false }), output);
  assert.equal(prompts.length, 0);
});

test('a rewrite the pass or the Writer\'s checks turn back leaves that email as it was', async () => {
  // It invents a figure: the pass turns both tries back.
  const invented = rewriting((paragraphs) => toYou(paragraphs).map((paragraph, index) => (index === 1 ? `${paragraph} Ya lo usan 40 empresas.` : paragraph)));
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: invented.generate }), output);
  // It asks a question of its own over the one the email closes with.
  const asks = rewriting((paragraphs) => [...toYou(paragraphs), '¿Lo vemos esta semana?']);
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: asks.generate }), output);
  // It moves to «usted» in an email that greets with «Hola».
  const formal = rewriting((paragraphs) => toYou(paragraphs).map((paragraph) => paragraph.replace('cuando te entra', 'cuando a usted le entra').replace('un cliente te pide', 'un cliente le pide a usted')));
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: formal.generate }), output);
  // A model that fails.
  const failing = (async () => { throw new Error('503'); }) as never;
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: failing }), output);
});

test('an email that greets with «Estimado» stays in usted, and one without a greeting is not touched', async () => {
  const body = `Estimado Jorge Araya:\n\nCon 90 operadores de planta en selección, cada evaluación pendiente deja una posición menos disponible para los turnos de la faena.\n\nRevisa consulta antecedentes laborales en el PJUD y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos postulantes evalúa hoy para este proceso?\n\nSaludos cordiales,\nCarla Soto`;
  const formal = { ...output, blocks: [{ type: 'email_draft' as const, title: 'Correo para Jorge', to: ['jorge@mineraaltos.example'], subject: 'Selección de operadores', body }] };
  const tutea = rewriting((paragraphs) => paragraphs.map((paragraph) => paragraph.replace('Con 90 operadores de planta en selección,', 'Si tienes 90 operadores de planta en selección,')));
  assert.equal(await coworkVoicePass(formal, { ...options, generate: tutea.generate }), formal);
  assert.match(tutea.prompts[0], /de usted en todo el correo/);
  assert.match(tutea.prompts[1], /El correo trata de usted: no tutees/);
  const kept = rewriting((paragraphs) => paragraphs.map((paragraph) => paragraph.replace('Con 90 operadores de planta en selección,', 'Con 90 operadores de planta en selección, usted sabe que')));
  const voiced = await coworkVoicePass(formal, { ...options, generate: kept.generate });
  assert.match((voiced.blocks[0] as { body: string }).body, /^Estimado Jorge Araya:\n\nCon 90 operadores de planta en selección, usted sabe que cada evaluación[\s\S]*\n\n¿Cuántos postulantes evalúa hoy para este proceso\?\n\nSaludos cordiales,\nCarla Soto$/);

  const bare = { ...output, blocks: [{ type: 'email_draft' as const, title: 'Correo para Ana', to: null, subject: 'Ingresos en Vigilancia Andes', body: first.replace('Hola Ana,\n\n', '') }] };
  const { prompts, generate } = rewriting(toYou);
  assert.equal(await coworkVoicePass(bare, { ...options, generate }), bare);
  assert.equal(prompts.length, 0);
});

test('an email that asks more than once goes to the pass whole, and keeps as many questions', async () => {
  const body = first.replace('cada antecedente pendiente es un guardia que no toma su turno.', '¿cuántos antecedentes quedan pendientes? Cada uno es un guardia que no toma su turno.');
  const twice = { ...output, blocks: [{ type: 'email_draft' as const, title: 'Correo para Ana', to: null, subject: 'Ingresos en Vigilancia Andes', body }] };
  const { prompts, generate } = rewriting((paragraphs) => paragraphs.map((paragraph) => paragraph.replace('Cada uno es un guardia', 'Cada uno te deja un guardia')));
  const voiced = await coworkVoicePass(twice, { ...options, generate });
  const after = (voiced.blocks[0] as { body: string }).body;
  assert.match(after, /Cada uno te deja un guardia/);
  assert.equal((after.match(/\?/g) || []).length, 2);
  assert.equal(after.split('¿Cuántos ingresos revisan al mes en Vigilancia Andes?').length, 2, 'the closing question is there once');
  assert.ok(after.endsWith(signature));
  assert.ok(!/cierra con esta pregunta/.test(prompts[0]));
});
