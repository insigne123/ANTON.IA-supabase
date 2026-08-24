import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SerperSearchError,
  buildSerperCacheKey,
  normalizeSerperSearchInput,
  searchSerper,
} from './serper-search';

function withSerperApiKey<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.SERPER_API_KEY;
  if (value == null) delete process.env.SERPER_API_KEY;
  else process.env.SERPER_API_KEY = value;

  return run().finally(() => {
    if (previous == null) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = previous;
  });
}

test('normalizes explicit Serper localization and bounds result limits', () => {
  const normalized = normalizeSerperSearchInput({
    organizationId: 'org-a',
    kind: 'news',
    query: '  Acme   expansion  ',
    language: 'ES-cl',
    countryCode: 'CL',
    location: ' Santiago, Chile ',
    limit: 99,
  });

  assert.deepEqual(normalized.localization, {
    language: 'es-cl',
    countryCode: 'cl',
    location: 'Santiago, Chile',
  });
  assert.equal(normalized.query, 'Acme expansion');
  assert.equal(normalized.limit, 10);
});

test('tenant-aware cache keys do not expose tenant or query data', () => {
  const input = {
    kind: 'organic' as const,
    query: 'Acme hiring',
    language: 'es',
    countryCode: 'cl',
    limit: 5,
  };
  const first = buildSerperCacheKey({ ...input, organizationId: 'tenant-a' });
  const second = buildSerperCacheKey({ ...input, organizationId: 'tenant-b' });

  assert.notEqual(first, second);
  assert.doesNotMatch(first, /tenant-a|Acme/i);
});

test('calls Serper news with explicit localization and normalized results', async () => {
  await withSerperApiKey('serper-test-key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await searchSerper({
      organizationId: 'org-a',
      kind: 'news',
      query: 'Acme launches',
      language: 'es',
      countryCode: 'cl',
      location: 'Santiago, Chile',
      limit: 4,
    }, {
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({
          news: [{
            title: 'Acme opens a new office',
            link: 'https://news.example/acme',
            snippet: 'A growth signal.',
            source: 'Example News',
            date: '2 hours ago',
            position: 1,
          }],
          peopleAlsoAsk: [{ question: 'What does Acme do?' }],
        }), { status: 200 });
      }) as typeof fetch,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://google.serper.dev/news');
    assert.equal(new Headers(calls[0].init?.headers).get('x-api-key'), 'serper-test-key');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      q: 'Acme launches',
      gl: 'cl',
      hl: 'es',
      num: 4,
      location: 'Santiago, Chile',
    });
    assert.equal(result.provider, 'serper');
    assert.deepEqual(result.items, [{
      title: 'Acme opens a new office',
      link: 'https://news.example/acme',
      snippet: 'A growth signal.',
      source: 'Example News',
      date: '2 hours ago',
      position: 1,
    }]);
    assert.deepEqual(result.relatedQuestions, ['What does Acme do?']);
  });
});

test('retries only a definitive transient Serper HTTP failure', async () => {
  await withSerperApiKey('serper-test-key', async () => {
    let calls = 0;
    const result = await searchSerper({
      organizationId: 'org-a',
      kind: 'organic',
      query: 'Acme careers',
    }, {
      maxRetries: 1,
      retryDelayMs: 0,
      sleep: async () => {},
      fetch: (async () => {
        calls += 1;
        if (calls === 1) return new Response('provider failure with api key serper-test-key', { status: 503 });
        return new Response(JSON.stringify({
          organic: [{ title: 'Careers', link: 'https://acme.example/careers', snippet: 'Join Acme.' }],
        }), { status: 200 });
      }) as typeof fetch,
    });

    assert.equal(calls, 2);
    assert.equal(result.items.length, 1);
  });
});

test('redacts provider failures and does not fall back to SerpAPI credentials', async () => {
  const previousSerpApi = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = 'legacy-serpapi-secret';
  try {
    await withSerperApiKey(undefined, async () => {
      await assert.rejects(
        searchSerper({ organizationId: 'org-a', kind: 'organic', query: 'Acme' }),
        (error: any) => error instanceof SerperSearchError && error.code === 'SERPER_API_KEY_NOT_CONFIGURED',
      );
    });

    await withSerperApiKey('serper-test-key', async () => {
      await assert.rejects(
        searchSerper({ organizationId: 'org-a', kind: 'organic', query: 'Acme' }, {
          maxRetries: 1,
          fetch: (async () => new Response('api key serper-test-key leaked', { status: 401 })) as typeof fetch,
        }),
        (error: any) => {
          assert.equal(error.code, 'SERPER_HTTP_401');
          assert.doesNotMatch(error.message, /serper-test-key|leaked/i);
          return true;
        },
      );
    });
  } finally {
    if (previousSerpApi == null) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpApi;
  }
});

test('aborts a timeout without retrying an ambiguous provider request', async () => {
  await withSerperApiKey('serper-test-key', async () => {
    let calls = 0;
    let aborted = false;
    const fetchImpl = ((_: string, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('api key serper-test-key', 'AbortError'));
        }, { once: true });
      });
    }) as typeof fetch;

    await assert.rejects(
      searchSerper({ organizationId: 'org-a', kind: 'organic', query: 'Acme' }, {
        fetch: fetchImpl,
        timeoutMs: 5,
        maxRetries: 2,
      }),
      (error: any) => error instanceof SerperSearchError && error.code === 'SERPER_TIMEOUT',
    );
    assert.equal(calls, 1);
    assert.equal(aborted, true);
  });
});
