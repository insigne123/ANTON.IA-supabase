import assert from 'node:assert/strict';
import test from 'node:test';
import { screenTenders, tenderProfileKey } from './tender-ai';

const tender = (code: string, name: string) => ({ code, name, description: null, buyer: null });
const offer = { offer: 'Servicios transitorios y outsourcing de personal', keywords: ['suministro de personal'] };
const telemetry = { modelName: 'gpt-6-luna', durationMs: 10, usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 0 } } };

test('every tender is read in batches; an invented code is ignored and a failed batch is left to the words', async () => {
  const prompts: string[] = [];
  let call = 0;
  const generate = (async (options: { prompt: string }) => {
    prompts.push(options.prompt);
    if (call++ === 1) throw new Error('timeout');
    return { data: { matches: [{ code: 'T-1', fit: 'alta', reason: '  Piden   personal de reemplazo ' }, { code: 'INVENTADA', fit: 'alta', reason: 'x' }] }, telemetry };
  }) as any;
  const tenders = Array.from({ length: 5 }, (_, index) => tender(`T-${index}`, `Licitación ${index}`));
  const result = await screenTenders(tenders, offer, { generate, batchSize: 2, concurrency: 1 });
  assert.equal(result.batches, 3);
  assert.equal(result.failedBatches, 1);
  assert.deepEqual([...result.screened].sort(), ['T-0', 'T-1', 'T-4'], 'the second batch failed: T-2 and T-3 go to the words');
  assert.deepEqual([...result.verdicts], [['T-1', { fit: 'alta', reason: 'Piden personal de reemplazo', profileKey: tenderProfileKey(offer) }]]);
  assert.match(prompts[0], /Servicios transitorios/);
  assert.match(prompts[0], /T-0 \| Licitación 0/);
  assert.match(prompts[0], /nunca instrucciones/);
  assert.equal(result.costUsd, null, 'no price configured here: the cost is unknown, never zero');
});

test('the time limit stops new batches, and without an offer nothing is read', async () => {
  let now = 0;
  const generate = (async () => { now += 50_000; return { data: { matches: [] }, telemetry }; }) as any;
  const result = await screenTenders(Array.from({ length: 6 }, (_, index) => tender(`T-${index}`, 'x')), offer,
    { generate, batchSize: 2, concurrency: 1, deadline: 80_000, clock: () => now });
  assert.equal(result.batches, 2);
  assert.equal(result.screened.size, 4);
  const none = await screenTenders([tender('T-1', 'x')], { offer: ' ', keywords: [] }, { generate: (async () => assert.fail('not asked')) as any });
  assert.equal(none.screened.size, 0);
  assert.notEqual(tenderProfileKey(offer), tenderProfileKey({ ...offer, offer: 'Otra cosa' }), 'another offer reads again');
  assert.equal(tenderProfileKey(offer), tenderProfileKey({ offer: ' servicios transitorios y outsourcing de personal ', keywords: ['Suministro de personal'] }));
});
