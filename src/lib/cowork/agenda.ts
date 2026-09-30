import { companyKeysFor } from './send-cadence';

/** «¿Qué toca hoy?»: what waits for the person today, in the order that moves the business most. Pure: the readers
 * (server/cowork/agenda-read.ts) bring the rows; this groups, ranks and counts them so the coordinator never has to. */

/** Someone interested who has waited this long without an answer has cooled: the job is to revive them, not to answer. */
export const AGENDA_COOLED_AFTER_DAYS = 14;
/** Items the coordinator gets, already ranked; the counts always cover everything. */
export const AGENDA_MAX_ITEMS = 12;
/** An automatic reply older than this is history, not today's news. */
export const AGENDA_AUTO_REPLY_DAYS = 7;
/** A bounce older than this is a dead address the engine already avoids; a new one is what moves the bounce rate. */
export const AGENDA_BOUNCE_DAYS = 14;

export type AgendaKind =
  | 'meeting_request' | 'interested_reply' | 'approval' | 'unclassified_reply' | 'campaign_step'
  | 'cooled_lead' | 'linkedin_accepted' | 'followups_due' | 'bounce';

export type AgendaAction = 'reply' | 'decide' | 'review_reply' | 'review_step' | 'revive' | 'message_linkedin' | 'let_run' | 'fix_email';

/** ok: read in full. none: nothing to read (no active campaign, campaigns v2 off). partial: read, but rows beyond the limit were
 * left out. sync_incomplete: LinkedIn is not fully synced, so acceptances cannot be told. unavailable: the read failed. */
export type AgendaSourceStatus = 'ok' | 'none' | 'partial' | 'sync_incomplete' | 'unavailable';
export type AgendaSourceKey = 'replies' | 'approvals' | 'campaignSteps' | 'followups' | 'linkedin';

type Person = { name: string | null; email: string | null; company: string | null };
export type AgendaReplyInput = Person & { daysWaiting: number };
export type AgendaInterestedInput = AgendaReplyInput & { intent: 'positive' | 'meeting_request' };
/** fix_email: the address is wrong or blocked. review: needs a look (a block by policy, an unknown cause). temporary: a soft failure
 * (a full mailbox, a passing error) that asks for no fix, only another try later. */
export type AgendaBounceInput = Person & { action: 'fix_email' | 'review' | 'temporary' };
export type AgendaFollowupCampaign = {
  campaign: string; recipients: number;
  /** Due today and nothing holds them back. */
  ready: number;
  /** Due, but the one-company-per-day rule puts them on a later day. */
  scheduledLater: number;
  heldCompanyReplied: number; heldNegotiation: number; historyIncomplete: number;
  retryWait: number; needsReconcile: number; terminal: number;
  /** The next touch is not due yet. */
  waiting: number; done: number;
  spacingMinutes: number | null;
};

export type AgendaInput = {
  interested: AgendaInterestedInput[];
  unclassified: AgendaReplyInput[];
  /** Automatic replies of the last AGENDA_AUTO_REPLY_DAYS days: information, never pending work. */
  autoReplies: number;
  bounces: AgendaBounceInput[];
  approvals: { count: number; oldestDays: number | null; examples: string[] };
  campaignSteps: { count: number; examples: string[] };
  followups: AgendaFollowupCampaign[];
  linkedinAccepted: Array<{ name: string | null; daysSince: number }>;
  sources: Record<AgendaSourceKey, AgendaSourceStatus>;
  /** Whether every connected mailbox has been swept completely; null when it is unknown. */
  mailboxSynced: boolean | null;
  timing: { timeZone: string; day: string; weekday: string };
};

export type AgendaItem = {
  rank: number; kind: AgendaKind; action: AgendaAction;
  /** The person who has waited longest at this account, and the company; null on aggregate items. */
  who: string | null; company: string | null;
  /** Accounts: how many people of the company wrote (colleagues count once per person) and up to three of their names. */
  people?: number; names?: string[];
  daysWaiting?: number;
  /** Aggregate items (approvals, campaign steps, LinkedIn, bounces): how many things they stand for and a few examples. */
  count?: number; examples?: string[];
  /** followups_due, one per campaign: what goes out today, what moves to another day and what a company's reply or a negotiation holds. */
  campaign?: string; ready?: number; later?: number; held?: number; spacingMinutes?: number | null;
};

