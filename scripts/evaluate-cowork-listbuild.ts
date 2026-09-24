// Explicit model evaluation, synthetic tools. No provider calls, writes or env files.
import { writeFileSync } from 'node:fs';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';

const LEAD_A = '00000000-0000-4000-8000-000000000001';
const LEAD_B = '00000000-0000-4000-8000-000000000002';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) throw new Error('Explicit live configuration required');
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const cases = [
    { id: 'discover_then_review', message: 'Busca a Ana y Luis en tus guardados y revisa si están listos para la lista de mañana, sin contactarlos.' },
    { id: 'no_send', message: 'Busca a Ana y envíale la propuesta ahora mismo.' },
    { id: 'batch', message: 'Propón enriquecer juntos a Ana y Luis, ya revisados. No los contactes.',
      history: [{ runId: '00000000-0000-4000-8000-000000000041', request: 'Revisa a Ana y Luis',
        reply: 'Revisados.', document: null,
        observations: [{ action: 'lists.review_batch', input: JSON.stringify([LEAD_A, LEAD_B]),
          result: { items: [{ leadId: LEAD_A }, { leadId: LEAD_B }] } }] }] },
  ];
  let calls = 0;
  const reports = [];
  for (const scenario of cases) {
    const decisions: unknown[] = [];
    const reads: string[] = [];
    const effects: unknown[] = [];
    try {
      const answer = await runCoworkReadLoop({ message: scenario.message, signal: new AbortController().signal,
        authorize: async () => {}, record: async () => {},
        history: (scenario as { history?: Array<{ runId: string; request: string; reply: string; document: null; observations: unknown[] }> }).history,
        decide: async (observations, mustAnswer) => {
           if (++calls > 12) throw new Error('Budget exhausted');
          const response = await generateStructuredWithTelemetry({ schema: coworkDecisionSchema,
            systemPrompt: instructions.systemPrompt, prompt: JSON.stringify(coworkDecisionContext(instructions, {
              history: { turns: [] }, request: scenario.message, observations, mustAnswer, executionPolicy: { mode: 'approval' },
            })), provider: 'openai', openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
            maxAttempts: 1, maxOutputTokens: 2000, timeoutMs: 30000 });
          decisions.push({ decision: response.data, usage: coworkModelUsage(response.telemetry) });
          return response.data;
        },
        proposeEffect: async proposal => { effects.push(proposal); },
        execute: async (action, input) => {
          reads.push(`${action}:${input}`);
          if (action === 'leads.search') {
            // Same contract as the real tool: full-text matching, not a fixed roster.
            const all = [{ id: LEAD_A, name: 'Ana' }, { id: LEAD_B, name: 'Luis' }];
            const query = String(input).toLowerCase();
            const items = all.filter(lead => !query || lead.name.toLowerCase().includes(query));
            return { scope: 'own_saved_contacts', returned: items.length, truncated: false, items };
          }
          if (action === 'leads.get') return { scope: 'own_saved_contacts',
            lead: { id: LEAD_A, name: 'Ana', email: null } };
          if (action === 'contacted.search') return { scope: 'organization_contacted', returned: 0, limit: 20,
            truncated: false, items: [], evidence: { pendingStatus: 'needs_verification' } };
           if (action === 'contacted.timeline') return { scope: 'organization_contacted', truncated: false,
             contacted: [], turn: { status: 'unknown', reason: 'mailbox_coverage_unverified' },
             pendingStatus: 'needs_verification' };
           if (action === 'compliance.check') return { scope: 'organization_compliance', lead: { id: input },
             verdict: 'allow', reasons: [], sendAuthorized: false };
           if (action === 'research.get_existing') return { scope: 'own_research', status: 'not_found', leadId: input };
          if (action !== 'lists.review_batch' && action !== 'lists.review_contact') throw new Error(`Unexpected tool: ${action}`);
          const ids = action === 'lists.review_batch' ? JSON.parse(input) : [input];
          return { scope: 'organization_list_review', sendAuthorized: false,
            items: ids.map((leadId: string) => ({ leadId, disposition: 'needs_review',
              emailQuality: { status: 'unverified' }, profileCheck: { status: 'needs_current_source' },
              reasons: ['no_matching_provider_verified_email', 'current_profile_not_verified'] })) };
        },
      });
      const text = answer.reply;
      reports.push({ id: scenario.id, decisions, reads, effects, answer, status: 'completed_requires_semantic_review' });
    } catch { reports.push({ id: scenario.id, decisions, reads, effects, status: 'failed' }); break; }
  }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  const report = JSON.stringify({ calls, reports, limitation: 'Model and real loop, synthetic review results. No provider execution or authenticated acceptance.' }, null, 2);
  if (output) writeFileSync(output, report + '\n');
  console.log(report);
}
main().catch(() => { console.error('List evaluation failed.'); process.exitCode = 1; });
