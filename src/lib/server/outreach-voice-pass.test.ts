import assert from 'node:assert/strict';
import test from 'node:test';
import { voicePass, voicePassPrompt, voicePassSample, type VoicePassInput } from './outreach-voice-pass';

// A fictional seller and recipient.
const base: VoicePassInput = {
  subject: 'Dotación para las nuevas tiendas',
  paragraphs: [
    'Vi que abrirán 2 tiendas nuevas en la zona sur antes de diciembre. En retail, cuando falta gente en una apertura, se forman filas en caja y los turnos extra suelen recaer en el equipo de tienda.',
    'Soy Carla, de ServiPro; ponemos dotación temporal para el peak de las aperturas, y el costo deja de correr cuando baja.',
  ],
  step: 'initial',
  treatment: 'tu',
  sender: { name: 'Carla Soto', company: 'ServiPro' },
  recipient: { firstName: 'Rodrigo', company: 'Tiendas Ejemplo' },
  facts: ['Abrirán dos tiendas nuevas en la zona sur antes de diciembre', 'Dotación temporal para peaks'],
  keep: ['El hecho del destinatario queda reconocible en una misma oración: conserva al menos dos de estos términos: tiendas, zona, sur.'],
  words: { min: 30, max: 90 },
  questions: { min: 0, max: 0 },
  seed: 'rodrigo@tiendasejemplo.example',
};

const person = {
  subject: 'Equipo para las aperturas',
  paragraphs: [
    'Vi que abren 2 tiendas en la zona sur antes de diciembre. Si parten con poca gente, tu equipo de tienda va a pasar las primeras semanas doblando turnos en caja.',
    'En ServiPro te ponemos al personal temporal para las aperturas, y cuando pasa diciembre dejas de pagar por ellos.',
  ],
};

function answering(...versions: Array<typeof person | Error>) {
  const calls: Array<{ prompt: string; systemPrompt?: string; openAiModel?: string }> = [];
  const generate = (async (options: { prompt: string; systemPrompt?: string; openAiModel?: string; schema: { parse: (value: unknown) => unknown } }) => {
    calls.push(options);
    const next = versions[Math.min(calls.length - 1, versions.length - 1)];
    if (next instanceof Error) throw next;
    return { data: options.schema.parse(next), telemetry: { modelName: 'gpt-6-luna', usage: { prompt_tokens: 900, completion_tokens: 120 }, durationMs: 1 } };
  }) as never;
  return { calls, generate };
}

test('the email comes back in the voice of the person, with what gives it away named in the request', async () => {
  const { calls, generate } = answering(person);
  const result = await voicePass({ ...base, generate });
  assert.equal(result.rewritten, true);
  assert.deepEqual(result.paragraphs, person.paragraphs);
  assert.equal(result.subject, person.subject);
  assert.ok(result.tellsAfter < result.tellsBefore);
  assert.equal(calls.length, 1);
  assert.match(calls[0].systemPrompt || '', /Eres Carla, de ServiPro/);
  assert.match(calls[0].prompt, /ASÍ SUENA/);
  assert.match(calls[0].prompt, /Nadie escribe punto y coma/);
  assert.match(calls[0].prompt, /explica desde lejos cómo es su rubro/);
  assert.match(calls[0].prompt, /Sin preguntas ni invitaciones/);
  assert.match(calls[0].prompt, /Entre 30 y 90 palabras/);
  assert.match(calls[0].prompt, /tiendas, zona, sur/);
  assert.equal(result.usage.length, 1);
});

test('a first draft is shown the samples without their ask; a later one with it', () => {
  const sample = voicePassPrompt(base).split('---')[1];
  assert.ok(!sample.includes('?'), 'no question to imitate where none may be written');
  const later = voicePassPrompt({ ...base, step: 'follow_up', questions: { min: 1, max: 1 } });
  assert.match(later.split('---')[1], /\?/);
  assert.match(later, /Una sola pregunta, al final/);
});

test('the emails the person wrote themselves come before the built-in ones', () => {
  const prompt = voicePassPrompt({ ...base, ownSamples: ['Hola Pedro, te cuento que partimos el lunes con la faena.'] });
  assert.match(prompt, /ASÍ ESCRIBES TÚ/);
  assert.ok(prompt.indexOf('partimos el lunes') < prompt.lastIndexOf('---'));
  assert.equal(prompt.split('---').length - 1, 2, 'theirs alone: no built-in sample competes with the person\'s own voice');
  assert.ok(!prompt.includes(voicePassSample(base)));
});

test('one built-in sample gives the shape, another recipient gets another, and its phrases may not be lifted', async () => {
  const sample = voicePassSample(base);
  assert.ok(voicePassPrompt(base).includes(sample));
  assert.equal(voicePassPrompt(base).split('---').length - 1, 2);
  assert.ok(new Set(Array.from({ length: 30 }, (_, index) => voicePassSample({ ...base, seed: `persona${index}@acme.example` }))).size >= 5);
  const phrase = sample.split(/\s+/).slice(4, 12).join(' ');
  const lifted = { ...person, paragraphs: [person.paragraphs[0], `${person.paragraphs[1]} Y ${phrase.replace(/[.,]/g, '').toLowerCase()} también.`.replace(/\b(?:Dotal|Turnia|Selecta|Lampa|Quilicura|Navidad|Obras|Sur)\b/gi, 'eso')] };
  const result = await voicePass({ ...base, words: { min: 30, max: 140 }, generate: answering(lifted).generate });
  assert.equal(result.rewritten, false);
  assert.match(result.dropped || '', /Copiaste una frase del ejemplo/);
});

