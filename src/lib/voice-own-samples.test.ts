import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnWritingSubject, ownVoiceSampleProblem, ownVoiceTraits, pickOwnVoiceSamples, sentBodyAsText, voiceCandidates, type SentEmail } from './voice-own-samples';

// A fictional seller and fictional recipients.
const own = 'carla@servipro.example';
const pitch = `Hola Rodrigo,

Te escribo porque supe que abren dos tiendas en la zona sur antes de diciembre y me imagino que ya están viendo cómo armar los equipos.

Nosotros ponemos personal temporal para esas semanas y nos hacemos cargo de los contratos, así tu gente de tienda no dobla turnos. ¿Te parece si lo vemos 15 minutos el jueves?

Saludos,
Carla Soto
Ejecutiva comercial · ServiPro
+56 9 5555 0101`;
const email = (over: Partial<SentEmail>): SentEmail => ({ id: 'm1', subject: 'Equipo para las aperturas', sentAt: '2026-11-03T14:00:00Z', recipients: ['rodrigo@tiendasejemplo.example'], body: pitch, ...over });

test('what is kept of an email is what the person typed: no thread below it, no signature under the closing word', () => {
  const text = sentBodyAsText(`${pitch}\n\nEl mar, 3 nov 2026 a las 10:12, Rodrigo Paz <rodrigo@tiendasejemplo.example> escribió:\n> Hola Carla, ¿en qué quedamos?`);
  assert.match(text, /^Hola Rodrigo,\n\nTe escribo porque supe/);
  assert.ok(text.endsWith('el jueves?\n\nSaludos,'));
  assert.ok(!/Ejecutiva comercial|5555|escribió|en qué quedamos/.test(text));
  // Outlook's header for the thread, a phone's line and an email with no closing word.
  assert.equal(sentBodyAsText('Hola Ana, te mando lo que conversamos y quedo atenta a lo que decidan con el equipo.\n\nDe: Ana Rojas\nEnviado el: lunes\nAsunto: RE: propuesta'),
    'Hola Ana, te mando lo que conversamos y quedo atenta a lo que decidan con el equipo.');
  assert.equal(sentBodyAsText('Hola Ana, ¿lo vemos mañana a las diez?\n\nEnviado desde mi iPhone'), 'Hola Ana, ¿lo vemos mañana a las diez?');
  assert.equal(sentBodyAsText('Hola Ana, te confirmo que partimos el lunes con el equipo completo.\n\nCarla Soto\nServiPro\n+56 9 5555 0101'), 'Hola Ana, te confirmo que partimos el lunes con el equipo completo.');
});

test('an email the person wrote to someone outside their company is a candidate; answers, forwards, internal and mass mail are not', () => {
  assert.equal(isOwnWritingSubject('RE: Equipo para las aperturas'), false);
  assert.equal(isOwnWritingSubject('Aceptado: Reunión de coordinación'), false);
  assert.equal(isOwnWritingSubject('Equipo para las aperturas'), true);
  const found = voiceCandidates([
    email({ id: 'ok' }),
    email({ id: 'respuesta', subject: 'RE: Equipo para las aperturas' }),
    email({ id: 'hilo', reply: true }),
    email({ id: 'interno', recipients: ['pedro@servipro.example'] }),
    email({ id: 'masivo', recipients: ['a@uno.example', 'b@dos.example', 'c@tres.example', 'd@cuatro.example'] }),
    email({ id: 'de-la-app' }),
    email({ id: 'corto', body: 'Hola Rodrigo, ¿lo vemos mañana?\n\nSaludos,\nCarla' }),
    email({ id: 'ingles', body: 'Hi Rodrigo,\n\nI saw that you are opening two stores before December and wanted to ask how you are planning the teams for those weeks with your people. We staff temporary teams for those openings.\n\nBest,\nCarla' }),
  ], { ownEmail: own, skipIds: new Set(['de-la-app']) });
  assert.deepEqual(found.map((candidate) => candidate.id), ['ok']);
  assert.ok(found[0].body.endsWith('Saludos,'));
  assert.ok(found[0].words >= 25);
});

