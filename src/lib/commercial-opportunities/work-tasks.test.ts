import assert from 'node:assert/strict';
import test from 'node:test';
import { chileDay, dayOfDueAt, dueAtOfDay, isLate, myTaskGroups, orderTasks, planTaskDrafts, taskActivityLine, taskBatchSchema, taskDue, type MyTask, type OpportunityTask } from './work-tasks';

// Saturday 24 October 2026, 09:00 in Chile (summer time, UTC−3).
const NOW = new Date('2026-10-24T12:00:00.000Z');
const task = (id: string, due: string | null, status: OpportunityTask['status'] = 'pending', updated = '2026-10-20T12:00:00.000Z'): OpportunityTask =>
  ({ id, title: `Tarea ${id}`, owner_id: null, due_at: due, status, evidence: '', updated_at: updated });

test('a task is due on a day of Chile: kept at noon, so it reads as that day in any time zone, summer or winter', () => {
  assert.equal(dueAtOfDay('2026-10-28'), '2026-10-28T15:00:00.000Z');
  assert.equal(dueAtOfDay('2026-06-15'), '2026-06-15T16:00:00.000Z', 'winter: UTC−4');
  assert.deepEqual([dueAtOfDay(''), dueAtOfDay('28-10-2026'), dueAtOfDay(null)], [null, null, null]);
  assert.equal(chileDay('2026-10-29T02:30:00.000Z'), '2026-10-28', 'half past eleven at night in Chile is still that day');
  assert.equal(dayOfDueAt(dueAtOfDay('2026-10-28')), '2026-10-28');
  assert.equal(dayOfDueAt(null), '');
});

test('the list says when each is due: a late one with its day, today and tomorrow by name, the rest by their day', () => {
  assert.deepEqual(taskDue('2026-10-23T15:00:00.000Z', 'pending', NOW), { label: 'Venció el 23 de octubre', late: true });
  assert.deepEqual(taskDue('2026-10-24T23:00:00.000Z', 'working', NOW), { label: 'Vence hoy', late: false });
  assert.deepEqual(taskDue(dueAtOfDay('2026-10-25'), 'pending', NOW), { label: 'Vence mañana', late: false });
  assert.deepEqual(taskDue(dueAtOfDay('2026-10-30'), 'blocked', NOW), { label: 'Vence el 30 de octubre', late: false });
  assert.deepEqual(taskDue(dueAtOfDay('2027-01-05'), 'pending', NOW), { label: 'Vence el 5 de enero de 2027', late: false }, 'another year says it');
  assert.deepEqual(taskDue('2026-10-23T15:00:00.000Z', 'done', NOW), { label: '23 de octubre', late: false }, 'a done one is never late');
  assert.equal(taskDue(null, 'pending', NOW), null);
  assert.deepEqual([isLate(task('a', '2026-10-23T15:00:00.000Z'), NOW), isLate(task('b', null), NOW)], [true, false]);
});

test('what is still to do goes by the day it is due, the ones without a day last; what is done apart, the latest first', () => {
  const { open, done } = orderTasks([task('sin', null), task('lunes', dueAtOfDay('2026-10-26')), task('hecha', dueAtOfDay('2026-10-20'), 'done', '2026-10-21T00:00:00Z'),
    task('ayer', dueAtOfDay('2026-10-23'), 'working'), task('otra', dueAtOfDay('2026-10-19'), 'done', '2026-10-23T00:00:00Z')]);
  assert.deepEqual(open.map(item => item.id), ['ayer', 'lunes', 'sin']);
  assert.deepEqual(done.map(item => item.id), ['otra', 'hecha']);
});

