import test from 'node:test';
import assert from 'node:assert/strict';

import { N8nResearchRequestError, requestN8nResearch } from '@/lib/server/n8n-research-client';

const request = {
  webhook: 'https://n8n.example.test/webhook/research',
  headers: { 'Content-Type': 'application/json' },
  payload: { id: 'lead-1' },
  useSocialContext: true,
  timeoutMs: 25,
};

test('falls back once without social context after a definitive social server failure', async () => {
  const calls: Array<Record<string, any>> = [];
  const responses = [
    new Response(JSON.stringify({ error: 'social failed' }), { status: 502 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ];
  const fetchImpl = async (_url: any, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return responses.shift()!;
  };

  const result = await requestN8nResearch(request, { fetch: fetchImpl as typeof fetch });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].use_social_context, true);
  assert.equal(calls[1].use_social_context, false);
  assert.equal(result.fellBackToNonSocial, true);
  assert.equal(result.usedSocialContext, false);
  assert.equal(result.response.status, 200);
});

test('does not retry auth or bad-request failures', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const result = await requestN8nResearch(request, {
      fetch: (async () => {
        calls++;
        return new Response('{}', { status });
      }) as typeof fetch,
    });

    assert.equal(calls, 1);
    assert.equal(result.response.status, status);
    assert.equal(result.fellBackToNonSocial, false);
  }
});

test('falls back after a definitive social rate-limit response', async () => {
  let calls = 0;
  const result = await requestN8nResearch(request, {
    fetch: (async () => {
      calls++;
      return new Response('{}', { status: calls === 1 ? 429 : 200 });
    }) as typeof fetch,
  });

  assert.equal(calls, 2);
  assert.equal(result.fellBackToNonSocial, true);
});

test('aborts an ambiguous timeout without retrying', async () => {
  let calls = 0;
  let aborted = false;
  const fetchImpl = ((_url: any, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }) as typeof fetch;

  await assert.rejects(
    requestN8nResearch({ ...request, timeoutMs: 5 }, { fetch: fetchImpl }),
    (error: any) => error instanceof N8nResearchRequestError && error.kind === 'timeout',
  );
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});
