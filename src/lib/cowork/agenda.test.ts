import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkActionInfo, coworkReadFinding } from './presentation';
import { COWORK_DOMAIN_FIXED_READS, isCoworkDomainRead } from './domain-reads';
import {
  AGENDA_COOLED_AFTER_DAYS, AGENDA_MAX_ITEMS, AGENDA_WHEN_EMPTY, buildCoworkAgenda,
  type AgendaFollowupCampaign, type AgendaInput, type AgendaSourceKey, type AgendaSourceStatus,
} from './agenda';

const okSources = (): Record<AgendaSourceKey, AgendaSourceStatus> =>
  ({ interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' });
const empty = (): AgendaInput => ({
  interested: [], unclassified: [], autoReplies: 0, bounces: [],
  approvals: { count: 0, oldestDays: null, examples: [] }, campaignSteps: { count: 0, examples: [] },
  followups: [], linkedinAccepted: [], sources: okSources(), mailboxSynced: true,
  timing: { timeZone: 'America/Santiago', day: '2026-09-25', weekday: 'viernes' },
});
const person = (name: string, company: string, email: string, daysWaiting: number) => ({ name, company, email, daysWaiting });
const campaign = (overrides: Partial<AgendaFollowupCampaign> = {}): AgendaFollowupCampaign => ({
  campaign: 'Prospección construcción', recipients: 60, ready: 0, scheduledLater: 0,
  heldCompanyReplied: 0, heldNegotiation: 0, historyIncomplete: 0, retryWait: 0, needsReconcile: 0, terminal: 0,
  waiting: 0, done: 0, spacingMinutes: 30, ...overrides,
});

test('an empty day is an empty list with every count at zero and the list complete', () => {
  const agenda = buildCoworkAgenda(empty());
  assert.deepEqual(agenda.items, []);
  assert.equal(agenda.complete, true);
  assert.equal(agenda.truncated, false);
  assert.equal(agenda.counts.interestedAccounts, 0);
  assert.equal(agenda.counts.linkedinAccepted, 0);
  assert.equal(agenda.day, '2026-09-25');
  assert.equal(agenda.weekday, 'viernes');
});

test('an empty and complete list says what to read next; a list with something in it, or one that could not be read, does not', () => {
  const agenda = buildCoworkAgenda(empty());
  assert.equal(agenda.whenEmpty, AGENDA_WHEN_EMPTY);
  assert.match(AGENDA_WHEN_EMPTY, /leads\.search/);
  assert.match(AGENDA_WHEN_EMPTY, /campaigns\.list/);
  // Automatic replies and soft bounces are information, not work: the day is still empty.
  assert.equal(buildCoworkAgenda({ ...empty(), autoReplies: 2 }).whenEmpty, AGENDA_WHEN_EMPTY);
  assert.equal(buildCoworkAgenda({ ...empty(), interested: [{ ...person('A', 'Empresa A', 'a@empresa-a.cl', 1), intent: 'positive' }] }).whenEmpty, undefined);
  // An empty list that left something unread is not «nothing pending»: it must say what it could not read instead.
  assert.equal(buildCoworkAgenda({ ...empty(), sources: { ...okSources(), followups: 'unavailable' } }).whenEmpty, undefined);
  assert.equal(buildCoworkAgenda({ ...empty(), sources: { ...okSources(), interested: 'partial' } }).whenEmpty, undefined);
});

test('the list goes by commercial value: people who answered, then decisions, then what revives, then what runs by itself', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('Héctor Vidal', 'Casino Central', 'hvidal@casinocentral.cl', 3), intent: 'positive' },
      { ...person('Marcela Rojas', 'Servicios Norte', 'mrojas@sernorte.cl', 4), intent: 'meeting_request' },
      { ...person('Iván Herrera', 'Servicios Integrales', 'iherrera@servintegrales.cl', 24), intent: 'positive' },
    ],
    unclassified: [person('Sofía Lira', 'Minera Norte', 'slira@minanorte.cl', 1)],
    approvals: { count: 2, oldestDays: 3, examples: ['Mándale un correo a Adecco'] },
    campaignSteps: { count: 4, examples: ['Paso 2 de Retail'] },
    followups: [campaign({ ready: 47 })],
    linkedinAccepted: [{ name: 'Patricio Soto', daysSince: 2 }],
    bounces: [{ name: 'Rodrigo Pino', email: 'rpino@tandes.cl', company: 'Transportes Andes', action: 'fix_email' }],
    sources: { ...okSources(), campaignSteps: 'ok' },
  });
  assert.deepEqual(agenda.items.map(item => item.kind), [
    'meeting_request', 'interested_reply', 'approval', 'unclassified_reply', 'campaign_step',
    'cooled_lead', 'linkedin_accepted', 'followups_due', 'bounce']);
  assert.deepEqual(agenda.items.map(item => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(agenda.items[0].who, 'Marcela Rojas');
  assert.equal(agenda.items[0].action, 'reply');
  assert.deepEqual(agenda.items[0].members, [{ name: 'Marcela Rojas', daysWaiting: 4, askedForMeeting: true }]);
  assert.deepEqual(agenda.items[1].members, [{ name: 'Héctor Vidal', daysWaiting: 3, askedForMeeting: false }]);
  assert.equal(agenda.items[5].action, 'revive');
  assert.equal(agenda.items[7].action, 'let_run');
  assert.equal(agenda.items[8].action, 'fix_email');
});