test('the plan becomes tasks with a day between the steps around it, never on a weekend nor after the close, and an owner', () => {
  const people = [{ user_id: 'diego', name: 'Diego Fuentes' }, { user_id: 'camila', name: 'Camila Torres' }];
  const drafts = planTaskDrafts([
    { title: 'Pedir las dos referencias de clientes', role: 'Comercial', due: '27-10-2026 18:00' },
    { title: 'Calcular el precio por persona', role: 'Camila', due: '', dependency: 'Referencias', evidence: 'Anexo económico listo' },
    { title: 'Firmar la declaración jurada', role: 'Representante legal', due: '3 días hábiles antes del cierre' },
    { title: 'Preparar la garantía', due: 'Antes del cierre' },
    { title: 'Subir la oferta al portal', role: 'Comercial', due: 'Al cierre' },
    { title: 'Revisar las bases', due: 'Semana 1' },
    { title: ' ' },
  ], { deadline: '2026-11-06T15:00:00.000Z', now: NOW, responsibleId: 'diego', people, existing: ['revisar las  BASES'] });
  assert.deepEqual(drafts.map(draft => [draft.title, draft.day, draft.ownerId]), [
    ['Pedir las dos referencias de clientes', '2026-10-27', 'diego'],
    // Between the 27th and the 3rd: the 31st is a Saturday, so the Friday before.
    ['Calcular el precio por persona', '2026-10-30', 'camila'],
    ['Firmar la declaración jurada', '2026-11-03', 'diego'],
    ['Preparar la garantía', '2026-11-05', 'diego'],
    ['Subir la oferta al portal', '2026-11-06', 'diego'],
    ['Revisar las bases', '2026-11-06', 'diego'],
  ], 'the role that names someone of the team gives it to them; otherwise whoever is in charge');
  assert.equal(drafts[1].evidence, 'Antes: Referencias · Resultado: Anexo económico listo');
  assert.deepEqual(drafts.map(draft => draft.exists), [false, false, false, false, false, true], 'one already in the list, however it was written');
});

test('without a close the plan keeps only its own dates; a date already past is today; with one person in the team, it is theirs', () => {
  const drafts = planTaskDrafts([{ title: 'Pedir la visita a terreno', due: '20-10-2026' }, { title: 'Armar la propuesta' }],
    { deadline: null, now: NOW, responsibleId: null, people: [{ user_id: 'diego', name: 'Diego Fuentes' }], existing: [] });
  assert.deepEqual(drafts.map(draft => [draft.day, draft.ownerId]), [['2026-10-24', 'diego'], [null, 'diego']]);
  const nobody = planTaskDrafts([{ title: 'Armar la propuesta' }], { deadline: '2026-11-06T15:00:00.000Z', now: NOW, responsibleId: 'otra', people: [{ user_id: 'diego', name: 'Diego Fuentes' }, { user_id: 'camila', name: 'Camila Torres' }], existing: [] });
  assert.equal(nobody[0].ownerId, null, 'someone in charge who left the team is not proposed');
});

test('«Mis tareas» in the order they are needed, and the groups without tasks are left out', () => {
  const mine = (id: string, due: string | null): MyTask => ({ ...task(id, due), opportunity: { id: 'o', title: 'Licitación', kind: 'tender', deadline_at: null } });
  const groups = myTaskGroups([mine('sin', null), mine('vencida', dueAtOfDay('2026-10-22')), mine('hoy', dueAtOfDay('2026-10-24')), mine('martes', dueAtOfDay('2026-10-27')),
    mine('diciembre', dueAtOfDay('2026-12-01')), { ...mine('hecha', null), status: 'done' }], NOW);
  assert.deepEqual(groups.map(group => [group.label, group.tasks.map(item => item.id)]),
    [['Vencidas', ['vencida']], ['Hoy', ['hoy']], ['Próximos 7 días', ['martes']], ['Más adelante', ['diciembre']], ['Sin fecha', ['sin']]]);
  assert.deepEqual(myTaskGroups([], NOW), []);
});

test('each change leaves its line in the activity, in words; the plan admits forty tasks at most', () => {
  assert.equal(taskActivityLine('working', 'Pedir  las referencias'), 'Tarea en curso: Pedir las referencias');
  assert.equal(taskActivityLine('done', 'Firmar'), 'Tarea hecha: Firmar');
  assert.equal(taskActivityLine('deleted', 'Firmar'), 'Tarea eliminada: Firmar');
  const one = { title: 'Firmar', ownerId: null, dueAt: null };
  assert.equal(taskBatchSchema.safeParse({ tasks: Array.from({ length: 40 }, () => one) }).success, true);
  assert.equal(taskBatchSchema.safeParse({ tasks: Array.from({ length: 41 }, () => one) }).success, false);
  assert.equal(taskBatchSchema.safeParse({ tasks: [] }).success, false);
});
