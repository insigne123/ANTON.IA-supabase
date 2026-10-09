import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobSchema, createExecutorBuildProvider, CoworkBuildUnavailable, CoworkBuildOutcomeUnknown } from './build-provider';
const job = { id: 'cowork-code-1234', requestHash: 'a'.repeat(64), generation: '00000000-0000-4000-8000-000000000001', attempt: 1, status: 'running', result: null };
test('admission, inspection and cancel use the same identity and never send work on a poll', async () => {
  const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
  const transport = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body });
    assert.equal(init?.redirect, 'error'); assert.equal((init?.headers as Record<string,string>).authorization, 'Bearer fixture');
    if (url.endsWith('capabilities')) return Response.json({ asynchronous: true,durableJobs: true,cancellation: true,maxConcurrency: 1,maxTimeoutMs: 120000 });
    return Response.json(job, { status: url.endsWith('/v2/jobs') ? 202 : 200 });
  };
  const provider = createExecutorBuildProvider('https://executor.example.test', 'fixture', transport as typeof fetch);
  await provider.capabilities(); await provider.admit({ idempotencyKey: job.id, language: 'node', code: 'fixture',files: [] });
  await provider.inspect(job.id); await provider.cancel(job.id);
  assert.equal(calls[2].method, 'GET'); assert.equal(calls[2].body, undefined);
  assert.ok(calls[3].url.endsWith(`${job.id}/cancel`));
  assert.throws(() => buildJobSchema.parse({ ...job,status: 'completed' }), /durable result/);
  await assert.rejects(provider.inspect('../other'), /Invalid build identity/);
});
test('transport ambiguity is distinguishable from a conflict and never becomes a new job', async () => {
  const offline = createExecutorBuildProvider('https://executor.example.test','fixture', (async () => { throw new Error('network'); }) as typeof fetch);
  await assert.rejects(offline.inspect(job.id), CoworkBuildUnavailable);
  const conflict = createExecutorBuildProvider('https://executor.example.test','fixture', (async () => Response.json({}, { status: 409 })) as typeof fetch);
  await assert.rejects(conflict.admit({idempotencyKey:job.id,language:'node',code:'x',files:[]}), CoworkBuildOutcomeUnknown);
});
