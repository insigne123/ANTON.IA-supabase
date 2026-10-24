import assert from 'node:assert/strict';
import test from 'node:test';

import { alertDay, alertEmail, closingText, composeAlert, dayWord, waitingText, type AlertFacts, documentDue } from './daily-alerts';
import { DEFAULT_GOALS } from './weekly-goals';

// Chile is UTC−3 in October: 12:00Z is 09:00 there.
const TUESDAY = new Date('2026-10-20T12:00:00.000Z');
const WEDNESDAY = new Date('2026-10-21T12:00:00.000Z');
const facts = (extra: Partial<AlertFacts> = {}): AlertFacts => ({
  name: 'Ana', newReplies: [], olderPending: 0, commitments: [], newReady: { count: 0, yesterday: false }, ready: 0, research: [], closing: [],
  goal: { targets: DEFAULT_GOALS, counts: { contacted: 0, found: 0 }, source: 'default' }, ...extra,
});

test('alerts go from Tuesday to Friday, in Chile', () => {
  assert.equal(alertDay(new Date('2026-10-19T12:00:00.000Z')), false); // Monday: the weekly report
  assert.equal(alertDay(TUESDAY), true);
  assert.equal(alertDay(new Date('2026-10-23T12:00:00.000Z')), true);
  assert.equal(alertDay(new Date('2026-10-24T12:00:00.000Z')), false);
  // Tuesday 00:30 in Chile is still Monday 03:30Z: the day is Chile's.
  assert.equal(alertDay(new Date('2026-10-21T02:30:00.000Z')), true);
});

test('days are said the way a person says them', () => {
  assert.equal(dayWord('2026-10-20T20:00:00.000Z', TUESDAY), 'hoy');
  assert.equal(dayWord('2026-10-21T20:00:00.000Z', TUESDAY), 'mañana');
  assert.equal(dayWord('2026-10-23T20:00:00.000Z', TUESDAY), 'el viernes');
  assert.equal(dayWord('2026-10-26T20:00:00.000Z', TUESDAY), 'el lunes', 'within the week the weekday is enough');
  assert.equal(dayWord('2026-10-27T20:00:00.000Z', TUESDAY), 'el martes 27', 'a week ahead says its date, or «el martes» reads as today');
});

test('opportunities closing are named by kind and by why they matter', () => {
  const tender = (id: string, at: string, extra = {}) => ({ id, kind: 'tender', title: `Licitación ${id}`, deadlineAt: at, recommended: true, mine: false, ...extra });
  assert.equal(closingText([tender('a', '2026-10-23T18:00:00Z'), tender('b', '2026-10-23T19:00:00Z')], TUESDAY), '2 licitaciones que te sirven cierran el viernes');
  assert.equal(closingText([tender('a', '2026-10-21T18:00:00Z', { mine: true })], TUESDAY), 'Una licitación a tu cargo cierra mañana: Licitación a');
  assert.equal(closingText([tender('a', '2026-10-21T18:00:00Z'), { ...tender('b', '2026-10-22T18:00:00Z'), kind: 'compra_agil', recommended: false }], TUESDAY),
    '2 oportunidades cierran en los próximos días');
});

test('nothing concrete to do is no alert', () => {
  assert.equal(composeAlert(facts(), TUESDAY), null);
  // A goal that is behind is not enough on Tuesday…
  assert.equal(composeAlert(facts({ olderPending: 3 }), TUESDAY), null);
  // …and old replies alone do not start one either.
  assert.equal(composeAlert(facts({ olderPending: 3, goal: null }), WEDNESDAY), null);
});

test('a reply names the person in the subject and links to the conversation', () => {
  const alert = composeAlert(facts({ newReplies: [{ id: 'c-1', name: 'Juan Pérez', company: 'Retail Sur' }], olderPending: 2 }), TUESDAY)!;
  assert.equal(alert.subject, 'Te respondió Juan Pérez');
  assert.deepEqual(alert.lines.map(line => line.kind), ['reply', 'pending', 'goal']);
  assert.deepEqual(alert.lines[0], { kind: 'reply', text: 'Juan Pérez (Retail Sur) te respondió', href: '/contacted?c=c-1' });
  assert.equal(alert.lines[1].text, 'Te esperan 2 respuestas de días anteriores');
  assert.equal(alert.lines[2].text, 'Meta de la semana: 0 de 10 personas contactadas · 0 de 15 contactos nuevos con correo. Busca contactos nuevos');
  const many = composeAlert(facts({ newReplies: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: `Persona ${id}`, company: null })) }), TUESDAY)!;
  assert.equal(many.subject, 'Te respondieron Persona a y 4 personas más');
  assert.equal(many.lines.filter(line => line.kind === 'reply').length, 4);
  assert.equal(many.lines[3].text, 'Y 2 respuestas más');
});

