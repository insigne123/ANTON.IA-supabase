import assert from 'node:assert/strict';
import test from 'node:test';

import { checkHumanTone, feedbackForToneRetry } from './human-tone-checks';
import { draftContextFixture } from './draft-v2-test-fixtures';
import { validateDraftPreflightV2 } from './draft-preflight-v2';

const GOOD = {
  subject: 'dotación para el peak de diciembre',
  body: [
    'Hola Rodrigo,',
    '',
    'Vi que abren dos tiendas nuevas en la zona sur antes de fin de año. En esas aperturas lo difícil suele ser que la gente dure hasta enero.',
    '',
    'Nosotros ponemos reponedores y cajeros por temporada, y nos hacemos cargo del reemplazo si alguien no llega.',
    '',
    '¿Tienen resuelto el refuerzo de diciembre o te sirve que lo conversemos?',
  ].join('\n'),
};

test('human tone accepts a concrete human email without findings', () => {
  const result = checkHumanTone({ ...GOOD, maxModelQuestions: 1 });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('human tone blocks template openers and inflated language', () => {
  const result = checkHumanTone({
    subject: 'Propuesta Comercial De Servicios',
    body: 'Estimado Sr. González:\n\nEspero que este correo lo encuentre muy bien. Somos líderes en soluciones integrales de outsourcing para potenciar su operación.\n\nQuedo a su entera disposición.',
  });
  const codes = result.errors.map((finding) => finding.code);
  assert.ok(codes.includes('tone_muletilla'));
  assert.ok(codes.includes('tone_asunto'));
  assert.ok(result.errors.every((finding) => finding.blocking));
  assert.ok(feedbackForToneRetry(result.errors).length > 0);
});

test('human tone blocks em-dashes, bullets, emojis and extra questions', () => {
  const dashes = checkHumanTone({ subject: 'turnos noche en Pudahuel', body: 'Hola Felipe,\n\nEl turno — como sabes — cuesta cubrir.\n\n¿Conversamos?' });
  assert.ok(dashes.errors.some((finding) => finding.code === 'tone_formato'));

  const bullets = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nTenemos:\n· Reponedores\n· Cajeros\n\n¿Conversamos?' });
  assert.ok(bullets.errors.some((finding) => finding.code === 'tone_formato'));

  const questions = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\n¿Tienen resuelto diciembre? ¿O prefieren enero? ¿Llamamos?', maxModelQuestions: 1 });
  assert.ok(questions.errors.some((finding) => finding.code === 'tone_pregunta'));

  const initial = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\n¿Tienen resuelto diciembre?\n\n¿Te parece si lo conversamos 15 minutos esta semana?', ctaExactText: '¿Te parece si lo conversamos 15 minutos esta semana?', maxModelQuestions: 0 });
  assert.ok(initial.errors.some((finding) => finding.code === 'tone_pregunta'));

  const initialClean = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nPara diciembre podrían sumar refuerzo por un período acotado.\n\n¿Te parece si lo conversamos 15 minutos esta semana?', ctaExactText: '¿Te parece si lo conversamos 15 minutos esta semana?', maxModelQuestions: 0 });
  assert.deepEqual(initialClean.errors, []);
});

test('human tone blocks tuteo/usted mixing but accepts consistent usted', () => {
  const mixed = checkHumanTone({ subject: 'dotación en faena', body: 'Hola Paula,\n\nLe escribo por la dotación. ¿Te parece si lo conversamos?' });
  assert.ok(mixed.errors.some((finding) => finding.code === 'tone_tratamiento'));

  const usted = checkHumanTone({ subject: 'dotación en faena', body: 'Hola Paula,\n\nLe escribo por la dotación temporal en faena. Su equipo podría sumar personal por un período acotado.\n\n¿Le parece si lo conversamos?' });
  assert.deepEqual(usted.errors, []);
  // Bank of 30 Oct 2026: «sus tiendas» of the company or «les toca» to the cashiers turned correct tú emails back.
  for (const body of [
    'Hola Ana,\n\nVi que Acme abrirá sus tiendas en el sur. Si te sirve, ponemos personal para la apertura.',
    'Hola Ana,\n\nA los cajeros les toca doblar turno cuando falta alguien. Ponemos personal el mismo día si lo necesitas.',
    'Hola Ana,\n\nSi ustedes abren en marzo, te ayudamos con la dotación.',
  ]) assert.ok(!checkHumanTone({ subject: 'dotación en tiendas', body }).errors.some((finding) => finding.code === 'tone_tratamiento'), body);
  assert.ok(checkHumanTone({ subject: 'dotación en tiendas', body: 'Hola Ana,\n\nUsted verá que tu equipo llega justo.' }).errors.some((finding) => finding.code === 'tone_tratamiento'));
});

test('human tone blocks company-definition openings', () => {
  const ficha = checkHumanTone({
    subject: 'dotación temporal en tiendas',
    body: 'Hola Rodrigo,\n\nPara una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, sumar personal puede servir.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
  });
  assert.ok(ficha.errors.some((finding) => finding.code === 'tone_ficha'));
  const signal = checkHumanTone({
    subject: 'dotación para las nuevas tiendas',
    body: 'Hola Rodrigo,\n\nTiendas Ejemplo abrirá dos tiendas nuevas en la zona sur antes de diciembre. Para esa puesta en marcha podría servir refuerzo temporal.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
  });
  assert.deepEqual(signal.errors, []);
});

test('a ficha opening blocks without a signal too: naming the company in passing is always possible', () => {
  // Real research of 30 Oct 2026: two of three openings without a dated fact were «SQM cuenta con cinco líneas de negocio.».
  const ficha = checkHumanTone({
    subject: 'dotación temporal en tiendas',
    body: 'Hola Rodrigo,\n\nPara una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, sumar personal puede servir.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
    hasSignal: false,
  });
  assert.ok(ficha.errors.some((finding) => finding.code === 'tone_ficha' && finding.blocking && /de pasada/.test(finding.message)));
  // On the corrective retry it is a notice: a draft not created because of how it opens is worse than one the person reviews.
  const retried = checkHumanTone({
    subject: 'dotación temporal en tiendas',
    body: 'Hola Rodrigo,\n\nPara una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, sumar personal puede servir.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
    hasSignal: false,
    finalAttempt: true,
  });
  assert.ok(!retried.errors.some((finding) => finding.code === 'tone_ficha'));
  assert.ok(retried.warnings.some((finding) => finding.code === 'tone_ficha'));
  const described = checkHumanTone({
    subject: 'asuntos laborales en transporte',
    body: 'Hola Waldo,\n\nHualpén se describe como una compañía de transporte privado de personas. Un asunto laboral que se entrampa atrasa recorridos.\n\n¿Conversamos?',
    companyName: 'Hualpén',
    hasSignal: false,
  });
  assert.ok(described.errors.some((finding) => finding.code === 'tone_ficha'));
  const passing = checkHumanTone({
    subject: 'evaluaciones por cargo',
    body: 'Hola María,\n\nEn operaciones industriales como SQM, que cuenta con cinco líneas de negocio, cada cargo pide su propia batería de tests.\n\n¿Conversamos?',
    companyName: 'SQM',
    hasSignal: false,
  });
  assert.ok(!passing.errors.some((finding) => finding.code === 'tone_ficha'));
});

test('ficha feedback points to the trade, with the company in passing, when no signal exists', () => {
  const without = checkHumanTone({
    subject: 'dotación en faena', body: 'Hola Paula,\n\nEn una faena como la de Minera Cascada, con más de 2.000 trabajadores, la dotación temporal puede servir.\n\n¿Conversamos?',
    companyName: 'Minera Cascada',
  });
  assert.ok(without.errors.some((finding) => finding.code === 'tone_ficha' && /se complica en su rubro/.test(finding.message)));
  const withSignal = checkHumanTone({
    subject: 'dotación en faena', body: 'Hola Paula,\n\nEn una faena como la de Minera Cascada, con más de 2.000 trabajadores, la dotación temporal puede servir.\n\n¿Conversamos?',
    companyName: 'Minera Cascada', hasSignal: true,
  });
  assert.ok(withSignal.errors.some((finding) => finding.code === 'tone_ficha' && /dato fechado/.test(finding.message)));
});

test('human tone warns on review words and contrasts without blocking', () => {
  const result = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nPodemos optimizar la cobertura de diciembre. No es solo personal, es continuidad.\n\n¿Conversamos?' });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.length > 0);
});

test('preflight warns when the approved CTA mixes tratamiento with an usted body', () => {
  const context = draftContextFixture();
  const output = {
    subject: 'dotación en faena',
    body: 'Hola Paula,\n\nLe escribo por la dotación temporal en faena. Su equipo podría sumar personal por un período acotado.\n\n¿Te parece si lo conversamos 15 minutos esta semana?',
    personalization: [{ evidenceId: context.evidence[0].evidenceId, claimId: 'claim-acme-overview', sourceUrl: context.evidence[0].source.url }],
    hypothesisIds: [],
  };
  const result = validateDraftPreflightV2(context, output, { checkGeneratedCopy: true, checkHumanTone: true });
  assert.ok(result.preflight.warnings.some((w) => /otro tratamiento/.test(w)));
});

test('human tone blocks the bridges that say nothing', () => {
  for (const sentence of ['La puesta en marcha puede implicar sumar personal.', 'Así, el equipo puede revisar opciones con más agilidad.', 'Es una alternativa para cubrir la conserjería.'])
    assert.ok(checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
});

test('human tone blocks the same bridges with words in between, and leaves a real cost alone', () => {
  // Bank drafts of 30 Oct 2026 (v24) that still passed.
  for (const sentence of ['La dotación se ajusta y su costo acompaña la cosecha.', 'El gasto de ese refuerzo acompaña el peak.', 'Ponemos personal, de modo que el costo acompañe ese peak.', 'El costo de esa dotación acompaña el peak.', 'Así puede sumar personal durante esas aperturas.', 'Administrar contratos también puede acompañar la incorporación.', 'Así, ese turno puede volver a tener cobertura.', 'El reporte interno indica que la rotación llegó al 18%.', 'Así, la dotación también puede cubrir trabajos definidos.', 'En ServiPro hacemos reemplazos; así, usted cuenta con apoyo puntual.'])
    assert.ok(checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
  for (const sentence of ['El costo termina cuando termina la cosecha.', 'Acompañamos la apertura con dos personas por tienda.', 'Así que el equipo puede revisarlo el lunes.'])
    assert.ok(!checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
});

test('human tone blocks a sentence left without its verb, not a short sentence by style', async () => {
  const { sentenceFragments } = await import('./human-tone-checks');
  // A draft of 29 Oct 2026 opened like this, and the person had to rewrite it.
  const broken = checkHumanTone({ subject: 'Tests para servicios transitorios', body: 'Hola Cristian,\n\nPara selección en servicios transitorios.\n\nOfrecemos más de 45 tests para evaluar postulantes online.' });
  assert.ok(broken.errors.some((finding) => finding.code === 'tone_fragmento' && finding.blocking && /Para selección en servicios transitorios/.test(finding.message)));

  assert.deepEqual(sentenceFragments(GOOD.body), []);
  assert.deepEqual(sentenceFragments('Hola Ana,\n\nUn solo proveedor para personal, aseo y seguridad. ¿Cuántos turnos cubren al mes?'), [], 'a short sentence of another kind is style');
  assert.deepEqual(sentenceFragments('Hola Paula,\n\nLe escribo por la dotación temporal en faena. Con la temporada encima, cubrimos turnos el mismo día.'), []);
  assert.deepEqual(sentenceFragments('Hola,\n\nPara selección en servicios transitorios. Cuando entran muchos guardias a la vez, cubrimos el turno.'), ['Para selección en servicios transitorios.']);
  assert.deepEqual(sentenceFragments('Hola,\n\nCon este correo cierro el tema. Con AXIS, cargas la lista de postulantes.'), [], 'the first and second person are verbs');
  // Turned back a first attempt of the bank on 30 Oct 2026 (v25): a clitic before a word is a verb.
  assert.deepEqual(sentenceFragments('Hola,\n\nSi se alarga, se posterga la decisión de contratación. Para la selección de esta cosecha.'), ['Para la selección de esta cosecha.']);
});

test('a company named in passing is not a ficha; one described as the subject still is', () => {
  // Production, 30 Oct 2026: the second form was turned back twice and the draft was not created. «María»: an accented name hid the opening from the check.
  const passing = checkHumanTone({
    subject: 'Turnos en tiendas', body: 'Hola Rodrigo,\n\nEn una cadena de retail como Tiendas Ejemplo, con 40 tiendas en la zona sur, un turno corto alarga la fila en caja.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo', hasSignal: true,
  });
  assert.ok(!passing.errors.some((finding) => finding.code === 'tone_ficha'));
  const described = checkHumanTone({
    subject: 'Evaluaciones por cargo', body: 'Hola María,\n\nAcme cuenta con cinco líneas de negocio, desde litio hasta nutrición vegetal.\n\n¿Conversamos?',
    companyName: 'Acme', hasSignal: true,
  });
  assert.ok(described.errors.some((finding) => finding.code === 'tone_ficha' && /de pasada/.test(finding.message)));
});

test('its own advertising said back is blocked, with or without a signal; the same words about the trade are not', () => {
  // Real research of 30 Oct 2026: «Hualpén es la principal compañía de transporte privado de personas» opened the draft.
  const said = (body: string, hasSignal: boolean) => checkHumanTone({ subject: 'Turnos de conductores', body, companyName: 'Acme', hasSignal })
    .errors.filter((finding) => finding.code === 'tone_ficha' && finding.blocking && /publicidad/.test(finding.message));
  assert.equal(said('Hola Waldo,\n\nEn transporte de personas, Acme es la principal compañía del rubro y opera turnos de noche.\n\n¿Conversamos?', false).length, 1);
  assert.equal(said('Hola Ana,\n\nAcme ejerce una posición de liderazgo mundial en litio.\n\n¿Conversamos?', true).length, 1);
  assert.equal(said('Hola Ana,\n\nCon la flota más grande del país, un conductor que falta deja un bus en patio.\n\n¿Conversamos?', false).length, 1);
  for (const body of [
    'Hola Ana,\n\nEn retail, la falta de cobertura es la principal causa de reclamos en caja.\n\n¿Conversamos?',
    'Hola Ana,\n\nSi el que falta es el líder de turno, la cuadrilla se detiene.\n\n¿Conversamos?',
    'Hola Ana,\n\nUno de los principales problemas en faena es el relevo de turno.\n\n¿Conversamos?',
    'Hola Ana,\n\nEl primer grupo de contratados entra en marzo.\n\n¿Conversamos?',
  ]) assert.deepEqual(said(body, true), [], body);
});

test('their own words in quotes are blocked; a short name in quotes is not', () => {
  // Real research of 30 Oct 2026: «Tawa Chile resume su aporte como «Contribuimos con las organizaciones».».
  const quotes = (body: string) => checkHumanTone({ subject: 'Tests en selección', body, companyName: 'Acme', hasSignal: false })
    .errors.filter((finding) => /comillas/.test(finding.message));
  assert.equal(quotes('Hola Rolando,\n\nEn selección, Acme resume su aporte como «Contribuimos con las organizaciones». Interpretar tests a mano toma horas.\n\n¿Conversamos?').length, 1);
  assert.deepEqual(quotes('Hola Karlos,\n\nCon el contrato «Mantenimiento Vial y Control Carretera» hasta 2029, las cuadrillas trabajan en ruta.\n\n¿Conversamos?'), []);
});

test('«como los de …» or «de …» names the company in passing; «Así puedes…» says nothing', () => {
  const ofIt = checkHumanTone({
    subject: 'Perfiles TI para minería', body: 'Hola Julian,\n\nEn los proyectos mineros de LEN, con más de cinco décadas en obras, una búsqueda TI larga deja tareas pendientes.\n\n¿Conversamos?',
    companyName: 'LEN INGENIERIA', hasSignal: false,
  });
  assert.ok(!ofIt.errors.some((finding) => finding.code === 'tone_ficha'));
  const passing = checkHumanTone({
    subject: 'Perfiles TI para minería', body: 'Hola Julian,\n\nEn proyectos mineros como los de LEN Ingeniería, con más de cinco décadas en obras, sumar especialistas TI compite con el avance del proyecto.\n\n¿Conversamos?',
    companyName: 'LEN INGENIERIA', hasSignal: false,
  });
  assert.ok(!passing.errors.some((finding) => finding.code === 'tone_ficha'));
  const hollow = checkHumanTone({ subject: 'Evaluaciones por cargo', body: 'Hola María,\n\nEntregamos informes interpretados. Así puedes comparar postulantes.\n\n¿Conversamos?' });
  assert.ok(hollow.errors.some((finding) => finding.code === 'tone_muletilla'));
});