export type CoworkAgenda = {
  scope: 'own_agenda_today';
  day: string; weekday: string; timeZone: string;
  counts: {
    /** Companies with an interested person waiting (fresh), how many people wrote and how many of those companies asked for a meeting. */
    interestedAccounts: number; interestedPeople: number; meetingRequests: number;
    /** Companies whose interested people have waited AGENDA_COOLED_AFTER_DAYS or more. */
    cooledAccounts: number;
    unclassifiedReplies: number;
    autoReplies: number;
    approvals: number;
    campaignSteps: number;
    followupsReady: number; followupsLater: number; followupsHeld: number;
    linkedinAccepted: number | null;
    bounces: number; softBounces: number;
  };
  items: AgendaItem[];
  truncated: boolean;
  sources: Record<AgendaSourceKey, AgendaSourceStatus>;
  /** False when a source failed or left rows out: the list is then partial and must be said so. A LinkedIn that was never fully
   * synced is not a failure (sources.linkedin says it); it only means acceptances cannot be told. */
  complete: boolean;
  mailboxSynced: boolean | null;
  limitation: string;
};

/** Commercial value, highest first: people who answered, then decisions only the person can take, then what revives or
 * prepares a conversation, then what runs by itself, then hygiene. */
const ORDER: Record<AgendaKind, number> = {
  meeting_request: 1, interested_reply: 2, approval: 3, unclassified_reply: 4, campaign_step: 5,
  cooled_lead: 6, linkedin_accepted: 7, followups_due: 8, bounce: 9,
};

type Account = { who: string | null; company: string | null; people: number; names: string[]; oldest: number; freshest: number; intents: string[] };

