import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_CHIP, availableResults, batchSummary, chosenProfiles, creditsNote, enrichSummary } from '../ui/search-batch.ts';

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

test('«Buscar correo» says what each person got, and the credits it used', () => {
  const person = (handle, outcome, extra = {}) => ({ linkedinUrl: `https://www.linkedin.com/in/${handle}`, fullName: handle, outcome, ...extra });
  const summary = enrichSummary({ consumed: 3, people: [person('ana', 'email', { email: 'ana@acme.cl' }), person('bruno', 'had_email'),
    person('carla', 'not_found'), person('diego', 'pending'), person('eva', 'blocked')] });
  assert.equal(summary, '2 quedan con correo en «Por escribir». 1 sigue en búsqueda: aparecerá en «Por escribir». 1 quedó sin correo: puedes escribirles por LinkedIn. 1 no se guardó: lo trabaja alguien de tu equipo. Usaste 3 créditos.');
  assert.match(enrichSummary({ consumed: 0, people: [person('ana', 'failed')], warning: 'Se acabaron tus créditos de hoy: se renuevan mañana.' }), /^Se acabaron tus créditos/);
  assert.equal(enrichSummary({ consumed: 0, people: [] }), 'No había nadie para buscar.');
  assert.equal(OUTCOME_CHIP.email.tone, 'success');
  assert.equal(OUTCOME_CHIP.blocked.tone, 'warning');
});

test('the cost is said before, against what is left today', () => {
  assert.equal(creditsNote(0, 50), 'Usa 1 crédito por persona sin correo; quien ya tenía correo no gasta.');
  assert.equal(creditsNote(3, 50), 'Usa hasta 3 créditos de los 50 que te quedan hoy. Quien ya tenía correo no gasta.');
  assert.equal(creditsNote(1, null), 'Usa hasta 1 crédito. Quien ya tenía correo no gasta.');
  assert.equal(creditsNote(5, 2), 'Te quedan 2 créditos hoy: alcanza para 2 personas. Elige menos o busca mañana.');
});
