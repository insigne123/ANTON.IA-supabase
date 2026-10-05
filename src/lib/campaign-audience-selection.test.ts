import assert from 'node:assert/strict';
import test from 'node:test';

import { firstSelection } from './campaign-audience-selection';

const person = (email: string, blockedReason: string | null = null) => ({ email, blockedReason });

test('the first results come selected, without the blocked ones and without repeats', () => {
  assert.deepEqual(firstSelection([], [person('a@x.cl'), person('b@x.cl', 'Se dio de baja'), person('a@x.cl'), person('c@x.cl')], 100),
    ['a@x.cl', 'c@x.cl']);
});

test('a selection the person made is kept, and nothing selectable changes nothing', () => {
  assert.equal(firstSelection(['z@x.cl'], [person('a@x.cl')], 100), null);
  assert.equal(firstSelection([], [person('b@x.cl', 'Sin correo')], 100), null);
  assert.equal(firstSelection([], [], 100), null);
});

test('never more than the campaign allows', () => {
  const many = Array.from({ length: 5 }, (_, index) => person(`p${index}@x.cl`));
  assert.deepEqual(firstSelection([], many, 3), ['p0@x.cl', 'p1@x.cl', 'p2@x.cl']);
});
