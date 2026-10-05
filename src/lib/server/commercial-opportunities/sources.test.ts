import test from 'node:test';
import assert from 'node:assert/strict';
import { JSearchRequestError, searchJSearch } from './jsearch';
import { FantasticJobsError, fantasticRunPlan, searchFantasticJobs } from './fantastic-jobs';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('JSearch asks for Chile and the last month, sends the key only in its header and keeps the company data', async () => {
  let url = '', headers: Record<string, string> = {};
  const urls: string[] = [];
  const fetch = (async (input: string, init: RequestInit) => {
    url = input; headers = init.headers as Record<string, string>;
    urls.push(url);
    if (urls.length === 2) return json(200, { status: 'OK', data: { jobs: [], cursor: null } });
    return json(200, { status: 'OK', data: { jobs: [
      { job_id: 'j1', job_title: 'Operario de bodega', employer_name: 'Acme', employer_website: 'https://acme.cl', job_publisher: 'Computrabajo',
        job_apply_link: 'https://cl.computrabajo.com/j1', job_city: 'Calama', job_state: 'Antofagasta', job_country: 'CL', job_posted_at_datetime_utc: '2026-09-30T10:00:00.000Z' },
      { job_title: 'sin id' },
    ], cursor: 'next-page' } });
  }) as unknown as typeof globalThis.fetch;
  const result = await searchJSearch({ query: 'operario', numPages: 2 }, { fetch, key: 'secret-key' });
  const params = new URL(url).searchParams;
  assert.equal(new URL(url).host, 'jsearch.p.rapidapi.com');
  assert.equal(new URL(url).pathname, '/search-v2');
  assert.deepEqual([params.get('query'), params.get('country'), params.get('date_posted'), params.get('language'), params.get('cursor')], ['operario Chile', 'cl', 'month', 'es', 'next-page']);
  assert.equal(new URL(urls[0]).searchParams.has('cursor'), false);
  assert.equal(params.has('num_pages'), false);
  assert.equal(url.includes('secret-key'), false, 'the key never goes in the address');
  assert.equal(headers['x-rapidapi-key'], 'secret-key');
  assert.equal(result.ads.length, 1);
  assert.deepEqual([result.ads[0].companyDomain, result.ads[0].region], ['acme.cl', 'Antofagasta']);
  assert.deepEqual([result.requests, result.costUsd], [2, 0.005]);
});

test('JSearch v2 rejects malformed results, stops on repeated cursors and counts actual requests rather than requested pages', async () => {
  let calls = 0;
  const fetch = (async () => { calls++; return json(200, { status: 'OK', data: { jobs: [], cursor: 'same-cursor' } }); }) as unknown as typeof globalThis.fetch;
  const result = await searchJSearch({ query: 'Operario Chile', numPages: 5 }, { fetch, key: 'k' });
  assert.equal(calls, 2);
  assert.equal(result.requests, 2);
  assert.equal(result.costUsd, 0.005);
  assert.equal(result.cursor, null);
  const malformed = (async () => json(200, { data: [] })) as unknown as typeof globalThis.fetch;
  await assert.rejects(searchJSearch({ query: 'x' }, { fetch: malformed, key: 'k' }), /sin una lista/);
  await assert.rejects(searchJSearch({ query: 'x', page: 2 }, { fetch: malformed, key: 'k' }), /usa cursor/);
});

test('JSearch errors say what happened without the key', async () => {
  for (const [status, message] of [[403, /rechazó la clave/], [429, /temporalmente/], [500, /respondió 500/]] as const) {
    const fetch = (async () => json(status, {})) as unknown as typeof globalThis.fetch;
    await assert.rejects(searchJSearch({ query: 'x' }, { fetch, key: 'secret-key' }), (error: Error) => message.test(error.message) && !error.message.includes('secret-key'));
  }
  await assert.rejects(searchJSearch({ query: 'x' }, { fetch: globalThis.fetch, key: undefined }), /JSEARCH_API_KEY/);
});

