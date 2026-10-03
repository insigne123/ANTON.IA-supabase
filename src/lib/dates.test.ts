import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatRelative } from './dates';

const now = new Date(2026, 9, 3, 15, 0, 0); // 3 oct 2026, 15:00 local

test('dates read in Chilean Spanish, without the current year', () => {
  assert.equal(formatDate(new Date(2026, 9, 3), { now }), '3 oct');
  assert.equal(formatDate(new Date(2025, 11, 24), { now }), '24 dic 2025');
  assert.equal(formatDate(new Date(2026, 0, 5), { now, year: true }), '5 ene 2026');
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('no es fecha'), '—');
  assert.equal(formatDateTime(new Date(2026, 9, 3, 9, 5), { now }), '3 oct, 09:05');
});

test('recent moments read as words', () => {
  assert.equal(formatRelative(new Date(now.getTime() - 20_000), { now }), 'ahora');
  assert.equal(formatRelative(new Date(now.getTime() - 5 * 60_000), { now }), 'hace 5 min');
  assert.equal(formatRelative(new Date(now.getTime() - 3 * 3_600_000), { now }), 'hace 3 h');
  assert.equal(formatRelative(new Date(2026, 9, 2, 20, 0), { now }), 'ayer');
  assert.equal(formatRelative(new Date(2026, 8, 30, 10, 0), { now }), 'hace 3 días');
  assert.equal(formatRelative(new Date(2026, 8, 1, 10, 0), { now }), '1 sept');
  assert.equal(formatRelative(new Date(now.getTime() + 2 * 3_600_000), { now }), 'en 2 h');
  assert.equal(formatRelative(new Date(2026, 9, 4, 10, 0), { now }), 'mañana');
  assert.equal(formatRelative(new Date(2026, 9, 6, 10, 0), { now }), 'en 3 días');
});
