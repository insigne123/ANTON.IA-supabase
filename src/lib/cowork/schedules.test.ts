import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COWORK_SCHEDULE_MARK, coworkIsScheduledMessage, coworkScheduleInputSchema, coworkScheduleMessage, coworkScheduleOf, coworkScheduleOfferSchema, coworkScheduledTitle,
  coworkStoredScheduleOffer, describeCoworkSchedule, nextCoworkScheduleRun, type CoworkSchedule,
} from './schedules';

const schedule = (overrides: Partial<CoworkSchedule> = {}): CoworkSchedule => ({ frequency: 'daily', time: '09:00', weekday: null, monthDay: null, timeZone: 'America/Santiago', ...overrides });
const next = (value: CoworkSchedule, after: string) => nextCoworkScheduleRun(value, new Date(after)).toISOString();

// Chile in 2026: UTC-3 in summer time (until the night of Saturday 4 to Sunday 5 April, 03:00 UTC) and from Sunday 6 September (04:00 UTC); UTC-4 between.

test('a daily task fires at its local time, and a firing at this very moment is not the next one', () => {
  assert.equal(next(schedule(), '2026-10-23T11:00:00Z'), '2026-10-23T12:00:00.000Z', '09:00 in Chile is 12:00 UTC in October');
  assert.equal(next(schedule(), '2026-10-23T12:00:00Z'), '2026-10-24T12:00:00.000Z', 'strictly after');
  assert.equal(next(schedule(), '2026-10-23T12:00:01Z'), '2026-10-24T12:00:00.000Z');
});

test('a weekdays task skips the weekend', () => {
  const task = schedule({ frequency: 'weekdays', time: '08:30' });
  assert.equal(next(task, '2026-10-23T12:00:00Z'), '2026-10-26T11:30:00.000Z', 'Friday 09:00 local is past 08:30: the next is Monday');
  assert.equal(next(task, '2026-10-24T12:00:00Z'), '2026-10-26T11:30:00.000Z', 'Saturday goes to Monday');
  assert.equal(next(task, '2026-10-26T10:00:00Z'), '2026-10-26T11:30:00.000Z', 'Monday early: the same day');
});

test('a weekly task fires on its day, and a monthly one on its day of the month', () => {
  assert.equal(next(schedule({ frequency: 'weekly', weekday: 1 }), '2026-10-26T12:00:00Z'), '2026-11-02T12:00:00.000Z', 'Monday at the minute: next Monday');
  assert.equal(next(schedule({ frequency: 'weekly', weekday: 7, time: '18:00' }), '2026-10-23T12:00:00Z'), '2026-10-25T21:00:00.000Z', 'Sunday 18:00');
  assert.equal(next(schedule({ frequency: 'monthly', monthDay: 1 }), '2026-10-23T12:00:00Z'), '2026-11-01T12:00:00.000Z');
  assert.equal(next(schedule({ frequency: 'monthly', monthDay: 28, time: '23:30' }), '2026-02-28T20:00:00Z'), '2026-03-01T02:30:00.000Z', 'Feb 28 23:30 local in summer time (UTC-3)');
  assert.equal(next(schedule({ frequency: 'monthly', monthDay: 15 }), '2026-12-15T13:00:00Z'), '2027-01-15T12:00:00.000Z', 'over the year');
});

test('clocks that go forward or back keep the local time of the task', () => {
  // Saturday 5 September is UTC-4 (09:00 is 13:00 UTC); Sunday 6 September is UTC-3 (09:00 is 12:00 UTC).
  assert.equal(next(schedule(), '2026-09-05T13:00:00Z'), '2026-09-06T12:00:00.000Z');
  // A time that does not exist (00:30 of the Sunday the clocks go forward) fires after the gap, at 01:30.
  assert.equal(next(schedule({ time: '00:30' }), '2026-09-05T12:00:00Z'), '2026-09-06T04:30:00.000Z');
  // A time that happens twice (23:30 of the Saturday the clocks go back) fires the first time.
  assert.equal(next(schedule({ time: '23:30' }), '2026-04-04T12:00:00Z'), '2026-04-05T02:30:00.000Z');
  // And the days around keep their own offset.
  assert.equal(next(schedule(), '2026-04-05T12:00:00Z'), '2026-04-05T13:00:00.000Z', 'winter time: 09:00 is 13:00 UTC');
  assert.equal(next(schedule(), '2026-04-05T13:00:00Z'), '2026-04-06T13:00:00.000Z');
});

test('another time zone is respected, and an unknown one falls back to the account zone', () => {
  assert.equal(next(schedule({ timeZone: 'America/Lima' }), '2026-10-23T12:00:00Z'), '2026-10-23T14:00:00.000Z', 'Lima is UTC-5');
  assert.equal(coworkScheduleOf({ frequency: 'daily', time: '09:00', timeZone: 'No/Existe' }).timeZone, 'America/Santiago');
  assert.equal(next(schedule({ timeZone: 'No/Existe' }), '2026-10-23T11:00:00Z'), '2026-10-23T12:00:00.000Z');
});

