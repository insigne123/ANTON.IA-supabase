import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIORITY_STEPS, comparePriority, parsePrioritySort, starsFor, starsText } from './priority';

test('the score becomes one to five stars at the cuts production justifies, and never fails on a broken score', () => {
  for (const [score, stars] of [[100, 5], [90, 5], [80, 5], [79, 4], [65, 4], [64, 3], [50, 3], [49, 2], [30, 2], [29, 1], [10, 1], [0, 1]] as const) assert.equal(starsFor(score), stars, String(score));
  for (const broken of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY * 0]) assert.equal(starsFor(broken as any), 1, String(broken));
  assert.equal(starsFor(-5), 1);
  assert.equal(starsFor(250), 5, 'a score above 100 is still the best');
  // Every step starts below the one above it, so no score falls between two of them.
  assert.deepEqual(PRIORITY_STEPS.map(step => step.stars), [5, 4, 3, 2, 1]);
  assert.ok(PRIORITY_STEPS.every((step, index) => index === 0 || step.from < PRIORITY_STEPS[index - 1].from));
  assert.equal(PRIORITY_STEPS.at(-1)!.from, 0);
});

test('what the AI leaves out (10 or less) is one star, and what it recommends is three or more', () => {
  assert.equal(starsFor(10), 1);
  assert.ok(starsFor(55) >= 3, 'the lowest recommended score seen in production');
  assert.equal(starsFor(90), 5);
});

test('the stars say in words what they mean, for the screen reader and the tooltip', () => {
  assert.equal(starsText(85), '5 de 5 estrellas: calza muy bien con tu oferta');
  assert.equal(starsText(70), '4 de 5 estrellas: calza bien con tu oferta');
  assert.equal(starsText(35), '2 de 5 estrellas: calza poco con tu oferta');
  assert.equal(starsText(null), '1 de 5 estrellas: calza muy poco con tu oferta');
});

test('priority puts the most stars first and, with the same stars, the one that closes first; deadline does the opposite', () => {
  const cards = [
    { id: 'late-top', score: 90, days: 25 }, { id: 'soon-top', score: 82, days: 2 }, { id: 'soon-low', score: 20, days: 1 },
    { id: 'open-mid', score: 55, days: null }, { id: 'soon-mid', score: 58, days: 4 }, { id: 'tie-b', score: 33, days: 9 }, { id: 'tie-a', score: 33, days: 9 },
  ];
  const order = (sort: 'priority' | 'deadline') => [...cards].sort(comparePriority(sort)).map(card => card.id);
  assert.deepEqual(order('priority'), ['soon-top', 'late-top', 'soon-mid', 'open-mid', 'tie-a', 'tie-b', 'soon-low'],
    'five stars by closing date, then three stars (one without deadline last), then two, then one');
  assert.deepEqual(order('deadline'), ['soon-low', 'soon-top', 'soon-mid', 'tie-a', 'tie-b', 'late-top', 'open-mid'], 'by closing date; without one, last');
  assert.deepEqual([...cards].reverse().sort(comparePriority('priority')).map(card => card.id), order('priority'), 'the same order whatever the order they arrive in');
});

test('an unknown sort falls back to priority', () => {
  assert.equal(parsePrioritySort('deadline'), 'deadline');
  for (const value of ['priority', '', null, undefined, 'score', 5]) assert.equal(parsePrioritySort(value), 'priority');
});
