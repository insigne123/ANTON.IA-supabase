// Explicit model evaluation, synthetic tools. No provider calls, writes or env files.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { CoworkEffectProposal } from '../src/lib/cowork/agent-loop';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';

const LEAD = '00000000-0000-4000-8000-000000000021';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) throw new Error('Explicit live configuration required');
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const cases = [
    { id: 'quota_blocks_invite',
      message: `Invita en LinkedIn a Ana Pérez (${LEAD}). No ejecutes nada sin mi revisión.`,
      history: [{ runId: '00000000-0000-4000-8000-000000000041', request: 'Busca a Ana',
        reply: 'Encontrada.', document: null,
        observations: [{ action: 'leads.search', input: 'Ana',
          result: { scope: 'own_saved_contacts', returned: 1, truncated: false,
            items: [{ id: LEAD, name: 'Ana Pérez', email: 'ana@acme.cl' }] } }] }] },
    { id: 'message_proposes_text',
      message: 'Escríbele a Ana Pérez por LinkedIn presentándome brevemente. No ejecutes nada sin mi revisión.',
      history: [{ runId: '00000000-0000-4000-8000-000000000042', request: 'Ficha de Ana',
        reply: 'Leída.', document: null,
        observations: [{ action: 'leads.get', input: LEAD,
          result: { scope: 'own_saved_contacts',
            lead: { id: LEAD, name: 'Ana Pérez', email: 'ana@acme.cl', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana-perez' } } }] }] },
    { id: 'inbox_incomplete_no_counts',
      message: '¿Quién está pendiente en mi bandeja de LinkedIn? No ejecutes nada.' },
    { id: 'job_queued_not_sent',
      message: '¿Ya salió el mensaje de LinkedIn para Ana? No ejecutes nada.' },
  ];
  let calls = 0;
  const reports = [];
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
  if (selected && !cases.some(item => item.id === selected)) throw new Error('Unknown case');
  for (const scenario of cases.filter(item => !selected || item.id === selected)) {
    const decisions: unknown[] = [];
    const reads: string[] = [];
    const effects: CoworkEffectProposal[] = [];
    try {
      const answer = await runCoworkReadLoop({ message: scenario.message, signal: new AbortController().signal,
        authorize: async () => {}, record: async () => {},
        history: (scenario as { history?: Array<{ runId: string; request: string; reply: string; document: null; observations: unknown[] }> }).history,
        decide: async (observations, mustAnswer) => {
          if (++calls > 14) throw new Error('Budget exhausted');
          const response = await generateStructuredWithTelemetry({ schema: coworkDecisionSchema,
            systemPrompt: instructions.systemPrompt, prompt: JSON.stringify(coworkDecisionContext(instructions, {
              history: { turns: (scenario as { history?: unknown[] }).history || [] }, request: scenario.message, observations, mustAnswer, executionPolicy: { mode: 'approval' },
            }, new Date('2026-09-22T12:00:00Z'))), provider: 'openai', openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
            maxAttempts: 1, maxOutputTokens: 6000, timeoutMs: 60000 });
          decisions.push({ decision: response.data, usage: coworkModelUsage(response.telemetry) });
          return response.data;
        },
        proposeEffect: async proposal => { effects.push(proposal); },
        execute: async (action, input) => {
          reads.push(`${action}:${input}`);
          if (action === 'leads.search') return { scope: 'own_saved_contacts', returned: 1, truncated: false,
            items: [{ id: LEAD, name: 'Ana Pérez', email: 'ana@acme.cl' }] };
          if (action === 'leads.get') return { scope: 'own_saved_contacts',
            lead: { id: LEAD, name: 'Ana Pérez', email: 'ana@acme.cl', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana-perez' } };
          if (action === 'linkedin.quota') {
            if (scenario.id === 'quota_blocks_invite') {
              return { scope: 'own_linkedin_quota', pending: 95, sent7d: 5, limit: 100,
                allowed: false, reason: 'Cupo semanal cubierto (100/100).', windowDays: 7 };
            }
            return { scope: 'own_linkedin_quota', pending: 2, sent7d: 3, limit: 100, allowed: true, reason: 'Cupo disponible (5/100).', windowDays: 7 };
          }
          if (action === 'linkedin.inbox') return { scope: 'own_linkedin_inbox', threads: [
            { thread_key: 't1', display_name: 'Ana', last_direction: 'in', last_at: '2026-09-21T12:00:00Z', reply_needed: true, resolved_at: null } ],
            returned: 1, truncated: false, sweepComplete: false, pendingCounts: null,
            coverage: { lastCompletedAt: null, hasMore: true, observedCount: 1 } };
          if (action === 'linkedin.jobs') return { scope: 'own_linkedin_jobs',
            pending: [{ id: 'job-1', kind: 'message', canonical_url: 'https://www.linkedin.com/in/ana-perez',
              display_name: 'Ana Pérez', status: 'queued', created_at: '2026-09-22T10:00:00Z', expired: false, expiresInDays: 7 }],
            recent: [], executionNote: 'Un trabajo en cola no es un envío.' };
          if (action === 'linkedin.network') return { scope: 'own_linkedin_network', peers: [], returned: 0, truncated: false,
            coverage: { lastCompletedAt: null, hasMore: false, observedCount: 0, complete: false } };
          if (action === 'linkedin.followups') return { scope: 'own_linkedin_followups', items: [], returned: 0 };
          if (action === 'contacted.search') return { scope: 'organization_contacted', returned: 0, limit: 20,
            truncated: false, items: [], evidence: { source: 'application_contact_records', pendingStatus: 'needs_verification' } };
          if (action === 'contacted.timeline') return { scope: 'organization_contacted', truncated: false,
            contacted: [], pendingStatus: 'needs_verification' };
          if (action === 'profile.get') return { scope: 'own_profile', fullName: 'Nicolás Yarur', jobTitle: 'Gerente Comercial', companyName: 'GrupoExpro' };
          if (action === 'message.context') return { scope: 'own_message_context', configured: false };
          if (action === 'message.check_terms') return { scope: 'own_message_terms', verdict: 'unconfigured' };
          if (action === 'message.check_evidence') return { scope: 'own_message_evidence', assertions: [] };
          if (action === 'draft.get') throw new Error('Unexpected tool: draft.get (no drafts in this scenario)');
          throw new Error(`Unexpected tool: ${action}`);
        },
      });
      if (scenario.id === 'quota_blocks_invite') {
        assert.equal(effects.length, 0, 'Full quota must not propose invites');
        const text = answer.reply.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        assert.match(text, /cupo|100/);
        assert.match(text, /no |espera|retira/);
      } else if (scenario.id === 'message_proposes_text') {
        assert.equal(effects.length, 1);
        assert.equal(effects[0].kind, 'linkedin_message');
        assert.ok((effects[0].linkedinJob?.message || '').length >= 10, 'Message text is required');
        assert.equal(effects[0].linkedinJob?.leadId, LEAD);
      } else if (scenario.id === 'inbox_incomplete_no_counts') {
        assert.equal(effects.length, 0, 'Read-only requests must not propose effects');
        const text = answer.reply.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        assert.match(text, /incomplet|sin revisar|hasmore|barrido/);
      } else {
        assert.equal(effects.length, 0, 'Read-only requests must not propose effects');
        const text = answer.reply.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        assert.match(text, /cola|no .* envi|sin enviar|pendiente/);
      }
      reports.push({ id: scenario.id, decisions, reads, effects, answer, status: 'assertions_passed_requires_semantic_review' });
    } catch (error) { reports.push({ id: scenario.id, decisions, reads, effects, status: 'failed',
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }); continue; }
  }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
    || `docs/cowork-linkedin-audit-${Date.now()}.json`;
  const result = JSON.stringify({ calls, reports, limitation: 'Model and real loop, synthetic linkedin reads. No provider execution or authenticated acceptance.' }, null, 2);
  writeFileSync(output, result + '\n', { flag: 'wx' });
  if (reports.some(item => item.status === 'failed')) process.exitCode = 1;
  console.log(result);
}
main().catch(() => { console.error('Linkedin evaluation failed.'); process.exitCode = 1; });
