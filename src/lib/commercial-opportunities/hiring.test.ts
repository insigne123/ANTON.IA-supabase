import assert from 'node:assert/strict';
import test from 'node:test';
import { chileanRegion, companyKey, domainOf, employerKind, groupHiring, jobAdFromFantastic, jobAdFromJSearch, type JobAd } from './hiring';

const NOW = '2026-10-02T12:00:00Z';
const PROFILE = { roles: ['operario', 'bodeguero', 'conductor', 'guardia'], regions: ['Antofagasta'], minAds: 3, clients: ['Retail Andes'], contactsCompanies: ['Minera Norte S.A.'] };
const ad = (externalId: string, title: string, company: string, extra: Partial<JobAd> = {}): JobAd => ({
  source: 'jsearch', externalId, title, company, companyDomain: null, companyLinkedinUrl: null, companySize: null, companyIndustry: null,
  location: 'Antofagasta, Antofagasta, Chile', region: 'Antofagasta', publisher: 'Computrabajo', url: `https://cl.computrabajo.com/${externalId}`,
  postedAt: '2026-09-28T12:00:00Z', ...extra });

test('regions are found by name or city, in Spanish or English', () => {
  assert.equal(chileanRegion('Calama, Antofagasta, Chile'), 'Antofagasta');
  assert.equal(chileanRegion('Santiago Metropolitan Region, Chile'), 'Metropolitana');
  assert.equal(chileanRegion('Viña del Mar'), 'Valparaíso');
  assert.equal(chileanRegion('Concepción, Biobío'), 'Biobío');
  assert.equal(chileanRegion('Lima, Perú'), null);
});

test('agencies, boards and anonymous posters are not companies that hire', () => {
  assert.equal(employerKind('Adecco Chile'), 'agency');
  assert.equal(employerKind('Servicios Transitorios del Norte SpA'), 'agency');
  assert.equal(employerKind('Consultora en RR. HH. Talento'), 'agency');
  assert.equal(employerKind('Consultora Minera Andina'), 'company', 'a mining consultancy hires for itself');
  assert.equal(employerKind('Importante empresa del rubro'), 'anonymous');
  assert.equal(employerKind('Confidencial'), 'anonymous');
  assert.equal(employerKind('Minera Norte S.A.'), 'company');
});

test('a company is its site, or its name without legal suffixes', () => {
  assert.equal(companyKey({ company: 'Securitas Chile S.A.', companyDomain: null }), 'name:securitas');
  assert.equal(companyKey({ company: 'Securitas', companyDomain: null }), 'name:securitas');
  assert.equal(companyKey({ company: 'Lo que sea', companyDomain: 'acme.cl' }), 'domain:acme.cl');
  assert.equal(domainOf('https://www.acme.cl/trabaja-con-nosotros'), 'acme.cl');
  assert.equal(domainOf('https://cl.linkedin.com/company/acme'), null, 'a social profile is not the site');
});

test('JSearch and Fantastic Jobs ads become the same shape, without the person who posted them', () => {
  const jsearch = jobAdFromJSearch({ job_id: 'j1', job_title: 'Operario de bodega', employer_name: 'Acme', employer_website: 'https://acme.cl',
    job_publisher: 'Computrabajo', job_apply_link: 'https://cl.computrabajo.com/oferta/j1', job_city: 'Calama', job_state: 'Antofagasta', job_country: 'CL',
    job_posted_at_datetime_utc: '2026-09-30T10:00:00.000Z', job_description: 'texto largo' });
  assert.deepEqual(jsearch, { source: 'jsearch', externalId: 'j1', title: 'Operario de bodega', company: 'Acme', companyDomain: 'acme.cl', companyLinkedinUrl: null,
    companySize: null, companyIndustry: null, location: 'Calama, Antofagasta, CL', region: 'Antofagasta', publisher: 'Computrabajo',
    url: 'https://cl.computrabajo.com/oferta/j1', postedAt: '2026-09-30T10:00:00.000Z' });
  const linkedin = jobAdFromFantastic({ id: '4100', title: 'Conductor Clase A', organization: 'Transportes Sur', organization_url: 'https://www.tsur.cl',
    organization_linkedin_url: 'https://www.linkedin.com/company/tsur', org_linkedin_size: '201-500', org_linkedin_industry: 'Truck Transportation',
    locations_derived: [{ city: 'Antofagasta', admin: 'Antofagasta', country: 'Chile' }], url: 'https://www.linkedin.com/jobs/view/4100', date_posted: '2026-09-29T08:00:00',
    recruiter_name: 'Ana Pérez', recruiter_url: 'https://www.linkedin.com/in/ana' });
  assert.equal(linkedin?.companyDomain, 'tsur.cl');
  assert.equal(linkedin?.region, 'Antofagasta');
  assert.equal(linkedin?.companySize, '201-500');
  assert.ok(!JSON.stringify(linkedin).includes('Ana'), 'the recruiter is not kept');
  assert.equal(jobAdFromJSearch({ job_title: 'Sin id' }), null);
});

test('companies with enough ads, each ad once across boards, scored with their reasons', () => {
  const ads = [
    ad('a1', 'Operario de bodega', 'Acme S.A.', { companyDomain: 'acme.cl' }),
    ad('a1-li', 'Operario de Bodega', 'Acme', { source: 'linkedin', companyDomain: 'acme.cl', publisher: 'LinkedIn', companySize: '201-500' }),
    ad('a2', 'Operarias de producción', 'Acme', { companyDomain: 'acme.cl', postedAt: '2026-09-20T12:00:00Z' }),
    ad('a3', 'Bodeguero', 'Acme', { companyDomain: 'acme.cl', postedAt: '2026-09-30T12:00:00Z' }),
    ad('a4', 'Conductor', 'Acme', { companyDomain: 'acme.cl', postedAt: '2026-08-01T12:00:00Z' }),
    ad('m1', 'Guardia de seguridad', 'Minera Norte'), ad('m2', 'Guardias', 'Minera Norte S.A.'), ad('m3', 'Conductores', 'Minera Norte'),
    ad('r1', 'Cajero', 'Retail Andes'), ad('r2', 'Cajera', 'Retail Andes'), ad('r3', 'Reponedor', 'Retail Andes'),
    ad('x1', 'Operario', 'Adecco'), ad('x2', 'Operario', 'Confidencial'), ad('s1', 'Operario', 'Solo Uno'),
  ];
  const result = groupHiring(ads, PROFILE, { now: NOW });
  assert.deepEqual(result.opportunities.map(item => item.company), ['Acme', 'Minera Norte', 'Retail Andes'], 'the client goes last');
  const acme = result.opportunities[0];
  assert.equal(acme.ads, 3, 'the same ad in two boards counts once, and one from August is out of the window');
  assert.deepEqual(acme.roles, [{ role: 'operario', ads: 2 }, { role: 'bodeguero', ads: 1 }]);
  assert.equal(acme.size, '201-500');
  assert.deepEqual(acme.reasons, ['3 avisos en 30 días (2 en la última semana)', 'cargos: operario (2), bodeguero (1)', 'en Antofagasta', '201-500 empleados', 'aún no es contacto']);
  assert.equal(acme.score, 20 + 5 + 20 + 10 + 10);
  assert.ok(result.opportunities[1].reasons.includes('ya tienes contactos ahí'));
  assert.ok(result.opportunities[2].isClient);
  assert.deepEqual(result.skipped, { agency: 1, anonymous: 1, old: 1, noCompany: 0 });
  assert.ok(acme.evidence.every(item => item.url?.startsWith('https://')));
});
