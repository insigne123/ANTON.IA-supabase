import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkAgenda, readLinkedinAccepted, readPendingApprovals, waitingCampaignSteps } from './agenda-read';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const NOW = Date.parse('2026-09-25T13:10:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86400000).toISOString();

function tables(data: Record<string, unknown[]>, failing: string[] = []) {
  return { from(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    const chain: Record<string, (...args: any[]) => any> = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq(key: string, value: unknown) { filters.push(row => !(key in row) || row[key] === value); return chain; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return chain; },
      gte(key: string, value: string) { filters.push(row => !(key in row) || String(row[key]) >= value); return chain; },
      async maybeSingle() {
        if (failing.includes(table)) return { data: null, error: { message: 'down' } };
        return { data: (data[table] || []).filter(row => filters.every(filter => filter(row)))[0] ?? null, error: null };
      },
      then(resolve: (value: unknown) => void) {
        resolve(failing.includes(table) ? { data: null, error: { message: 'down' } }
          : { data: (data[table] || []).filter(row => filters.every(filter => filter(row))), error: null });
      },
    };
    return chain;
  } } as never;
}

const interested = {
  items: [
    { contactedId: 'c1', leadId: null, name: 'Marcela Rojas', email: 'mrojas@sernorte.cl', company: 'Servicios Norte', replyIntent: 'meeting_request', repliedAt: daysAgo(4), daysWaiting: 4 },
    { contactedId: 'c2', leadId: null, name: 'Héctor Vidal', email: 'hvidal@casinocentral.cl', company: 'Casino Central', replyIntent: 'positive', repliedAt: daysAgo(3), daysWaiting: 3 },
    { contactedId: 'c3', leadId: null, name: 'Ana Ruiz', email: 'aruiz@delvalle.cl', company: 'Alimentos del Valle', replyIntent: 'positive', repliedAt: daysAgo(2), daysWaiting: 2 },
  ],
  truncated: false,
};
const attention = {
  scope: 'organization_replies', truncated: false, limitation: '',
  coverage: { gmail: { windowDays: 30, windowComplete: true, lastCompletedAt: daysAgo(0), lastError: null }, outlook: null },
  failures: [
    { name: 'Rodrigo Pino', email: 'rpino@tandes.cl', company: 'Transportes Andes', sent_at: daysAgo(3), group: 'bounce_or_block', action: 'do_not_contact_fix_email' },
    { name: 'Dirección vieja', email: 'vieja@antigua.cl', company: 'Antigua', sent_at: daysAgo(40), group: 'bounce_or_block', action: 'do_not_contact_fix_email' },
    { name: 'Casilla llena', email: 'llena@retail.cl', company: 'Retail', sent_at: daysAgo(2), group: 'bounce_or_block', action: 'retry_later' },
  ],
  unclassified: [{ id: 'c9', name: 'Sofía Lira', email: 'slira@minanorte.cl', company: 'Minera Norte', replied_at: daysAgo(1), group: 'unclassified', action: 'classify_reply' }],
  automatic: [
    { name: 'Verónica Paz', email: 'vpaz@retailsur.cl', replied_at: daysAgo(1), group: 'auto_reply_info', action: 'info_only' },
    { name: 'Luis Mena', email: 'lmena@minanorte.cl', replied_at: daysAgo(2), group: 'auto_reply_info', action: 'info_only' },
    { name: 'De hace un mes', email: 'mes@pasado.cl', replied_at: daysAgo(30), group: 'auto_reply_info', action: 'info_only' },
  ],
};
const followups = {
  campaigns: [{ campaignId: 'k1', name: 'Prospección construcción y RR. HH.', recipients: 165, ready: 47, scheduledLater: 0, heldCompanyReplied: 3, heldNegotiation: 0,
    historyIncomplete: 0, retryWait: 0, needsReconcile: 0, terminal: 0, waiting: 103, done: 12, spacingMinutes: 30 }],
  failed: 0, truncated: false, todaySantiago: '2026-09-25',
};
const dependencies = () => ({
  interested: async () => interested, attention: async () => attention, followups: async () => followups,
  linkedin: async () => ({ status: 'ok' as const, accepted: [{ name: 'Patricio Soto', daysSince: 2 }] }),
  approvals: async () => ({ count: 2, oldestDays: 3, examples: ['Mándale un correo a Adecco'], truncated: false }),
  steps: async () => ({ enabled: false, count: 0, examples: [], truncated: false }),
}) as never;