test('the counts are exact and separate what waits for an answer from what has cooled', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('Marcela Rojas', 'Servicios Norte', 'mrojas@sernorte.cl', 4), intent: 'meeting_request' },
      { ...person('Héctor Vidal', 'Casino Central', 'hvidal@casinocentral.cl', 3), intent: 'positive' },
      { ...person('Ana Ruiz', 'Alimentos del Valle', 'aruiz@delvalle.cl', 2), intent: 'positive' },
      { ...person('Iván Herrera', 'Servicios Integrales', 'iherrera@servintegrales.cl', 24), intent: 'positive' },
    ],
    autoReplies: 2,
    followups: [campaign({ ready: 47, scheduledLater: 5, heldCompanyReplied: 3, heldNegotiation: 1, historyIncomplete: 0 })],
    bounces: [
      { name: 'Rodrigo Pino', email: 'rpino@tandes.cl', company: 'Transportes Andes', action: 'fix_email' },
      { name: 'Lucía Soto', email: 'lsoto@retailsur.cl', company: 'Retail Sur', action: 'temporary' },
    ],
  });
  assert.equal(agenda.counts.interestedAccounts, 3);
  assert.equal(agenda.counts.interestedPeople, 3);
  assert.equal(agenda.counts.ofWhichMeetingRequests, 1, 'the one that asked for a meeting is one of the three, not a fourth');
  assert.equal(agenda.counts.cooledAccounts, 1);
  assert.equal(agenda.counts.followupsReady, 47);
  assert.equal(agenda.counts.followupsLater, 5);
  assert.equal(agenda.counts.followupsHeld, 4);
  assert.equal(agenda.counts.bounces, 1, 'a temporary failure (a full mailbox) asks for no fix: it is counted apart');
  assert.equal(agenda.counts.softBounces, 1);
  assert.equal(agenda.counts.autoReplies, 2);
});

test('automatic replies are information: they never become an item nor add to the pending replies', () => {
  const agenda = buildCoworkAgenda({ ...empty(), autoReplies: 3 });
  assert.deepEqual(agenda.items, []);
  assert.equal(agenda.counts.autoReplies, 3);
  assert.equal(agenda.counts.unclassifiedReplies, 0);
  assert.equal(agenda.counts.interestedAccounts, 0);
});

test('colleagues of one company are one account, found by the corporate domain and never merged through a shared mailbox', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('Marcela Rojas', 'Servicios Norte', 'mrojas@sernorte.cl', 5), intent: 'positive' },
      { ...person('Gerardo Paz', 'Servicios Norte SpA', 'gpaz@sernorte.cl', 2), intent: 'meeting_request' },
      { ...person('Marcela Rojas', 'Servicios Norte', 'MRojas@sernorte.cl', 5), intent: 'positive' },
      { ...person('Pedro Gil', 'Taller Gil', 'pedro@gmail.com', 1), intent: 'positive' },
      { ...person('Paula Gil', 'Otra Empresa', 'paula@gmail.com', 1), intent: 'positive' },
    ],
  });
  assert.equal(agenda.counts.interestedAccounts, 3, 'one company at sernorte.cl and two separate people on gmail.com');
  assert.equal(agenda.counts.interestedPeople, 4, 'the same person twice counts once');
  const account = agenda.items.find(item => item.company === 'Servicios Norte');
  assert.ok(account);
  assert.equal(account!.kind, 'meeting_request', 'one colleague asking for a meeting makes the account a meeting request');
  assert.equal(account!.people, 2);
  assert.deepEqual(account!.members, [
    { name: 'Marcela Rojas', daysWaiting: 5, askedForMeeting: false },
    { name: 'Gerardo Paz', daysWaiting: 2, askedForMeeting: true },
  ], 'each colleague keeps their own wait, and the meeting was asked for by Gerardo, not by Marcela');
  assert.equal(account!.who, 'Marcela Rojas', 'the one who has waited longest');
  assert.equal(account!.daysWaiting, 5);
});

