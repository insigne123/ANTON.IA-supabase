import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as zod from 'zod';
import * as campaigns from '../../../../../lib/bulk-campaigns';
import * as assist from '../../../../../lib/bulk-campaign-assist';
import * as voice from '../../../../../lib/voice-own-samples';

test('sequence endpoint authenticates, budgets once and preserves the requested schedule', async () => {
  const calls: string[] = [];
  const modules: Record<string, any> = {
    'next/server': { NextResponse: { json: (body: unknown) => body } },
    zod,
    '@/lib/bulk-campaigns': campaigns,
    '@/lib/bulk-campaign-assist': assist,
    '@/lib/server/bulk-campaigns': {
      requireBulkCampaignAuth: async () => { calls.push('auth'); return { organizationId: 'org', user: { id: 'user' } }; },
      bulkCampaignError: (error: Error) => { throw error; },
    },
    '@/lib/server/bulk-ai-budget': { consumeAssistBudget: async () => { calls.push('budget'); } },
    '@/ai/openai-json': { generateStructured: async (options: any) => {
      calls.push('generate');
      const input = JSON.parse(options.prompt);
      assert.deepEqual(input.followUpDelays, [5, 9]);
      return { messages: [0, 1, 2].map(index => ({ subject: `Correo ${index}`, body: 'Texto completo', delayDays: 90 })) };
    } },
    '@/lib/server/campaign-follow-ups': { writeCampaignFollowUps: async () => [], reviseCampaignSequence: async () => [] },
    '@/lib/server/voice-own-samples': { voiceSamplesFor: async () => [] },
    '@/lib/voice-own-samples': voice,
  };
  const exports: any = {};
  const compiled = ts.transpileModule(readFileSync('src/app/api/campaigns/bulk/assist/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', compiled)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const result = await exports.POST({ json: async () => ({ mode: 'sequence', objective: 'Presentar el servicio', audience: '', relationship: 'never_contacted', followUpDelays: [5, 9] }) });
  assert.deepEqual(calls, ['auth', 'budget', 'generate']);
  assert.deepEqual(result.messages.map((value: any) => value.delayDays), [0, 5, 9]);
  calls.length = 0;
  await assert.rejects(exports.POST({ json: async () => ({ mode: 'sequence', objective: 'Presentar el servicio' }) }));
  assert.deepEqual(calls, ['auth']);
});

test('the follow-ups of a first email and one instruction for the whole sequence go through the same authentication and budget', async () => {
  const calls: Array<[string, any?]> = [];
  const modules: Record<string, any> = {
    'next/server': { NextResponse: { json: (body: unknown) => body } },
    zod,
    '@/lib/bulk-campaigns': campaigns,
    '@/lib/bulk-campaign-assist': assist,
    '@/lib/server/bulk-campaigns': {
      requireBulkCampaignAuth: async () => { calls.push(['auth']); return { organizationId: 'org', user: { id: 'user' } }; },
      bulkCampaignError: (error: Error) => { throw error; },
    },
    '@/lib/server/bulk-ai-budget': { consumeAssistBudget: async () => { calls.push(['budget']); } },
    '@/ai/openai-json': { generateStructured: async () => { throw new Error('not this one'); } },
    '@/lib/server/campaign-follow-ups': {
      writeCampaignFollowUps: async (input: any) => { calls.push(['follow_ups', input]); return [{ subject: 'Seguimiento', body: 'Hola {{nombre}},', delayDays: 3 }]; },
      reviseCampaignSequence: async (input: any) => { calls.push(['sequence_instruction', input]); return input.messages; },
    },
    // «Tu voz»: the emails the signed-in person chose as samples of how they write.
    '@/lib/server/voice-own-samples': { voiceSamplesFor: async (input: any) => { calls.push(['voice', input]); return ['Hola Pedro, te cuento que partimos el lunes con la faena.']; } },
    '@/lib/voice-own-samples': voice,
  };
  const exports: any = {};
  const compiled = ts.transpileModule(readFileSync('src/app/api/campaigns/bulk/assist/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', compiled)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const first = { subject: 'Turnos', body: 'Hola {{nombre}}, ¿lo conversamos?' };
  const followUps = await exports.POST({ json: async () => ({ mode: 'follow_ups', objective: 'Reunión', relationship: 'never_contacted', first, followUpDelays: [3] }) });
  assert.equal(followUps.messages.length, 1);
  assert.deepEqual(calls.slice(0, 3).map(call => call[0]), ['auth', 'budget', 'voice']);
  assert.deepEqual({ ...calls[2][1] }, { userId: 'user', organizationId: 'org' }, 'the samples are the signed-in person\'s');
  assert.deepEqual(calls[3][1].first, first);
  assert.equal(calls[3][1].recipients, 2, 'without a count, the follow-ups are for several people');
  assert.deepEqual(calls[3][1].voiceSamples, ['Hola Pedro, te cuento que partimos el lunes con la faena.'], 'and the follow-ups are written from them');
  calls.length = 0;
  const messages = [{ subject: 'Uno', body: 'Hola {{nombre}}', delayDays: 0 }, { subject: 'Dos', body: 'Hola {{nombre}}', delayDays: 3 }];
  const revised = await exports.POST({ json: async () => ({ mode: 'sequence_instruction', instruction: 'Más breves', objective: 'Reunión',
    relationship: 'never_contacted', messages, locked: [0], recipients: 1 }) });
  assert.deepEqual(revised.messages, messages);
  assert.deepEqual(calls[2][1].locked, [0]);
  assert.equal(calls[2][1].recipients, 1);
  calls.length = 0;
  await assert.rejects(exports.POST({ json: async () => ({ mode: 'follow_ups', objective: 'Reunión', relationship: 'never_contacted', first, followUpDelays: [] }) }));
  assert.deepEqual(calls.map(call => call[0]), ['auth'], 'a request without follow-ups to write spends nothing');
});
