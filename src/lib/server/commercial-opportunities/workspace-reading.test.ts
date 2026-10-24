import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The reading of a report's documents, four parts at a time, with the model answering in memory.
const bundle = await build({
  stdin: { contents: `export { readOpportunityParts } from './src/lib/server/commercial-opportunities/workspace-reading'; export { AuthError } from '@/lib/server/auth-utils';`,
    loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /auth-utils$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { readOpportunityParts, AuthError } = compiled.exports;

const chunks = Array.from({ length: 38 }, (_, index) => ({ id: `c${index}`, document_id: index < 20 ? 'bases' : 'anexo', ordinal: index, locator: `p. ${index}`,
  content: `Fragmento ${index}: la garantía de seriedad es de 50 UF.` }));
const factOf = (block: any[]) => ({ facts: [{ text: `Hecho de ${block[0].id}`, state: 'documented', citations: [{ chunkId: block[0].id, quote: `Fragmento ${block[0].ordinal}: la garantía` }] }],
  missing: [`Falta en ${block[0].id}`] });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('ten parts are read four at a time, and their facts keep the documents\' order whichever answered first', async () => {
  let running = 0, most = 0;
  const notes: number[] = [];
  const result = await readOpportunityParts(chunks, async (block: any[]) => {
    running++; most = Math.max(most, running);
    // The later parts of each group answer first.
    await wait(40 - Number(block[0].ordinal) % 16 * 2);
    running--;
    return factOf(block);
  }, { started: Date.now(), note: async (read: number) => { notes.push(read); } });
  assert.equal(most, 4, 'never more than four calls at once');
  assert.deepEqual(notes, [0, 4, 8], 'one note per group, with the parts already read');
  assert.equal(result.waiting, false);
  assert.deepEqual(result.facts.map((fact: any) => fact.text), Array.from({ length: 10 }, (_, part) => `Hecho de c${part * 4}`));
  assert.deepEqual(result.missing.slice(0, 2), ['Falta en c0', 'Falta en c4']);
  assert.equal(result.facts[0].citations.length, 1, 'a citation that is in its fragment stays');
  assert.equal(result.skipped, 0);
});

test('an unreadable part is skipped and counted; a budget refusal stops the job once every call of its group has ended', async () => {
  const skipped = await readOpportunityParts(chunks.slice(0, 16), async (block: any[]) => {
    if (block[0].id === 'c4') throw new AuthError('La evaluación no terminó. Conservamos los datos y el consumo observado.', 503);
    return factOf(block);
  }, { started: Date.now(), note: async () => undefined });
  assert.deepEqual([skipped.skipped, skipped.facts.length], [1, 3]);
  const ended: string[] = [];
  await assert.rejects(readOpportunityParts(chunks, async (block: any[]) => {
    if (block[0].id === 'c4') throw new AuthError('Oportunidades llegó al tope de US$20 de octubre. Se renueva el 1 de noviembre.', 402);
    await wait(20); ended.push(block[0].id);
    return factOf(block);
  }, { started: Date.now(), note: async () => undefined }), (error: any) => error.status === 402);
  assert.deepEqual(ended.sort(), ['c0', 'c12', 'c8'], 'the rest of the group finished, and no other group started');
});

test('a turn that has run out of time waits for the next one before starting a group', async () => {
  let clock = 0, calls = 0;
  const result = await readOpportunityParts(chunks, async (block: any[]) => { calls++; clock += 50_000; return factOf(block); },
    { started: 0, now: () => clock, note: async () => undefined });
  // The first group ends at 200 s of turn: past 120 s, the second waits.
  assert.deepEqual([result.waiting, calls], [true, 4]);
});
