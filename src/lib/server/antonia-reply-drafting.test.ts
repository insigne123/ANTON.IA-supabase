import assert from 'node:assert/strict';
import test from 'node:test';

import { replySellerOffer, sentEmailText } from './antonia-reply-drafting';
import { normalizeSellerProfile } from './seller-profile';

test('the sent email is read from its text, or from its HTML when there is no text', () => {
  assert.equal(sentEmailText({ text: 'Hola Felipe,\n\nReemplazamos turnos.', html: '<p>otro</p>' }), 'Hola Felipe,\n\nReemplazamos turnos.');
  assert.equal(sentEmailText({ text: '  ', html: '<p>Hola Felipe,</p><p>Reemplazamos turnos.</p>' }), 'Hola Felipe,\n\nReemplazamos turnos.');
  assert.equal(sentEmailText(null), '');
});

test('the reply offer is what the sender profile sells, not the lead research', () => {
  const seller = normalizeSellerProfile({
    company_name: 'ServiPro',
    signatures: { profile_extended: {
      description: 'Outsourcing y servicios transitorios.',
      services: 'Dotación de personal temporal\nReemplazo de turnos el mismo día',
      valueProposition: 'Ponemos la dotación que necesitas por el tiempo que la necesitas.',
    } },
  });
  assert.deepEqual(replySellerOffer(seller), {
    description: 'Outsourcing y servicios transitorios.',
    services: ['Dotación de personal temporal', 'Reemplazo de turnos el mismo día'],
    valueProposition: 'Ponemos la dotación que necesitas por el tiempo que la necesitas.',
    proofPoints: [],
  });
});
