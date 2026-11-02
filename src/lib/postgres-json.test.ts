import assert from 'node:assert/strict';
import test from 'node:test';

import { withoutNul } from './postgres-json';

test('the NUL character leaves every string and key, and nothing else changes (plan de uso A6)', () => {
  const posted = { content: 'Buscamos\u0000 guardias', author: { name: 'Acme\u0000' }, 'clave\u0000': [1, 'a\u0000b', null, true], when: '2026-11-02' };
  assert.deepEqual(withoutNul(posted), { content: 'Buscamos guardias', author: { name: 'Acme' }, clave: [1, 'ab', null, true], when: '2026-11-02' });
  assert.equal(JSON.stringify(withoutNul(posted)).includes('\\u0000'), false);
  const clean = { a: 'texto', b: [1, 2], c: { d: null } };
  assert.deepEqual(withoutNul(clean), clean);
  const date = new Date('2026-11-02T00:00:00Z');
  assert.equal(withoutNul(date), date, 'not a plain object: as it is');
  assert.equal(withoutNul('sin nada'), 'sin nada');
});
