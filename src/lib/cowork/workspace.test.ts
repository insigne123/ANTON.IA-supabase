import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoworkAgenda, type AgendaInput } from './agenda';
import { COWORK_WORKSPACE_MAX_ITEMS, coworkWorkspaceDigest } from './workspace';

const day = (input: Partial<AgendaInput> = {}): AgendaInput => ({
  interested: [], unclassified: [], autoReplies: 0, bounces: [], approvals: { count: 0, oldestDays: null, examples: [] },
  campaignSteps: { count: 0, examples: [] }, followups: [], linkedinAccepted: [], mailboxSynced: true,
  sources: { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' },
  timing: { timeZone: 'America/Santiago', day: '2026-09-25', weekday: 'viernes' }, ...input,
});

test('the digest names who waits and for what, most urgent first, without addresses', () => {
  const agenda = buildCoworkAgenda(day({
    interested: [
      { name: 'Marcela Rojas', company: 'Servicios Norte', email: 'mrojas@sernorte.cl', daysWaiting: 4, intent: 'meeting_request' },
      { name: 'Héctor Vidal', company: 'Casino Central', email: 'hvidal@casinocentral.cl', daysWaiting: 1, intent: 'positive' },
    ],
    approvals: { count: 2, oldestDays: 3, examples: ['Mándale un correo a los tibios'] },
  }));
  const workspace = coworkWorkspaceDigest({ contacts: 256, withEmail: 21, campaigns: 19, linkedin: { pending: 38, sent7d: 20, limit: 100 }, agenda });
  assert.ok(workspace?.today);
  assert.deepEqual({ contacts: workspace.contacts, withEmail: workspace.withEmail, campaigns: workspace.campaigns, linkedin: workspace.linkedin },
    { contacts: 256, withEmail: 21, campaigns: 19, linkedin: { used: 58, limit: 100 } });
  assert.equal(workspace.today.meetingRequests, 1);
  assert.deepEqual(workspace.today.first[0], { who: 'Marcela Rojas · Servicios Norte', what: 'pidió una reunión hace 4 días' });
  assert.ok(workspace.today.first.some(item => item.what === '2 propuestas esperan tu visto bueno'));
  assert.ok(!JSON.stringify(workspace).includes('@'), 'no addresses travel with every turn');
});

test('the digest keeps at most four items and says when the agenda is unknown rather than empty', () => {
  const many = buildCoworkAgenda(day({ interested: Array.from({ length: 7 }, (_, index) => ({
    name: `Persona ${index + 1}`, company: `Empresa ${index + 1}`, email: `p${index}@e${index}.cl`, daysWaiting: index + 1, intent: 'positive' as const })) }));
  assert.equal(coworkWorkspaceDigest({ contacts: 1, withEmail: 1, campaigns: 0, linkedin: null, agenda: many })?.today?.first.length, COWORK_WORKSPACE_MAX_ITEMS);
  const unknown = coworkWorkspaceDigest({ contacts: 3, withEmail: null, campaigns: null, linkedin: null, agenda: null });
  assert.deepEqual(unknown, { contacts: 3, withEmail: null, campaigns: null, linkedin: null, today: null });
  const quiet = coworkWorkspaceDigest({ contacts: 3, withEmail: 1, campaigns: 0, linkedin: null, agenda: buildCoworkAgenda(day()) });
  assert.deepEqual(quiet?.today?.first, []);
  assert.equal(coworkWorkspaceDigest({ contacts: null, withEmail: null, campaigns: null, linkedin: null, agenda: null }), null);
});