test('commitments, research and new contacts lead in that order', () => {
  const alert = composeAlert(facts({
    commitments: [{ id: 'k1', name: 'Rosa Díaz', company: 'Logística Norte', title: 'Enviar propuesta', dueAt: '2026-10-19T13:00:00Z' }],
    research: [{ leadId: 'lead-1', name: 'Pedro Rojas' }],
    newReady: { count: 12, yesterday: true }, ready: 12,
  }), TUESDAY)!;
  assert.equal(alert.subject, 'Vencido: Enviar propuesta con Rosa Díaz (Logística Norte)');
  assert.deepEqual(alert.lines.map(line => line.kind), ['commitment', 'research', 'ready', 'goal']);
  assert.deepEqual(alert.lines[1], { kind: 'research', text: 'Lista la investigación de Pedro Rojas', href: '/saved/leads/enriched?investigar=lead-1' });
  assert.equal(alert.lines[2].text, 'Los 12 contactos que guardaste ayer ya tienen correo: escríbeles desde «Por escribir»');
  assert.equal(alert.lines[3].href, '/saved/leads/enriched');
  const ready = composeAlert(facts({ newReady: { count: 1, yesterday: false } }), TUESDAY)!;
  assert.equal(ready.subject, 'El contacto que guardaste ya tiene correo');
  assert.equal(ready.lines[0].text, 'El contacto que guardaste ya tiene correo: escríbele desde «Por escribir»');
});

test('the contacts you saved are never worded as the contact of the day (Rodrigo read «Tus 3 contactos» and looked for three)', () => {
  const item = { leadId: 'lf_1', name: 'Enrique Ruiz', title: 'Gerente de Personas', company: 'Gou', domain: 'gou.cl', industry: null, size: null, city: 'Santiago', hasEmail: true, hasPhone: false,
    why: 'Calza con tu cliente ideal por su cargo.', research: [], draft: null, savedLeadId: null };
  const drop = { id: 'd-1', items: [item] };
  const alert = composeAlert(facts({ newReady: { count: 3, yesterday: true }, ready: 3, drop }), WEDNESDAY)!;
  const email = alertEmail(alert, 'Rodrigo', 'https://app.antonia.ai/', drop);
  assert.match(email.text, /Los 3 contactos que guardaste ayer ya tienen correo/);
  assert.match(email.text, /Tu contacto de hoy, con su correo listo/);
  for (const copy of [alert.subject, ...alert.lines.map(line => line.text), email.text, email.html]) assert.doesNotMatch(copy, /Tus 3 contactos/);
});

test('a goal that is behind is reason enough on Wednesdays and Fridays, in one workspace only', () => {
  const alert = composeAlert(facts(), WEDNESDAY)!;
  assert.equal(alert.subject, 'Vas 0 de 10 en tu meta de la semana');
  assert.deepEqual(alert.lines.map(line => line.kind), ['goal']);
  assert.equal(composeAlert(facts(), WEDNESDAY, { goalReminders: false }), null);
  assert.equal(composeAlert(facts({ goal: { targets: DEFAULT_GOALS, counts: { contacted: 4, found: 6 }, source: 'team' } }), WEDNESDAY), null);
  assert.equal(composeAlert(facts({ goal: { targets: { contacted: 0, found: 0 }, counts: { contacted: 0, found: 0 }, source: 'team' } }), WEDNESDAY), null);
});

test('the email lists each line as a link and escapes what people wrote', () => {
  const alert = composeAlert(facts({ newReplies: [{ id: 'c-1', name: 'Ana <b>', company: null }] }), TUESDAY)!;
  const email = alertEmail(alert, 'Ana', 'https://app.antonia.ai/');
  assert.equal(email.subject, 'Te respondió Ana <b>');
  assert.match(email.text, /^Hola, Ana\. Esto te espera hoy en ANTON\.IA:/);
  assert.match(email.text, /- Ana <b> te respondió \(https:\/\/app\.antonia\.ai\/contacted\?c=c-1\)/);
  assert.match(email.html, /Ana &lt;b&gt; te respondió/);
  assert.doesNotMatch(email.html, /Ana <b>/);
  assert.match(email.html, /href="https:\/\/app\.antonia\.ai\/dashboard\?vista=semana"/);
});

