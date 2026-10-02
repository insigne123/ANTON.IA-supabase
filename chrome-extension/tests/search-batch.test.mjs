import test from 'node:test';
import assert from 'node:assert/strict';
import { availableResults, batchSummary, chosenProfiles } from '../ui/search-batch.ts';

const result = (handle, extra = {}) => ({ linkedinUrl: `https://www.linkedin.com/in/${handle}`, fullName: handle, headline: 'Gerente en Acme', title: 'Gerente', companyName: 'Acme', ...extra });

test('«Seleccionar disponibles» leaves out the people the organization already knows, up to 25', () => {
  const results = [result('ana'), result('bruno'), result('carla')];
  const presence = { 'https://www.linkedin.com/in/bruno': { label: 'Guardado por Ana', tone: 'info', blocks: false } };
  assert.deepEqual(availableResults(results, presence), ['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/carla']);
  const many = Array.from({ length: 40 }, (_, index) => result(`p${index}`));
  assert.equal(availableResults(many, {}).length, 25);
});

test('the chosen people go with what the results show', () => {
  assert.deepEqual(chosenProfiles([result('ana'), result('bruno', { headline: '' })], ['https://www.linkedin.com/in/bruno']), [
    { linkedinUrl: 'https://www.linkedin.com/in/bruno', fullName: 'bruno', title: 'Gerente', companyName: 'Acme' },
  ]);
  assert.deepEqual(chosenProfiles([result('ana')], ['https://www.linkedin.com/in/ana'])[0].details, { headline: 'Gerente en Acme' });
});

test('the summary says what happened to each group', () => {
  const person = name => ({ linkedinUrl: `https://www.linkedin.com/in/${name}`, fullName: name });
  assert.equal(batchSummary({ saved: [person('Ana'), person('Bruno')], already: [person('Carla')], blocked: [{ ...person('Diego'), reason: 'En conversación con Ana' }], failed: [] }),
    '2 contactos guardados en tu organización. 1 ya estaba guardado. No se guardó Diego (En conversación con Ana).');
  assert.equal(batchSummary({ saved: [], already: [], blocked: [], failed: [{ ...person('Eva'), error: 'x' }] }), '1 no se pudo guardar: vuelve a intentarlo.');
  assert.equal(batchSummary({ saved: [], already: [], blocked: [], failed: [] }), 'No había nadie para guardar.');
});
