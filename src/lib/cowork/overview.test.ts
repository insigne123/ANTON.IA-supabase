import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkFirstName, coworkOfferMessage, coworkOverviewFigures, type CoworkOverview } from './overview';

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
    [128, 'contactos guardados', null], [96, 'con correo', null], [3, 'campañas', null], [12, 'invitaciones de LinkedIn esta semana', 20],
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
