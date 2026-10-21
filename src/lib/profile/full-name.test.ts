import assert from 'node:assert/strict';
import test from 'node:test';

import { checkFullName, hasFullName, needsFullName, normalizeFullName } from './full-name';

test('a name is missing when the profile has none or only blanks', () => {
  assert.equal(needsFullName({ full_name: null }), true);
  assert.equal(needsFullName({ full_name: '' }), true);
  assert.equal(needsFullName({ full_name: '   ' }), true);
  assert.equal(needsFullName({}), true);
  assert.equal(needsFullName({ full_name: 'Ana' }), false);
  assert.equal(hasFullName(undefined), false);
  assert.equal(hasFullName(' Ana '), true);
});

test('without a profile row there is nothing to ask for', () => {
  assert.equal(needsFullName(null), false);
  assert.equal(needsFullName(undefined), false);
});

test('the name is saved with single spaces and no blanks at the ends', () => {
  assert.equal(normalizeFullName('  María   José \n González  '), 'María José González');
  assert.deepEqual(checkFullName('  María   González '), { ok: true, name: 'María González' });
});

test('accepts the names people have: accents, particles, apostrophes, hyphens and initials', () => {
  for (const name of ['Nicolás Yarur', 'María José de la Cruz', "Sofía D'Angelo", 'Andrés Pérez-Cotapos', 'J. Pérez', 'Åsa Öberg', 'Ñuñoa Ñanco']) {
    assert.deepEqual(checkFullName(name), { ok: true, name }, name);
  }
});

test('asks for name and surname when it is empty or just one word', () => {
  assert.deepEqual(checkFullName(''), { ok: false, error: 'Escribe tu nombre y apellido.' });
  assert.deepEqual(checkFullName('   '), { ok: false, error: 'Escribe tu nombre y apellido.' });
  const one = checkFullName('Nicolás');
  assert.equal(one.ok, false);
  assert.match(one.ok ? '' : one.error, /nombre y apellido/);
});

test('rejects an email, digits and symbols instead of saving them as a name', () => {
  for (const value of ['vespinoza@grupoexpro.com', 'Ana 2', 'Ana <b>Pérez</b>', 'Ana_Pérez Soto', '123 456', 'Ana / Pérez']) {
    const check = checkFullName(value);
    assert.equal(check.ok, false, value);
    assert.match(check.ok ? '' : check.error, /Usa solo letras/, value);
  }
});

test('rejects a name that is too long', () => {
  const check = checkFullName(`Ana ${'a'.repeat(130)}`);
  assert.equal(check.ok, false);
  assert.match(check.ok ? '' : check.error, /menos de 120/);
});
