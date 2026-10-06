import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_YES_CHIP, coworkAnswerIssues, coworkBlocks, coworkChoices, coworkQuestion, coworkSuggestions, polishCoworkAnswer, polishCoworkText, coworkMetricFit } from './answer-quality';
import { coworkChoiceMessage, coworkReplyBody, coworkStoredChoices, coworkStoredQuestion } from './contracts';

test('internal codes copied from tool results become plain Spanish', () => {
  assert.equal(polishCoworkText('El período disponible es *last_30_days* (30 días móviles).'), 'El período disponible es últimos 30 días (30 días móviles).');
  assert.equal(polishCoworkText('No contactes direcciones marcadas do_not_contact.'), 'No contactes direcciones marcadas «no contactar».');
  assert.equal(polishCoworkText('Solo Jose muestra correo (`jcastro@grupoexpro.com`).'), 'Solo Jose muestra correo (jcastro@grupoexpro.com).');
  assert.equal(polishCoworkText('Enriquece a Jose (c517a22f-d087-45ae-b450-045f2abc60e1) ahora.'), 'Enriquece a Jose ahora.');
});

test('fenced code blocks are left untouched', () => {
  const code = '```python\nperiod = "last_30_days"\n```';
  assert.equal(polishCoworkText(`Resultado:\n${code}`), `Resultado:\n${code}`);
});

test('polishing covers the reply and the document content', () => {
  const answer = polishCoworkAnswer({ reply: 'Periodo: last_7_days.', document: { title: 'Informe', content: 'Alcance: last_30_days.' } });
  assert.equal(answer.reply, 'Periodo: últimos 7 días.');
  assert.equal(answer.document?.content, 'Alcance: últimos 30 días.');
});

test('the production answers that confused people are flagged', () => {
  const pendientes = 'En los registros de la app no aparecen contactos ni respuestas pendientes. Pero la cobertura de Gmail y Outlook no está verificada, así que no puedo confirmar que no haya mensajes por atender.';
  const codes = coworkAnswerIssues(pendientes).map(issue => issue.code);
  assert.ok(codes.includes('jargon'));
  assert.ok(codes.includes('next_step'));
  const dominio = coworkAnswerIssues('Pásame el dominio desnudo (por ejemplo, ejemplo.cl) y revisaré sus registros.');
  assert.ok(dominio.some(issue => issue.detail.includes('dominio desnudo')));
  assert.ok(coworkAnswerIssues('Revisé yago.cl a las 04:12 UTC.').some(issue => issue.code === 'timezone'));
});

test('a direct answer with a closing offer passes', () => {
  const good = 'Hoy no tienes respuestas pendientes en ANTON.IA.\nLo que sí puedes avanzar:\n- 12 de tus 13 contactos recientes no tienen correo.\n- Tienes 2 incidencias abiertas.\n¿Busco el correo de los 3 más relevantes?';
  assert.deepEqual(coworkAnswerIssues(good), []);
});

test('an explanatory answer passes; a greeting first, a wall of text or a reply that belongs in a document do not', () => {
  const explained = [
    'Tienes 12 contactos de RR. HH. listos para escribirles hoy: tienen correo y nunca recibieron nada.',
    '',
    'Revisé tus 406 contactos guardados y los envíos de los últimos 30 días. Lo que encontré:',
    '- 12 de RR. HH. con correo y sin envíos, 8 de ellos en empresas de más de 200 personas.',
    '- 5 respondieron a tu última campaña y 2 pidieron reunión.',
    '',
    'Te propongo empezar por los 8 de empresas grandes, porque son las que contratan en volumen. Al aprobar dejo una campaña pausada con un primer correo para cada uno; nada sale sin tu aprobación.',
    '',
    '¿Dejo lista la campaña pausada para esos 8?',
  ].join('\n');
  assert.deepEqual(coworkAnswerIssues(explained), []);
  assert.deepEqual(coworkAnswerIssues(`¡Claro! ${explained}`).map(issue => issue.code), ['preamble']);
  assert.deepEqual(coworkAnswerIssues(`Perfecto, ${explained}`).map(issue => issue.code), ['preamble']);
  assert.deepEqual(coworkAnswerIssues(`Claro Chile contrata 40 operarios este mes.\n¿Busco a su jefa de RR. HH.?`), [], 'a company named Claro is not a greeting');
  const wall = `${Array.from({ length: 120 }, (_, index) => `dato${index}`).join(' ')}.\n\n¿Sigo con el resto?`;
  assert.deepEqual(coworkAnswerIssues(wall).map(issue => issue.code), ['wall']);
  const paragraph = `${Array.from({ length: 50 }, (_, index) => `cifra${index}`).join(' ')}.`;
  const long = `${Array.from({ length: 9 }, () => paragraph).join('\n\n')}\n\n¿Lo paso a un documento?`;
  assert.deepEqual(coworkAnswerIssues(long).map(issue => issue.code), ['length'], 'short paragraphs, but it belongs in a document');
  const list = `Estos son los 30:\n${Array.from({ length: 30 }, (_, index) => `- Persona ${index}, gerenta de personas en una empresa de retail con correo.`).join('\n')}\n¿Sigo?`;
  assert.ok(!coworkAnswerIssues(list).some(issue => issue.code === 'wall'), 'list items are not a wall of text');
});

