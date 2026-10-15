import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkAgentInstructions } from './agent-instructions';

test('the batch instruction counts people already among the contacts apart, with the number the card will show', () => {
  // Production, 15 oct: «Propongo guardar esos 10» above a card «Guardar a 6 personas» and, below, «4 personas ya estaban listas».
  const text = coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false, prepareBatch: true }).prepareBatchCapability || '';
  assert.match(text, /savedLeadId ya está en tus contactos: no lo cuentes entre las que vas a guardar/);
  assert.match(text, /cuántas son nuevas y cuántas ya estaban/);
  assert.match(text, /\{leadId: savedLeadId\}/);
});