test('nothing about money, credentials, health or a dispute is offered, and neither is a list or a page of links', () => {
  const body = (extra: string) => pitch.replace('¿Te parece si lo vemos 15 minutos el jueves?', extra);
  const found = voiceCandidates([
    email({ id: 'clave', body: body('La contraseña del portal es la misma de siempre y te la mando aparte por si acaso la necesitas hoy.') }),
    email({ id: 'rut', body: body('Te dejo mi RUT 12.345.678-9 para que emitan el documento cuando puedan esta semana.') }),
    email({ id: 'cobranza', body: body('Te escribo también por la factura impaga de octubre, que sigue pendiente en nuestro sistema.') }),
    email({ id: 'lista', body: `${pitch.split('\n\n').slice(0, 2).join('\n\n')}\n\n- Reclutamiento del personal\n- Contratos y anexos\n- Reemplazos el mismo día\n\nSaludos,\nCarla` }),
  ], { ownEmail: own });
  assert.deepEqual(found, []);
});

test('the same email sent to several people is offered once, and the ones that show a voice best come first', () => {
  const plainer = `Hola Marta,

Adjunto va la propuesta que conversamos ayer por teléfono con todos los detalles del servicio y los plazos de puesta en marcha que revisamos juntos durante la llamada con el equipo.

Saludos,
Carla`;
  const found = voiceCandidates([
    email({ id: 'plano', body: plainer, recipients: ['marta@otra.example'], sentAt: '2026-11-05T10:00:00Z' }),
    email({ id: 'uno', recipients: ['rodrigo@tiendasejemplo.example'] }),
    email({ id: 'dos', recipients: ['paula@frioaustral.example'], body: pitch.replace('Hola Rodrigo', 'Hola Paula'), sentAt: '2026-11-04T10:00:00Z' }),
  ], { ownEmail: own });
  assert.deepEqual(found.map((candidate) => candidate.id), ['dos', 'plano']);
});

test('a pasted sample needs enough words to show a voice and not so many that it is a report', () => {
  assert.match(ownVoiceSampleProblem('Hola Ana, ¿lo vemos mañana?') || '', /muy corto/);
  assert.match(ownVoiceSampleProblem(Array.from({ length: 230 }, () => 'palabra').join(' ')) || '', /muy largo/);
  assert.equal(ownVoiceSampleProblem(sentBodyAsText(pitch)), null);
});

test('each recipient gets two of the person\'s samples, and not always the same two', () => {
  const samples = ['uno', 'dos', 'tres', 'cuatro', 'cinco'];
  assert.deepEqual(pickOwnVoiceSamples(['uno', ' '], 'x'), ['uno']);
  assert.equal(pickOwnVoiceSamples(samples, 'ana@acme.example').length, 2);
  assert.deepEqual(pickOwnVoiceSamples(samples, 'ana@acme.example'), pickOwnVoiceSamples(samples, 'ana@acme.example'));
  assert.ok(new Set(Array.from({ length: 20 }, (_, index) => pickOwnVoiceSamples(samples, `persona${index}@acme.example`).join('|'))).size >= 3);
});

test('how the person starts a sentence and how they ask is read from their samples, without what the emails were about', () => {
  const traits = ownVoiceTraits([
    'Hola Marcela, ¿cómo estás?\n\nTe cuento cortito: estamos partiendo con un par de empresas de tu rubro y me acordé de ti por lo que conversamos en la feria. La idea es simple, que tu equipo deje de perseguir informes.\n\nSi te tinca, te muestro cómo funciona en una llamada de 15 minutos. ¿Te acomoda el miércoles en la mañana?\n\nUn abrazo,',
    'Hola Daniela,\n\nGracias por recibirme el otro día. Me quedé pensando en lo que dijiste de los turnos de fin de semana, y creo que ahí es donde más te podemos ayudar.\n\nEn Evalia Chile partimos con 40 personas la semana pasada y resultó bien para todos los equipos.\n\nTe propongo algo fácil: partimos con un grupo chico y ves si te sirve. ¿Qué te parece?\n\nUn abrazo,',
  ]);
  assert.deepEqual(traits.openers, ['Te cuento cortito', 'La idea es', 'Si te tinca', 'Te propongo algo'], 'an opener that speaks of a meeting or a talk is not offered: said to someone else, it invents one');
  assert.deepEqual(traits.questions, ['¿Te acomoda el miércoles en la mañana?', '¿Qué te parece?'], 'the question in the greeting line is the greeting');
  assert.ok(!traits.openers.join(' ').includes('Evalia'), 'a sentence that starts with a name or a figure is what the email was about');
  assert.deepEqual(ownVoiceTraits([]), { openers: [], questions: [] });
});
