import assert from 'node:assert/strict';
import test from 'node:test';
import { offerText, profileOffer, profileOfferDetails } from './suplia-context';

test('offer text reads strings and JSON profiles without "[object Object]"', () => {
  assert.equal(offerText('  Automatizamos consultas judiciales  '), 'Automatizamos consultas judiciales');
  assert.equal(offerText({ valueProposition: 'Verificación de antecedentes en minutos' }), 'Verificación de antecedentes en minutos');
  assert.equal(offerText({ name: 'Yago', products: ['AXIS', { name: 'SADT', description: 'registro DT masivo' }] }), 'Yago. Productos: AXIS; SADT: registro DT masivo');
  assert.equal(offerText({ unrelated: { nested: true } }), '');
  assert.equal(offerText(null), '');
});

test('the own offer comes from «Perfil» (signatures.profile_extended) before older fields', () => {
  const profile = { company_name: 'Yago SpA', company_profile: { valueProposition: 'Oferta antigua' },
    signatures: { gmail: { html: '<p>firma</p>' }, profile_extended: { valueProposition: 'AXIS consulta el PJUD por lote.', services: 'AXIS, SADT' } } };
  assert.equal(profileOffer(profile), 'AXIS consulta el PJUD por lote. Productos y servicios: AXIS; SADT.');
  assert.equal(profileOffer({ company_profile: { valueProposition: 'Oferta antigua' } }), 'Oferta antigua');
  assert.equal(profileOffer({ company_name: 'Yago SpA', companyName: 'Yago SpA', company: 'Yago' }), null, 'a name is not an offer');
  assert.doesNotMatch(JSON.stringify(profileOfferDetails(profile)), /firma/);
});

test('«Perfil» fields longer than the shared normalizer allows are clipped, not thrown', () => {
  const long = 'x'.repeat(5000);
  const details = profileOfferDetails({ company_name: 'Y'.repeat(900), signatures: { profile_extended: {
    description: long, valueProposition: long, services: [long, long], proofPoints: [long], sector: long, role: long } } });
  assert.ok(details.offer && details.offer.length <= 600);
  assert.equal(details.services.length, 1, 'repeated services collapse into one');
  assert.ok(details.proofPoints[0].length <= 1900);
});
