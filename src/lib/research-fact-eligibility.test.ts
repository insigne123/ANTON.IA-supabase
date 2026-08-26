import assert from 'node:assert/strict';
import test from 'node:test';

import { mentionsResearchCompany } from './research-fact-eligibility';

test('mentionsResearchCompany accepts the company name in its actual order', () => {
  assert.equal(mentionsResearchCompany(
    'Industrias San Miguel amplió su operación regional.',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), true);
});

test('mentionsResearchCompany rejects a different company with the same reordered words', () => {
  assert.equal(mentionsResearchCompany(
    'San Miguel Industrias PET opera una planta de reciclaje botella a botella.',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), false);
});

test('mentionsResearchCompany rejects a different company with extra identity terms', () => {
  assert.equal(mentionsResearchCompany(
    'Banco Nacional de Chile publicó sus resultados.',
    { companyName: 'Banco de Chile', companyDomain: 'bancochile.cl' },
  ), false);
});

test('mentionsResearchCompany tolerates omitted legal suffixes', () => {
  assert.equal(mentionsResearchCompany(
    'Acme Logistics presentó su nueva operación.',
    { companyName: 'Acme Logistics SpA', companyDomain: 'acme-logistics.example' },
  ), true);
});

test('mentionsResearchCompany still accepts the verified company domain', () => {
  assert.equal(mentionsResearchCompany(
    'Más información en https://www.ism.global/nuestra-historia',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), true);
});