test('the agenda puts every source in one ranked list with exact counts', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, dependencies(), NOW);
  assert.equal(agenda.day, '2026-09-25');
  assert.equal(agenda.weekday, 'viernes');
  assert.equal(agenda.timeZone, 'America/Santiago');
  assert.equal(agenda.counts.interestedAccounts, 3);
  assert.equal(agenda.counts.ofWhichMeetingRequests, 1);
  assert.equal(agenda.counts.followupsReady, 47);
  assert.equal(agenda.counts.followupsHeld, 3);
  assert.equal(agenda.counts.unclassifiedReplies, 1);
  assert.equal(agenda.counts.linkedinAccepted, 1);
  assert.equal(agenda.counts.approvals, 2);
  assert.equal(agenda.complete, true);
  assert.equal(agenda.mailboxSynced, true);
  assert.deepEqual(agenda.items.map(item => item.kind), [
    'meeting_request', 'interested_reply', 'interested_reply', 'approval', 'unclassified_reply', 'linkedin_accepted', 'followups_due', 'bounce']);
  assert.equal(agenda.items[0].who, 'Marcela Rojas');
  assert.deepEqual(agenda.sources, { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' });
});

test('each person comes with the conversation to read to answer them, from the send that was answered', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, dependencies(), NOW);
  const members = Object.fromEntries(agenda.items.flatMap(item => (item.members || []).map(member => [member.name, member.contactedId])));
  assert.deepEqual(members, { 'Marcela Rojas': 'c1', 'Héctor Vidal': 'c2', 'Ana Ruiz': 'c3', 'Sofía Lira': 'c9' });
});

test('automatic replies of the last week are news and older ones history; they are never pending work', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, dependencies(), NOW);
  assert.equal(agenda.counts.autoReplies, 2);
  assert.ok(!agenda.items.some(item => /auto/i.test(item.kind)));
});

test('a bounce is news for two weeks; a temporary failure asks for no fix and is counted apart', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, dependencies(), NOW);
  assert.equal(agenda.counts.bounces, 1, 'the address that bounced 3 days ago; the one from 40 days ago is history');
  assert.equal(agenda.counts.softBounces, 1);
  const bounce = agenda.items.find(item => item.kind === 'bounce')!;
  assert.deepEqual(bounce.examples, ['Rodrigo Pino (Transportes Andes)']);
});

test('a source that fails is named and the rest of the list stays', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object,
    followups: async () => { throw new Error('down'); },
    linkedin: async () => { throw new Error('down'); },
  } as never, NOW);
  assert.equal(agenda.complete, false);
  assert.equal(agenda.sources.followups, 'unavailable');
  assert.equal(agenda.sources.linkedin, 'unavailable');
  assert.equal(agenda.sources.interested, 'ok');
  assert.equal(agenda.sources.attention, 'ok');
  assert.equal(agenda.counts.linkedinAccepted, null, 'an unreadable LinkedIn is not zero acceptances');
  assert.equal(agenda.counts.followupsReady, null, 'follow-ups that could not be read are unknown, never a zero the coordinator would repeat');
  assert.equal(agenda.counts.followupsLater, null);
  assert.equal(agenda.counts.followupsHeld, null);
  assert.equal(agenda.counts.interestedAccounts, 3);
  assert.ok(!agenda.items.some(item => item.kind === 'followups_due'));
});

test('if one half of the replies cannot be read, its counts are unknown and the other half stands', async () => {
  const noAttention = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, attention: async () => { throw new Error('down'); },
  } as never, NOW);
  assert.equal(noAttention.sources.attention, 'unavailable');
  assert.equal(noAttention.sources.interested, 'ok');
  assert.equal(noAttention.counts.interestedAccounts, 3, 'what could be read is still there');
  assert.equal(noAttention.counts.unclassifiedReplies, null);
  assert.equal(noAttention.counts.autoReplies, null);
  assert.equal(noAttention.counts.bounces, null);
  assert.equal(noAttention.counts.softBounces, null);
  assert.equal(noAttention.mailboxSynced, null);
  assert.equal(noAttention.complete, false);
  const noInterested = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, interested: async () => { throw new Error('down'); },
  } as never, NOW);
  assert.equal(noInterested.sources.interested, 'unavailable');
  assert.equal(noInterested.counts.interestedAccounts, null, 'no one interested is not the same as not knowing');
  assert.equal(noInterested.counts.interestedPeople, null);
  assert.equal(noInterested.counts.cooledAccounts, null);
  assert.equal(noInterested.counts.ofWhichMeetingRequests, null);
  assert.equal(noInterested.counts.bounces, 1, 'the other half is unaffected');
  assert.equal(noInterested.complete, false);
});

