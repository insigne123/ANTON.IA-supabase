import assert from 'node:assert/strict';
import test from 'node:test';
import { googleCalendarUrl, markInputSchema, marksFromRows, parseReportDate, reportCalendarFile, reportChecklist, reportItemKey, reportProgress, reportRoute } from './report-marks';

test('an item keeps its key across versions of the report: case and spaces do not matter, the kind does', () => {
  const key = reportItemKey('requirement', 'Boleta de garantía de seriedad');
  assert.match(key, /^req:[a-f0-9]{16}$/);
  assert.equal(reportItemKey('requirement', '  boleta de  GARANTÍA de seriedad '), key);
  assert.notEqual(reportItemKey('task', 'Boleta de garantía de seriedad'), key);
  assert.notEqual(reportItemKey('requirement', 'Boleta de garantía de fiel cumplimiento'), key);
  assert.equal(markInputSchema.safeParse({ key, label: 'Boleta', done: true }).success, true);
  assert.equal(markInputSchema.safeParse({ key, label: 'Boleta' }).success, false, 'nothing to save');
  assert.equal(markInputSchema.safeParse({ key: 'req:../../x', label: 'Boleta', done: true }).success, false);
});

test('progress counts the next steps, the requirements and the plan once each', () => {
  const report = { requirements: [{ title: 'Anexo N.º 1' }, { title: 'Garantía' }], tasks: [{ title: 'Garantía' }, { title: 'Subir la oferta' }] } as any;
  const list = reportChecklist(report, ['Pedir la garantía al banco']);
  assert.equal(list.length, 5);
  const marks = marksFromRows([{ item_key: list[0].key, done: true, highlight: false, note: '' }, { item_key: list[2].key, done: true, highlight: true, note: 'Lo ve Ana' }]);
  assert.deepEqual(reportProgress(list, marks), { done: 2, total: 5, percent: 40 });
  assert.deepEqual(reportProgress([], {}), { done: 0, total: 0, percent: 0 });
});

test('dates as the documents write them become Chile times, with summer time', () => {
  assert.equal(parseReportDate('29-10-2026 9:00:00')?.at.toISOString(), '2026-10-29T12:00:00.000Z', 'October: summer time, UTC−3');
  assert.equal(parseReportDate('15/06/2026 15:30')?.at.toISOString(), '2026-06-15T19:30:00.000Z', 'June: UTC−4');
  assert.equal(parseReportDate('16 de octubre de 2026, 10:00')?.at.toISOString(), '2026-10-16T13:00:00.000Z');
  const dayOnly = parseReportDate('6 de noviembre de 2026');
  assert.equal(dayOnly?.at.toISOString(), '2026-11-06T12:00:00.000Z'); assert.equal(dayOnly?.hasTime, false);
  assert.equal(parseReportDate('2026-10-29T15:01:00+00:00')?.at.toISOString(), '2026-10-29T15:01:00.000Z');
  for (const unknown of ['Por confirmar', '5 días hábiles después de la adjudicación', '31-02-20', '']) assert.equal(parseReportDate(unknown), null, unknown);
});

const subject = { title: 'SERVICIO ASEO PARA DEPENDENCIAS DEL MHN', buyer: 'Servicio Nacional del Patrimonio Cultural', code: '1217466-29-LP26', kind: 'tender',
  appUrl: 'https://app.example/opportunities?op=op-1', sourceUrl: 'https://www.mercadopublico.cl/ficha?idlicitacion=1217466-29-LP26' };

test('a reminder says in the calendar which purchase it is about: its name, its ID, who buys it and where to open it', () => {
  const at = parseReportDate('22-10-2026 10:00')!.at;
  const url = new URL(googleCalendarUrl({ subject, label: 'Cierre de recepción de ofertas', date: '22 de octubre de 2026, 10:00', at, reminder: '1d' }));
  assert.equal(url.searchParams.get('text'), 'Mañana: Cierre de recepción de ofertas · SERVICIO ASEO PARA DEPENDENCIAS DEL MHN (ID 1217466-29-LP26)');
  const details = url.searchParams.get('details')!;
  assert.match(details, /^Cierre de recepción de ofertas: 22 de octubre de 2026, 10:00\n\nLicitación: SERVICIO ASEO PARA DEPENDENCIAS DEL MHN\nOrganismo: Servicio Nacional del Patrimonio Cultural\nID: 1217466-29-LP26/);
  assert.ok(details.includes('Abrir en ANTON.IA: https://app.example/opportunities?op=op-1'));
  assert.ok(details.includes('Ficha oficial: https://www.mercadopublico.cl/ficha?idlicitacion=1217466-29-LP26'));
  assert.equal(url.searchParams.get('location'), subject.sourceUrl);
  // On the day itself the event is the date, with no «Hoy» to say twice.
  assert.equal(new URL(googleCalendarUrl({ subject, label: 'Cierre de ofertas', date: 'x', at, reminder: 'same' })).searchParams.get('text'), 'Cierre de ofertas · SERVICIO ASEO PARA DEPENDENCIAS DEL MHN (ID 1217466-29-LP26)');
  assert.match(new URL(googleCalendarUrl({ subject, label: 'Cierre', date: 'x', at, reminder: '3d' })).searchParams.get('text')!, /^En 3 días: Cierre · /);
  assert.match(new URL(googleCalendarUrl({ subject, label: 'Cierre', date: 'x', at, reminder: '7d' })).searchParams.get('text')!, /^En una semana: Cierre · /);
  // Without a code or a buyer it still names the purchase, and a link that is not http(s) is not offered as a place.
  const bare = new URL(googleCalendarUrl({ subject: { title: 'Cargos en Retail Andino', sourceUrl: 'javascript:alert(1)' }, label: 'Llamar', date: 'x', at, reminder: '1d' }));
  assert.equal(bare.searchParams.get('text'), 'Mañana: Llamar · Cargos en Retail Andino');
  assert.equal(bare.searchParams.get('location'), null);
  assert.match(bare.searchParams.get('details')!, /Oportunidad: Cargos en Retail Andino/);
});