test('quick replies keep short plain chips and drop malformed ones one by one', () => {
  const chips = coworkSuggestions([
    { label: 'Sí, búscalo.', message: 'Sí, busca el correo de Nehal (00000000-0000-4000-8000-000000000022).' },
    { label: '**Ver incidencias**', message: '' },
    { label: 'Una etiqueta demasiado larga para caber en un botón del chat', message: 'Algo' },
    { label: 'sí, búscalo', message: 'Repetida' },
    { label: 'Usa last_30_days', message: 'Muéstrame last_30_days' },
    { label: 'Cuarta', message: 'No cabe: el máximo es tres' },
  ]);
  assert.deepEqual(chips, [
    { label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal.' },
    { label: 'Ver incidencias', message: 'Ver incidencias' },
    { label: 'Usa últimos 30 días', message: 'Muéstrame últimos 30 días' },
  ]);
  assert.deepEqual(coworkSuggestions(null), []);
  // Asterisks inside the text (masked names) are not formatting.
  assert.deepEqual(coworkSuggestions([{ label: 'Buscar correos', message: 'Busca los correos de Carlos Ah***a y Nehal Pa***a' }]),
    [{ label: 'Buscar correos', message: 'Busca los correos de Carlos Ah***a y Nehal Pa***a' }]);
  assert.deepEqual(coworkSuggestions([{ label: 'Ver ficha 00000000-0000-4000-8000-000000000022', message: 'Ver ficha' }]), []);
  assert.deepEqual(coworkSuggestions([{ label: 'Ya lo guardé', message: 'Ya lo guardé; estos son los textos:' }]), []);
  assert.deepEqual(coworkSuggestions([{ label: 'Sí, te cuento', message: 'AXIS ayuda a [describe qué resuelve]. Prepara los correos' }]), []);
  assert.deepEqual(coworkSuggestions([
    { label: 'Sí, después', message: 'Sí, cuando guarde el contacto, prepara la campaña' },
    { label: 'Sincronizar LinkedIn', message: 'Voy a sincronizar mi LinkedIn' },
    { label: 'Ya lo guardé', message: 'Ya lo guardé, crea la campaña' },
  ]), [{ label: 'Ya lo guardé', message: 'Ya lo guardé, crea la campaña' }]);
  // Seen with the real model: the chip waits for a time or a recipient the person has not given.
  assert.deepEqual(coworkSuggestions([
    { label: 'Cambiar horario', message: 'Prepara una invitación para Carlos de Minera Centinela y te indicaré otro horario.' },
    { label: 'Adaptarlo al destinatario', message: 'Sí, adapta este correo para un destinatario específico que te indicaré.' },
    { label: 'Preparar invitación', message: 'Sí, prepara la invitación para el martes 29 a las 10:00' },
  ]), [{ label: 'Preparar invitación', message: 'Sí, prepara la invitación para el martes 29 a las 10:00' }]);
});

test('polishing an answer keeps its clean quick replies, or null when none survive', () => {
  const answer = polishCoworkAnswer({ reply: '¿Busco su correo?', document: null,
    suggestions: [{ label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal Pa***a de Adecco' }] });
  assert.deepEqual(answer.suggestions, [{ label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal Pa***a de Adecco' }]);
  assert.equal(polishCoworkAnswer({ reply: 'Listo.', document: null }).suggestions, null);
});

test('the closing question is one plain sentence that ends the reply exactly once', () => {
  assert.equal(coworkQuestion('**¿Busco su correo?**'), '¿Busco su correo?');
  assert.equal(coworkQuestion('Te preparo el correo?'), '¿Te preparo el correo?');
  assert.equal(coworkQuestion('Si quieres, ¿lo dejo listo?'), 'Si quieres, ¿lo dejo listo?');
  for (const bad of [null, '', 'Listo.', '¿Le escribo a [nombre]?', '¿Busco 00000000-0000-4000-8000-000000000022?', `¿${'a'.repeat(300)}?`]) {
    assert.equal(coworkQuestion(bad), null);
  }
  const polish = (reply: string, question: string | null) => polishCoworkAnswer({ reply, document: null, question });
  // Apart from the reply, it is appended so history and copies read the whole answer.
  assert.equal(polish('Te dejé la secuencia.', '¿Creo la campaña?').reply, 'Te dejé la secuencia.\n\n¿Creo la campaña?');
  assert.equal(polish('Te dejé la secuencia.', '¿Creo la campaña?').question, '¿Creo la campaña?');
  // Already the last line: no repetition.
  assert.equal(polish('Te dejé la secuencia.\n¿Creo la campaña?', '¿Creo la campaña?').reply, 'Te dejé la secuencia.\n¿Creo la campaña?');
  // A different closing question gives way: one question, the one in answer.question.
  assert.equal(polish('Te dejé la secuencia.\n¿Quieres otro tono?', '¿Creo la campaña?').reply, 'Te dejé la secuencia.\n\n¿Creo la campaña?');
  assert.equal(polish('Te dejé la secuencia.\n\n**¿Quieres otro tono?**', '¿Creo la campaña?').reply, 'Te dejé la secuencia.\n\n¿Creo la campaña?');
  // Only the asking sentences go: seen with the real model, the whole paragraph with
  // the people to write to was lost when its last sentence was a question.
  assert.equal(polish('Priorizaría a Felipe Muñoz (Securitas) y a Camila Fuentes (Adecco): tienen correo. A Marcela ya le escribiste. ¿Te preparo el correo?', '¿Preparo el correo para Felipe y Camila?').reply,
    'Priorizaría a Felipe Muñoz (Securitas) y a Camila Fuentes (Adecco): tienen correo. A Marcela ya le escribiste.\n\n¿Preparo el correo para Felipe y Camila?');
  assert.equal(polish('Esto es información general, no asesoría legal. ¿Reviso tus bajas? ¿O prefieres otra cosa?', '¿Reviso tus bajas?').reply,
    'Esto es información general, no asesoría legal.\n\n¿Reviso tus bajas?');
  // An abbreviation inside the question («RR. HH.») is not where it starts: seen with the real model, the
  // reply kept «¿La uso … de RR. HH.» and then repeated the whole question.
  assert.equal(polish('Lo orienté a presentar AXIS, sin resultados no respaldados. ¿La uso en una campaña pausada con tus contactos de RR. HH. con correo?',
    '¿La uso en una campaña pausada con tus contactos de RR. HH. con correo?').reply,
  'Lo orienté a presentar AXIS, sin resultados no respaldados.\n\n¿La uso en una campaña pausada con tus contactos de RR. HH. con correo?');
  assert.equal(polish('Te dejé el correo para la Sra. Rojas. **¿Lo envío a la Sra. Rojas?**', '¿Lo envío?').reply, 'Te dejé el correo para la Sra. Rojas.\n\n¿Lo envío?');
  // A question written without «¿» still goes sentence by sentence.
  assert.equal(polish('Te dejé la secuencia. Quieres otro tono?', '¿Creo la campaña?').reply, 'Te dejé la secuencia.\n\n¿Creo la campaña?');
  // A question inside a list is content, not the closing.
  assert.equal(polish('Preguntas para la reunión:\n- ¿Cuántos postulantes revisan?', '¿La agendo?').reply,
    'Preguntas para la reunión:\n- ¿Cuántos postulantes revisan?\n\n¿La agendo?');
  assert.equal(polish('Listo.', null).question, null);
  // A closed question without quick replies still gets a one-tap yes; without a question, none.
  assert.deepEqual(polish('Te dejé la secuencia.', '¿Creo la campaña?').suggestions, [{ label: 'Sí, adelante', message: 'Sí, adelante.' }]);
  assert.equal(polish('Listo.', null).suggestions, null);
  assert.deepEqual(polishCoworkAnswer({ reply: 'Listo.', document: null, question: '¿Creo la campaña?',
    suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }] }).suggestions, [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }]);
  // The chat shows the body and the question apart.
  assert.equal(coworkReplyBody('Te dejé la secuencia.\n\n¿Creo la campaña?', '¿Creo la campaña?'), 'Te dejé la secuencia.');
  assert.equal(coworkReplyBody('Te dejé la secuencia.', '¿Creo la campaña?'), 'Te dejé la secuencia.');
  assert.equal(coworkStoredQuestion('¿Creo la campaña?'), '¿Creo la campaña?');
  assert.equal(coworkStoredQuestion('Listo.'), null);
  assert.equal(coworkStoredQuestion({ text: '¿Sí?' }), null);
});

test('a figure that does not fit its card moves the rest to its detail, cut between clauses, never inside a word', () => {
  // Seen with the real model (Plan 12, 3c): «1 respondió (33 %)» was cut at 40 characters into «1 respondió (3».
  assert.deepEqual(coworkMetricFit('6 contactos; 4 con envío; 1 respondió (33 %)', '1 de 3 contactos con envío no rebotado'),
    { value: '6 contactos; 4 con envío', detail: '1 respondió (33 %) · 1 de 3 contactos con envío no rebotado' });
  assert.deepEqual(coworkMetricFit('12 reuniones (4 más que en septiembre de 2026)', null),
    { value: '12 reuniones', detail: '(4 más que en septiembre de 2026)' });
  // No clause to split at: the value ends at a word, with an ellipsis, and goes on in the detail.
  const long = coworkMetricFit('Muy por encima del promedio de la industria regional', null);
  assert.equal(long.value, 'Muy por encima del promedio de la…');
  assert.equal(long.detail, 'industria regional');
  // What fits stays as it is, and a long detail ends at a word too.
  assert.deepEqual(coworkMetricFit('57 de 60', null), { value: '57 de 60', detail: null });
  const detail = coworkMetricFit('3', 'palabra '.repeat(30).trim()).detail!;
  assert.ok(detail.length <= 140 && detail.endsWith('…') && !/palabr…$/.test(detail));
  // Through coworkBlocks, the card shows the split figure.
  const [card] = coworkBlocks([{ type: 'metrics', title: 'Por rubro', period: null,
    items: [{ label: 'Minería', value: '6 contactos; 4 con envío; 1 respondió (33 %)', detail: null }] }]);
  assert.deepEqual(card, { type: 'metrics', title: 'Por rubro', period: null,
    items: [{ label: 'Minería', value: '6 contactos; 4 con envío', detail: '1 respondió (33 %)' }] });
});

test('blocks become cards one by one: plain text, no IDs, trimmed to what a card shows', () => {
  const id = '00000000-0000-4000-8000-000000000022';
  const blocks = coworkBlocks([
    { type: 'email_draft', title: '', to: ['Marcela Rojas', id], subject: 'Antecedentes en minutos', body: 'Hola,\nNicolás' },
    { type: 'sequence', title: 'Una sola', steps: [{ day: 0, subject: 'Único', body: 'Hola' }] },
    { type: 'table', title: 'Prioridad', columns: ['Contacto', 'ID', ''], rows: [['Felipe', id, 'x'], ['', '', ''], ['Camila', 'last_30_days', 'y', 'extra']] },
    { type: 'metrics', title: 'Semana', period: 'last_7_days', items: [{ label: 'Envíos', value: '1', detail: null }, { label: '', value: '3', detail: null }] },
    { type: 'metrics', title: 'Sobra', period: null, items: [{ label: 'Quinta', value: '5', detail: null }] },
    { type: 'nope' },
  ]);
  assert.deepEqual(blocks, [
    { type: 'email_draft', title: 'Antecedentes en minutos', to: ['Marcela Rojas'], subject: 'Antecedentes en minutos', body: 'Hola,\nNicolás' },
    // A one-email sequence reads as an email.
    { type: 'email_draft', title: 'Una sola', to: null, subject: 'Único', body: 'Hola' },
    { type: 'table', title: 'Prioridad', columns: ['Contacto', 'ID', 'Columna 3'], rows: [['Felipe', '', 'x'], ['Camila', 'últimos 30 días', 'y']] },
    { type: 'metrics', title: 'Semana', period: 'últimos 7 días', items: [{ label: 'Envíos', value: '1', detail: null }] },
  ]);
  assert.deepEqual(coworkBlocks(null), []);
  // Sequences keep their order by day and at most seven emails.
  const steps = Array.from({ length: 9 }, (_, index) => ({ day: 9 - index, subject: `Correo ${9 - index}`, body: 'Hola' }));
  const sequence = coworkBlocks([{ type: 'sequence', title: 'Larga', steps }])[0];
  assert.equal(sequence.type, 'sequence');
  if (sequence.type === 'sequence') assert.deepEqual(sequence.steps.map(step => step.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(polishCoworkAnswer({ reply: 'Listo.', document: null }).blocks, null);
});

test('options keep 2 to 5 short plain distinct answers, or none', () => {
  assert.deepEqual(coworkChoices({ multiple: true, options: ['- RR. HH. y outsourcing', '**Retail**', 'retail', '1) Transporte.', 'Seguridad [2 contactos]', 'RR. HH.'] }),
    { multiple: true, options: ['RR. HH. y outsourcing', 'Retail', 'Transporte', 'RR. HH.'] });
  // Long labels, IDs and placeholders go one by one; more than five are cut.
  assert.deepEqual(coworkChoices({ multiple: false, options: ['a'.repeat(61), 'Contacto c517a22f-d087-45ae-b450-045f2abc60e1', 'A', 'B', 'C', 'D', 'E', 'F'] }),
    { multiple: false, options: ['A', 'B', 'C', 'D', 'E'] });
  // One option is no choice, and a yes or a no is a closed question the quick replies answer.
  assert.equal(coworkChoices({ multiple: false, options: ['Retail', 'retail'] }), null);
  // «Otra industria» repeats the app's own «Otra respuesta».
  assert.deepEqual(coworkChoices({ multiple: false, options: ['Salud', 'Construcción', 'Otra industria', 'Otros'] })?.options, ['Salud', 'Construcción']);
  assert.equal(coworkChoices({ multiple: false, options: ['Sí', 'No'] }), null);
  assert.equal(coworkChoices(null), null);
  assert.equal(coworkChoices({ multiple: 'yes', options: ['A', 'B'] })?.multiple, false);
});

test('options answer the closing question: with them there are no quick replies, and without a question there are none', () => {
  const choices = { multiple: false, options: ['Minería', 'Retail'] };
  const asked = polishCoworkAnswer({ reply: 'Elige la industria y preparo la búsqueda.', document: null, question: '¿En qué industria buscamos?',
    suggestions: [{ label: 'Sí, adelante', message: 'Sí, adelante.' }], choices });
  assert.deepEqual(asked.choices, choices);
  assert.equal(asked.suggestions, null);
  assert.ok(asked.reply.endsWith('¿En qué industria buscamos?'));
  const unasked = polishCoworkAnswer({ reply: 'Listo.', document: null, question: null, choices });
  assert.equal(unasked.choices, null);
  // A question without valid options keeps its one-tap yes, as before.
  const closed = polishCoworkAnswer({ reply: 'Te dejo la lista.', document: null, question: '¿La reviso?', choices: { multiple: false, options: ['Sí', 'No'] } });
  assert.equal(closed.choices, null);
  assert.deepEqual(closed.suggestions, [COWORK_YES_CHIP]);
});

test('the page reads stored options as they came, and picking sends what the person would type', () => {
  assert.deepEqual(coworkStoredChoices({ multiple: true, options: ['RR. HH.', 'Retail', 3] }), { multiple: true, options: ['RR. HH.', 'Retail'] });
  assert.equal(coworkStoredChoices({ multiple: true, options: ['RR. HH.'] }), null);
  assert.equal(coworkStoredChoices({ options: ['A', 'B'] }), null);
  assert.equal(coworkChoiceMessage(['Minería']), 'Minería');
  assert.equal(coworkChoiceMessage(['RR. HH.', 'Retail']), 'RR. HH. y Retail');
  assert.equal(coworkChoiceMessage(['RR. HH.', 'Retail', ' solo los de Santiago ']), 'RR. HH., Retail y solo los de Santiago');
  assert.equal(coworkChoiceMessage([]), '');
});
