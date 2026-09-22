// Explicit model evaluation, synthetic tools. No provider calls, writes or env files.
import { writeFileSync } from 'node:fs';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';

const DRAFT = '00000000-0000-4000-8000-000000000021';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) throw new Error('Explicit live configuration required');
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const cases = [
    { id: 'terms', message: 'Revisa si el borrador 00000000-0000-4000-8000-000000000021 cumple nuestras reglas de lenguaje antes de presentarlo.' },
    { id: 'correction', message: 'La afirmación de 1000 personas en 30 minutos es falsa; además el término "filtrar candidatos" está prohibido. Deja el contexto listo para que no vuelva a pasar.' },
  ];
  let calls = 0;
  const reports = [];
  for (const scenario of cases) {
    const decisions: unknown[] = [];
    const reads: string[] = [];
    const effects: unknown[] = [];
    try {
      const answer = await runCoworkReadLoop({ message: scenario.message, runId: '00000000-0000-4000-8000-000000000031',
        signal: new AbortController().signal,
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
        execute: async (action, input) => {
          reads.push(`${action}:${input}`);
          if (action === 'message.context') return { scope: 'organization_messaging_context', configured: false, context: null };
          if (action === 'draft.get') return { scope: 'own_draft', draftId: DRAFT, versionId: 'v1' };
          if (action === 'message.check_terms') return { scope: 'own_draft_terms', draftId: DRAFT, verdict: 'blocked',
            prohibitedFound: ['filtrar candidatos'], requiredMissing: [], termsConfigured: 1, sendAuthorized: false };
          if (action === 'message.check_evidence') return { scope: 'own_draft_evidence', draftId: DRAFT,
            snapshotObserved: true, sendAuthorized: false,
            assertions: [{ id: 'quantity', label: 'Cantidad concreta', status: 'needs_human_judgment' }],
            researchClaims: [{ statement: 'Caso A documentado', evidence: ['e1'] }], approvedClaims: [] };
          throw new Error(`Unexpected tool: ${action}`);
        },
        proposeEffect: async proposal => { effects.push(proposal); },
      });
      reports.push({ id: scenario.id, decisions, reads, effects, answer, status: 'completed_requires_semantic_review' });
    } catch { reports.push({ id: scenario.id, decisions, reads, effects, status: 'failed' }); break; }
  }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  const report = JSON.stringify({ calls, reports, limitation: 'Model and real loop, synthetic reads. No provider execution or authenticated acceptance.' }, null, 2);
  if (output) writeFileSync(output, report + '\n');
  console.log(report);
}
main().catch(() => { console.error('Message evaluation failed.'); process.exitCode = 1; });
