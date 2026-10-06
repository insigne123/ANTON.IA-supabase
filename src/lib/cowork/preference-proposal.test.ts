import test from 'node:test';
import assert from 'node:assert/strict';

import { coworkPreferenceAlreadyKept, coworkPreferenceKey, coworkPreferenceLabel, coworkPreferenceSchema, coworkRememberSuggestion } from './preference-proposal';

test('the card says what will be remembered and for whom', () => {
  assert.equal(coworkPreferenceLabel({ text: 'No le escribo a empresas de la competencia', scope: 'personal' }),
    'Recordar solo para ti: «No le escribo a empresas de la competencia»');
  assert.equal(coworkPreferenceLabel({ text: ' Tono cercano, sin tutear ', scope: 'organization' }),
    'Recordar para todo tu equipo: «Tono cercano, sin tutear»');
  assert.ok(coworkPreferenceLabel({ text: 'a'.repeat(240), scope: 'personal' }).length <= 280);
});

test('the same preference keeps the same key', () => {
  assert.equal(coworkPreferenceKey('  No le escribo a la competencia.  '), coworkPreferenceKey('no le escribo a la   competencia'));
});

test('a preference is one short sentence for a known audience', () => {
  assert.equal(coworkPreferenceSchema.safeParse({ text: 'ok', scope: 'personal' }).success, false);
  assert.equal(coworkPreferenceSchema.safeParse({ text: 'x'.repeat(241), scope: 'personal' }).success, false);
  assert.equal(coworkPreferenceSchema.safeParse({ text: 'Firma siempre como Nico', scope: 'team' }).success, false);
  assert.equal(coworkPreferenceSchema.safeParse({ text: 'Firma siempre como Nico', scope: 'personal', extra: 1 }).success, false);
});

test('a preference already remembered is recognized, a change of mind is not', () => {
  const memories = ['No le escribo a empresas de seguridad privada', 'Tono cercano: tuteamos a los prospectos'];
  assert.equal(coworkPreferenceAlreadyKept('No le escribo a empresas de seguridad privada.', memories), true);
  assert.equal(coworkPreferenceAlreadyKept('Nunca le escribo a empresas de seguridad privada', memories), true);
  // Saying the opposite is a change, not a repeat.
  assert.equal(coworkPreferenceAlreadyKept('Ahora sí le escribo a empresas de seguridad privada', memories), false);
  assert.equal(coworkPreferenceAlreadyKept('Firmo como Nico', memories), false);
  assert.equal(coworkPreferenceAlreadyKept('No le escribo a empresas de seguridad privada', []), false);
});

test('a preference asked for next to another task becomes a quick reply that asks to remember it', () => {
  assert.deepEqual(coworkRememberSuggestion('escríbeme un correo para los gerentes de retail, y recuerda que siempre firmo como Nico'),
    { label: 'Recordarlo para la próxima', message: 'Recuerda que siempre firmo como Nico' });
  assert.equal(coworkRememberSuggestion('De ahora en adelante, tuteamos a los prospectos. Escríbele a Ana')?.message, 'Recuerda que tuteamos a los prospectos');
  assert.equal(coworkRememberSuggestion('escríbele a Ana para agendar'), null);
  assert.equal(coworkRememberSuggestion('¿recuerdas qué le escribí a Ana?'), null);
});