test('with today\'s contact the email has one block and one main button; without it, the usual button', () => {
  const item = { leadId: 'lf_1', name: 'Ramiro Páez', title: 'Jefe de Reclutamiento', company: 'Logística S.A.', domain: null, industry: null, size: null, city: null, hasEmail: true, hasPhone: false,
    why: 'Calza con tu cliente ideal por su cargo.', research: [], draft: null, savedLeadId: null };
  const drop = { id: 'd-1', items: [item] };
  // Replies and the contact: the list keeps what is not the contact; the contact has its block and its button.
  const mixed = composeAlert(facts({ newReplies: [{ id: 'c-1', name: 'Ana', company: null }], drop }), TUESDAY)!;
  assert.ok(mixed.lines.some(line => line.kind === 'drop'), 'the alert itself still counts it');
  const email = alertEmail(mixed, 'Ana', 'https://app.antonia.ai/', drop);
  assert.equal([...email.html.matchAll(/Tu contacto de hoy, con su correo listo/g)].length, 1, 'said once, not as a line and again as a heading');
  assert.match(email.html, /Ana te respondió/);
  assert.match(email.html, />Ver y guardar</);
  assert.doesNotMatch(email.html, /background:#111827[^>]*>Abrir ANTON\.IA</, 'no second button');
  assert.match(email.html, />Abrir ANTON\.IA &rsaquo;</);
  assert.match(email.html, /^<div style="background:#ffffff;color:#111827;color-scheme:light/, 'on a white card of its own, readable in a dark mail client');
  assert.doesNotMatch(email.text, /guárdalo sin gastar créditos \(/);
  // The contact alone: the greeting says it, and there is no list or heading.
  const alone = composeAlert(facts({ drop, goal: null }), TUESDAY)!;
  const only = alertEmail(alone, 'Ana', 'https://app.antonia.ai/', drop);
  assert.match(only.html, /Tu contacto del día ya está listo\./);
  assert.doesNotMatch(only.html, /border-top:1px solid #e5e7eb;font-size:15px|Contacto del día<\/h2>/);
  assert.match(only.text, /^Hola, Ana\. Tu contacto del día ya está listo\./);
  // No contact: the usual dark button, and still the white card.
  const plain = alertEmail(composeAlert(facts({ newReplies: [{ id: 'c-1', name: 'Ana', company: null }] }), TUESDAY)!, 'Ana', 'https://app.antonia.ai/');
  assert.match(plain.html, /background:#111827[^>]*>Abrir ANTON\.IA</);
  assert.match(plain.html, /^<div style="background:#ffffff/);
});

test('what waits for an administrator on Oportunidades leads, with who asked, and says how long it has waited or when it is needed', () => {
  const ask = { id: 'o1', title: 'Aseo Hospital Regional', kind: 'ask' as const, who: 'Diego', since: '2026-10-16T15:00:00Z', dueAt: null };
  assert.equal(waitingText(ask, TUESDAY), 'Diego pide una decisión: Aseo Hospital Regional · espera hace 3 días');
  assert.equal(waitingText({ ...ask, since: '2026-10-20T10:00:00Z' }, TUESDAY), 'Diego pide una decisión: Aseo Hospital Regional', 'asked today: no age to say');
  assert.equal(waitingText({ ...ask, dueAt: '2026-10-21T15:00:00Z' }, TUESDAY), 'Diego pide una decisión: Aseo Hospital Regional · la piden para mañana');
  assert.equal(waitingText({ ...ask, dueAt: '2026-10-19T15:00:00Z' }, TUESDAY), 'Diego pide una decisión: Aseo Hospital Regional · la fecha pedida ya pasó');
  assert.equal(waitingText({ ...ask, kind: 'no_go' }, TUESDAY), 'Diego propone no postular: Aseo Hospital Regional · espera hace 3 días');
  assert.equal(waitingText({ ...ask, kind: 'blocked', who: 'Alguien del equipo' }, TUESDAY), 'Bloqueada: Aseo Hospital Regional · espera hace 3 días');
  const alert = composeAlert(facts({ waiting: [ask, { ...ask, id: 'o2', kind: 'blocked' }, { ...ask, id: 'o3' }, { ...ask, id: 'o4' }] }), TUESDAY)!;
  assert.equal(alert.subject, 'Diego pide una decisión: Aseo Hospital Regional');
  assert.deepEqual(alert.lines.filter(line => line.kind === 'decision').map(line => [line.text.split(' · ')[0], line.href]), [
    ['Diego pide una decisión: Aseo Hospital Regional', '/opportunities?op=o1'], ['Bloqueada: Aseo Hospital Regional', '/opportunities?op=o2'],
    ['Y 2 oportunidades más esperan tu respuesta', '/opportunities']]);
});

test('an opportunity assigned or a report ready on one of yours is reason enough for the alert, after the replies', () => {
  const one = composeAlert(facts({ assigned: [{ id: 'o1', title: 'Guardias Puerto Montt' }] }), TUESDAY)!;
  assert.equal(one.subject, 'Te asignaron: Guardias Puerto Montt');
  assert.deepEqual(one.lines[0], { kind: 'assigned', text: 'Te asignaron: Guardias Puerto Montt', href: '/opportunities?op=o1' });
  const both = composeAlert(facts({ newReplies: [{ id: 'c-1', name: 'Juan Pérez', company: null }], assigned: [{ id: 'o1', title: 'A' }, { id: 'o2', title: 'B' }], reports: [{ id: 'o3', title: 'Aseo' }] }), TUESDAY)!;
  assert.equal(both.subject, 'Te respondió Juan Pérez');
  assert.deepEqual(both.lines.map(line => line.kind), ['reply', 'assigned', 'report', 'goal']);
  assert.equal(both.lines[1].text, 'Te asignaron 2 oportunidades');
  assert.equal(both.lines[2].text, 'Listo el informe de Aseo');
});

test('a source of the search that failed two days in a row reaches whoever manages Oportunidades', () => {
  const facts: AlertFacts = { name: 'Camila', newReplies: [], olderPending: 0, commitments: [], newReady: { count: 0, yesterday: false }, ready: 0, research: [], closing: [], goal: null,
    sources: [{ label: 'Compra Ágil', days: 2 }] };
  const alert = composeAlert(facts, TUESDAY)!;
  assert.equal(alert.subject, 'La búsqueda de Compra Ágil falló 2 días seguidos');
  assert.deepEqual(alert.lines, [{ kind: 'source', text: 'La búsqueda de Compra Ágil falló 2 días seguidos', href: '/opportunities' }]);
});

test('a document of the company is told two weeks before, a week before, the day before, the day itself and once after it lapsed; never every day', () => {
  const told = (gap: number) => Array.from({ length: 22 }, (_, index) => 16 - index).filter(daysLeft => documentDue(daysLeft, gap));
  assert.deepEqual(told(1), [15, 7, 1, 0, -1]);
  // On Tuesday the last alert was on Friday: what crossed over the weekend or on Monday is told once, on Tuesday.
  assert.ok(documentDue(5, 4), 'a week ahead fell on Saturday');
  assert.ok(!documentDue(11, 4), 'no day crossed since Friday');
  assert.ok(documentDue(-3, 4), 'it lapsed on Saturday');
  const alert = composeAlert(facts({ goal: null, documents: [{ label: 'Certificado F30', daysLeft: 7 }, { label: 'Certificado F30-1', daysLeft: -1 }] }), TUESDAY)!;
  assert.deepEqual(alert.lines.map(line => [line.kind, line.text]), [['document', 'Certificado F30 vence en 7 días'], ['document', 'Venció Certificado F30-1: renuévalo antes de la próxima postulación']]);
});

test('what is new in a saved search reaches whoever asked to hear of it, with the list of its filters', () => {
  const alert = composeAlert(facts({ goal: null, searches: [{ name: '“guardias” · Seguridad', count: 3, href: '/opportunities?vista=lista&q=guardias&rubro=seguridad' }] }), TUESDAY)!;
  assert.equal(alert.subject, '3 nuevas en tu búsqueda «“guardias” · Seguridad»');
  assert.deepEqual(alert.lines, [{ kind: 'search', text: '3 nuevas en tu búsqueda «“guardias” · Seguridad»', href: '/opportunities?vista=lista&q=guardias&rubro=seguridad' }]);
});
