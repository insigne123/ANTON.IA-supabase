import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOICE_SAMPLES,
  VOICE_SAMPLE_NAMES,
  selectVoiceSamples,
  voiceFactsChanged,
  voiceSampleText,
  voiceSharedPhrase,
  voiceSkeleton,
  voiceTells,
  voiceTreatmentOf,
} from './outreach-voice';
import { checkHumanTone } from './server/human-tone-checks';

const codes = (body: string) => voiceTells(body).map((tell) => tell.code);

// Emails of fictional sellers, shaped like the drafts of the bench and of production on 9 Nov 2026.
const FORM = 'Hola Rodrigo,\n\nVi que abrirán dos tiendas nuevas en la zona sur antes de diciembre. En retail, cuando falta gente en una apertura, se forman filas en caja y los turnos extra suelen recaer en el equipo de tienda.\n\nSoy Carla, de ServiPro; ponemos dotación temporal para el peak de las aperturas, y el costo deja de correr cuando baja.\n\n¿Te parece si lo conversamos 15 minutos esta semana?';
const REPORT = 'Hola Paula,\n\nEn Evalia generamos informes de competencias para postulantes a cargos vinculados a faenas mineras.\n\nLa interpretación automática entrega resultados para comparar candidatos y decidir según sus competencias. ¿Cómo realizan hoy la evaluación psicolaboral de postulantes para esos cargos?';
const FOLLOW_UP = 'Hola Cristian,\n\nQuería consultarte si te interesa conversar sobre cómo cubrir los peaks de distribución con personal transitorio.\n\nSi te parece pertinente, podemos coordinar una breve conversación.';

test('the samples are emails a person could send: none trips the tone checks or carries a tell', () => {
  for (const sample of VOICE_SAMPLES) {
    const text = voiceSampleText(sample, { greeting: 'Hola Andrea,' });
    assert.deepEqual(voiceTells(text), [], sample.id);
    const tone = checkHumanTone({ subject: 'Equipo para la bodega', body: text, ctaExactText: sample.ask, maxModelQuestions: 1, hasSignal: true });
    assert.deepEqual(tone.errors, [], sample.id);
    const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
    assert.ok(words <= 90, `${sample.id}: ${words} words`);
    assert.equal((text.match(/\?/g) || []).length, 1, `${sample.id}: one ask`);
  }
});

test('every step has samples in both treatments, and each recipient gets its own', () => {
  for (const step of ['initial', 'follow_up', 'close'] as const) {
    for (const treatment of ['tu', 'usted'] as const) {
      const picked = selectVoiceSamples({ step, treatment, seed: 'ana@acme.example' });
      assert.ok(picked.length >= 1);
      assert.ok(picked.every((sample) => sample.step === step && sample.treatment === treatment), `${step} ${treatment}`);
    }
  }
  const first = (seed: string) => selectVoiceSamples({ step: 'initial', treatment: 'tu', seed })[0].id;
  assert.equal(first('ana@acme.example'), first('ana@acme.example'), 'a retry keeps its samples');
  assert.ok(new Set(Array.from({ length: 30 }, (_, index) => first(`persona${index}@acme.example`))).size >= 4, 'a campaign spreads over the shapes');
  assert.equal(new Set(selectVoiceSamples({ step: 'initial', treatment: 'tu', seed: 'x', count: 2 }).map((sample) => sample.id)).size, 2);
  assert.equal(selectVoiceSamples({ step: 'initial', treatment: 'tu', seed: 'x' }).length, 1, 'one sample gives the shape');
});

test('a sample without its ask is what a first research draft writes: the server adds the closing line', () => {
  const sample = VOICE_SAMPLES[0];
  assert.ok(!voiceSampleText(sample, { withAsk: false }).includes('?'));
  assert.ok(voiceSampleText(sample).endsWith(sample.ask));
});

test('the form filled in is told apart from the email of a person', () => {
  assert.deepEqual(new Set(codes(FORM)), new Set(['narrador', 'punto_y_coma']));
  assert.ok(codes('Hola Ana,\n\nAdministramos tus contratos. Dejamos los anexos al día. Revisamos cada finiquito.').includes('sin_conectores'));
  assert.ok(codes('Hola Ana,\n\nAdministramos tus contratos. Dejamos los anexos al día. Revisamos cada finiquito.').includes('ritmo_parejo'));
  assert.ok(codes(REPORT).includes('cosa_que_actua'), 'a thing acts: «la interpretación automática entrega…»');
  assert.ok(codes(REPORT).includes('fila_de_sustantivos'));
  assert.ok(codes(REPORT).includes('palabra_de_informe'), '«vinculados a», «realizan»');
  assert.deepEqual(new Set(codes(FOLLOW_UP)), new Set(['formula']));
  assert.ok(codes('Hola Ana,\n\nAdministramos los contratos de tu equipo, asegurando que cada anexo quede al día.').includes('gerundio'));
  const person = 'Hola Rodrigo,\n\nVi que abren dos tiendas en la zona sur antes de diciembre. Si llegan a la apertura con medio equipo, el primer fin de semana van a tener filas en caja.\n\nEn ServiPro ponemos el personal temporal para esas semanas, y cuando baja la carga se termina el contrato.\n\n¿Te parece si lo conversamos 15 minutos esta semana?';
  assert.deepEqual(voiceTells(person), []);
  for (const tell of voiceTells(FORM)) assert.ok(tell.advice.length > 20 && FORM.includes(tell.excerpt.replace(/\.\.\.$/, '').slice(0, 40)));
});

