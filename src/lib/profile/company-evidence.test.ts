import test from 'node:test';
import assert from 'node:assert/strict';

import { findCompanyEvidence, parseCompanyEvidence } from './company-evidence';

test('company evidence requires tenant scope and never calls providers without it', async () => {
  let calls = 0;
  const evidence = await findCompanyEvidence(
    { companyName: 'Acme' },
    { search: async () => { calls += 1; return { items: [] }; } },
  );
  assert.deepEqual(evidence, []);
  assert.equal(calls, 0);
});

test('company evidence prefers the official site and maps Serper results', async () => {
  const seen: string[] = [];
  const evidence = await findCompanyEvidence(
    { companyName: 'Acme', domain: 'acme.cl', organizationId: 'org-1' },
    {
      search: async (input) => {
        seen.push(input.query);
        assert.equal(input.organizationId, 'org-1');
        return { items: [
          { title: 'Acme', link: 'https://acme.cl/servicios', snippet: 'Servicios B2B.', source: 'acme.cl', date: null, position: 1 },
          { title: 'Sin extracto', link: 'https://example.com', snippet: '', source: null, date: null, position: 2 },
        ] };
      },
      fetchHtml: async (url) => {
        assert.equal(url, 'https://acme.cl/');
        return '<html><head><title>Acme - Servicios</title><meta name="description" content="Outsourcing para empresas."></head><body><p>Acme presta servicios de soporte.</p></body></html>';
      },
    },
  );
  assert.ok(seen[0].startsWith('site:acme.cl '));
  assert.equal(evidence[0].official, true);
  assert.equal(evidence[0].source, 'acme.cl');
  assert.match(evidence[0].snippet, /Outsourcing/);
  assert.equal(evidence[1].link, 'https://acme.cl/servicios');
  assert.equal(evidence.length, 2);
});

test('company evidence survives official site failures and quotes name-only searches', async () => {
  const seen: string[] = [];
  const evidence = await findCompanyEvidence(
    { companyName: 'Acme', organizationId: 'org-1' },
    {
      search: async (input) => {
        seen.push(input.query);
        return { items: [{ title: 'Acme', link: 'https://noticias.cl/acme', snippet: 'Acme crece.', source: 'noticias.cl', date: null, position: 1 }] };
      },
      fetchHtml: async () => { throw new Error('OFFICIAL_SITE_HTTP_404'); },
    },
  );
  assert.match(seen[0], /^"Acme"/);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].official, undefined);
});

test('company evidence keeps concise attributable search results', () => {
  const evidence = parseCompanyEvidence({
    organic_results: [
      { title: 'Empresa', link: 'https://empresa.cl', snippet: 'Servicios B2B.', displayed_link: 'empresa.cl' },
      { title: 'Sin extracto', link: 'https://example.com' },
    ],
  });

  assert.deepEqual(evidence, [{
    title: 'Empresa',
    link: 'https://empresa.cl',
    snippet: 'Servicios B2B.',
    source: 'empresa.cl',
  }]);
});
