import assert from 'node:assert/strict';
import test from 'node:test';
import { chileanClock, describeSchedule, normalizeSchedule, scheduleDue } from './schedule';

const weekdays = { enabled: true, days: [1, 2, 3, 4, 5], hour: 7 };

test('the clock is Chile\'s, summer time included', () => {
  // 8 Oct 2026 is a Thursday; Chile is on UTC-3 in October.
  assert.deepEqual(chileanClock('2026-10-08T11:15:00Z'), { day: 4, hour: 8, date: '2026-10-08' });
  assert.deepEqual(chileanClock('2026-10-09T02:30:00Z'), { day: 4, hour: 23, date: '2026-10-08' }, 'late at night is still the same day in Chile');
});

test('a search is due on its day, from its hour, once a day', () => {
  assert.equal(scheduleDue(weekdays, '2026-10-08T09:15:00Z', null), false, '06:15 in Chile: not yet');
  assert.equal(scheduleDue(weekdays, '2026-10-08T10:15:00Z', null), true, '07:15: its hour');
  assert.equal(scheduleDue(weekdays, '2026-10-08T13:15:00Z', null), true, '10:15: an hour the tick missed is caught up');
  assert.equal(scheduleDue(weekdays, '2026-10-08T13:15:00Z', '2026-10-08T10:15:00Z'), false, 'already ran today');
  assert.equal(scheduleDue(weekdays, '2026-10-08T10:15:00Z', '2026-10-07T10:15:00Z'), true, 'yesterday\'s run does not count');
  assert.equal(scheduleDue(weekdays, '2026-10-10T10:15:00Z', null), false, 'Saturday is not a weekday');
  assert.equal(scheduleDue({ ...weekdays, enabled: false }, '2026-10-08T10:15:00Z', null), false, 'paused');
  // Today's behavior is kept by the defaults: every day, from 8.
  assert.equal(scheduleDue(normalizeSchedule(null), '2026-10-11T11:15:00Z', null), true);
});

test('the schedule is cleaned and read in words', () => {
  assert.deepEqual(normalizeSchedule({ days: [5, 1, 1, 9, 'x'], hour: 30, enabled: 'sí' }), { enabled: true, days: [1, 5], hour: 8 });
  assert.equal(describeSchedule(normalizeSchedule(null)), 'Todos los días a las 08:00');
  assert.equal(describeSchedule(weekdays), 'De lunes a viernes a las 07:00');
  assert.equal(describeSchedule({ enabled: true, days: [1, 3, 5], hour: 9 }), 'Lunes, miércoles y viernes a las 09:00');
  assert.equal(describeSchedule({ enabled: true, days: [0], hour: 18 }), 'Domingo a las 18:00');
  assert.equal(describeSchedule({ ...weekdays, enabled: false }), 'En pausa');
});
