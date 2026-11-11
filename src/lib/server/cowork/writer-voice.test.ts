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

test('an email is its greeting, what it says and its signature', () => {
  const parts = splitCoworkEmail(first);
  assert.equal(parts.greeting, 'Hola Ana,');
  assert.equal(parts.content.length, 3);
  assert.match(parts.content[2], /^¿Cuántos ingresos/);
  assert.deepEqual(parts.signature, [signature]);
  assert.deepEqual(splitCoworkEmail('Hola {{nombre}},\n\nTe escribo por la temporada.\n\n¿Cómo lo ven hoy?\n\nUn abrazo,\n\nNico').signature, ['Un abrazo,', 'Nico']);
  assert.deepEqual(splitCoworkEmail('Te escribo por la temporada. ¿Cómo lo ven hoy?'), { greeting: null, content: ['Te escribo por la temporada. ¿Cómo lo ven hoy?'], signature: [] });
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
  assert.match(prompts[0], /Una sola pregunta, al final/);
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
  // It drops the question: the email would ask for nothing.
  const noAsk = rewriting((paragraphs) => toYou(paragraphs).slice(0, 2));
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: noAsk.generate }), output);
  // A model that fails.
  const failing = (async () => { throw new Error('503'); }) as never;
  assert.deepEqual(await coworkVoicePass(output, { ...options, generate: failing }), output);
});
