import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGenericResearchText,
  isHardRejectedResearchUrl,
  isHardRejectedResearchText,
  mentionsResearchCompany,
} from './research-fact-eligibility';

test('hard-rejected challenge text cannot be diluted with substantive-looking padding', () => {
  const poisoned = [
    'Acme Logistics ofrece soluciones empresariales para operaciones regionales. '.repeat(12),
    'One moment, please... Loader Please wait while your request is being verified.',
  ].join(' ');

  assert.ok(poisoned.length > 320);
  assert.equal(isHardRejectedResearchText(poisoned), true);
  assert.equal(isGenericResearchText(poisoned), true);
  assert.equal(isHardRejectedResearchText('Verify you are human with hCaptcha before continuing.'), true);
  assert.equal(isHardRejectedResearchText('Just a moment...'), true);
  assert.equal(isHardRejectedResearchUrl('https://acme.example/cdn-cgi/challenge-platform/h/g/orchestrate'), true);
  assert.equal(isHardRejectedResearchText('Acme explica cómo reCAPTCHA ayuda a proteger formularios públicos.'), false);
});

test('hard-rejected research text excludes leaked HTML and static asset paths', () => {
  assert.equal(isHardRejectedResearchText('GrupoExpro <section class="elementor-section elementor-element-026ce62">'), true);
  assert.equal(isHardRejectedResearchText('com/wp-content/uploads/hummingbird-assets/09e805aff56cad98a711e'), true);
  assert.equal(isHardRejectedResearchText('doctype html> GrupoExpro | Te ayudamos a encontrar el trabajo que necesitas'), true);
  assert.equal(isHardRejectedResearchText('GrupoExpro ofrece servicios de reclutamiento y selección para distintas industrias.'), false);
});

test('ordinary navigation remains a conservative length-bounded generic filter', () => {
  assert.equal(isGenericResearchText('Skip to main content'), true);
  assert.equal(isGenericResearchText(`${'Acme publishes useful operational context. '.repeat(12)} Skip to main content`), false);
});

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