test('the input is checked: the day fields belong to their frequency, the time is HH:MM and nothing unknown comes through', () => {
  const ok = { title: 'Resumen del lunes', prompt: 'Dime quién respondió esta semana y a quién escribir hoy.', frequency: 'weekly', time: '09:00', weekday: 1 };
  assert.equal(coworkScheduleInputSchema.safeParse(ok).success, true);
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, weekday: undefined }).success, false, 'a weekly task needs its day');
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, frequency: 'daily' }).success, false, 'a daily task has no weekday');
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, frequency: 'monthly', weekday: null, monthDay: 31 }).success, false, 'the day of the month stops at 28');
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, time: '9:00' }).success, false);
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, time: '24:00' }).success, false);
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, prompt: 'corto' }).success, false);
  assert.equal(coworkScheduleInputSchema.safeParse({ ...ok, enabled: true }).success, false, 'a field it does not know is refused, not ignored');
  const parsed = coworkScheduleInputSchema.parse({ ...ok, title: '  Resumen  ' });
  assert.equal(parsed.title, 'Resumen', 'trimmed');
  assert.deepEqual(coworkScheduleOf({ ...parsed, frequency: 'daily', weekday: 3 }), schedule({ weekday: null }), 'a day that does not belong is dropped');
});

test('a schedule reads as a person would say it', () => {
  assert.equal(describeCoworkSchedule(schedule()), 'Todos los días a las 09:00');
  assert.equal(describeCoworkSchedule(schedule({ frequency: 'weekdays', time: '08:30' })), 'De lunes a viernes a las 08:30');
  assert.equal(describeCoworkSchedule(schedule({ frequency: 'weekly', weekday: 1 })), 'Los lunes a las 09:00');
  assert.equal(describeCoworkSchedule(schedule({ frequency: 'weekly', weekday: 3 })), 'Los miércoles a las 09:00');
  assert.equal(describeCoworkSchedule(schedule({ frequency: 'weekly', weekday: 7 })), 'Los domingos a las 09:00');
  assert.equal(describeCoworkSchedule(schedule({ frequency: 'monthly', monthDay: 1 })), 'El día 1 de cada mes a las 09:00');
  assert.equal(describeCoworkSchedule(schedule({ timeZone: 'America/Lima' })), 'Todos los días a las 09:00 (hora de America/Lima)');
});

test('the message of a firing says what it is, when it fired, the request word for word and that nobody is watching', () => {
  const message = coworkScheduleMessage({ title: 'Resumen del lunes', prompt: '  Dime quién respondió esta semana.  ' }, new Date('2026-10-26T12:00:00Z'), 'America/Santiago');
  const lines = message.split('\n');
  assert.equal(lines[0], `${COWORK_SCHEDULE_MARK} · Resumen del lunes`);
  assert.equal(lines[1], 'lunes 26 de octubre, 09:00');
  assert.ok(message.includes('\nDime quién respondió esta semana.\n'), 'the request, trimmed');
  assert.match(message, /Ejecución automática/);
  assert.equal(coworkIsScheduledMessage(message), true);
  assert.equal(coworkIsScheduledMessage('Hola'), false);
  assert.equal(coworkIsScheduledMessage(null), false);
  assert.equal(coworkScheduledTitle(message), 'Resumen del lunes');
  assert.equal(coworkScheduledTitle('Hola'), null);
});

test('the task Cowork proposes reads back as a task would take it, or as none when it is not one', () => {
  const offer = { title: 'Prospectos de logística del lunes', prompt: 'Tráeme 5 prospectos nuevos de logística en Santiago para escribirles.',
    frequency: 'weekly', time: '09:00', weekday: 1, monthDay: null };
  assert.equal(coworkScheduleOfferSchema.safeParse(offer).success, true, 'the model writes it with plain fields');
  assert.deepEqual(coworkStoredScheduleOffer(offer), { ...offer, monthDay: null });
  assert.deepEqual(coworkStoredScheduleOffer({ ...offer, frequency: 'daily' }), { ...offer, frequency: 'daily', weekday: null, monthDay: null },
    'a day the frequency does not use is dropped, not a reason to lose the task');
  assert.equal(coworkStoredScheduleOffer({ ...offer, weekday: null }), null, 'a weekly task needs its day');
  assert.equal(coworkStoredScheduleOffer({ ...offer, time: '9' }), null);
  assert.equal(coworkStoredScheduleOffer({ ...offer, prompt: 'corto' }), null);
  assert.equal(coworkStoredScheduleOffer(null), null);
  assert.deepEqual(coworkStoredScheduleOffer({ ...offer, frequency: 'monthly', weekday: 3, monthDay: 15 }),
    { ...offer, frequency: 'monthly', weekday: null, monthDay: 15 });
});