test('a sentence that names the recipient company speaks to them', () => {
  const body = 'Hola Ana,\n\nEn una constructora del tamaño de Obras del Sur cada obra nueva exige salir a buscar cuadrilla con poco aviso.';
  assert.ok(codes(body).includes('narrador'));
  assert.ok(!voiceTells(body, { recipientCompany: 'Obras del Sur SpA' }).some((tell) => tell.code === 'narrador'));
});

test('a batch that shares one shape shows it', () => {
  const other = FORM.replace('Rodrigo', 'Paula').replace('dos tiendas nuevas en la zona sur', 'una bodega en Lampa');
  assert.equal(voiceSkeleton(FORM), voiceSkeleton(other));
  assert.equal(voiceSkeleton(FORM), 'vi que | soy N | te parece');
  assert.notEqual(voiceSkeleton(FORM), voiceSkeleton(voiceSampleText(VOICE_SAMPLES[1], { greeting: 'Hola Paula,' })));
});

test('a rewrite may change how an email sounds, never what it says', () => {
  const before = 'Vi que abren 2 tiendas en Temuco antes de diciembre. En ServiPro ponemos personal temporal para esas aperturas.';
  const keep = { names: ['ServiPro', 'Rodrigo', 'Tiendas Ejemplo'], questions: { min: 0, max: 0 }, words: { min: 10, max: 60 } };
  assert.equal(voiceFactsChanged(before, 'Te escribo porque abren 2 tiendas en Temuco antes de diciembre, y en ServiPro ponemos el personal temporal para esas semanas.', keep), null);
  assert.match(voiceFactsChanged(before, 'Abren 2 tiendas en Temuco y ponemos 40 personas en una semana.', keep) || '', /cifra.*40/);
  assert.match(voiceFactsChanged(before, 'Abren 2 tiendas en Temuco, y en Dotal ponemos el personal para esas semanas.', keep) || '', /nombre.*Dotal/);
  assert.match(voiceFactsChanged(before, 'Abren 2 tiendas en Temuco antes de diciembre. ¿Ya tienes al equipo de ServiPro en mente?', keep) || '', /no lleva preguntas/);
  assert.match(voiceFactsChanged(before, 'Abren 2 tiendas en Temuco.', keep) || '', /palabras/);
  assert.equal(voiceFactsChanged(before, 'Te escribo por las 2 tiendas que abren en Temuco antes de diciembre. En ServiPro, donde trabaja Rodrigo, ponemos personal temporal.', keep), null, 'a name the caller allows');
  assert.match(voiceFactsChanged('Hola {{nombre}}, te escribo por {{empresa}}.', 'Hola {{nombre}}, te escribo por tu empresa.') || '', /variables/);
  assert.match(voiceFactsChanged('Puedes agendar aquí: https://agenda.example/ana', 'Puedes agendar cuando quieras.') || '', /enlace/);
  assert.match(voiceFactsChanged('Le escribo por la fiscalización que anunció la Dirección del Trabajo.', 'Te escribo por la fiscalización que anunció la Dirección del Trabajo.') || '', /usted/);
  assert.match(voiceFactsChanged('Te escribo por la apertura de marzo.', 'Me dirijo a usted por la apertura de marzo.') || '', /tutea/);
  for (const name of ['Dotal', 'Turnia', 'Selecta', 'Lampa']) assert.ok(VOICE_SAMPLE_NAMES.includes(name), name);
});

test('a phrase lifted from a sample is found, whatever its capitals and accents', () => {
  assert.equal(voiceSharedPhrase('Y ahí es donde aparecen los errores de pago, creo.', 'Ahí es donde aparecen los errores de pago.'), 'ahi es donde aparecen los');
  assert.equal(voiceSharedPhrase('Ponemos el personal para esas semanas.', 'Ahí es donde aparecen los errores de pago.'), null);
});

test('the treatment of an email is the one it already uses', () => {
  assert.equal(voiceTreatmentOf('Le escribo por la fiscalización. ¿Le parece si lo conversamos?'), 'usted');
  assert.equal(voiceTreatmentOf('Te escribo por la apertura. ¿Te parece si lo vemos?'), 'tu');
  assert.equal(voiceTreatmentOf('Vi que abren dos tiendas.'), 'tu');
});
