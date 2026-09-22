// No environment files, database, provider enrichment or delivery operations.
import { replayAxisCase, replayIds, replayInstructions } from './fixtures/cowork-axis-replay';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';
import { writeFileSync } from 'node:fs';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) {
    throw new Error('Requires --live and explicit OPENAI_API_KEY/COWORK_MODEL. Use replay tests for offline verification.');
  }
  const selected = process.argv.find(a => a.startsWith('--cases='))?.slice(8).split(',') || [];
  const maxCalls = Number(process.argv.find(a => a.startsWith('--max-calls='))?.slice(12));
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !(replayIds as readonly string[]).includes(id))) {
    throw new Error('Select explicit known --cases');
  }
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 19) throw new Error('Explicit --max-calls=1..19 required');
  let calls = 0;
  const usage: unknown[] = [];
  const results = [];
  const decisions: unknown[] = [];
  for (const id of selected) {
    try {
      results.push(await replayAxisCase(id, async context => {
        if (calls >= maxCalls) throw new Error('Replay call budget exhausted');
        const prompt = JSON.stringify(context);
        if (Buffer.byteLength(prompt, 'utf8') > 60000) throw new Error('Replay input budget exhausted');
        calls++;
        const response = await generateStructuredWithTelemetry({ schema: coworkDecisionSchema,
          systemPrompt: replayInstructions.systemPrompt + '\nspecialists.review está deshabilitado.',
          prompt, provider: 'openai', openAiModel: process.env.COWORK_MODEL,
          allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 1800, timeoutMs: 30000 });
        usage.push(coworkModelUsage(response.telemetry));
        decisions.push({ id, request: context.request, observations: structuredClone(context.observations), decision: response.data });
        return response.data;
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const category = /^(Unsupported fixture read: [a-z._]+|Unobserved fixture target|Replay call budget exhausted|Replay input budget exhausted|Effect proposals unavailable)$/.test(message) ? message : 'provider_or_contract_error';
      results.push({ id, passed: false, error: category });
      break;
    }
  }
  const report = JSON.stringify({ mode: 'real_model_real_loop_synthetic_tools', calls, usage, decisions, results,
    limitation: 'Adapted scenarios; no authenticated E2E or complete mailbox coverage. Lexical checks require human semantic review. Budget is per invocation, not a campaign ledger.' }, null, 2);
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  if (output) writeFileSync(output, report + '\n', 'utf8');
  console.log(report);
  if (results.length !== selected.length || results.some(r => !r.passed)) process.exitCode = 1;
}
main().catch(() => { console.error('Replay requires explicit configuration; no model calls performed.'); process.exitCode = 1; });
