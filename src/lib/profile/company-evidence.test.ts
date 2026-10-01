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

test('company evidence searches inside the company domain and never fetches a page itself', async () => {
  const seen: string[] = [];
  const evidence = await findCompanyEvidence(
    { companyName: 'Acme', domain: 'acme.cl', organizationId: 'org-1' },
    {
      search: async (input) => {
        seen.push(input.query);
        assert.equal(input.organizationId, 'org-1');
        return { items: [
          { title: 'Acme', link: 'https://acme.cl/servicios', snippet: 'Servicios B2B.', source: 'acme.cl', date: null, position: 1 },
          { title: 'Acme', link: 'https://acme.cl/servicios/', snippet: 'Duplicado.', source: 'acme.cl', date: null, position: 2 },
          { title: 'Sin extracto', link: 'https://example.com', snippet: '', source: null, date: null, position: 3 },
        ] };
      },
    },
  );
  assert.ok(seen[0].startsWith('site:acme.cl '));
  assert.deepEqual(evidence.map((item) => item.link), ['https://acme.cl/servicios']);
});

test('company evidence quotes name-only searches and survives a provider failure', async () => {
  const seen: string[] = [];
  const evidence = await findCompanyEvidence(
    { companyName: 'Acme', organizationId: 'org-1' },
    {
      search: async (input) => {
        seen.push(input.query);
        return { items: [{ title: 'Acme', link: 'https://noticias.cl/acme', snippet: 'Acme crece.', source: 'noticias.cl', date: null, position: 1 }] };
      },
    },
  );
  assert.match(seen[0], /^"Acme"/);
  assert.equal(evidence.length, 1);
  const failed = await findCompanyEvidence({ companyName: 'Acme', organizationId: 'org-1' }, { search: async () => { throw new Error('SERPER_DOWN'); } });
  assert.deepEqual(failed, []);
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