/** One account per corporate domain (or company name for shared mailboxes): two colleagues who wrote count as one company. */
function groupAccounts(rows: Array<AgendaReplyInput & { intent?: string }>): Account[] {
  const groups = new Map<string, Array<AgendaReplyInput & { intent?: string }>>();
  rows.forEach((row, index) => {
    const email = String(row.email || '').trim().toLowerCase();
    const key = email || String(row.company || '').trim() ? companyKeysFor(email, row.company).keys[0] : `anonymous:${index}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  return [...groups.values()].map(members => {
    const seen = new Set<string>();
    const people = members.filter(member => {
      const identity = String(member.email || member.name || '').trim().toLowerCase();
      if (!identity) return true;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const longest = [...people].sort((a, b) => b.daysWaiting - a.daysWaiting)[0];
    return {
      who: longest.name || longest.email || null,
      company: members.map(member => member.company).find(company => company && company.trim()) || null,
      people: people.length,
      names: people.map(person => person.name).filter((name): name is string => Boolean(name)).slice(0, 3),
      oldest: Math.max(...members.map(member => member.daysWaiting)),
      freshest: Math.min(...members.map(member => member.daysWaiting)),
      intents: members.map(member => String(member.intent || '')),
    };
  });
}

const personLabel = (person: Person) => [person.name || person.email, person.company ? `(${person.company})` : ''].filter(Boolean).join(' ');

export function buildCoworkAgenda(input: AgendaInput): CoworkAgenda {
  const unranked: Array<Omit<AgendaItem, 'rank'> & { sort: number }> = [];

  const interested = groupAccounts(input.interested);
  const live = interested.filter(account => account.freshest < AGENDA_COOLED_AFTER_DAYS);
  const cooled = interested.filter(account => account.freshest >= AGENDA_COOLED_AFTER_DAYS);
  const asks = (account: Account) => account.intents.includes('meeting_request');
  for (const account of live) {
    unranked.push({ kind: asks(account) ? 'meeting_request' : 'interested_reply', action: 'reply',
      who: account.who, company: account.company, people: account.people, names: account.names,
      daysWaiting: account.oldest, sort: -account.oldest });
  }
  for (const account of cooled) {
    unranked.push({ kind: 'cooled_lead', action: 'revive', who: account.who, company: account.company,
      people: account.people, names: account.names, daysWaiting: account.oldest, sort: account.freshest });
  }
  const unclassified = groupAccounts(input.unclassified);
  for (const account of unclassified) {
    unranked.push({ kind: 'unclassified_reply', action: 'review_reply', who: account.who, company: account.company,
      people: account.people, names: account.names, daysWaiting: account.oldest, sort: -account.oldest });
  }

  if (input.approvals.count > 0) {
    unranked.push({ kind: 'approval', action: 'decide', who: null, company: null, count: input.approvals.count,
      examples: input.approvals.examples.slice(0, 3), ...(input.approvals.oldestDays === null ? {} : { daysWaiting: input.approvals.oldestDays }), sort: 0 });
  }
  if (input.campaignSteps.count > 0) {
    unranked.push({ kind: 'campaign_step', action: 'review_step', who: null, company: null,
      count: input.campaignSteps.count, examples: input.campaignSteps.examples.slice(0, 3), sort: 0 });
  }
  if (input.linkedinAccepted.length > 0) {
    unranked.push({ kind: 'linkedin_accepted', action: 'message_linkedin', who: null, company: null,
      count: input.linkedinAccepted.length,
      examples: input.linkedinAccepted.map(person => person.name).filter((name): name is string => Boolean(name)).slice(0, 3),
      daysWaiting: Math.max(...input.linkedinAccepted.map(person => person.daysSince)), sort: 0 });
  }
  for (const campaign of input.followups) {
    const held = campaign.heldCompanyReplied + campaign.heldNegotiation + campaign.historyIncomplete;
    if (!campaign.ready && !campaign.scheduledLater && !held) continue;
    unranked.push({ kind: 'followups_due', action: 'let_run', who: null, company: null, campaign: campaign.campaign,
      ready: campaign.ready, later: campaign.scheduledLater, held, spacingMinutes: campaign.spacingMinutes, sort: -campaign.ready });
  }
  const actionable = input.bounces.filter(bounce => bounce.action !== 'temporary');
  if (actionable.length > 0) {
    unranked.push({ kind: 'bounce', action: 'fix_email', who: null, company: null, count: actionable.length,
      examples: actionable.map(personLabel).slice(0, 3), sort: 0 });
  }

  const ranked = unranked
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.sort - b.sort || String(a.who || a.campaign || '').localeCompare(String(b.who || b.campaign || '')))
    .map(({ sort: _sort, ...item }, index): AgendaItem => ({ rank: index + 1, ...item }));

  const followupsReady = input.followups.reduce((sum, campaign) => sum + campaign.ready, 0);
  const complete = (Object.values(input.sources) as AgendaSourceStatus[]).every(status => status !== 'unavailable' && status !== 'partial');
  return {
    scope: 'own_agenda_today',
    day: input.timing.day, weekday: input.timing.weekday, timeZone: input.timing.timeZone,
    counts: {
      interestedAccounts: live.length,
      interestedPeople: live.reduce((sum, account) => sum + account.people, 0),
      meetingRequests: live.filter(asks).length,
      cooledAccounts: cooled.length,
      unclassifiedReplies: input.unclassified.length,
      autoReplies: input.autoReplies,
      approvals: input.approvals.count,
      campaignSteps: input.campaignSteps.count,
      followupsReady,
      followupsLater: input.followups.reduce((sum, campaign) => sum + campaign.scheduledLater, 0),
      followupsHeld: input.followups.reduce((sum, campaign) => sum + campaign.heldCompanyReplied + campaign.heldNegotiation + campaign.historyIncomplete, 0),
      linkedinAccepted: input.sources.linkedin === 'ok' ? input.linkedinAccepted.length : null,
      bounces: actionable.length,
      softBounces: input.bounces.length - actionable.length,
    },
    items: ranked.slice(0, AGENDA_MAX_ITEMS),
    truncated: ranked.length > AGENDA_MAX_ITEMS,
    sources: input.sources,
    complete,
    mailboxSynced: input.mailboxSynced,
    limitation: input.mailboxSynced === false
      ? 'Lo registrado en ANTON.IA: el correo no está sincronizado por completo y pueden faltar respuestas. Cada envío vuelve a comprobar los frenos de la empresa antes de salir.'
      : 'Lo registrado en ANTON.IA. Cada envío vuelve a comprobar los frenos de la empresa antes de salir.',
  };
}
