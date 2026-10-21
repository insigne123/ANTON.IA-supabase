import assert from 'node:assert/strict';
import test from 'node:test';
import { buyerQuestions, consultationEmail, friendlyJobError, humanDate, opportunityReportWarnings, reportDecision, reportKeyDates, reportNextSteps } from './report-view';

const milestones = [{ label: 'Recepción de consultas', date: '20 de octubre de 2026, 17:00', state: 'documented' as const, citations: [] },
  { label: 'Cierre de recepción de ofertas', date: '28 de octubre de 2026, 15:00', state: 'documented' as const, citations: [] }];

test('dates read like a person writes them, in Chile time', () => {
  assert.equal(humanDate('2026-10-28T18:00:00Z', true), '28 de octubre de 2026, 15:00');
  assert.equal(humanDate('2026-10-15T00:47:51.040Z'), '14 de octubre de 2026');
  assert.equal(humanDate(null), null);
});

test('the decision speaks the language of each opportunity: postular for a tender, contactar for a LinkedIn signal', () => {
  assert.equal(reportDecision({ recommendation: 'conditional', kind: 'tender' }).label, 'Postular si se resuelve lo pendiente');
  assert.equal(reportDecision({ recommendation: 'advance', kind: 'hiring' }).label, 'Contactar ahora');
  assert.equal(reportDecision({ recommendation: 'do_not_advance' }).tone, 'no');
});

test('what to do now comes from the report, or from its plan for reports made before', () => {
  assert.deepEqual(reportNextSteps({ nextSteps: ['Enviar consultas'], tasks: [], requirements: [] }), ['Enviar consultas']);
  const tasks = ['a', 'b', 'c', 'd'].map(t => ({ title: `Paso ${t}`, role: '', due: t === 'a' ? 'antes del 20 de octubre' : '', dependency: '', evidence: '' }));
  assert.deepEqual(reportNextSteps({ tasks, requirements: [] }), ['Paso a (antes del 20 de octubre)', 'Paso b', 'Paso c']);
});

test('key dates: the questions deadline from the milestones and the closing from the opportunity, then the milestones', () => {
  assert.deepEqual(reportKeyDates({ milestones }, '2026-10-28T18:00:00Z'), { questions: '20 de octubre de 2026, 17:00', closes: '28 de octubre de 2026, 15:00' });
  assert.deepEqual(reportKeyDates({ milestones }, null).closes, '28 de octubre de 2026, 15:00');
  assert.deepEqual(reportKeyDates({ milestones: [] }), { questions: null, closes: null });
  const asked = [{ label: 'Cierre de consultas', date: '20 de octubre de 2026, 17:00', state: 'documented' as const, citations: [] },
    { label: 'Publicación de respuestas a consultas', date: '23 de octubre de 2026', state: 'documented' as const, citations: [] }, milestones[1]];
  assert.deepEqual(reportKeyDates({ milestones: asked }), { questions: '20 de octubre de 2026, 17:00', closes: '28 de octubre de 2026, 15:00' },
    'the questions deadline is never the closing, and the answers date is not the questions deadline');
});

test('the questions become a ready-to-send consultation e-mail with the deadline', () => {
  const email = consultationEmail({ title: 'x', milestones, questions: ['¿Cuál es el cierre?', '¿Se exige ISO 27001?'] }, { title: 'Licitación SIA-2026-14', buyer: 'Seguridad Integral Andes' });
  assert.match(email, /^Asunto: Consultas · Licitación SIA-2026-14/);
  assert.match(email, /Estimados de Seguridad Integral Andes:/);
  assert.match(email, /\(20 de octubre de 2026, 17:00\)/);
  assert.match(email, /1\. ¿Cuál es el cierre\?\n2\. ¿Se exige ISO 27001\?/);
});

