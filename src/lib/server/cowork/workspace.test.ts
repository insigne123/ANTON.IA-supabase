import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoworkAgenda } from '@/lib/cowork/agenda';
import { coworkWorkspaceEnabled, loadCoworkWorkspace } from './workspace';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const agenda = buildCoworkAgenda({
  interested: [{ name: 'Marcela Rojas', company: 'Servicios Norte', email: 'mrojas@sernorte.cl', daysWaiting: 4, intent: 'meeting_request' }],
  unclassified: [], autoReplies: 0, bounces: [], approvals: { count: 0, oldestDays: null, examples: [] }, campaignSteps: { count: 0, examples: [] },
  followups: [], linkedinAccepted: [], mailboxSynced: true,
  sources: { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' },
  timing: { timeZone: 'America/Santiago', day: '2026-09-25', weekday: 'viernes' },
});

/** Counts by table; every filter is recorded so the test sees that each count is scoped to the person. */
function counting(counts: Record<string, number | 'error'>, seen: string[][]) {
  return { from(table: string) {
    const filters: string[] = [table];
    seen.push(filters);
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain,
      eq: (key, value) => { filters.push(`${key}=${value}`); return chain; },
      not: (key) => { filters.push(`${key} not null`); return chain; },
      neq: (key) => { filters.push(`${key} not empty`); return chain; },
      then: (resolve) => {
        const withEmail = filters.some(filter => filter.startsWith('email'));
        const value = counts[withEmail ? `${table}+email` : table];
        (resolve as (value: unknown) => void)(value === 'error' ? { count: null, error: { message: 'down' } } : { count: value ?? null, error: null });
      },
    };
    return chain;
  } } as never;
}

const reads = {
  linkedin: async () => ({ scope: 'own_linkedin_quota', pending: 38, sent7d: 20, limit: 100, allowed: true, reason: '', windowDays: 7 }) as never,
  agenda: async () => agenda,
};

test('the account state is counted for the person in their organization and read with the agenda and the LinkedIn week', async () => {
  const seen: string[][] = [];
  const workspace = await loadCoworkWorkspace(counting({ leads: 256, 'leads+email': 21, bulk_campaigns: 19 }, seen), scope, 1000, reads);
  assert.deepEqual({ ...workspace, today: undefined }, { contacts: 256, withEmail: 21, campaigns: 19, linkedin: { used: 58, limit: 100 }, today: undefined });
  assert.deepEqual(workspace?.today?.first, [{ who: 'Marcela Rojas · Servicios Norte', what: 'pidió una reunión hace 4 días' }]);
  assert.equal(seen.length, 3);
  for (const filters of seen) assert.ok(filters.includes('organization_id=org-1') && filters.includes('user_id=user-1'), filters.join(' '));
});

test('a part that fails is unknown on its own, and a slow read leaves the turn without the state', async () => {
  const partial = await loadCoworkWorkspace(counting({ leads: 'error', 'leads+email': 21, bulk_campaigns: 19 }, []), scope, 1000,
    { linkedin: async () => { throw new Error('down'); }, agenda: reads.agenda });
  assert.equal(partial?.contacts, null);
  assert.equal(partial?.withEmail, 21);
  assert.equal(partial?.linkedin, null);
  assert.ok(partial?.today);
  const started = Date.now();
  const slow = await loadCoworkWorkspace(counting({ leads: 1 }, []), scope, 30,
    { linkedin: reads.linkedin, agenda: () => new Promise(() => {}) });
  assert.equal(slow, null);
  assert.ok(Date.now() - started < 1000);
});

test('the state travels only with COWORK_WORKSPACE_ENABLED=true', () => {
  assert.equal(coworkWorkspaceEnabled({}), false);
  assert.equal(coworkWorkspaceEnabled({ COWORK_WORKSPACE_ENABLED: '1' }), false);
  assert.equal(coworkWorkspaceEnabled({ COWORK_WORKSPACE_ENABLED: 'true' }), true);
});