test('rows left out by a limit make the source partial, not complete', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object,
    interested: async () => ({ ...interested, truncated: true }),
    followups: async () => ({ ...followups, truncated: true }),
    approvals: async () => ({ count: 20, oldestDays: 9, examples: [], truncated: true }),
  } as never, NOW);
  assert.equal(agenda.sources.interested, 'partial');
  assert.equal(agenda.sources.followups, 'partial');
  assert.equal(agenda.sources.approvals, 'partial');
  assert.equal(agenda.complete, false);
  const failedCampaign = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, followups: async () => ({ ...followups, failed: 1 }),
  } as never, NOW);
  assert.equal(failedCampaign.sources.followups, 'partial', 'one campaign that could not be read leaves the list partial');
  const fullAttention = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, attention: async () => ({ ...attention, truncated: true }),
  } as never, NOW);
  assert.equal(fullAttention.sources.attention, 'partial', 'a full page of bounces or unclassified replies leaves that half partial');
  assert.equal(fullAttention.sources.interested, 'ok', 'and only that half');
  assert.equal(fullAttention.complete, false);
});

test('no approved campaign and no campaigns v2 are nothing to read, not a failure', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, followups: async () => ({ campaigns: [], failed: 0, truncated: false, todaySantiago: '2026-09-25' }),
  } as never, NOW);
  assert.equal(agenda.sources.followups, 'none');
  assert.equal(agenda.sources.campaignSteps, 'none');
  assert.equal(agenda.complete, true);
});

test('campaign steps of campaigns v2 that wait for the person become one item', async () => {
  const agenda = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object,
    steps: async () => ({ enabled: true, count: 4, examples: ['Paso 2 · Ana Ruiz'], truncated: false }),
  } as never, NOW);
  assert.equal(agenda.sources.campaignSteps, 'ok');
  assert.equal(agenda.counts.campaignSteps, 4);
  assert.equal(agenda.items.find(item => item.kind === 'campaign_step')!.count, 4);
});

test('the mailbox counts as synced only when every connected mailbox finished its sweep', async () => {
  const half = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object,
    attention: async () => ({ ...attention, coverage: { gmail: attention.coverage.gmail, outlook: { windowDays: 30, windowComplete: false, lastCompletedAt: null, lastError: null } } }),
  } as never, NOW);
  assert.equal(half.mailboxSynced, false);
  assert.match(half.limitation, /no está sincronizado por completo/);
  const unknown = await readCoworkAgenda(tables({}), scope, {
    ...dependencies() as object, attention: async () => ({ ...attention, coverage: { gmail: null, outlook: null } }),
  } as never, NOW);
  assert.equal(unknown.mailboxSynced, null);
});

test('pending approvals are the proposals nobody decided, oldest first, with short examples', async () => {
  const client = tables({ cowork_runs: [
    { message: '  Mándale un correo\n a  Adecco   con la oferta ', created_at: daysAgo(5), status: 'waiting_approval' },
    { message: 'x'.repeat(200), created_at: daysAgo(1), status: 'waiting_approval' },
    { message: 'Ya aprobada', created_at: daysAgo(9), status: 'completed' },
  ] });
  const approvals = await readPendingApprovals(client, scope, NOW);
  assert.equal(approvals.count, 2);
  assert.equal(approvals.oldestDays, 5);
  assert.equal(approvals.examples[0], 'Mándale un correo a Adecco con la oferta');
  assert.equal(approvals.examples[1].length, 90);
  assert.equal(approvals.truncated, false);
  const many = await readPendingApprovals(tables({ cowork_runs: Array.from({ length: 21 }, (_, index) =>
    ({ message: `m${index}`, created_at: daysAgo(index), status: 'waiting_approval' })) }), scope, NOW);
  assert.equal(many.count, 20);
  assert.equal(many.truncated, true);
  await assert.rejects(readPendingApprovals(tables({}, ['cowork_runs']), scope, NOW), /No se pudieron consultar las aprobaciones pendientes/);
});

test('LinkedIn acceptances are only told once the network has been synced completely', async () => {
  const never = await readLinkedinAccepted(tables({ cowork_linkedin_sweep_state: [] }), scope, NOW);
  assert.equal(never.status, 'sync_incomplete');
  const midway = await readLinkedinAccepted(tables({ cowork_linkedin_sweep_state: [{ kind: 'network', last_completed_at: daysAgo(1), has_more: true }] }), scope, NOW);
  assert.equal(midway.status, 'sync_incomplete');
  assert.deepEqual(midway.accepted, []);
});

