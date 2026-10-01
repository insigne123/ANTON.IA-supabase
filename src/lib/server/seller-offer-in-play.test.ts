import assert from 'node:assert/strict';
import test from 'node:test';
import { sellerWithOfferInPlay } from './seller-profile';

const seller = {
  name: 'Nicolás Yarur', jobTitle: 'Gerente Comercial', companyName: 'Yago', companyDomain: 'yago.cl', sector: 'Software',
  description: 'Software para RR. HH.', services: ['Outsourcing de nómina', 'AXIS: revisión de antecedentes'],
  valueProposition: 'Ordenamos la nómina de empresas medianas', proofPoints: ['40 clientes en Chile'],
};

test('a product promoted in the conversation is what the draft offers; the person and their company stay', () => {
  const next = sellerWithOfferInPlay(seller, '  AXIS: revisión de antecedentes laborales en minutos ');
  assert.equal(next.valueProposition, 'AXIS: revisión de antecedentes laborales en minutos');
  assert.deepEqual(next.services, ['AXIS: revisión de antecedentes laborales en minutos']);
  assert.deepEqual([next.name, next.jobTitle, next.companyName, next.proofPoints], [seller.name, seller.jobTitle, seller.companyName, seller.proofPoints]);
  // Without an offer in play, «Perfil» as it is.
  assert.equal(sellerWithOfferInPlay(seller, null), seller);
  assert.equal(sellerWithOfferInPlay(seller, '   '), seller);
});
