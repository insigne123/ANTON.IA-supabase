import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCompanyUrl, companyDomain, companySearchName, emailDomain, plainCompanyName, sameCompany } from './extension-company';

test('a company page is its LinkedIn handle, whatever tab or parameters it shows', () => {
  assert.equal(canonicalCompanyUrl('https://www.linkedin.com/company/Minera-Norte/people/?keywords=gerente'), 'https://www.linkedin.com/company/minera-norte');
  assert.equal(canonicalCompanyUrl('linkedin.com/company/12345/'), 'https://www.linkedin.com/company/12345');
  assert.equal(canonicalCompanyUrl('https://www.linkedin.com/in/ana'), '');
  assert.equal(canonicalCompanyUrl('https://evil.example/company/acme'), '');
  assert.equal(canonicalCompanyUrl(''), '');
});

test('a domain comes from a site, an address or an email, never from LinkedIn', () => {
  assert.equal(companyDomain('https://www.MineraNorte.cl/contacto'), 'mineranorte.cl');
  assert.equal(companyDomain('mineranorte.cl'), 'mineranorte.cl');
  assert.equal(companyDomain('https://www.linkedin.com/company/acme'), '');
  assert.equal(companyDomain('no es un sitio'), '');
  assert.equal(emailDomain('Ana@MineraNorte.cl'), 'mineranorte.cl');
  assert.equal(emailDomain(''), '');
});

test('names compare without case, accents, punctuation or legal suffix', () => {
  assert.equal(plainCompanyName('Minera Norte S.A.'), 'minera norte');
  assert.equal(plainCompanyName('MINERA NORTE'), 'minera norte');
  assert.equal(plainCompanyName('Logística Sur SpA'), 'logistica sur');
  assert.equal(plainCompanyName('Constructora Austral Ltda.'), 'constructora austral');
  assert.equal(companySearchName('Minera Norte S.A.'), 'Minera Norte');
  assert.equal(companySearchName('Logística Sur, SpA'), 'Logística Sur');
  assert.equal(companySearchName('Banco Falabella'), 'Banco Falabella');
});

test('the same company by its page, its domain or its plain name; a name inside another is not the same', () => {
  const keys = { linkedinUrl: 'https://www.linkedin.com/company/falabella', domain: 'falabella.com', name: 'Falabella' };
  assert.ok(sameCompany(keys, { linkedinUrl: 'linkedin.com/company/falabella/' }));
  assert.ok(sameCompany(keys, { domains: ['falabella.com'] }));
  assert.ok(sameCompany(keys, { name: 'FALABELLA S.A.' }));
  assert.ok(!sameCompany(keys, { name: 'Banco Falabella', domains: ['bancofalabella.cl'] }));
  assert.ok(!sameCompany({ linkedinUrl: '', domain: '', name: '' }, { name: '' }));
});
