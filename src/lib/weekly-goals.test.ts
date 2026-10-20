import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GOALS, goalMet, goalNextStep, goalPace, goalSentence, goalsOff, paceSentence, progressText, resolveTargets, sourceText, validTargets,
  workdaysBefore, type GoalProgress,
} from './weekly-goals';

// Chile is UTC−3 in October: 12:00Z is 09:00 there.
const MONDAY = new Date('2026-10-19T12:00:00.000Z');
const WEDNESDAY = new Date('2026-10-21T12:00:00.000Z');
const FRIDAY = new Date('2026-10-23T12:00:00.000Z');
const SUNDAY = new Date('2026-10-25T12:00:00.000Z');
const progress = (contacted: number, found: number, targets = DEFAULT_GOALS): GoalProgress => ({ targets, counts: { contacted, found }, source: 'team' });

test('a goal is two whole numbers from 0 to 500', () => {
  assert.deepEqual(validTargets({ contacted: 10, found: 15 }), { contacted: 10, found: 15 });
  assert.deepEqual(validTargets({ contacted: 0, found: 500 }), { contacted: 0, found: 500 });
  assert.equal(validTargets({ contacted: 501, found: 1 }), null);
  assert.equal(validTargets({ contacted: 2.5, found: 1 }), null);
  assert.equal(validTargets({ contacted: '10', found: 1 }), null);
  assert.equal(validTargets(null), null);
});

test('the person\'s own goal wins over the team\'s, and the team\'s over the default', () => {
  const team = { contacted: 20, found: 30 }, own = { contacted: 5, found: 5 };
  assert.deepEqual(resolveTargets(team, own), { targets: own, source: 'person' });
  assert.deepEqual(resolveTargets(team, null), { targets: team, source: 'team' });
  assert.deepEqual(resolveTargets(null, null), { targets: DEFAULT_GOALS, source: 'default' });
  assert.equal(goalsOff({ contacted: 0, found: 0 }), true);
  assert.equal(goalsOff({ contacted: 0, found: 3 }), false);
});

test('the pace follows the working days already over, in Chile', () => {
  assert.equal(workdaysBefore(MONDAY), 0);
  assert.equal(workdaysBefore(WEDNESDAY), 2);
  assert.equal(workdaysBefore(FRIDAY), 4);
  assert.equal(workdaysBefore(SUNDAY), 5);
  // 04:00Z on Monday is 01:00 on Monday in Chile: a new week with nothing over yet.
  assert.equal(workdaysBefore(new Date('2026-10-19T04:00:00.000Z')), 0);
  // Wednesday: by the start of the day 4 of 10 people (2/5), by its end 6.
  assert.deepEqual(goalPace(progress(3, 6), WEDNESDAY), { behind: true, todayLeft: { contacted: 3, found: 3 } });
  assert.deepEqual(goalPace(progress(4, 6), WEDNESDAY), { behind: false, todayLeft: { contacted: 2, found: 3 } });
});

test('one line says whether the person is on pace and what today asks', () => {
  assert.equal(paceSentence(progress(0, 0), MONDAY), 'Vas al día. Para seguir así, contacta hoy a 2 personas.');
  assert.equal(paceSentence(progress(3, 6), WEDNESDAY), 'Para ir al día, contacta hoy a 3 personas.');
  assert.equal(paceSentence(progress(6, 2, { contacted: 6, found: 10 }), WEDNESDAY), 'Para ir al día, suma hoy 4 contactos con correo.');
  assert.equal(paceSentence(progress(10, 15), WEDNESDAY), 'Cumpliste tu meta de la semana.');
  assert.equal(paceSentence(progress(2, 2), SUNDAY), 'La semana termina el domingo; el lunes empieza una nueva meta.');
  assert.equal(goalMet(progress(10, 15)), true);
  assert.equal(goalMet(progress(10, 14)), false);
});

test('the next step writes to the contacts ready, or finds new ones', () => {
  assert.deepEqual(goalNextStep(progress(2, 20), 7), { text: 'Escribe a tus contactos listos', href: '/saved/leads/enriched' });
  assert.deepEqual(goalNextStep(progress(2, 20), 1), { text: 'Escribe a tu contacto listo', href: '/saved/leads/enriched' });
  assert.deepEqual(goalNextStep(progress(2, 20), 0), { text: 'Busca contactos nuevos', href: '/search' });
  assert.deepEqual(goalNextStep(progress(10, 3), 9), { text: 'Busca contactos nuevos', href: '/search' });
  assert.equal(goalNextStep(progress(10, 15), 9), null);
});

test('progress and the email sentence only name the goals that are on', () => {
  assert.equal(progressText(progress(4, 6)), '4 de 10 personas contactadas · 6 de 15 contactos nuevos con correo');
  assert.equal(progressText(progress(1, 6, { contacted: 1, found: 0 })), '1 de 1 persona contactada');
  assert.equal(goalSentence(progress(4, 6), 'current'), 'Tu meta de esta semana: llevas 4 de 10 personas contactadas · 6 de 15 contactos nuevos con correo.');
  assert.equal(goalSentence(progress(12, 15), 'previous'), 'Cumpliste tu meta de la semana pasada: 12 de 10 personas contactadas · 15 de 15 contactos nuevos con correo.');
  assert.equal(goalSentence(progress(3, 15), 'previous'), 'Tu meta de la semana pasada: 3 de 10 personas contactadas · 15 de 15 contactos nuevos con correo.');
});

test('who set the goal, and admins are not sent to an admin', () => {
  assert.equal(sourceText('default'), 'Meta sugerida. Tu administrador puede cambiarla.');
  assert.equal(sourceText('default', true), 'Meta sugerida por ANTON.IA.');
  assert.equal(sourceText('person'), 'Meta personal, puesta por tu administrador.');
  assert.equal(sourceText('team', true), 'Meta de tu equipo.');
});