test('a colleague who wrote this week keeps the account warm even if the first person wrote long ago', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('Marcela Rojas', 'Servicios Norte', 'mrojas@sernorte.cl', 20), intent: 'positive' },
      { ...person('Gerardo Paz', 'Servicios Norte', 'gpaz@sernorte.cl', 1), intent: 'positive' },
    ],
  });
  assert.equal(agenda.counts.cooledAccounts, 0);
  assert.equal(agenda.counts.interestedAccounts, 1);
  assert.equal(agenda.items[0].kind, 'interested_reply');
  assert.equal(agenda.items[0].daysWaiting, 20, 'the wait of the one who has waited longest is still shown');
});

test('the cooling point is exactly fourteen days, and the freshest cold account comes first', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('A', 'Empresa A', 'a@empresa-a.cl', AGENDA_COOLED_AFTER_DAYS - 1), intent: 'positive' },
      { ...person('B', 'Empresa B', 'b@empresa-b.cl', AGENDA_COOLED_AFTER_DAYS), intent: 'positive' },
      { ...person('C', 'Empresa C', 'c@empresa-c.cl', 40), intent: 'positive' },
      { ...person('D', 'Empresa D', 'd@empresa-d.cl', 20), intent: 'positive' },
    ],
  });
  assert.deepEqual(agenda.items.map(item => item.who), ['A', 'B', 'D', 'C']);
  assert.deepEqual(agenda.items.map(item => item.kind), ['interested_reply', 'cooled_lead', 'cooled_lead', 'cooled_lead']);
});

test('who waited longest goes first inside a group, and a person without name or company is still counted', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    interested: [
      { ...person('Reciente', 'Empresa R', 'r@empresa-r.cl', 1), intent: 'positive' },
      { ...person('Antigua', 'Empresa A', 'a@empresa-a.cl', 6), intent: 'positive' },
      { name: null, company: null, email: 'solo@correo-uno.cl', daysWaiting: 3, intent: 'positive' },
      { name: null, company: null, email: null, daysWaiting: 2, intent: 'positive' },
      { name: null, company: null, email: null, daysWaiting: 2, intent: 'positive' },
    ],
  });
  assert.deepEqual(agenda.items.map(item => item.who), ['Antigua', 'solo@correo-uno.cl', null, null, 'Reciente']);
  assert.equal(agenda.counts.interestedAccounts, 5, 'rows with nothing to tell them apart are not merged into one');
});

test('follow-ups appear per campaign only when something goes out, moves to another day or is held, and say why', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    followups: [
      campaign({ campaign: 'Sin nada hoy', waiting: 30, done: 30 }),
      campaign({ campaign: 'Construcción', ready: 12, scheduledLater: 8, spacingMinutes: 30 }),
      campaign({ campaign: 'Solo retenidos', heldCompanyReplied: 4, heldNegotiation: 1 }),
    ],
  });
  assert.deepEqual(agenda.items.map(item => item.campaign), ['Construcción', 'Solo retenidos']);
  assert.equal(agenda.items[0].ready, 12);
  assert.equal(agenda.items[0].later, 8);
  assert.equal(agenda.items[0].spacingMinutes, 30);
  assert.equal(agenda.items[1].ready, 0);
  assert.equal(agenda.items[1].held, 5);
  assert.equal(agenda.counts.followupsReady, 12);
  assert.equal(agenda.counts.followupsHeld, 5);
});

