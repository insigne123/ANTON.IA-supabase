import assert from 'node:assert/strict';
import test from 'node:test';
import { reportChanges } from './report-changes';
import { composeUrl, MAILTO_MAX } from '../mail-compose';
import { consultationDraft, consultationEmail } from './report-view';

const base = {
  title: 'Aseo', executive: '', recommendation: 'conditional', reasons: [], sections: [], tasks: [], scenarios: [], warnings: [], generatedAt: '2026-10-20T12:00:00Z', sources: [],
  requirements: [{ title: 'Garantía de seriedad', status: 'pending', evidence: [], action: '', role: '', due: '' }],
  milestones: [{ label: 'Cierre de recepción de ofertas', date: '30-10-2026 15:00', state: 'documented', citations: [] }, { label: 'Cierre de consultas', date: '24-10-2026 15:00', state: 'documented', citations: [] }],
  risks: [{ title: 'Multas por atraso', impact: 'medium', basis: 'documented', mitigation: '', citations: [] }],
  questions: ['¿Se acepta póliza electrónica?'],
  coverage: [{ id: 'd1', name: 'Bases administrativas.pdf', status: 'read', pagesRead: 20, pagesTotal: 20 }, { id: 'd2', name: 'Aclaraciones del foro.pdf', status: 'partial', pagesRead: 12, pagesTotal: 24 }],
} as any;
const version = (created_at: string, report: any) => ({ created_at, report });

test('the new version says what moved: the decision, documents, dates, requirements, questions and serious risks', () => {
  const latest = {
    ...base, recommendation: 'advance',
    coverage: [...base.coverage.slice(0, 1), { ...base.coverage[1], status: 'read', pagesRead: 24 }, { id: 'd3', name: 'Anexo 4.docx', status: 'read', pagesRead: 3, pagesTotal: 3 }],
    // The same close written another way is not news; the questions moved a day.
    milestones: [{ ...base.milestones[0], date: '30 de octubre de 2026, 15:00' }, { ...base.milestones[1], date: '25-10-2026 15:00' }],
    requirements: [...base.requirements, { title: 'Certificado de vigencia', status: 'pending', evidence: [], action: '', role: '', due: '' }],
    questions: ['¿Se acepta  póliza electrónica?', '¿Hay visita a terreno?'],
    risks: [...base.risks, { title: 'Boleta de garantía por el 10 %', impact: 'high', basis: 'documented', mitigation: '', citations: [] }],
  };
  const { since, lines } = reportChanges(version('2026-10-22T12:00:00Z', base), version('2026-10-24T12:00:00Z', latest));
  assert.equal(since, '22 de octubre de 2026');
  assert.deepEqual(lines, [
    'La recomendación cambió: de «Postular si se resuelve lo pendiente» a «Postular».',
    'Leyó un documento nuevo: «Anexo 4.docx».',
    'Terminó de leer «Aclaraciones del foro.pdf».',
    'Las consultas cierran ahora 25-10-2026 15:00 (antes 24-10-2026 15:00).',
    'Un requisito nuevo: «Certificado de vigencia».',
  ], 'five lines at most, in that order');
});

test('nothing that matters moved, nothing to say; and the rest of the lines when the decision held', () => {
  assert.deepEqual(reportChanges(version('2026-10-22T12:00:00Z', base), version('2026-10-24T12:00:00Z', { ...base, executive: 'Otro texto' })).lines, []);
  const latest = { ...base, questions: [...base.questions, 'a', 'b'], risks: [...base.risks, { title: 'Garantía alta', impact: 'high' }, { title: 'Otro', impact: 'low' }] };
  assert.deepEqual(reportChanges(version('2026-10-22T12:00:00Z', base), version('2026-10-24T12:00:00Z', latest)).lines,
    ['2 preguntas nuevas para el comprador.', 'Un riesgo nuevo de impacto alto: «Garantía alta».']);
});

test('the questions open written in the person\'s mail: Gmail or Outlook when connected, the computer\'s mail program otherwise', () => {
  const draft = consultationDraft(base, { title: 'Aseo del museo', buyer: 'Museo Histórico' });
  assert.equal(draft.subject, 'Consultas · Aseo del museo');
  assert.match(draft.body, /^Estimados de Museo Histórico:\n\nJunto con saludar, y dentro del plazo de consultas \(24-10-2026 15:00\)/);
  assert.equal(consultationEmail(base, { title: 'Aseo del museo' }).split('\n')[0], 'Asunto: Consultas · Aseo del museo', 'what is copied keeps its subject line');
  const gmail = new URL(composeUrl('google', draft)!);
  assert.deepEqual([gmail.origin, gmail.searchParams.get('view'), gmail.searchParams.get('su'), gmail.searchParams.get('body')], ['https://mail.google.com', 'cm', draft.subject, draft.body]);
  const outlook = new URL(composeUrl('outlook', { ...draft, to: 'compras@museo.cl' })!);
  assert.deepEqual([outlook.origin + outlook.pathname, outlook.searchParams.get('to'), outlook.searchParams.get('subject')], ['https://outlook.office.com/mail/deeplink/compose', 'compras@museo.cl', draft.subject]);
  assert.match(composeUrl(null, draft)!, /^mailto:\?subject=Consultas%20%C2%B7%20Aseo%20del%20museo&body=Estimados%20de/);
  assert.equal(composeUrl(null, { subject: 'x', body: 'y'.repeat(MAILTO_MAX) }), null, 'too long for a mail program: it is copied instead');
});
