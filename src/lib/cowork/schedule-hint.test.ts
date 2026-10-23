import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkScheduleHint } from './schedule-hint';

test('a weekday and a time are read from the way people say it', () => {
  assert.deepEqual(coworkScheduleHint('Cada lunes a las 9, dime a quién escribir hoy'), { title: 'Dime a quién escribir hoy', frequency: 'weekly', weekday: 1, time: '09:00' });
  assert.deepEqual(coworkScheduleHint('Los viernes a las 8:30 resume las respuestas de la semana.'), { title: 'Resume las respuestas de la semana', frequency: 'weekly', weekday: 5, time: '08:30' });
  assert.equal(coworkScheduleHint('todos los miércoles revisa mis campañas').weekday, 3);
  assert.equal(coworkScheduleHint('cada sábado haz un resumen').weekday, 6);
  assert.equal(coworkScheduleHint('los domingos a las 20 prepara la semana').weekday, 7);
});

test('every day, weekdays, a week and a month', () => {
  assert.equal(coworkScheduleHint('Todos los días a las 8 revisa si hay respuestas nuevas').frequency, 'daily');
  assert.equal(coworkScheduleHint('De lunes a viernes a las 08:15 dime qué quedó pendiente').frequency, 'weekdays');
  assert.equal(coworkScheduleHint('Cada semana mándame un informe de campañas').frequency, 'weekly');
  assert.equal(coworkScheduleHint('Cada semana mándame un informe de campañas').weekday, 1, 'a week without a day is Monday');
  assert.deepEqual(coworkScheduleHint('El día 15 de cada mes calcula mis resultados'), { title: 'Calcula mis resultados', frequency: 'monthly', monthDay: 15 });
  assert.equal(coworkScheduleHint('Cada mes revisa mis leads').monthDay, 1);
  assert.equal(coworkScheduleHint('El día 31 de cada mes cierra el mes').monthDay, 28, 'the day of the month stops at 28');
});

test('the hour: 24 hours as typed, pm and «de la tarde» add twelve, and 1 to 6 with no mark is the afternoon', () => {
  const at = (text: string) => coworkScheduleHint(text).time;
  assert.equal(at('cada lunes a las 9'), '09:00');
  assert.equal(at('cada lunes a las 9 de la mañana'), '09:00');
  assert.equal(at('cada lunes a las 9:45 am'), '09:45');
  assert.equal(at('cada lunes a las 3 de la tarde'), '15:00');
  assert.equal(at('cada lunes a las 8 pm'), '20:00');
  assert.equal(at('cada lunes a las 5'), '17:00');
  assert.equal(at('cada lunes a las 17 h'), '17:00');
  assert.equal(at('cada lunes a las 12 am'), '00:00');
  assert.equal(at('cada lunes a las 25'), undefined, 'an hour that does not exist is no hour');
  assert.equal(at('cada lunes a las 9:75'), undefined);
  assert.equal(at('todas las mañanas revisa mi bandeja'), '08:00');
  assert.equal(at('todas las tardes revisa mi bandeja'), '16:00');
});

test('a request that says nothing about when leaves it to the person', () => {
  assert.deepEqual(coworkScheduleHint('Dime a quién escribir hoy'), { title: 'Dime a quién escribir hoy' });
  assert.deepEqual(coworkScheduleHint(''), { title: '' });
  assert.deepEqual(coworkScheduleHint('a las 10 revisa mis campañas'), { title: 'Revisa mis campañas', time: '10:00' });
});

test('the name is the request without the words that said when, cut at its first sentence and 50 characters', () => {
  assert.equal(coworkScheduleHint('Cada lunes a las 9 revisa quién respondió y a quién escribir. Después ordénalos por empresa.').title, 'Revisa quién respondió y a quién escribir');
  const long = coworkScheduleHint('Todos los días a las 8 revisa las respuestas nuevas de todas mis campañas activas y dime cuáles piden reunión').title;
  assert.ok(long.length <= 50 && long.endsWith('…'), long);
  assert.equal(coworkScheduleHint('¿Puedes decirme todos los días a las 8 cuántos contactos nuevos hay?').title, 'Puedes decirme cuántos contactos nuevos hay');
});
