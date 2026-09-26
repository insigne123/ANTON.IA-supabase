import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkAnswerIssues, coworkSuggestions, polishCoworkAnswer, polishCoworkText } from './answer-quality';

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
  assert.deepEqual(coworkSuggestions([
    { label: 'Sí, después', message: 'Sí, cuando guarde el contacto, prepara la campaña' },
    { label: 'Sincronizar LinkedIn', message: 'Voy a sincronizar mi LinkedIn' },
    { label: 'Ya lo guardé', message: 'Ya lo guardé, crea la campaña' },
  ]), [{ label: 'Ya lo guardé', message: 'Ya lo guardé, crea la campaña' }]);
});

test('polishing an answer keeps its clean quick replies, or null when none survive', () => {
  const answer = polishCoworkAnswer({ reply: '¿Busco su correo?', document: null,
    suggestions: [{ label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal Pa***a de Adecco' }] });
  assert.deepEqual(answer.suggestions, [{ label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal Pa***a de Adecco' }]);
  assert.equal(polishCoworkAnswer({ reply: 'Listo.', document: null }).suggestions, null);
});