test('aggregate items carry how many things they stand for, a few examples and the oldest wait', () => {
  const agenda = buildCoworkAgenda({
    ...empty(),
    approvals: { count: 5, oldestDays: 9, examples: ['uno', 'dos', 'tres', 'cuatro'] },
    linkedinAccepted: [{ name: 'Ana', daysSince: 2 }, { name: null, daysSince: 6 }, { name: 'Luis', daysSince: 1 }, { name: 'Eva', daysSince: 3 }, { name: 'Raúl', daysSince: 4 }],
    bounces: [1, 2, 3, 4].map(n => ({ name: `Persona ${n}`, email: `p${n}@empresa${n}.cl`, company: n === 2 ? null : `Empresa ${n}`, action: 'fix_email' as const })),
  });
  const approval = agenda.items.find(item => item.kind === 'approval')!;
  assert.equal(approval.count, 5);
  assert.deepEqual(approval.examples, ['uno', 'dos', 'tres']);
  assert.equal(approval.daysWaiting, 9);
  const linkedin = agenda.items.find(item => item.kind === 'linkedin_accepted')!;
  assert.equal(linkedin.count, 5);
  assert.deepEqual(linkedin.examples, ['Ana', 'Luis', 'Eva']);
  assert.equal(linkedin.daysWaiting, 6);
  const bounce = agenda.items.find(item => item.kind === 'bounce')!;
  assert.equal(bounce.count, 4);
  assert.deepEqual(bounce.examples, ['Persona 1 (Empresa 1)', 'Persona 2', 'Persona 3 (Empresa 3)']);
});

test('the list is cut at twelve items but the counts keep covering everything', () => {
  const interested = Array.from({ length: 15 }, (_, index) =>
    ({ ...person(`Persona ${index}`, `Empresa ${index}`, `p${index}@empresa${index}.cl`, index + 1), intent: 'positive' as const }));
  const agenda = buildCoworkAgenda({ ...empty(), interested });
  assert.equal(agenda.items.length, AGENDA_MAX_ITEMS);
  assert.equal(agenda.truncated, true);
  assert.equal(agenda.counts.interestedAccounts, 13, 'the 13 freshest wait less than fourteen days');
  assert.equal(agenda.counts.cooledAccounts, 2);
  assert.equal(agenda.items[0].who, 'Persona 12', 'the one who has waited longest of the live ones first');
  assert.deepEqual(agenda.items.map(item => item.rank), Array.from({ length: AGENDA_MAX_ITEMS }, (_, index) => index + 1));
});

test('a source that failed or left rows out makes the list partial; nothing to read and an unsynced LinkedIn do not', () => {
  const failed = buildCoworkAgenda({ ...empty(), sources: { ...okSources(), followups: 'unavailable' } });
  assert.equal(failed.complete, false);
  assert.equal(failed.sources.followups, 'unavailable');
  assert.equal(buildCoworkAgenda({ ...empty(), sources: { ...okSources(), interested: 'partial' } }).complete, false);
  const none = buildCoworkAgenda({ ...empty(), sources: { ...okSources(), campaignSteps: 'none', followups: 'none' } });
  assert.equal(none.complete, true, 'nothing to read is not a failure');
  const unsynced = buildCoworkAgenda({ ...empty(), sources: { ...okSources(), linkedin: 'sync_incomplete' } });
  assert.equal(unsynced.complete, true, 'the list is as complete as the app can make it; the source says LinkedIn was never fully synced');
  assert.equal(unsynced.sources.linkedin, 'sync_incomplete');
  assert.equal(unsynced.counts.linkedinAccepted, null, 'an unsynced LinkedIn is not zero acceptances');
});

test('the limitation says when the mailbox is not fully synced and never claims the inbox was reviewed', () => {
  const synced = buildCoworkAgenda(empty());
  const unsynced = buildCoworkAgenda({ ...empty(), mailboxSynced: false });
  assert.doesNotMatch(synced.limitation, /sincroniz/);
  assert.match(unsynced.limitation, /no está sincronizado por completo/);
  assert.doesNotMatch(`${synced.limitation} ${unsynced.limitation}`, /bandeja revisada/i);
  assert.equal(unsynced.mailboxSynced, false);
});

