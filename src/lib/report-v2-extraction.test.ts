import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

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

test('fallback preserves useful content, metadata, JSON-LD and country links without scripts or navigation', () => {
  const title = 'Servicios de personal para empresas';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Empresa de personal',
    dateModified: '2026-04-02T18:18:45Z',
  };
  const html = `<html><head>
    <title>${title}</title>
    <meta name="description" content="Soluciones de personal para empresas.">
  </head><body>
    <h1>${title}</h1>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script>{"require":[["maybeDisableAnimations",null,null,[]]]}</script>
    <style>body { color: purple; }</style>
    <noscript>Activar JavaScript para continuar.</noscript>
    <template><p>Contenido de plantilla.</p></template>
    <nav hidden><a href="/chile/">Chile</a><a href="/peru/">Peru</a><a href="/colombia/">Colombia</a></nav>
    <footer>Informacion legal y privacidad.</footer>
    <form><button>Ingresar con cuenta.</button></form>
    <svg aria-hidden="true"><text>Icono de menu</text></svg>
  </body></html>`;
  // A title-only page has no article, so this exercises the real body fallback.
  const dom = new JSDOM(html);
  assert.equal(new Readability(dom.window.document).parse(), null);
  dom.window.close();

  const evidence = parseWebEvidenceV2({
    html,
    url: 'https://example.test/',
    retrievedAt: golden.capturedAt,
  });

  assert.equal(evidence.text, title);
  assert.deepEqual(evidence.blocks, [title]);
  assert.equal(evidence.source.title, title);
  assert.equal(evidence.metaDescription, 'Soluciones de personal para empresas.');
  assert.equal(evidence.source.modifiedAt, '2026-04-02T18:18:45.000Z');
  assert.deepEqual(evidence.jsonLd, [jsonLd]);
  assert.deepEqual(evidence.links, [
    { text: 'Chile', url: 'https://example.test/chile' },
    { text: 'Peru', url: 'https://example.test/peru' },
    { text: 'Colombia', url: 'https://example.test/colombia' },
  ]);
});

test('accepts long document and Open Graph titles within the 500-character source limit', () => {
  for (const title of ['a'.repeat(500), 'a'.repeat(501), 'Servicios de personal '.repeat(100).trim()]) {
    for (const metadata of [`<title>${title}</title>`, `<meta property="og:title" content="${title}">`]) {
      const evidence = parseWebEvidenceV2({
        html: `<html><head>${metadata}</head><body><p>Contenido util para empresas.</p></body></html>`,
        url: 'https://example.test/',
        retrievedAt: golden.capturedAt,
      });

      assert.ok(evidence.source.title.length <= 500);
      assert.equal(evidence.source.title, title.length > 500 ? truncateAtWord(title, 497) : title);
      assert.match(evidence.text, /Contenido util para empresas/);
    }
  }
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
