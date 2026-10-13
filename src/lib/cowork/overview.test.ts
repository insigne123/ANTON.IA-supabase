import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_TODAY_PROMPTS, coworkFirstName, coworkOfferMessage, coworkOverviewFigures, coworkTodayItems, type CoworkOverview } from './overview';

const overview = (patch: Partial<CoworkOverview> = {}): CoworkOverview => ({
  firstName: 'Nicolás', hasOffer: true, contacts: 128, withEmail: 96, campaigns: 3, linkedin: { used: 12, limit: 20 }, ...patch,
});

test('the home greets by the first name, and only by a name', () => {
  assert.equal(coworkFirstName('  Nicolás   Yarur '), 'Nicolás');
  assert.equal(coworkFirstName(null), null);
  assert.equal(coworkFirstName('   '), null);
  assert.equal(coworkFirstName('1234 5678'), null);
});

test('the figures read in order, in singular or plural, and a figure that could not be read is left out', () => {
  assert.deepEqual(coworkOverviewFigures(overview()).map(figure => [figure.value, figure.label, figure.total ?? null]), [
    [128, 'contactos guardados', null], [96, 'con correo', null], [3, 'campañas', null], [8, 'invitaciones de LinkedIn libres esta semana', null],
  ]);
  assert.deepEqual(coworkOverviewFigures(overview({ contacts: 1, withEmail: 1, campaigns: 1, linkedin: null })).map(figure => figure.label),
    ['contacto guardado', 'con correo', 'campaña']);
  // Unknown is not zero: nothing is made up.
  assert.deepEqual(coworkOverviewFigures(overview({ contacts: null, withEmail: null, campaigns: null, linkedin: null })), []);
  // «con correo» only means something next to the contacts.
  assert.deepEqual(coworkOverviewFigures(overview({ contacts: 0, withEmail: 0 })).map(figure => figure.id), ['contacts', 'campaigns', 'linkedin']);
  assert.deepEqual(coworkOverviewFigures(null), []);
});

test('the «Cuéntame qué vendes» message carries what was written and the site when given', () => {
  assert.equal(coworkOfferMessage('  revisión de antecedentes   en minutos. ', ''), 'Guarda en mi perfil lo que vendo: revisión de antecedentes en minutos.');
  assert.equal(coworkOfferMessage('software de RR. HH.', ' https://yago.cl '),
    'Guarda en mi perfil lo que vendo: software de RR. HH. Mi sitio web es https://yago.cl.');
  // Only the site: Cowork reads it and proposes who to aim at, instead of asking to save an offer that was never written.
  assert.equal(coworkOfferMessage('  ', ' https://contafacil.cl '), 'Mi web es https://contafacil.cl, ayúdame a partir');
});

test('«Para hoy» brings who is ready to write and who still lacks an email, from the real figures only', () => {
  assert.deepEqual(coworkTodayItems(overview({ contacts: 7, withEmail: 4, toWrite: 4 })).map(item => [item.text, item.action]), [
    ['4 contactos con correo aún no reciben nada de ti', 'Escribirles'],
    ['3 contactos guardados no tienen correo', 'Buscar sus correos'],
  ]);
  assert.deepEqual(coworkTodayItems(overview({ contacts: 2, withEmail: 1, toWrite: 1 })).map(item => item.text),
    ['1 contacto con correo aún no recibe nada de ti', '1 contacto guardado no tiene correo']);
  assert.equal(coworkTodayItems(overview({ contacts: 5, withEmail: 5, toWrite: 0 })).length, 0, 'everyone written and with an email: nothing to push');
  assert.deepEqual(coworkTodayItems(overview({ contacts: 5, withEmail: 3, toWrite: null })).map(item => item.id), ['emails'], 'an unknown count is left out');
  assert.equal(coworkTodayItems(overview({ contacts: null, withEmail: null, toWrite: null })).length, 0);
  assert.equal(coworkTodayItems(null).length, 0);
  assert.equal(coworkTodayItems(overview({ contacts: 7, withEmail: 4, toWrite: 4 }))[0].prompt, COWORK_TODAY_PROMPTS.write);
});
