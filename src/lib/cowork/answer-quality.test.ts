import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkAnswerIssues, coworkQuestion, coworkSuggestions, polishCoworkAnswer, polishCoworkText } from './answer-quality';
import { coworkReplyBody, coworkStoredQuestion } from './contracts';

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