test('Google Calendar places the reminder the person chose; the calendar file carries the real date, its alert and the purchase', () => {
  const at = parseReportDate('29-10-2026 9:00')!.at;
  const url = new URL(googleCalendarUrl({ subject: { title: 'Seguridad Museo' }, label: 'Cierre de ofertas', date: '29-10-2026 9:00', at, reminder: '3d' }));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('dates'), '20261026T120000Z/20261026T123000Z');
  assert.equal(url.searchParams.get('text'), 'En 3 días: Cierre de ofertas · Seguridad Museo');
  assert.equal(url.searchParams.get('ctz'), 'America/Santiago');

  const file = reportCalendarFile({ subject: { title: 'Seguridad, Museo; Valparaíso', code: '4521-61-LE26', buyer: 'Hospital Regional' }, now: new Date('2026-10-16T00:00:00Z'), events: [
    { uid: 'date:1', label: 'Cierre de ofertas', date: '29-10-2026 9:00', at, reminder: '1d' },
    { uid: 'date:2', label: 'Fin de consultas', date: '16-10-2026 9:00', at: parseReportDate('16-10-2026 9:00')!.at, reminder: 'same' },
  ] });
  assert.match(file, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(file, /DTSTART:20261029T120000Z\r\n/);
  assert.match(file, /TRIGGER:-PT1440M\r\n/);
  assert.match(file, /TRIGGER:-PT0M\r\n/);
  assert.ok(file.replace(/\r\n /g, '').includes('SUMMARY:Cierre de ofertas · Seguridad\\, Museo\\; Valparaíso (ID 4521-61-LE26)'));
  assert.ok(file.replace(/\r\n /g, '').includes('Organismo: Hospital Regional'));
  assert.equal((file.match(/BEGIN:VEVENT/g) || []).length, 2);
  for (const line of file.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  assert.ok(file.endsWith('END:VCALENDAR\r\n'));
});

test('the route is the AI\'s own when there is one, and otherwise the plan and the dated milestones in order', () => {
  const own = reportRoute({ milestones: [], tasks: [], route: { steps: [
    { title: 'Reunir anexos', detail: 'Anexos 1 a 8', date: 'Esta semana', kind: 'prepare' },
    { title: 'Enviar consultas', detail: '', date: '16-10-2026', kind: 'ask' },
    { title: 'Subir la oferta', detail: '', date: '29-10-2026 9:00', kind: 'submit' },
  ] } });
  assert.deepEqual(own.map(s => s.title), ['Reunir anexos', 'Enviar consultas', 'Subir la oferta']);
  assert.equal(own[0].key, reportItemKey('route', 'Reunir anexos'));
  const derived = reportRoute({ tasks: [{ title: 'Pedir garantía', role: 'Finanzas', due: 'Antes del cierre', dependency: '', evidence: '' }] as any,
    milestones: [{ label: 'Cierre de ofertas', date: '29-10-2026 9:00', state: 'documented', citations: [] }, { label: 'Adjudicación', date: 'Por confirmar', state: 'unknown', citations: [] },
      { label: 'Fin de consultas', date: '16-10-2026 9:00', state: 'documented', citations: [] }, { label: 'Fecha de publicación', date: '09-10-2026', state: 'documented', citations: [] }] as any });
  assert.deepEqual(derived.map(s => [s.title, s.kind]), [['Pedir garantía', 'prepare'], ['Fin de consultas', 'ask'], ['Cierre de ofertas', 'submit'], ['Adjudicación', 'decide']]);
});
