import test from 'node:test';
import assert from 'node:assert/strict';

import { campaignObjectiveFromProfile } from './campaign-objective';

test('the objective starts from the value proposition and up to three services', () => {
  const objective = campaignObjectiveFromProfile({
    valueProposition: 'Ayudamos a centros de distribución a cubrir peaks sin sobrecostos.',
    description: 'Empresa de servicios transitorios.',
    services: '- Servicios transitorios: personal para peaks\n• Outsourcing de bodega\n\nReclutamiento masivo\nCapacitación',
  });
  assert.equal(objective, 'Ofrecemos: Ayudamos a centros de distribución a cubrir peaks sin sobrecostos.\n'
    + 'Servicios: Servicios transitorios: personal para peaks; Outsourcing de bodega; Reclutamiento masivo');
});

test('without a value proposition the description says what is offered', () => {
  assert.equal(campaignObjectiveFromProfile({ valueProposition: ' ', description: 'Software de\n  turnos para retail.', services: '' }),
    'Ofrecemos: Software de turnos para retail.');
  assert.equal(campaignObjectiveFromProfile({ valueProposition: '', description: '', services: 'Auditoría de nómina' }), 'Servicios: Auditoría de nómina');
});

test('a profile that says nothing about the offer leaves the objective empty', () => {
  assert.equal(campaignObjectiveFromProfile({ valueProposition: '', description: '', services: '' }), '');
});

test('a long offer is cut to fit the field', () => {
  const objective = campaignObjectiveFromProfile({ valueProposition: 'a'.repeat(5000), description: '', services: 'b'.repeat(5000) });
  assert.ok(objective.length <= 2000);
  assert.match(objective, /^Ofrecemos: a+…\nServicios: b+…$/);
});
