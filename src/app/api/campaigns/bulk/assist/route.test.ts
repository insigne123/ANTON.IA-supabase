import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as zod from 'zod';
import * as campaigns from '../../../../../lib/bulk-campaigns';
import * as assist from '../../../../../lib/bulk-campaign-assist';

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