test('a version that changes what the email says is asked again, told why, and then dropped', async () => {
  const invented = { ...person, paragraphs: [person.paragraphs[0], 'En ServiPro te ponemos 40 personas en una semana, y cuando pasa diciembre dejas de pagar por ellas.'] };
  const fixed = answering(invented, person);
  const second = await voicePass({ ...base, generate: fixed.generate });
  assert.equal(second.rewritten, true);
  assert.equal(fixed.calls.length, 2);
  assert.match(fixed.calls[1].prompt, /Tu versión anterior no sirve: Agregaste una cifra que el correo no tenía \(40\)/);

  const stubborn = answering(invented, invented);
  const kept = await voicePass({ ...base, generate: stubborn.generate });
  assert.equal(kept.rewritten, false);
  assert.deepEqual(kept.paragraphs, base.paragraphs, 'the writer\'s email stands');
  assert.equal(kept.subject, base.subject);
  assert.match(kept.dropped || '', /cifra/);
  assert.equal(kept.usage.length, 2, 'what both tries cost is still counted');
});

test('a version that reads worse, or that names a company of the samples, never replaces the email', async () => {
  const worse = { subject: 'Aperturas', paragraphs: ['Vi que abrirán 2 tiendas en la zona sur. La dotación temporal permite cubrir el peak; el costo acompaña la apertura, reduciendo la carga.', 'En ServiPro el servicio entrega personal mediante contratos temporales para las aperturas de las tiendas del sur.'] };
  assert.equal((await voicePass({ ...base, paragraphs: person.paragraphs, generate: answering(worse).generate })).rewritten, false);
  const leaked = { ...person, paragraphs: [person.paragraphs[0], 'En Dotal te ponemos al personal temporal para las aperturas, y cuando pasa diciembre dejas de pagar por ellos.'] };
  const result = await voicePass({ ...base, generate: answering(leaked).generate });
  assert.equal(result.rewritten, false);
  assert.match(result.dropped || '', /Dotal/);
});

test('the guide\'s own sentences are not material for an email: a version that lifts one is turned back', async () => {
  const lifted = { ...person, paragraphs: [person.paragraphs[0], 'En ServiPro te ponemos al personal temporal, y solo te queda mirar lo que no calzó.'] };
  const result = await voicePass({ ...base, generate: answering(lifted).generate });
  assert.equal(result.rewritten, false);
  assert.match(result.dropped || '', /palabras de la guía/);
});

test('a version that opens with the name the greeting already carries is turned back', async () => {
  const named = { ...person, paragraphs: [`Rodrigo, ${person.paragraphs[0].replace(/^Vi/, 'vi')}`, person.paragraphs[1]] };
  const result = await voicePass({ ...base, generate: answering(named, person).generate });
  assert.equal(result.rewritten, true);
  assert.deepEqual(result.paragraphs, person.paragraphs);
  assert.match((await voicePass({ ...base, generate: answering(named).generate })).dropped || '', /el saludo ya lo lleva/);
});

test('the caller\'s own checks turn a version back; a subject they refuse gives way to the writer\'s', async () => {
  const refused = await voicePass({ ...base, generate: answering(person).generate, check: () => ['Frases de plantilla o de IA: «potenciar».'] });
  assert.equal(refused.rewritten, false);
  assert.match(refused.dropped || '', /potenciar/);
  const subjectOnly = await voicePass({ ...base, generate: answering(person).generate,
    check: (version) => (version.subject === person.subject ? ['El asunto parece título.'] : []) });
  assert.equal(subjectOnly.rewritten, true);
  assert.equal(subjectOnly.subject, base.subject);
  assert.deepEqual(subjectOnly.paragraphs, person.paragraphs);
});

test('a model that fails leaves the writer\'s email, and a cancelled request still cancels', async () => {
  const failed = await voicePass({ ...base, generate: answering(new Error('503')).generate });
  assert.equal(failed.rewritten, false);
  assert.deepEqual(failed.paragraphs, base.paragraphs);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(voicePass({ ...base, signal: controller.signal, generate: answering(new Error('aborted')).generate }));
});

test('what the person asked of the draft reaches the pass and comes before the samples', () => {
  assert.match(voicePassPrompt({ ...base, instruction: 'Más corto y de usted.' }), /manda sobre los ejemplos: "Más corto y de usted\."/);
  assert.match(voicePassPrompt({ ...base, treatment: 'usted' }), /de usted en todo el correo/);
});

test('the person\'s own emails lend their turns of phrase, and never a sentence whole', async () => {
  const own = ['Hola Pedro, te cuento que partimos el lunes con la faena y quedo atenta a lo que necesites para coordinar los turnos de la primera semana.'];
  // A short turn of phrase of theirs is their voice.
  const turn = { ...person, paragraphs: [person.paragraphs[0], `${person.paragraphs[1]} Quedo atenta a lo que necesites.`] };
  assert.equal((await voicePass({ ...base, ownSamples: own, words: { min: 30, max: 110 }, generate: answering(turn).generate })).rewritten, true);
  // Seven words in a row are what that other email said.
  const sentence = { ...person, paragraphs: [person.paragraphs[0], `${person.paragraphs[1]} Te cuento que partimos el lunes con la faena.`] };
  const result = await voicePass({ ...base, ownSamples: own, words: { min: 30, max: 110 }, generate: answering(sentence).generate });
  assert.equal(result.rewritten, false);
  assert.match(result.dropped || '', /Copiaste una frase del ejemplo/);
});
