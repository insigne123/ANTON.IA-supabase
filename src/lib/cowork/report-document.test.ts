import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_REPORTS_TITLE, coworkReportsDocument, withCoworkReports } from './report-document';

const RAFAEL = '00000000-0000-4000-8000-0000000000a1';
const SUSANA = '00000000-0000-4000-8000-0000000000b1';
const NADIE = '00000000-0000-4000-8000-0000000000c1';
const section = (key: string, title: string, text: string) => ({ key, title, text });
const read = (leadId: string, sections: unknown[], report: Record<string, unknown> = {}) => ({
  action: 'research.get_existing',
  result: { leadId, availability: 'available', reportStatus: 'ready', report: { status: 'completed', sections, caveats: [], truncated: false, ...report }, research: {} },
});
const rafael = read(RAFAEL, [
  section('verdict', 'Resumen y decisión', 'Vale la pena escribirle: RyD Montajes abrió dos obras.'),
  section('angle', 'Cómo usarlo en el correo y los seguimientos', 'Ángulo 1: la contratación de la temporada.\n\nIdea de primer correo: asunto «antecedentes para la temporada».'),
], { caveats: ['No se confirmó su cargo actual.'] });
const susana = read(SUSANA, [section('verdict', 'Resumen y decisión', 'MSTI trabaja en servicios eléctricos.')], { truncated: true });

test('the document carries each named report as written, in the order asked, with its caveats', () => {
  const document = coworkReportsDocument(
    [{ leadId: SUSANA, title: 'Susana Cáceres · MSTI' }, { leadId: RAFAEL, title: 'Rafael Durán · RyD Montajes' }, { leadId: SUSANA, title: 'otra vez' }],
    [rafael, susana, { action: 'leads.search', result: { items: [] } }]);
  assert.ok(document);
  assert.equal(document.included, 2);
  assert.ok(document.content.indexOf('## Susana Cáceres · MSTI') < document.content.indexOf('## Rafael Durán · RyD Montajes'));
  assert.match(document.content, /### Cómo usarlo en el correo y los seguimientos\n\nÁngulo 1: la contratación de la temporada\.\n\nIdea de primer correo/);
  assert.match(document.content, /\*\*Lo que no se pudo confirmar:\*\* No se confirmó su cargo actual\./);
  assert.match(document.content, /Este informe se acortó para la conversación/, 'a report cut for the conversation says so');
  assert.doesNotMatch(document.content, /otra vez/, 'the same person goes once');
});

test('a report not read in this turn is named apart, never written; with none read the answer stays as the model wrote it', () => {
  const document = coworkReportsDocument([{ leadId: RAFAEL, title: 'Rafael Durán · RyD Montajes' }, { leadId: NADIE, title: 'Ana Pérez · Acme' }], [rafael]);
  assert.ok(document);
  assert.deepEqual(document.missing, ['Ana Pérez · Acme']);
  assert.match(document.content, /No van aquí: Ana Pérez · Acme\. Pídemelos aparte\./);
  assert.equal(coworkReportsDocument([{ leadId: NADIE, title: 'Ana Pérez · Acme' }], [rafael]), null);
  const withoutReport = { action: 'research.get_existing', result: { leadId: RAFAEL, availability: 'available', reportStatus: 'writing', report: null } };
  const answer = { reply: 'Aún se escribe el informe.', document: null, reports: [{ leadId: RAFAEL, title: 'Rafael Durán · RyD Montajes' }] };
  assert.deepEqual(withCoworkReports(answer, [withoutReport]), { reply: 'Aún se escribe el informe.', document: null });
});

test('a report that does not fit is named apart instead of cut', () => {
  const long = (leadId: string) => read(leadId, [section('company', 'La empresa', 'x'.repeat(20_000))]);
  const document = coworkReportsDocument([{ leadId: RAFAEL, title: 'Rafael' }, { leadId: SUSANA, title: 'Susana' }], [long(RAFAEL), long(SUSANA)]);
  assert.ok(document);
  assert.equal(document.included, 1);
  assert.deepEqual(document.missing, ['Susana']);
  assert.ok(document.content.length < 40_000);
});

test('the answer gets the document the app writes, after one the model wrote, and never keeps the request', () => {
  const none = null as { title: string; content: string } | null;
  const plain = withCoworkReports({ reply: 'Te dejo los dos informes.', document: none, reports: [{ leadId: RAFAEL, title: 'Rafael Durán · RyD Montajes' }] }, [rafael]);
  assert.equal(plain.document?.title, COWORK_REPORTS_TITLE);
  assert.match(plain.document?.content || '', /^## Rafael Durán · RyD Montajes\n\n### Resumen y decisión/);
  assert.equal('reports' in plain, false);
  const both = withCoworkReports({ reply: 'Listo.', document: { title: 'Plan de contacto', content: '## Próximos pasos\n\nEscribirle el lunes.' },
    reports: [{ leadId: RAFAEL, title: 'Rafael Durán · RyD Montajes' }] }, [rafael]);
  assert.equal(both.document?.title, 'Plan de contacto');
  assert.match(both.document?.content || '', /^## Próximos pasos\n\nEscribirle el lunes\.\n\n## Rafael Durán · RyD Montajes/);
  assert.deepEqual(withCoworkReports({ reply: 'Hola.', document: null }, [rafael]), { reply: 'Hola.', document: null });
});