test('Fantastic Jobs uses valid actor input for Chile, normalizes current numeric IDs and drops descriptions and recruiter', async () => {
  let url = '', body: Record<string, unknown> = {}, headers: Record<string, string> = {};
  const fetch = (async (input: string, init: RequestInit) => {
    url = input; body = JSON.parse(String(init.body)); headers = init.headers as Record<string, string>;
    return json(200, [{ id: 4100, title: 'Conductor Clase A', organization: 'Transportes Sur', organization_url: 'https://www.tsur.cl', description_text: 'No conservar',
      org_linkedin_size: '201-500', locations_derived: [{ city: 'Antofagasta', admin: 'Antofagasta', country: 'Chile' }],
      url: 'https://www.linkedin.com/jobs/view/4100', date_posted: '2026-09-29T08:00:00', recruiter_name: 'Ana Pérez', recruiter_url: 'https://www.linkedin.com/in/ana' }]);
  }) as unknown as typeof globalThis.fetch;
  const result = await searchFantasticJobs({ titles: ['operario', 'auxiliar de aseo', 'conductor'], limit: 50 }, { fetch, token: 'apify-token', usdPerJob: 0.005 });
  assert.ok(url.startsWith('https://api.apify.com/v2/acts/fantastic-jobs~advanced-linkedin-job-search-api/run-sync-get-dataset-items'));
  assert.equal(url.includes('apify-token'), false);
  assert.equal(headers.authorization, 'Bearer apify-token');
  const params = new URL(url).searchParams;
  assert.equal(params.get('maxTotalChargeUsd'), '1');
  assert.equal(params.get('forcePermissionLevel'), 'LIMITED_PERMISSIONS');
  assert.equal(params.get('restartOnError'), 'false');
  assert.deepEqual(body.titleSearch, ['operari:*', 'auxiliar de aseo', 'conductor:*']);
  assert.deepEqual([body.locationSearch, body.removeAgency, body.descriptionType, body.timeRange, body.limit], [['Chile'], true, 'text', '7d', 50]);
  assert.equal(body.recruiterOnly, false);
  assert.equal(result.ads[0].externalId, '4100');
  assert.equal(result.ads[0].companyDomain, 'tsur.cl');
  assert.ok(!JSON.stringify(result.ads).includes('Ana'));
  assert.ok(!JSON.stringify(result.ads).includes('No conservar'));
  assert.deepEqual([result.fetched, result.costUsd], [1, 0.015]);
  await assert.rejects(searchFantasticJobs({ titles: ['x'] }, { fetch, token: undefined }), /APIFY_TOKEN/);
});

test('JSearch distinguishes temporary throttling from quota exhaustion without exposing provider payloads', async () => {
  for (const [message, expected] of [['Too many requests secret-key', /temporalmente/], ['Daily quota exceeded secret-key', /temporalmente/], ['Monthly quota exceeded secret-key', /cupo del plan este mes/]] as const) {
    const fetch = (async () => json(429, { message })) as unknown as typeof globalThis.fetch;
    await assert.rejects(searchJSearch({ query: 'operario' }, { fetch, key: 'secret-key' }),
      (error: JSearchRequestError) => error instanceof JSearchRequestError && error.costUsd === 0 && error.stopQueries
        && expected.test(error.message) && !error.message.includes('secret-key'));
  }
});

test('a later JSearch page failure preserves paid first-page evidence and the estimate', async () => {
  let calls = 0;
  const fetch = (async () => ++calls === 1 ? json(200, { status: 'OK', data: { jobs: [{ job_id: 'j1', job_title: 'Operario', employer_name: 'Acme' }], cursor: 'next' } })
    : json(500, {})) as unknown as typeof globalThis.fetch;
  await assert.rejects(searchJSearch({ query: 'operario', numPages: 2 }, { fetch, key: 'k' }),
    (error: JSearchRequestError) => error.costUsd === 0.005 && error.ads[0]?.externalId === 'j1');
  const timeout = (async () => { throw new Error('network timeout secret-key'); }) as unknown as typeof globalThis.fetch;
  await assert.rejects(searchJSearch({ query: 'operario' }, { fetch: timeout, key: 'secret-key' }),
    (error: JSearchRequestError) => error.stopQueries && error.costUsd === 0.0025 && !error.message.includes('secret-key'));
});

