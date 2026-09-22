// Explicit model evaluation, synthetic tools. No Apollo calls, writes or env files.
import { writeFileSync } from 'node:fs';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';
import { analyzeStoredAudience } from '../src/lib/cowork/audience-analysis';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) throw new Error('Explicit live configuration required');
  const instructions = coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false });
  const cases = [
    { id: 'companies', message: 'Busca 5 empresas de outsourcing en Chile de 51 a 200 empleados. Solo empresas, no personas.' },
    { id: 'people', message: 'Busca 5 gerentes de recursos humanos ubicados en Chile, incluyendo cargos en español e inglés. No filtres por país de casa matriz.' },
    { id: 'freshness_roles', message: 'Revisa qué sectores de nuestra base están menos contactados y distingue posibles compradores y usuarios operativos. No supongas autoridad por el cargo.' },
  ];
  let calls = 0;
  const reports = [];
  for (const scenario of cases) {
    const decisions: unknown[] = [];
    const reads: string[] = [];
    let proposal: unknown = null;
    try {
      const answer = await runCoworkReadLoop({ message: scenario.message, signal: new AbortController().signal,
        authorize: async () => {}, record: async () => {},
        decide: async (observations, mustAnswer) => {
          if (++calls > 10) throw new Error('Budget exhausted');
          const response = await generateStructuredWithTelemetry({ schema: coworkDecisionSchema,
            systemPrompt: instructions.systemPrompt, prompt: JSON.stringify(coworkDecisionContext(instructions, {
              history: { turns: [] }, request: scenario.message, observations, mustAnswer, executionPolicy: { mode: 'approval' },
            })), provider: 'openai', openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
            maxAttempts: 1, maxOutputTokens: 2000, timeoutMs: 30000 });
          decisions.push({ decision: response.data, usage: coworkModelUsage(response.telemetry) });
          return response.data;
        },
        proposeSearch: async criteria => { proposal = criteria; },
        execute: async action => {
          reads.push(action);
          if (action !== 'audience.analyze') throw new Error('Unsupported fixture read');
          return analyzeStoredAudience([
            { id: '1', name: 'Ana', title: 'Reclutadora', company: 'Alpha', industry: 'Staffing' },
            { id: '2', name: 'Luis', title: 'Gerente de operaciones', company: 'Beta', industry: 'Staffing' },
          ], [{ company: 'Alpha', sent_at: '2026-08-01' }], { leadsComplete: true, historyComplete: true });
        },
      });
      reports.push({ id: scenario.id, message: scenario.message, decisions, reads, proposal, answer, status: 'completed_requires_semantic_review' });
    } catch { reports.push({ id: scenario.id, decisions, reads, proposal, status: 'failed' }); break; }
  }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  const report = JSON.stringify({ calls, reports, limitation: 'Model and real loop, synthetic read data. No provider execution or authenticated UI acceptance.' }, null, 2);
  if (output) writeFileSync(output, report + '\n');
  console.log(report);
}
main().catch(() => { console.error('Audience evaluation failed.'); process.exitCode = 1; });