test('agenda.today is a fixed read with its own plan label and its own count', () => {
  assert.ok(isCoworkDomainRead('agenda.today'));
  assert.ok((COWORK_DOMAIN_FIXED_READS as readonly string[]).includes('agenda.today'), 'no input: it is one of the fixed reads');
  const info = coworkActionInfo('agenda.today');
  assert.equal(info.label, 'Armó tu lista de hoy');
  assert.equal(info.icon, 'calendar');
  const agenda = buildCoworkAgenda({ ...empty(), interested: [{ ...person('A', 'Empresa A', 'a@empresa-a.cl', 1), intent: 'positive' }], followups: [campaign({ ready: 3 })] });
  assert.deepEqual(coworkReadFinding({ action: 'agenda.today', result: agenda }), { count: 2, label: 'pendientes de hoy' });
  assert.deepEqual(coworkReadFinding({ action: 'agenda.today', result: buildCoworkAgenda(empty()) }), { count: null, label: 'sin pendientes de hoy' });
});

test('what could not be read is unknown, never zero: each source makes only its own counts null', () => {
  const nulls = (source: AgendaSourceKey, status: AgendaSourceStatus) => {
    const counts = buildCoworkAgenda({ ...empty(), sources: { ...okSources(), [source]: status } }).counts as Record<string, number | null>;
    return Object.keys(counts).filter(key => counts[key] === null).sort();
  };
  assert.deepEqual(nulls('interested', 'unavailable'), ['cooledAccounts', 'interestedAccounts', 'interestedPeople', 'ofWhichMeetingRequests']);
  assert.deepEqual(nulls('attention', 'unavailable'), ['autoReplies', 'bounces', 'softBounces', 'unclassifiedReplies']);
  assert.deepEqual(nulls('approvals', 'unavailable'), ['approvals']);
  assert.deepEqual(nulls('campaignSteps', 'unavailable'), ['campaignSteps']);
  assert.deepEqual(nulls('followups', 'unavailable'), ['followupsHeld', 'followupsLater', 'followupsReady']);
  assert.deepEqual(nulls('linkedin', 'unavailable'), ['linkedinAccepted']);
  assert.deepEqual(nulls('linkedin', 'sync_incomplete'), ['linkedinAccepted']);
  assert.deepEqual(nulls('interested', 'partial'), [], 'a page that was cut is a lower bound, and the source says so');
  assert.deepEqual(nulls('followups', 'none'), [], 'no campaign is a real zero');
  assert.deepEqual(nulls('campaignSteps', 'none'), [], 'campaigns v2 off is a real zero');
});

test('the people who asked for a meeting are already inside the interested companies', () => {
  const agenda = buildCoworkAgenda({ ...empty(), interested: [
    { ...person('Marcela Rojas', 'Servicios Norte', 'mrojas@sernorte.cl', 4), intent: 'meeting_request' },
    { ...person('Héctor Vidal', 'Casino Central', 'hvidal@casinocentral.cl', 3), intent: 'positive' },
    { ...person('Ana Ruiz', 'Alimentos del Valle', 'aruiz@delvalle.cl', 2), intent: 'positive' },
  ] });
  assert.equal(agenda.counts.interestedAccounts, 3);
  assert.equal(agenda.counts.ofWhichMeetingRequests, 1);
  assert.ok(Number(agenda.counts.ofWhichMeetingRequests) <= Number(agenda.counts.interestedAccounts));
});

test('a person who appears twice keeps their longest wait, asks for the meeting if any of their replies did, and the account lists three people at most', () => {
  const agenda = buildCoworkAgenda({ ...empty(), interested: [
    // Not in order of wait, so that the order of the members is the code's and not the order the rows came in.
    { ...person('Dani Pino', 'Delvalle', 'dpino@delvalle.cl', 1), intent: 'positive' },
    { ...person('Carla Soto', 'Delvalle', 'csoto@delvalle.cl', 3), intent: 'positive' },
    { ...person('Ana Ruiz', 'Delvalle', 'aruiz@delvalle.cl', 2), intent: 'positive' },
    { ...person('Ana Ruiz', 'Delvalle', 'ARuiz@delvalle.cl', 6), intent: 'meeting_request' },
    { ...person('Beto Díaz', 'Delvalle', 'bdiaz@delvalle.cl', 4), intent: 'positive' },
  ] });
  const account = agenda.items[0];
  assert.equal(account.people, 4);
  assert.deepEqual(account.members, [
    { name: 'Ana Ruiz', daysWaiting: 6, askedForMeeting: true },
    { name: 'Beto Díaz', daysWaiting: 4, askedForMeeting: false },
    { name: 'Carla Soto', daysWaiting: 3, askedForMeeting: false },
  ]);
  assert.equal(account.daysWaiting, 6);
});
