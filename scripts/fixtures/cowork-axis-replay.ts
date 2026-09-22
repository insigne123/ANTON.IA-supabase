import { axisConversations } from './cowork-axis-conversations';
import { coworkAgentInstructions } from '../../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../../src/lib/cowork/decision-context';
import { coworkDecisionSchema, runCoworkReadLoop, type CoworkObservation, type CoworkReadAction } from '../../src/lib/cowork/agent-loop';
import type { z } from 'zod';
import { contactRecordEvidence } from '../../src/lib/cowork/contact-evidence';

export const AXIS_LEAD = '00000000-0000-4000-8000-000000000001';
export const AXIS_SECOND_LEAD = '00000000-0000-4000-8000-000000000003';
export const replayIds = ['01-hoy', '03-ya-respondi', '08-reuniones', '12-reloj'] as const;
type Decision = z.infer<typeof coworkDecisionSchema>;
export const replayInstructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
export type ReplayContext = ReturnType<typeof coworkDecisionContext>;

/** Deliberately narrow boundary: unimplemented reads fail, never return invented success. */
function readFixture(id: string, turn: number, action: CoworkReadAction, value: string) {
  const name = id === '03-ya-respondi' ? 'Rafael' : 'Contacto Alfa';
  const sent = id === '03-ya-respondi' && turn > 0 ? '2026-08-04T15:55:00Z' : '2026-08-01T12:00:00Z';
  const replied = id === '03-ya-respondi' ? '2026-08-04T15:46:00Z' : '2026-08-12T12:00:00Z';
  const row = { id: '00000000-0000-4000-8000-000000000002', lead_id: AXIS_LEAD,
    name, company: 'Cuenta A', sent_at: sent, replied_at: replied, reply_intent: 'meeting_request',
    reply_summary: id === '01-hoy' ? 'Solicita fecha de entrega de cotización; fecha aún desconocida.' : 'Solicita coordinar una reunión.' };
  const second = { ...row, id: '00000000-0000-4000-8000-000000000004', lead_id: AXIS_SECOND_LEAD, name: 'Contacto Beta', company: 'Cuenta B' };
  const items = id === '08-reuniones' ? [row, second] : [row];
  if (action === 'contacted.search') return { items, returned: items.length, limit: 20, scope: 'organization_contacted', truncated: false };
  if (action === 'contacted.timeline') {
    if (!items.some(item => item.lead_id === value)) throw new Error('Unobserved fixture target');
    const selected = items.find(item => item.lead_id === value)!;
    const now = id === '03-ya-respondi' ? '2026-08-04T16:00:00Z' : '2026-08-31T12:00:00Z';
    return { contacted: [selected], scope: 'organization_contacted', truncated: false,
      ...contactRecordEvidence([selected], false, now) };
  }
  if (action === 'metrics.overview') return { scope: 'organization', windowDays: 7,
    limitation: 'Los totales no determinan quién espera respuesta ni confirman reuniones.' };
  if (action === 'campaigns.inbox') return { items: [], scope: 'own', truncated: false };
  if (action === 'missions.list' || action === 'exceptions.list') return { items: [], scope: 'own', truncated: false };
  throw new Error(`Unsupported fixture read: ${action}`);
}

export async function replayAxisCase(id: string, decide: (context: ReplayContext) => Promise<Decision>) {
  if (!(replayIds as readonly string[]).includes(id)) throw new Error('Unknown replay case');
  const fixture = axisConversations.find(c => c.id === id)!;
  const history: Array<{ runId: string; request: string; reply: string; document: null | { title: string; content: string }; observations: CoworkObservation[] }> = [];
  const results = [];
  for (const [turn, request] of fixture.turns.entries()) {
    const observations: CoworkObservation[] = [];
    const now = new Date(id === '03-ya-respondi' ? '2026-08-04T16:00:00Z' : '2026-08-31T12:00:00Z');
    const answer = await runCoworkReadLoop({ message: request,
      runId: `${id}:${turn}`, history, signal: new AbortController().signal,
      authorize: async () => {},
      decide: (current, mustAnswer) => decide(coworkDecisionContext(replayInstructions, {
        history: { turns: history, olderTurnsOmitted: false }, request, observations: current, mustAnswer,
        executionPolicy: { mode: 'approval' },
      }, now)),
      execute: async (action, value) => readFixture(id, turn, action, value),
      record: async observation => { observations.push(observation); },
      // No effect callbacks: even a model requesting an effect cannot execute it.
    });
    const readTimeline = observations.some(o => o.action === 'contacted.timeline' && o.input === AXIS_LEAD);
    const text = answer.reply;
    const checks = {
      freshRead: observations.some(o => o.action === 'contacted.search' || o.action === 'contacted.timeline'),
      timelineOnCorrection: id !== '03-ya-respondi' || readTimeline,
      timelineForClock: id !== '12-reloj' || readTimeline,
      bothMeetingRequestsRead: id !== '08-reuniones' || [AXIS_LEAD, AXIS_SECOND_LEAD].every(leadId => observations.some(o => o.action === 'contacted.timeline' && o.input === leadId)),
      // Screening only; these are not semantic certification.
      reply: id === '03-ya-respondi' && turn > 0 ? /Rafael/i.test(text) && /15:55/.test(text)
        && /registros[\s\S]*app/i.test(text) && /cobertura|sincroniz|no.*comprobar/i.test(text)
        : id === '12-reloj' ? /19|diecinueve/.test(text)
        : id === '01-hoy' ? /fecha/.test(text) : /solicitud|coordinar|entrante/.test(text),
    };
    results.push({ turn, request, observations, answer, checks, passed: Object.values(checks).every(Boolean) });
    history.push({ runId: `${id}:${turn}`, request, ...answer, observations });
  }
  return { id, results, passed: results.every(r => r.passed) };
}