test('warnings: missing bases first, unreadable documents explained, system notes and «null» never reach the person', () => {
  const warnings = opportunityReportWarnings(
    ['La investigación web del cliente no está conectada con una tarifa confirmada.', 'Fecha límite figura como null en la ficha.', 'Fechas de cierre contradictorias.'],
    [{ name: 'Bases.pdf', extraction_status: 'read' }, { name: 'Anexo escaneado.pdf', extraction_status: 'scan' }], true);
  assert.match(warnings[0], /^Faltan las bases y anexos de Mercado Público/);
  assert.match(warnings[1], /«Anexo escaneado\.pdf» es una imagen o un escaneo que la IA no alcanzó a leer/);
  assert.ok(!warnings.some(w => /tarifa confirmada|\bnull\b/.test(w)));
  assert.ok(warnings.includes('Fecha límite figura como sin dato en la ficha.'));
  assert.equal(opportunityReportWarnings([], [], false).length, 0);
  assert.deepEqual(opportunityReportWarnings(['No se pudo leer el contenido de una fuente pública; el análisis del cliente es parcial.', 'Una fuente pública no pudo leerse.',
    'Falta identificar al cliente para la investigación pública.'], [], false), ['No se pudo leer el contenido de una fuente pública; el análisis del cliente es parcial.'],
    'the same note said twice reaches the person once, and a system note about the research never does');
});

test('a failed report explains what happened and what to do, never the internal accounting', () => {
  assert.equal(friendlyJobError('La evaluación no terminó. Conservamos los datos y el consumo observado.'), 'Tardó más de lo esperado. Vuelve a intentarlo: suele resolverse al segundo intento.');
  assert.match(friendlyJobError('Se alcanzó el presupuesto disponible para este trabajo.'), /gasto permitido para un informe o para el mes/);
  assert.match(friendlyJobError('El expediente recibió documentos nuevos. Solicita un análisis actualizado.'), /cambió mientras se preparaba/);
  assert.equal(friendlyJobError('Faltan documentos legibles para investigar. Adjunta las bases o la invitación.'), 'Faltan documentos legibles para investigar. Adjunta las bases o la invitación.');
  assert.equal(friendlyJobError(null), 'Intenta de nuevo en un momento.');
});

test('everything to ask the buyer is one list: the report\'s questions and the contradictions of the bases, without repeating what says the same', () => {
  const report = { questions: ['¿Se acepta una póliza de seguro en vez de la boleta de garantía?', '¿Cuál es la hora de cierre de recepción de ofertas?'],
    submission: { inconsistencies: [
      { question: '¿Cuál es la hora exacta de cierre de la recepción de ofertas: la del portal o la de las bases?' },
      { question: '¿Es obligatorio marcar al menos un servicio adicional en el Anexo N°11?' },
      { question: '¿Se acepta una póliza de seguro en vez de la boleta de garantía?' },
    ] } };
  assert.deepEqual(buyerQuestions(report), [
    '¿Se acepta una póliza de seguro en vez de la boleta de garantía?',
    '¿Cuál es la hora de cierre de recepción de ofertas?',
    '¿Es obligatorio marcar al menos un servicio adicional en el Anexo N°11?',
  ], 'the same question and the one with the same words in a longer sentence are asked once');
  assert.deepEqual(buyerQuestions({ questions: ['¿A qué hora cierra?'], submission: null }), ['¿A qué hora cierra?']);
  assert.deepEqual(buyerQuestions({ questions: [] }), []);
  assert.deepEqual(buyerQuestions({ questions: ['  ', '¿Cuántas personas?'] }), ['¿Cuántas personas?']);
  // The email of consultations carries them all, numbered.
  const email = consultationEmail({ ...report, title: 'Aseo', milestones: [] }, { title: 'Aseo MHN', buyer: 'Museo' });
  assert.match(email, /1\. ¿Se acepta una póliza[^\n]*\n2\. ¿Cuál es la hora de cierre de recepción de ofertas\?\n3\. ¿Es obligatorio marcar/);
});
