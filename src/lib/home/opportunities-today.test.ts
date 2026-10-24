import assert from 'node:assert/strict';
import test from 'node:test';
import { dayLabel } from '@/lib/commercial-opportunities/waiting';
import { CLOSING_THIS_WEEK_HREF, opportunitiesToday, type OpportunitiesTodayInput } from './opportunities-today';

// Tuesday 27 October 2026, noon in Chile.
const NOW = new Date('2026-10-27T15:00:00.000Z');
const DIEGO = '00000000-0000-4000-8000-000000000011';
const ANA = '00000000-0000-4000-8000-000000000013';
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const input = (extra: Partial<OpportunitiesTodayInput> = {}): OpportunitiesTodayInput => ({
  now: NOW, admin: false, userId: DIEGO, mine: [], reports: [], waiting: [], closingWithoutTeam: [], ...extra,
});
const waiting: OpportunitiesTodayInput['waiting'] = [
  { id: 'a', title: 'Servicio de aseo  Hospital Regional', kind: 'ask', who: 'Diego', since: ago(3), dueAt: null, actorId: DIEGO },
  { id: 'b', title: 'Guardias Puerto Montt', kind: 'blocked', who: 'Alguien del equipo', since: ago(0), dueAt: null, actorId: null },
  { id: 'c', title: 'Vigilancia Temuco', kind: 'no_go', who: 'Ana', since: ago(1), dueAt: ahead(1), actorId: ANA },
  { id: 'd', title: 'Aseo Talca', kind: 'ask', who: 'Diego', since: ago(1), dueAt: null, actorId: DIEGO },
];

test('the days read the way people say them, in Chile', () => {
  assert.equal(dayLabel('2026-10-27T22:00:00.000Z', NOW), 'hoy');
  assert.equal(dayLabel('2026-10-28T03:30:00.000Z', NOW), 'mañana', 'half past midnight in Chile is already Wednesday');
  assert.equal(dayLabel('2026-10-30T18:00:00.000Z', NOW), 'el viernes');
  assert.equal(dayLabel('2026-11-12T18:00:00.000Z', NOW), 'el 12 de noviembre');
});

test('an administrator sees what waits for them, who asks and since when, and what closes this week with no team', () => {
  const today = opportunitiesToday(input({
    admin: true, userId: '00000000-0000-4000-8000-000000000010', waiting,
    closingWithoutTeam: [
      { id: 'x4', title: 'Cuarta', deadlineAt: ahead(6) }, { id: 'x1', title: 'Primera', deadlineAt: ahead(0.2) },
      { id: 'x3', title: 'Tercera', deadlineAt: ahead(4) }, { id: 'x2', title: 'Segunda', deadlineAt: ahead(3) },
    ],
  }));
  assert.equal(today.waiting.total, 4);
  assert.deepEqual(today.waiting.lines.map(line => [line.title, line.detail, line.urgent]), [
    ['Servicio de aseo Hospital Regional', 'Diego pide una decisión · espera hace 3 días', true],
    ['Guardias Puerto Montt', 'Bloqueada', true],
    ['Vigilancia Temuco', 'Ana propone no postular · la piden para mañana', true],
  ]);
  assert.equal(today.waiting.lines[0].href, '/opportunities?op=a');
  assert.equal(today.closing.total, 4);
  assert.deepEqual(today.closing.lines.map(line => line.detail), ['Cierra hoy · sin equipo', 'Cierra el viernes · sin equipo', 'Cierra el sábado · sin equipo']);
  assert.deepEqual(today.closing.lines.map(line => line.urgent), [true, false, false]);
  assert.equal(today.closing.href, CLOSING_THIS_WEEK_HREF);
  assert.equal(today.empty, false);
});

test('whoever asked a decision sees it waiting for an answer; blocks and the decisions of others are not theirs to answer', () => {
  const today = opportunitiesToday(input({ waiting, closingWithoutTeam: [{ id: 'x1', title: 'Primera', deadlineAt: ahead(1) }] }));
  assert.deepEqual(today.waiting.lines.map(line => [line.id, line.detail, line.urgent]), [
    ['a', 'Pediste una decisión · esperando respuesta hace 3 días', true],
    ['d', 'Pediste una decisión · esperando respuesta desde ayer', false],
  ]);
  assert.equal(today.closing.total, 0, 'only an administrator assigns');
});

test('the ones they work, the most pressing first, each said once', () => {
  const today = opportunitiesToday(input({
    waiting,
    mine: [
      { id: 'later', title: 'Aseo Coquimbo', kind: 'tender', deadlineAt: ahead(16), nextActionAt: null, state: 'working' },
      { id: 'none', title: 'Guardias Arica', kind: 'tender', deadlineAt: null, nextActionAt: null, state: 'assigned' },
      { id: 'late', title: 'Aseo Iquique', kind: 'tender', deadlineAt: ago(1), nextActionAt: null, state: 'working' },
      { id: 'a', title: 'Servicio de aseo Hospital Regional', kind: 'tender', deadlineAt: ahead(2), nextActionAt: null, state: 'working' },
      { id: 'soon', title: 'Compra Ágil Maipú', kind: 'compra_agil', deadlineAt: ahead(0.2), nextActionAt: ago(2), state: 'blocked' },
    ],
    reports: [{ id: 'later', title: 'Aseo Coquimbo' }, { id: 'later', title: 'Aseo Coquimbo' }],
  }));
  assert.equal(today.mine.total, 4, 'the one waiting for an answer is said there');
  assert.deepEqual(today.mine.lines.map(line => [line.id, line.detail, line.urgent]), [
    ['soon', 'Bloqueada · Cierra hoy', true],
    ['later', 'Cierra el 12 de noviembre', false],
    ['none', 'Asignada, sin empezar', false],
  ], 'what already closed goes last: it only needs to be marked');
  const closed = opportunitiesToday(input({ mine: [{ id: 'late', title: 'Aseo Iquique', kind: 'tender', deadlineAt: ago(1), nextActionAt: null, state: 'working' }] }));
  assert.deepEqual([closed.mine.lines[0].detail, closed.mine.lines[0].urgent], ['El plazo de cierre ya pasó', false]);
  assert.deepEqual(today.reports.lines.map(line => [line.id, line.detail]), [['later', 'El informe está listo']]);
  assert.equal(opportunitiesToday(input({ reports: [{ id: 'x', title: 'Aseo', offer: true }] })).reports.lines[0].detail, 'El borrador de oferta está listo');
  assert.equal(today.reports.total, 1);
  // The number in the menu (APP-23): what waits, the report ready, and the one of theirs that is urgent; not the calm ones.
  assert.equal(today.attention, today.waiting.total + today.closing.total + 1 + 1);
  const quiet = opportunitiesToday(input({ mine: [{ id: 'none', title: 'Guardias Arica', kind: 'tender', deadlineAt: null, nextActionAt: ago(0), state: 'assigned' }] }));
  assert.equal(quiet.mine.lines[0].detail, 'Próxima acción hoy');
  assert.equal(opportunitiesToday(input({ mine: [{ id: 'none', title: '', kind: 'tender', deadlineAt: null, nextActionAt: null, state: 'working' }] })).mine.lines[0].title, 'Oportunidad');
});

test('with nothing to act on, the card stays out of «Hoy»', () => {
  const today = opportunitiesToday(input({ waiting: waiting.filter(item => item.actorId !== DIEGO) }));
  assert.equal(today.empty, true);
  assert.equal(today.attention, 0);
  assert.deepEqual([today.waiting.total, today.mine.total, today.reports.total, today.closing.total], [0, 0, 0, 0]);
});
