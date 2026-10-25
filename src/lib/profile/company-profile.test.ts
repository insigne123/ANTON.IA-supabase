import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileUpdate, createEmptyProfileForm } from './profile-mappings';
import { mapProfileToForm } from './profile-mappings';
import {
  COMPANY_PROFILE_FIELD_MAX, COMPANY_PROFILE_FIELDS, COMPANY_PROFILE_REVIEW_DAYS, companyFieldsFromProfile, companyProfileFields,
  companyProfileHasOffer, companyProfileReview, companyProfileServices, companyServicesFor, companyServicesPicked, mergeCompanySuggestion, withCompanyProfile,
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

test('read through the company profile, a person keeps their name and role and sells what the company sells', () => {
  const seller = { id: 'u2', email: 'camila@yago.cl', ...buildProfileUpdate({ ...createEmptyProfileForm(), name: 'Camila R.', role: 'Ejecutiva comercial',
    companyName: 'Yago', services: 'SADT: contratos en la DT', valueProposition: 'Mi propia versión', targetRoles: 'Jefe de RR. HH.', targetLocations: 'Valparaíso' }) };
  const company = companyProfileFields({ companyName: 'Yago SpA', website: 'yago.cl', services: 'AXIS: consultas judiciales\nSADT: registro de contratos en la DT',
    valueProposition: 'Revisamos antecedentes en minutos.', proofPoints: 'Procesa 1.000 personas en 30 minutos', targetRoles: 'Gerente de Personas' });
  const read = mapProfileToForm(withCompanyProfile(seller, company));
  assert.equal(read.name, 'Camila R.');
  assert.equal(read.role, 'Ejecutiva comercial');
  assert.equal(read.companyName, 'Yago SpA');
  assert.equal(read.website, 'https://yago.cl');
  assert.equal(read.valueProposition, 'Revisamos antecedentes en minutos.');
  assert.equal(read.services, 'AXIS: consultas judiciales\nSADT: registro de contratos en la DT');
  assert.equal(read.proofPoints, 'Procesa 1.000 personas en 30 minutos');
  assert.equal(read.targetRoles, 'Gerente de Personas');
  // A field the company profile leaves empty keeps the person's.
  assert.equal(read.targetLocations, 'Valparaíso');
  assert.equal((withCompanyProfile(seller, company) as { email?: string }).email, 'camila@yago.cl');
  // Without a company profile with an offer, the row as it was.
  assert.equal(withCompanyProfile(seller, null), seller);
  assert.equal(withCompanyProfile(seller, companyProfileFields({ companyName: 'Yago SpA' })), seller);
});

test('a person who sells only some of the company\'s products reads only those; picks that are gone read all', () => {
  const company = companyProfileFields({ services: 'AXIS: consultas judiciales\nSADT: registro de contratos en la DT', valueProposition: 'x' });
  const picking = (companyServices: unknown) => ({ id: 'u3', signatures: { profile_extended: { companyServices } } });
  assert.deepEqual(companyServicesPicked(picking(['SADT: registro de contratos en la DT', ' ', 7])), ['SADT: registro de contratos en la DT', '7']);
  assert.deepEqual(companyServicesPicked(null), []);
  assert.equal(mapProfileToForm(withCompanyProfile(picking(['SADT: registro de contratos en la DT']), company)).services, 'SADT: registro de contratos en la DT');
  assert.deepEqual(companyServicesFor(company, ['Producto que ya no existe']), ['AXIS: consultas judiciales', 'SADT: registro de contratos en la DT']);
  assert.deepEqual(companyServicesFor(company, []), ['AXIS: consultas judiciales', 'SADT: registro de contratos en la DT']);
});

test('«Usar» fills the empty fields and adds the products not listed yet; what the admin wrote stays', () => {
  const values = companyProfileFields({ companyName: 'Yago SpA', services: 'AXIS: consultas judiciales', valueProposition: 'Lo que escribió el administrador.' });
  const { values: merged, added } = mergeCompanySuggestion(values, {
    companyName: 'Otra', services: 'axis: consultas judiciales\nSADT: registro de contratos', valueProposition: 'Otra cosa', proofPoints: '500 contratos al día',
  });
  assert.equal(merged.companyName, 'Yago SpA');
  assert.equal(merged.valueProposition, 'Lo que escribió el administrador.');
  assert.equal(merged.services, 'AXIS: consultas judiciales\nSADT: registro de contratos');
  assert.equal(merged.proofPoints, '500 contratos al día');
  assert.equal(added, 2);
  assert.equal(mergeCompanySuggestion(merged, { services: 'SADT: registro de contratos' }).added, 0);
});