test('a person who accepted an invitation and was not written to is an acceptance; one already messaged is not', async () => {
  const url = (name: string) => `https://www.linkedin.com/in/${name}`;
  const client = tables({
    cowork_linkedin_sweep_state: [{ kind: 'network', last_completed_at: daysAgo(1), has_more: false }],
    cowork_linkedin_jobs: [
      { kind: 'invite', status: 'confirmed', canonical_url: url('patricio'), display_name: 'Patricio Soto', created_at: daysAgo(6) },
      { kind: 'invite', status: 'confirmed', canonical_url: url('camila'), display_name: 'Camila Vera', created_at: daysAgo(8) },
      { kind: 'invite', status: 'confirmed', canonical_url: url('jorge'), display_name: 'Jorge Lagos', created_at: daysAgo(10) },
      { kind: 'invite', status: 'failed', canonical_url: url('fallida'), display_name: 'Fallida', created_at: daysAgo(3) },
      { kind: 'invite', status: 'confirmed', canonical_url: url('antigua'), display_name: 'Muy antigua', created_at: daysAgo(45) },
      { kind: 'message', status: 'confirmed', canonical_url: url('camila'), created_at: daysAgo(2) },
      { kind: 'message', status: 'failed', canonical_url: url('patricio'), created_at: daysAgo(1) },
    ],
    cowork_linkedin_peers: [
      { canonical_url: url('patricio'), first_seen: daysAgo(3) },
      { canonical_url: url('camila'), first_seen: daysAgo(5) },
      { canonical_url: url('antigua'), first_seen: daysAgo(40) },
      { canonical_url: url('fallida'), first_seen: daysAgo(2) },
    ],
  });
  const result = await readLinkedinAccepted(client, scope, NOW);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.accepted, [{ name: 'Patricio Soto', daysSince: 3 }],
    'Camila was already messaged, Jorge has not joined, the failed and the 45-day-old invitations do not count, and a failed message is not a message');
});

test('with no invitations sent there is nothing to accept, and a broken read is an error', async () => {
  const quiet = await readLinkedinAccepted(tables({ cowork_linkedin_sweep_state: [{ kind: 'network', last_completed_at: daysAgo(1), has_more: false }] }), scope, NOW);
  assert.equal(quiet.status, 'ok');
  assert.deepEqual(quiet.accepted, []);
  await assert.rejects(readLinkedinAccepted(tables({}, ['cowork_linkedin_sweep_state']), scope, NOW), /sincronización de LinkedIn/);
  await assert.rejects(readLinkedinAccepted(tables({
    cowork_linkedin_sweep_state: [{ kind: 'network', last_completed_at: daysAgo(1), has_more: false }],
    cowork_linkedin_jobs: [{ kind: 'invite', status: 'confirmed', canonical_url: 'https://www.linkedin.com/in/a', created_at: daysAgo(2) }],
  }, ['cowork_linkedin_peers']), scope, NOW), /conexiones de LinkedIn/);
});

test('only the campaign steps that wait for the person count: not the ones not due yet nor the ones already leaving', () => {
  const steps = waitingCampaignSteps({ enabled: true, truncated: false, items: [
    { state: 'review_required', stepName: 'Paso 2', recipientName: 'Ana Ruiz' },
    { state: 'ready_to_prepare', stepName: 'Paso 3', recipientName: 'Luis Mena' },
    { state: 'failed', stepName: 'Paso 1', recipientName: null },
    { state: 'not_due', stepName: 'Paso 4', recipientName: 'Eva Soto' },
    { state: 'dispatch_pending', stepName: 'Paso 1', recipientName: 'Raúl Díaz' },
    { state: 'sending', stepName: 'Paso 1', recipientName: 'Sol Vera' },
  ] });
  assert.equal(steps.count, 3);
  assert.deepEqual(steps.examples, ['Paso 2 · Ana Ruiz', 'Paso 3 · Luis Mena', 'Paso 1']);
  assert.equal(steps.enabled, true);
  assert.deepEqual(waitingCampaignSteps({ enabled: false, truncated: false, items: [{ state: 'review_required' }] }),
    { enabled: false, count: 0, examples: [], truncated: false }, 'campaigns v2 turned off: nothing to read');
  assert.equal(waitingCampaignSteps({ enabled: true, truncated: true, items: [] }).truncated, true);
});

test('by default the agenda asks for the replies and bounces of this person only', async () => {
  const eqs: Array<{ table: string; key: string; value: unknown }> = [];
  const client = { from: (table: string) => {
    const chain: Record<string, (...args: any[]) => any> = {
      select: () => chain, order: () => chain, limit: () => chain, in: () => chain, not: () => chain, is: () => chain, gte: () => chain, or: () => chain,
      eq: (key: string, value: unknown) => { eqs.push({ table, key, value }); return chain; },
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return chain;
  } } as never;
  const { interested, followups, linkedin, approvals, steps } = dependencies() as Record<string, unknown>;
  const agenda = await readCoworkAgenda(client, scope, { interested, followups, linkedin, approvals, steps } as never, NOW);
  const mine = eqs.filter(call => call.table === 'contacted_leads' && call.key === 'user_id');
  assert.equal(mine.length, 3, 'unclassified replies, bounces and automatic replies');
  assert.ok(mine.every(call => call.value === scope.userId));
  assert.equal(agenda.scope, 'own_agenda_today');
});
