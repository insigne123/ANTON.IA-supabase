import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreditDay, UsageFact } from '@/lib/admin/usage';
import { buildRealConversations, conversationSignals, redactPersonalData, renderRealUsageReport, replySimilarity, sectionHealth, type RealEvent, type RealRun } from './core';

test('emails, RUTs and phones leave before anything is graded; names and amounts stay', () => {
  const out = redactPersonalData('Escríbele a ana.perez@acme.cl (RUT 12.345.678-9, cel +56 9 8765 4321 o 9 1234 5678) por los 120 postulantes de 2026');
  assert.equal(out, 'Escríbele a [correo] (RUT [RUT], cel [teléfono] o [teléfono]) por los 120 postulantes de 2026');
});

const run = (id: string, at: string, message: string, extra: Partial<RealRun> = {}): RealRun =>
  ({ id, userId: 'u1', organizationId: 'o1', message, status: 'completed', createdAt: at, parentRunId: null, rootRunId: null, automatic: false, ...extra });
const event = (runId: string, kind: string, at: string, payload: unknown = {}): RealEvent => ({ runId, kind, createdAt: at, payload });

test('a conversation is its root run and the turns that follow it, each with what the person saw', () => {
  const runs = [
    run('r1', '2026-10-16T10:00:00Z', 'escríbele a ana@acme.cl'),
    run('r2', '2026-10-16T10:02:00Z', 'sí, déjalo listo', { rootRunId: 'r1', parentRunId: 'r1' }),
    run('r3', '2026-10-16T11:00:00Z', 'hola'),
  ];
  const events = [
    event('r1', 'tool.completed', '2026-10-16T10:00:05Z', { action: 'leads.search', result: { count: 1, email: 'ana@acme.cl' } }),
    event('r1', 'run.completed', '2026-10-16T10:00:20Z', { reply: 'Preparé el correo para ana@acme.cl.', document: { title: 'Correo para Ana' } }),
    event('r2', 'approval.requested', '2026-10-16T10:02:05Z', { label: 'Enviar a Ana' }),
    event('r2', 'run.completed', '2026-10-16T10:02:10Z', { reply: 'Te dejo el envío para aprobar.' }),
    event('r3', 'run.failed', '2026-10-16T11:01:30Z', { message: 'timeout' }),
  ];
  const [first, second] = buildRealConversations(runs, events);
  assert.equal(first.turns.length, 2);
  assert.equal(first.turns[0].request, 'escríbele a [correo]');
  assert.equal(first.turns[0].reply, 'Preparé el correo para [correo].');
  assert.equal(first.turns[0].document, 'Correo para Ana');
  assert.equal(first.turns[0].seconds, 20);
  assert.deepEqual(first.turns[0].observations, [{ action: 'leads.search', result: { count: 1, email: '[correo]' } }]);
  assert.equal(first.turns[0].answer?.reply, 'Preparé el correo para [correo].');
  assert.deepEqual(first.turns[1].approvals, ['Enviar a Ana']);
  assert.deepEqual(conversationSignals(first), ['aprobacion_sin_respuesta']);
  assert.equal(second.turns[0].failed, 'timeout');
  assert.deepEqual(conversationSignals(second).sort(), ['fallo', 'lento']);
});

test('the same answer twice and a frustrated person are flagged; a different answer is not', () => {
  const runs = [run('a', '2026-10-16T10:00:00Z', 'hola'), run('b', '2026-10-16T10:01:00Z', 'hola', { rootRunId: 'a' }),
    run('c', '2026-10-16T10:02:00Z', 'otra vez lo mismo, dime algo distinto', { rootRunId: 'a' })];
  const same = 'Hola, Nicolás. Tienes 4 contactos con correo que aún no reciben un primer correo; conviene partir por ellos.';
  const events = [event('a', 'run.completed', '2026-10-16T10:00:05Z', { reply: same }),
    event('b', 'run.completed', '2026-10-16T10:01:05Z', { reply: same.replace('Hola,', '¡Hola,') }),
    event('c', 'run.completed', '2026-10-16T10:02:05Z', { reply: 'Tienes razón. Puedo buscar prospectos nuevos, revisar tus resultados o preparar LinkedIn.' })];
  const signals = conversationSignals(buildRealConversations(runs, events)[0]);
  assert.ok(signals.includes('repite'));
  assert.ok(signals.includes('frustracion'));
  assert.ok(replySimilarity(same, 'Busqué gerentes de personas en retail de Santiago.') < 0.2);
});

const fact = (module: UsageFact['module'], kind: string, status: string, count: number, userId: string | null = 'u1'): UsageFact =>
  ({ organizationId: 'o1', userId, day: '2026-10-14', module, kind, status, actor: 'user', count, firstAt: '', lastAt: '' });
const credit = (resource: CreditDay['resource'], net: number, userId = 'u1'): CreditDay =>
  ({ organizationId: 'o1', userId, groupId: null, day: '2026-10-14', resource, net, debits: net, refunds: 0, source: 'journal' });

test('each section by its use: research that mostly ends partial needs attention, an unused section says so', () => {
  const health = sectionHealth({ activePeople: 3, facts: [
    fact('search', 'search_requested', 'started', 12), fact('contacts', 'contact_saved', 'recorded', 40),
    fact('research', 'research_completed', 'completed', 2), fact('research', 'research_requested', 'partial', 8),
    fact('email', 'draft_prepared', 'draft', 20), fact('email', 'contact_sent', 'recorded', 1),
  ], credits: [credit('enrich', 30), credit('search', 12)] });
  const by = Object.fromEntries(health.map(row => [row.module, row]));
  assert.equal(by.search.signal, 'bien');
  assert.equal(by.contacts.outcome, '40 contactos guardados · 30 enriquecimientos');
  assert.equal(by.research.signal, 'atencion');
  assert.equal(by.research.reliability, 0.2);
  assert.match(by.email.notes.join(), /casi ningún borrador termina enviado/);
  assert.equal(by.cowork.signal, 'sin_uso');
});

test('the report says per organization who used what, and which Cowork conversations to read first', () => {
  const conversations = buildRealConversations([run('r', '2026-10-16T10:00:00Z', 'búscame gerentes')], [event('r', 'run.failed', '2026-10-16T10:00:03Z', { message: 'proveedor caído' })]);
  const report = renderRealUsageReport({ from: '2026-10-01', to: '2026-10-16', coverageFrom: '2026-10-10T15:00:00Z', conversations,
    organizations: [{ id: 'o1', name: 'Acme', members: 5, active: 2, health: sectionHealth({ activePeople: 2, facts: [], credits: [credit('enrich', 3)] }) }],
    judged: [{ conversationId: 'r', runId: 'r', at: '2026-10-16T10:00:00Z', scores: { utilidad: 2, claridad: 4 }, veredicto: 'mala', problemas: ['No hizo la búsqueda.'] }] });
  assert.match(report, /## Acme/);
  assert.match(report, /2 de 5 personas usaron la app/);
  assert.match(report, /\| Contactos \| 1 \| 3 \|/);
  assert.match(report, /un turno falló/);
  assert.match(report, /Todo el período \(1 respuestas\): utilidad 2 · claridad 4/);
  assert.match(report, /Últimos 7 días \(1 respuestas\)/);
  assert.match(report, /No hizo la búsqueda/);
  assert.match(report, /desde el 2026-10-10/);
});
