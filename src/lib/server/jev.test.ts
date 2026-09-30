import assert from 'node:assert/strict';
import test from 'node:test';
import { askJev, JEV_STATE_CHARACTERS, jevConfigured, jevState } from './jev';

const questions = { denies: { type: 'noul' as const, instructions: 'The reply denies known context.' } };
const env = { TYPESAFE_API_KEY: 'test-key' };

function fakeFetch(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    return respond(String(url), init || {});
  }) as typeof fetch;
  return { calls, impl };
}

test('asks Jev with the key, the model and the questions, and reads its answers and cost', async () => {
  const { calls, impl } = fakeFetch(() => Response.json({ model: 'jev-1.13.0', answers: { denies: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 1000, output_tokens: 20 } }));
  const result = await askJev({ state: { request: 'hola' }, questions, env, fetchImpl: impl });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.answers, { denies: { type: 'noul', noul: 0.8 } });
  assert.equal(result.model, 'jev-1.13.0');
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.costUsd, 0.000042);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { state: { request: 'hola' }, model: 'jev-latest', questions });
});

test('without a key it does nothing and says it is disabled', async () => {
  const { calls, impl } = fakeFetch(() => Response.json({}));
  const result = await askJev({ state: 'x', questions, env: {}, fetchImpl: impl });
  assert.equal(result.status, 'disabled');
  assert.equal(result.answers, null);
  assert.equal(calls.length, 0);
  assert.equal(jevConfigured({}), false);
  assert.equal(jevConfigured(env), true);
});

test('an HTTP error, an unreadable answer or a timeout return no answers instead of throwing', async () => {
  const error = await askJev({ state: 'x', questions, env, fetchImpl: fakeFetch(() => new Response('no', { status: 401 })).impl });
  assert.deepEqual({ status: error.status, http: error.httpStatus, answers: error.answers }, { status: 'http_error', http: 401, answers: null });
  const invalid = await askJev({ state: 'x', questions, env, fetchImpl: fakeFetch(() => Response.json({ answers: { denies: { type: 'noul', noul: 7 } } })).impl });
  assert.equal(invalid.status, 'invalid');
  const slow = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  // A real request keeps the process alive through its socket; the fake needs a timer.
  const alive = setInterval(() => {}, 10);
  try {
    const timeout = await askJev({ state: 'x', questions, env, timeoutMs: 20, fetchImpl: slow.impl });
    assert.equal(timeout.status, 'timeout');
    assert.equal(timeout.answers, null);
  } finally {
    clearInterval(alive);
  }
});

test('a cancelled run is not hidden as a Jev failure', async () => {
  const controller = new AbortController();
  const hanging = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const pending = askJev({ state: 'x', questions, env, timeoutMs: 5000, signal: controller.signal, fetchImpl: hanging.impl });
  controller.abort();
  await assert.rejects(pending);
});

test('the state is clipped to what one request holds', () => {
  assert.equal((jevState('a'.repeat(JEV_STATE_CHARACTERS + 10)) as string).length, JEV_STATE_CHARACTERS);
  const big = jevState({ text: 'b'.repeat(JEV_STATE_CHARACTERS) });
  assert.equal(typeof big, 'string');
  assert.ok((big as string).length <= JEV_STATE_CHARACTERS);
  assert.deepEqual(jevState({ ok: true }), { ok: true });
});
