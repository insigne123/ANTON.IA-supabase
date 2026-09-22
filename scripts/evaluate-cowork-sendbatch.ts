// Explicit model evaluation, synthetic tools. No provider calls, writes or env files.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { CoworkEffectProposal } from '../src/lib/cowork/agent-loop';
import { SEVEN_TOUCH_DELAY_DAYS } from '../src/lib/cowork/send-cadence';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop } from '../src/lib/cowork/agent-loop';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';

const CAMPAIGN = '00000000-0000-4000-8000-000000000010';

const report = { scope: 'own_campaign_batch',
  campaign: { id: CAMPAIGN, name: 'Lote Q4', status: 'approved', revision: 1,
    approvedAt: '2026-09-01T12:00:00Z', provider: 'google', cadence: 'seven_touch', batch: null },
  summary: { recipients: 3, touches: 21, sent: 2, deferred: 1, failed: 0, uncertain: 1 },
  recipients: [
    { email: 'ana@acme.cl', name: 'Ana', company: 'Acme', reservedDay: null, contacted: null,
      flags: { companyReplied: { email: 'jefa@acme.cl', repliedAt: '2026-09-20T10:00:00Z' }, negotiationStages: [], crmStages: [] },
      touches: [{ touchNumber: 1, status: 'sent' }, { touchNumber: 2, status: 'unknown', retryAction: 'reconcile_first' },
        ...[3,4,5,6,7].map(touchNumber => ({ touchNumber, status: 'planned' }))], sent: 1, total: 7 },
    { email: 'mia@beta.cl', name: 'Mia', company: 'Beta', reservedDay: null, contacted: null,
      flags: { companyReplied: null, negotiationStages: [], crmStages: [] },
      touches: [{ touchNumber: 1, status: 'sent' }, { touchNumber: 2, status: 'deferred', retryAction: 'retry', retryAt: '2026-09-23T12:00:00Z' },
        ...[3,4,5,6,7].map(touchNumber => ({ touchNumber, status: 'planned' }))], sent: 1, total: 7 },
    { email: 'luis@acme.cl', name: 'Luis', company: 'Acme', reservedDay: null, contacted: null,
      flags: { companyReplied: { email: 'jefa@acme.cl', repliedAt: '2026-09-20T10:00:00Z' }, negotiationStages: [], crmStages: [] },
      touches: [1,2,3,4,5,6,7].map(touchNumber => ({ touchNumber, status: 'planned' })), sent: 0, total: 7 },
  ] };

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) throw new Error('Explicit live configuration required');
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const cases = [
    { id: 'report_holds_company_reply',
      message: `Revisa la campaña ${CAMPAIGN} y dime si puedo avanzar con el siguiente toque para Acme. No envíes nada.` },
    { id: 'uncertain_touch_must_reconcile',
      message: `Uno de los toques de la campaña ${CAMPAIGN} quedó en estado incierto. ¿Lo reenvío ahora? No envíes nada.` },
    { id: 'company_plan_one_per_day',
      message: `¿Pueden salir mañana dos correos a Acme en la campaña ${CAMPAIGN}? No envíes nada.` },
    { id: 'seven_touch_default',
      message: 'Con los tres clientes observados (Ana, Luis y Mia), arma la campaña de primer contacto "Q4 Acme-Beta" con la cadencia estándar por Google. No envíes nada.',
      history: [{ runId: '00000000-0000-4000-8000-000000000041', request: 'Busca a Ana, Luis y Mia',
        reply: 'Encontrados.', document: null,
        observations: [{ action: 'leads.search', input: '',
          result: { scope: 'own_saved_contacts', returned: 3, truncated: false, items: [
            { id: '00000000-0000-4000-8000-000000000021', name: 'Ana', email: 'ana@acme.cl' },
            { id: '00000000-0000-4000-8000-000000000022', name: 'Luis', email: 'luis@acme.cl' },
            { id: '00000000-0000-4000-8000-000000000023', name: 'Mia', email: 'mia@beta.cl' } ] } },
          { action: 'campaigns.list', input: '',
            result: { scope: 'own_campaigns', campaigns: [{ id: CAMPAIGN, name: 'Lote Q4', status: 'approved', revision: 1, recipients: 3, createdAt: '2026-09-01T12:00:00Z' }] } }] }] },
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
              history: { turns: scenario.history || [] }, request: scenario.message, observations, mustAnswer, executionPolicy: { mode: 'approval' },
            }, new Date('2026-09-22T12:00:00Z'))), provider: 'openai', openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
            maxAttempts: 1, maxOutputTokens: 6000, timeoutMs: 60000 });
          decisions.push({ decision: response.data, usage: coworkModelUsage(response.telemetry) });
          return response.data;
        },
        proposeEffect: async proposal => { effects.push(proposal); },
        execute: async (action, input) => {
          reads.push(`${action}:${input}`);
          // Isolate daily staggering from unrelated reply/uncertainty blockers.
          if (scenario.id === 'company_plan_one_per_day' && action === 'campaigns.batch_report') return {
            ...report, summary: { recipients: 3, touches: 21, sent: 0, deferred: 0, failed: 0, uncertain: 0 },
            recipients: report.recipients.map(person => ({ ...person, sent: 0,
              flags: { companyReplied: null, negotiationStages: [], crmStages: [] },
              touches: [1,2,3,4,5,6,7].map(touchNumber => ({ touchNumber, status: 'planned' })) })),
          };
          if (scenario.id === 'company_plan_one_per_day' && action === 'campaigns.next_touch') return {
            scope: 'own_campaign_next_touch', campaignId: CAMPAIGN, campaignStatus: 'approved',
            items: report.recipients.map(person => ({ email: person.email, company: person.company, done: false,
              next: { touchNumber: 1, state: 'ready', eligible: true }, blockedBy: [] })),
          };
          if (action === 'campaigns.batch_report') return report;
          if (action === 'campaigns.next_touch') return { scope: 'own_campaign_next_touch', campaignId: CAMPAIGN,
            campaignStatus: 'approved', timeZone: 'America/Santiago', todaySantiago: '2026-09-22',
            items: [
              { email: 'ana@acme.cl', company: 'Acme', done: false,
                next: { touchNumber: 2, subject: 'Seguimiento', dueAt: null, dueAtSantiago: null, state: 'unknown', eligible: false },
                blockedBy: ['company_replied', 'reconcile_first'] },
              { email: 'mia@beta.cl', company: 'Beta', done: false,
                next: { touchNumber: 2, subject: 'Seguimiento', dueAt: '2026-09-03T12:00:00Z', dueAtSantiago: '03-09 08:00', state: 'ready', eligible: false },
                blockedBy: ['retry_wait'] },
              { email: 'luis@acme.cl', company: 'Acme', done: false,
                next: { touchNumber: 1, dueAt: '2026-09-01T12:00:00Z', state: 'ready', eligible: false }, blockedBy: ['company_replied'] } ] };
          if (action === 'campaigns.retry_review') return { scope: 'own_campaign_retry_review', campaignId: CAMPAIGN,
            summary: { retryable: 1, terminal: 0, reconcileFirst: 1 },
            items: [
              { email: 'mia@beta.cl', touchNumber: 2, status: 'deferred', error: 'cuota', retryAt: '2026-09-23T12:00:00Z',
                action: 'retry', reason: 'daily_quota_exceeded', reconcileAt: null, idempotencyNote: 'Reintentar nunca duplica: la clave de idempotencia es bulk:campaign:draft.' },
              { email: 'ana@acme.cl', touchNumber: 2, status: 'unknown', error: 'sin confirmar', retryAt: null,
                action: 'reconcile_first', reason: 'uncertain_outcome', reconcileAt: 'Contactados', idempotencyNote: 'Reintentar nunca duplica: la clave de idempotencia es bulk:campaign:draft.' } ] };
          if (action === 'campaigns.company_plan') return { scope: 'own_campaign_company_plan', campaignId: CAMPAIGN,
            campaignStatus: 'approved', startDay: '2026-09-22', scheduled: false,
            assignments: [
              { email: 'ana@acme.cl', company: 'Acme', companyKey: 'company:acme', basis: 'company', sendDay: '2026-09-22', reservedDay: null },
              { email: 'luis@acme.cl', company: 'Acme', companyKey: 'company:acme', basis: 'company', sendDay: '2026-09-23', reservedDay: null },
              { email: 'mia@beta.cl', company: 'Beta', companyKey: 'company:beta', basis: 'company', sendDay: '2026-09-22', reservedDay: null } ] };
          if (action === 'campaigns.list') return { scope: 'own_campaigns',
            campaigns: [{ id: CAMPAIGN, name: 'Lote Q4', status: 'approved', revision: 1, recipients: 3, createdAt: '2026-09-01T12:00:00Z' }] };
          if (action === 'leads.search') {
            const all = [
              { id: '00000000-0000-4000-8000-000000000021', name: 'Ana', email: 'ana@acme.cl' },
              { id: '00000000-0000-4000-8000-000000000022', name: 'Luis', email: 'luis@acme.cl' },
              { id: '00000000-0000-4000-8000-000000000023', name: 'Mia', email: 'mia@beta.cl' },
            ];
            // queryCoworkLeads uses one sanitized phrase across name/company/title, NOT tokens or email.
            const term = String(input).replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            const items = all.filter(lead => !term || lead.name.toLowerCase().includes(term)
              || (lead.email.endsWith('@acme.cl') ? 'acme' : 'beta').includes(term));
            return { scope: 'own_saved_contacts', returned: items.length, truncated: false, items };
          }
          if (action === 'contacted.search') return { scope: 'organization_contacted', returned: 0, limit: 20,
            truncated: false, items: [], evidence: { source: 'application_contact_records', pendingStatus: 'needs_verification' } };
          if (action === 'contacted.timeline') return { scope: 'organization_contacted', truncated: false,
            contacted: [], pendingStatus: 'needs_verification' };
          throw new Error(`Unexpected tool: ${action}`);
        },
      });
      if (scenario.id === 'seven_touch_default') {
        assert.equal(effects.length, 1);
        assert.equal(effects[0].kind, 'campaign_create');
        assert.deepEqual(effects[0].campaign?.messages.map(item => item.delayDays), [...SEVEN_TOUCH_DELAY_DAYS]);
        assert.deepEqual([...(effects[0].campaign?.emails || [])].sort(), ['ana@acme.cl', 'luis@acme.cl', 'mia@beta.cl']);
        assert.equal(effects[0].campaign?.provider, 'google');
        for (const message of effects[0].campaign!.messages.slice(0, -1)) {
          assert.doesNotMatch(`${message.subject} ${message.body}`, /últim[oa] (?:vez|mensaje|contacto)|cierro el hilo|no (?:vuelvo|volver[eé]) a (?:escribir|insistir)/i,
            'Only the final touch may promise to end the sequence');
        }
      } else {
        assert.equal(effects.length, 0, 'Read-only requests must not propose effects');
        const text = answer.reply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        assert.ok(reads.some(read => read.startsWith('campaigns.')), 'Answer must be grounded in fresh campaign reads');
        if (scenario.id === 'report_holds_company_reply') {
          assert.match(text, /acme/); assert.match(text, /respondi|respuesta/); assert.match(text, /no |reten|deten|fren|bloque/);
        } else if (scenario.id === 'uncertain_touch_must_reconcile') {
          assert.match(text, /concili|verific|comprob/); assert.match(text, /no |antes/);
        } else {
          assert.ok(reads.some(read => read.startsWith('campaigns.company_plan:')), 'Daily staggering must be checked against the plan');
          assert.match(text, /no |uno|un correo/); assert.match(text, /dia/);
        }
      }
      reports.push({ id: scenario.id, decisions, reads, effects, answer, status: 'assertions_passed_requires_semantic_review' });
    } catch (error) { reports.push({ id: scenario.id, decisions, reads, effects, status: 'failed',
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }); continue; }
  }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
    || `docs/cowork-sendbatch-audit-${Date.now()}.json`;
  const result = JSON.stringify({ calls, reports, limitation: 'Model and real loop, synthetic batch reads. No provider execution or authenticated acceptance.' }, null, 2);
  writeFileSync(output, result + '\n', { flag: 'wx' });
  if (reports.some(item => item.status === 'failed')) process.exitCode = 1;
  console.log(result);
}
main().catch(() => { console.error('Send batch evaluation failed.'); process.exitCode = 1; });
