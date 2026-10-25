import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileUpdate, createEmptyProfileForm } from './profile-mappings';
import {
  COMPANY_PROFILE_FIELD_MAX, COMPANY_PROFILE_FIELDS, COMPANY_PROFILE_REVIEW_DAYS, companyFieldsFromProfile, companyProfileFields,
  companyProfileHasOffer, companyProfileReview, companyProfileServices,
} from './company-profile';

test('the company profile holds the company fields of «Perfil», never the person\'s name or role', () => {
  assert.ok(!COMPANY_PROFILE_FIELDS.includes('name' as never) && !COMPANY_PROFILE_FIELDS.includes('role' as never));
  const fields = companyProfileFields({ companyName: '  Yago SpA ', services: 'AXIS: consultas judiciales\r\nCarga por archivo', name: 'Nicolás', role: 'Gerente',
    targetCompanySize: 'enorme', sector: 7, description: 'x'.repeat(COMPANY_PROFILE_FIELD_MAX + 50) });
  assert.equal(fields.companyName, 'Yago SpA');
  assert.equal(fields.services, 'AXIS: consultas judiciales\nCarga por archivo');
  assert.equal(fields.targetCompanySize, '', 'an unknown size is no size');
  assert.equal(fields.sector, '', 'a number is not a sector');
  assert.equal(fields.description.length, COMPANY_PROFILE_FIELD_MAX);
  assert.equal('name' in fields || 'role' in fields, false);
  assert.deepEqual(companyProfileServices(fields), ['AXIS: consultas judiciales', 'Carga por archivo']);
  assert.deepEqual(companyProfileFields(null), companyProfileFields({}));
});

test('a person\'s «Perfil» gives its company part as the profile row stores it', () => {
  const row = { id: 'u1', ...buildProfileUpdate({ ...createEmptyProfileForm(), name: 'Nicolás', role: 'Gerente', companyName: 'Yago SpA', website: 'yago.cl',
    services: 'AXIS: consultas judiciales', proofPoints: 'Procesa 1.000 personas en 30 minutos', targetRoles: 'Gerente de Personas, Jefe de RR. HH.', targetCompanySize: '201-500' }) };
  const fields = companyFieldsFromProfile(row as never);
  assert.equal(fields.companyName, 'Yago SpA');
  assert.equal(fields.website, 'https://yago.cl', 'as «Perfil» shows it');
  assert.equal(fields.services, 'AXIS: consultas judiciales');
  assert.equal(fields.proofPoints, 'Procesa 1.000 personas en 30 minutos');
  assert.equal(fields.targetRoles, 'Gerente de Personas, Jefe de RR. HH.');
  assert.equal(fields.targetCompanySize, '201-500');
});

test('an offer is what it sells, the result it gets or what the company does; a name alone is not one', () => {
  assert.equal(companyProfileHasOffer(companyProfileFields({ companyName: 'Yago SpA', website: 'yago.cl' })), false);
  for (const field of ['services', 'valueProposition', 'description']) assert.equal(companyProfileHasOffer(companyProfileFields({ [field]: 'algo' })), true, field);
});

test('saving is reviewing; after the review window it asks to be looked at again', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  assert.deepEqual(companyProfileReview(null, now), { daysAgo: null, due: true });
  assert.deepEqual(companyProfileReview('2026-10-20T12:00:00Z', now), { daysAgo: 5, due: false });
  const old = new Date(now.getTime() - COMPANY_PROFILE_REVIEW_DAYS * 86_400_000).toISOString();
  assert.equal(companyProfileReview(old, now).due, true);
});