test('Apify rejections before actor start do not imply a charge', async () => {
  for (const [status, type] of [[400, 'invalid-input'], [400, 'run-input-body-not-valid-json'], [401, 'invalid-token'], [402, 'x402-payment-required'],
    [403, 'insufficient-permissions'], [404, 'record-not-found'], [429, 'rate-limit-exceeded']] as const) {
    const fetch = (async () => json(status, { error: { type, message: 'private token' } })) as unknown as typeof globalThis.fetch;
    await assert.rejects(searchFantasticJobs({ titles: ['operario'] }, { fetch, token: 'private token' }),
      (error: FantasticJobsError) => error instanceof FantasticJobsError && !error.mayHaveCharged && !error.message.includes('private token'), `${status} ${type}`);
  }
});

test('a run that started and failed, outlived the wait or does not say which may have charged', async () => {
  const cases = [
    [400, { error: { type: 'run-failed', message: 'Actor run did not succeed (run ID: abc, status: FAILED) private token' } }, /empezó y falló \(run-failed\)/],
    [408, { error: { type: 'run-timeout-exceeded', message: 'Actor run exceeded the timeout of 300 seconds' } }, /más allá del tiempo de espera/],
    [400, { error: { message: 'private token' } }, /sin decir si la corrida empezó/],
    [400, 'not json', /sin decir si la corrida empezó/],
  ] as const;
  for (const [status, body, expected] of cases) {
    const fetch = (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;
    await assert.rejects(searchFantasticJobs({ titles: ['operario'] }, { fetch, token: 'private token' }),
      (error: FantasticJobsError) => error instanceof FantasticJobsError && error.mayHaveCharged && expected.test(error.message)
        && !error.message.includes('private token'), `${status} ${JSON.stringify(body)}`);
  }
  const down = (async () => json(503, {})) as unknown as typeof globalThis.fetch;
  await assert.rejects(searchFantasticJobs({ titles: ['operario'] }, { fetch: down, token: 't' }),
    (error: Error) => !(error instanceof FantasticJobsError) && error.message === 'Apify respondió 503.', 'a server error stays an unknown outcome');
});

test('Apify budget includes startup, reduces the requested jobs to the hard cap, and a zero cap never calls the provider', async () => {
  assert.deepEqual(fantasticRunPlan(200, 0.005, 1, 0.01), { enabled: true, limit: 198, maxRunUsd: 1, startUsd: 0.01, estimateUsd: 1 });
  let limit = 0;
  const fetch = (async (_url: string, init: RequestInit) => { limit = JSON.parse(String(init.body)).limit; return json(200, []); }) as unknown as typeof globalThis.fetch;
  const result = await searchFantasticJobs({ titles: ['operario'], limit: 1000 }, { fetch, token: 't', usdPerJob: 0.005, maxRunUsd: 1, startUsd: 0.01 });
  assert.equal(limit, 198);
  assert.equal(result.costUsd, 0.01, 'an empty run still incurs startup');
  await assert.rejects(searchFantasticJobs({ titles: ['operario'] }, { token: 't', maxRunUsd: 0,
    fetch: (async () => assert.fail('zero budget must not call Apify')) as unknown as typeof globalThis.fetch }), /tope por búsqueda/);
});

test('unexpected Apify responses are unknown outcomes rather than a zero-cost successful empty run', async () => {
  await assert.rejects(searchFantasticJobs({ titles: ['operario'] }, { token: 't',
    fetch: (async () => json(200, { error: 'unexpected shape' })) as unknown as typeof globalThis.fetch }), /no entregó una lista/);
});
