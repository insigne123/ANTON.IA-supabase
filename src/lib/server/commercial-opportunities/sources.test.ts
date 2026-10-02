import test from 'node:test';
import assert from 'node:assert/strict';
import { searchJSearch } from './jsearch';
import { searchFantasticJobs } from './fantastic-jobs';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('JSearch asks for Chile and the last month, sends the key only in its header and keeps the company data', async () => {
  let url = '', headers: Record<string, string> = {};
  const fetch = (async (input: string, init: RequestInit) => {
    url = input; headers = init.headers as Record<string, string>;
    return json(200, { data: [
      { job_id: 'j1', job_title: 'Operario de bodega', employer_name: 'Acme', employer_website: 'https://acme.cl', job_publisher: 'Computrabajo',
        job_apply_link: 'https://cl.computrabajo.com/j1', job_city: 'Calama', job_state: 'Antofagasta', job_country: 'CL', job_posted_at_datetime_utc: '2026-09-30T10:00:00.000Z' },
      { job_title: 'sin id' },
    ] });
  }) as unknown as typeof globalThis.fetch;
  const result = await searchJSearch({ query: 'operario', numPages: 2 }, { fetch, key: 'secret-key' });
  const params = new URL(url).searchParams;
  assert.equal(new URL(url).host, 'jsearch.p.rapidapi.com');
  assert.deepEqual([params.get('query'), params.get('country'), params.get('date_posted'), params.get('num_pages')], ['operario', 'cl', 'month', '2']);
  assert.equal(url.includes('secret-key'), false, 'the key never goes in the address');
  assert.equal(headers['x-rapidapi-key'], 'secret-key');
  assert.equal(result.ads.length, 1);
  assert.deepEqual([result.ads[0].companyDomain, result.ads[0].region], ['acme.cl', 'Antofagasta']);
  assert.deepEqual([result.requests, result.costUsd], [2, 0.005]);
});

test('JSearch errors say what happened without the key', async () => {
  for (const [status, message] of [[403, /rechazó la clave/], [429, /cupo/], [500, /respondió 500/]] as const) {
    const fetch = (async () => json(status, {})) as unknown as typeof globalThis.fetch;
    await assert.rejects(searchJSearch({ query: 'x' }, { fetch, key: 'secret-key' }), (error: Error) => message.test(error.message) && !error.message.includes('secret-key'));
  }
  await assert.rejects(searchJSearch({ query: 'x' }, { fetch: globalThis.fetch, key: undefined }), /JSEARCH_API_KEY/);
});

test('Fantastic Jobs runs on Apify for Chile, without agencies or descriptions, and drops the recruiter', async () => {
  let url = '', body: Record<string, unknown> = {}, headers: Record<string, string> = {};
  const fetch = (async (input: string, init: RequestInit) => {
    url = input; body = JSON.parse(String(init.body)); headers = init.headers as Record<string, string>;
    return json(200, [{ id: '4100', title: 'Conductor Clase A', organization: 'Transportes Sur', organization_url: 'https://www.tsur.cl',
      org_linkedin_size: '201-500', locations_derived: [{ city: 'Antofagasta', admin: 'Antofagasta', country: 'Chile' }],
      url: 'https://www.linkedin.com/jobs/view/4100', date_posted: '2026-09-29T08:00:00', recruiter_name: 'Ana Pérez', recruiter_url: 'https://www.linkedin.com/in/ana' }]);
  }) as unknown as typeof globalThis.fetch;
  const result = await searchFantasticJobs({ titles: ['operario', 'auxiliar de aseo', 'conductor'], limit: 50 }, { fetch, token: 'apify-token', usdPerJob: 0.005 });
  assert.ok(url.startsWith('https://api.apify.com/v2/acts/fantastic-jobs~advanced-linkedin-job-search-api/run-sync-get-dataset-items'));
  assert.equal(url.includes('apify-token'), false);
  assert.equal(headers.authorization, 'Bearer apify-token');
  assert.deepEqual(body.titleSearch, ['operari:*', 'auxiliar de aseo', 'conductor:*']);
  assert.deepEqual([body.locationSearch, body.removeAgency, body.descriptionType, body.timeRange, body.limit], [['Chile'], true, '', '7d', 50]);
  assert.equal(result.ads[0].companyDomain, 'tsur.cl');
  assert.ok(!JSON.stringify(result.ads).includes('Ana'));
  assert.deepEqual([result.fetched, result.costUsd], [1, 0.005]);
  await assert.rejects(searchFantasticJobs({ titles: ['x'] }, { fetch, token: undefined }), /APIFY_TOKEN/);
});
