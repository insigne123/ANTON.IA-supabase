import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSupliaResearchCache,
  researchSimilarweb,
  researchWhois,
  supliaResearchTestInternals,
} from './suplia-research-tools';

const originalFetch = globalThis.fetch;

test('normalizes research domains', () => {
  assert.equal(supliaResearchTestInternals.normalizeResearchDomain('https://www.Example.com/path?a=1'), 'example.com');
  assert.equal(supliaResearchTestInternals.normalizeResearchDomain('m.example.com'), 'example.com');
});

test('research.similarweb parses public payloads and caches results', async () => {
  clearSupliaResearchCache();
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      GlobalRank: { Rank: 12345 },
      CategoryRank: { Category: 'Business', Rank: 33 },
      Engagments: { Visits: '4567', BounceRate: '0.42', PagePerVisit: '2.7' },
      TrafficSources: { Direct: '0.3', SearchOrganic: '0.5' },
      TopCountryShares: [{ CountryCode: 'CL', Value: 0.7 }],
    }), { status: 200 });
  };

  try {
    const first: any = await researchSimilarweb({ domain: 'https://www.example.com/path' }, {} as any);
    const second: any = await researchSimilarweb({ domain: 'example.com' }, {} as any);

    assert.equal(first.domain, 'example.com');
    assert.equal(first.status, 'completed');
    assert.equal(first.visitsMonthly, 4567);
    assert.deepEqual(first.cache, { hit: false });
    assert.deepEqual(second.cache, { hit: true });
    assert.equal(calls, 1);
  } finally {
    (globalThis as any).fetch = originalFetch;
    clearSupliaResearchCache();
  }
});

test('research.similarweb returns fallback on provider errors', async () => {
  clearSupliaResearchCache();
  (globalThis as any).fetch = async () => new Response('forbidden', { status: 403 });

  try {
    const result: any = await researchSimilarweb({ domain: 'example.com', cache: false }, {} as any);

    assert.equal(result.status, 'unavailable');
    assert.equal(result.source, 'similarweb_public');
    assert.match(String((result.warnings as string[])[0]), /similarweb_http_403/);
  } finally {
    (globalThis as any).fetch = originalFetch;
    clearSupliaResearchCache();
  }
});

test('research.whois parses domain details payloads', async () => {
  clearSupliaResearchCache();
  (globalThis as any).fetch = async () => new Response(JSON.stringify({
    registrar: 'Example Registrar',
    creationDate: '2020-01-02T00:00:00Z',
    expiryDate: '2030-01-02T00:00:00Z',
    available: false,
    nameServers: ['ns1.example.com', 'ns2.example.com'],
  }), { status: 200 });

  try {
    const result: any = await researchWhois({ domain: 'example.com' }, {} as any);

    assert.equal(result.status, 'completed');
    assert.equal(result.registrar, 'Example Registrar');
    assert.equal(result.created, '2020-01-02T00:00:00Z');
    assert.equal(result.available, false);
    assert.deepEqual(result.nameservers, ['ns1.example.com', 'ns2.example.com']);
  } finally {
    (globalThis as any).fetch = originalFetch;
    clearSupliaResearchCache();
  }
});

test('builds safe search research queries', () => {
  assert.equal(
    supliaResearchTestInternals.buildSerpQuery('serp_jobs_signals', { company: 'Acme', location: 'Chile' }),
    '"Acme" hiring jobs careers contratando Chile',
  );
  assert.equal(
    supliaResearchTestInternals.buildSerpQuery('brand_mentions', { company: 'Acme', domain: 'https://www.acme.com' }),
    '"Acme" -site:acme.com',
  );
  assert.equal(
    supliaResearchTestInternals.buildSerpQuery('serp_jobs_signals', { company: 'Acme', domain: 'acme.com' }),
    'site:acme.com (careers OR jobs OR empleo OR vacantes OR trabajar)',
  );
  assert.equal(
    supliaResearchTestInternals.buildSerpQuery('serp_company_news', { company: 'Acme', domain: 'acme.com' }),
    '"Acme" noticias novedades expansión alianza lanzamiento -site:acme.com',
  );
});
