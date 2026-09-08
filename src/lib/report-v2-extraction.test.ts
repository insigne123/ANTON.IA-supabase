import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalResearchUrl,
  isCleanEvidenceText,
  parseWebEvidenceV2,
  resolveEntityFromExistingContextV2,
  truncateAtWord,
} from './report-v2-extraction';

const fixtureRoot = 'test/fixtures/grupoexpro';
const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync(`${fixtureRoot}/provider-context.json`, 'utf8'));

function parseFixture(file: string, url: string, jurisdiction?: 'CL' | 'PE' | 'CO' | 'GLOBAL') {
  return parseWebEvidenceV2({
    html: readFileSync(`${fixtureRoot}/${file}`, 'utf8'),
    url,
    targetDomain: golden.domain,
    retrievedAt: golden.capturedAt,
    jurisdiction,
  });
}

test('extracts readable evidence, dates, links, JSON-LD, tables and contextual numbers', () => {
  const about = parseFixture('quienes-somos.html', 'https://www.grupoexpro.com/quienes-somos/?utm_source=test', 'GLOBAL');
  const registry = parseFixture('registry.html', 'https://registrotrabajo.example/2026/03/05/grupoexpro/', 'PE');
  const values = new Set(about.numbers.map((number) => number.value));

  assert.equal(about.source.canonicalUrl, 'https://grupoexpro.com/quienes-somos');
  assert.equal(about.source.modifiedAt, '2026-04-02T18:18:45.000Z');
  assert.equal(about.source.sourceType, 'corporate');
  golden.expected.requiredNumbers.forEach((number: number) => assert.ok(values.has(number), `Missing numeric value ${number}`));
  assert.ok(about.blocks.some((block) => block.includes('12.000 colaboradores')));
  assert.ok(about.blocks.every((block) => !/[<>]|elementor|wp-content|hummingbird/i.test(block)));
  assert.equal(registry.source.publishedAt, '2026-03-05T17:00:00.000Z');
  assert.equal(registry.jsonLd.length, 1);
  assert.deepEqual(registry.tables[0]?.headers, ['Empresa', 'Estado']);
});

test('filters technical noise and truncates only at a word boundary', () => {
  assert.equal(isCleanEvidenceText('<section class="elementor-section">'), false);
  assert.equal(isCleanEvidenceText('https://example.test/wp-content/site.js'), false);
  assert.equal(truncateAtWord('one two three four', 13), 'one two three...');
  assert.ok(!truncateAtWord('centralizada completamente', 18).endsWith('centraliz...'));
  assert.equal(canonicalResearchUrl('https://WWW.Example.test/a/?utm_medium=email&keep=1#section'), 'https://example.test/a?keep=1');
});

test('resolves Peru jurisdiction and lets the imported title override provider seniority', () => {
  const sources = [
    parseFixture('quienes-somos.html', 'https://grupoexpro.com/quienes-somos/', 'GLOBAL'),
    parseFixture('peru.html', 'https://grupoexpro.com/peru/quienes-somos/', 'PE'),
  ];
  const entity = resolveEntityFromExistingContextV2({
    contact: provider.contact,
    domain: golden.domain,
    sources,
  });

  assert.equal(entity.contactCountry, golden.expected.contactCountry);
  assert.equal(entity.contact.seniority, golden.expected.seniority);
  assert.equal(entity.contact.title, golden.contact.title);
  assert.equal(entity.countryScopedPaths.CL, '/chile/');
  assert.equal(entity.countryScopedPaths.PE, '/peru/');
  assert.ok(entity.excludedPaths.includes('/chile/'));
  assert.ok(entity.operatingCountries.includes('CO'));
});

test('frozen search and provider inputs require no network call', () => {
  const serper = JSON.parse(readFileSync(`${fixtureRoot}/serper-results.json`, 'utf8'));
  assert.equal(provider.networkCallPerformed, false);
  assert.ok(serper.results.length >= 6);
  assert.ok(serper.results.every((result: any) => result.fixture && result.link));
});
