import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGENDA_AUTO_REPLY_DAYS, AGENDA_BOUNCE_DAYS, buildCoworkAgenda,
  type AgendaFollowupCampaign, type AgendaSourceKey, type AgendaSourceStatus, type CoworkAgenda,
} from '@/lib/cowork/agenda';
import { santiagoDayBounds } from '@/lib/cowork/send-cadence';
import { readCoworkFollowupsToday } from './batch-reads';
import { readInterestedWaiting, readRepliesAttention } from './reply-reads';

type Scope = { userId: string; organizationId: string };

const DAY_MS = 86400000;
const PAGE = 50;
const APPROVALS_LIMIT = 20;

type Approvals = { count: number; oldestDays: number | null; examples: string[]; truncated: boolean };
type Steps = { enabled: boolean; count: number; examples: string[]; truncated: boolean };
type Accepted = { status: AgendaSourceStatus; accepted: Array<{ name: string | null; daysSince: number }> };

/** Approvals of Cowork's own proposals that nobody has decided: each waits in its own thread. */
export async function readPendingApprovals(client: SupabaseClient, scope: Scope, nowMs: number): Promise<Approvals> {
  const { data, error } = await client.from('cowork_runs').select('message,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('status', 'waiting_approval')
    .order('created_at', { ascending: true }).limit(APPROVALS_LIMIT + 1);
  if (error) throw new Error('No se pudieron consultar las aprobaciones pendientes.');
  const rows = (data || []) as Array<{ message?: string | null; created_at?: string | null }>;
  const oldest = rows[0]?.created_at ? Date.parse(rows[0].created_at) : NaN;
  return {
    count: Math.min(rows.length, APPROVALS_LIMIT),
    oldestDays: Number.isFinite(oldest) ? Math.max(0, Math.floor((nowMs - oldest) / DAY_MS)) : null,
    examples: rows.slice(0, 3).map(row => String(row.message || '').replace(/\s+/g, ' ').trim().slice(0, 90)).filter(Boolean),
    truncated: rows.length > APPROVALS_LIMIT,
  };
}

type Inbox = { enabled: boolean; truncated: boolean; items: Array<{ state?: string; stepName?: string | null; recipientName?: string | null }> };

/** Steps of campaigns v2 that wait for the person (prepare, review, send, resolve); the ones not due yet or already
 * leaving are not work for today. */
export function waitingCampaignSteps(inbox: Inbox): Steps {
  if (!inbox.enabled) return { enabled: false, count: 0, examples: [], truncated: false };
  const waiting = inbox.items.filter(item => !['not_due', 'dispatch_pending', 'sending'].includes(String(item.state)));
  return {
    enabled: true, count: waiting.length, truncated: inbox.truncated,
    examples: waiting.slice(0, 3).map(item => [item.stepName, item.recipientName].filter(Boolean).join(' · ')).filter(Boolean),
  };
}

async function readCampaignSteps(client: SupabaseClient, scope: Scope): Promise<Steps> {
  const { queryCoworkDomainRead } = await import('./domain-reads');
  return waitingCampaignSteps(await queryCoworkDomainRead(client, scope, 'campaigns.inbox', '') as Inbox);
}

/** People who accepted an invitation Cowork sent in the last 30 days and have not been written to. An acceptance shows up as
 * the person joining the observed network, so without a complete sync of it there is nothing to conclude. */
export async function readLinkedinAccepted(client: SupabaseClient, scope: Scope, nowMs: number): Promise<Accepted> {
  const own = { organization_id: scope.organizationId, user_id: scope.userId };
  const sweep = await client.from('cowork_linkedin_sweep_state').select('last_completed_at,has_more')
    .eq('organization_id', own.organization_id).eq('user_id', own.user_id).eq('kind', 'network').maybeSingle();
  if (sweep.error) throw new Error('No se pudo leer el estado de la sincronización de LinkedIn.');
  const state = sweep.data as { last_completed_at?: string | null; has_more?: boolean } | null;
  if (!state?.last_completed_at || state.has_more) return { status: 'sync_incomplete', accepted: [] };
  const invites = await client.from('cowork_linkedin_jobs').select('canonical_url,display_name,created_at')
    .eq('organization_id', own.organization_id).eq('user_id', own.user_id).eq('kind', 'invite').eq('status', 'confirmed')
    .gte('created_at', new Date(nowMs - 30 * DAY_MS).toISOString()).order('created_at', { ascending: false }).limit(200);
  if (invites.error) throw new Error('No se pudieron leer las invitaciones de LinkedIn.');
  const invited = new Map<string, { name: string | null; createdAt: string }>();
  for (const row of (invites.data || []) as Array<{ canonical_url: string; display_name: string | null; created_at: string }>) {
    if (!invited.has(row.canonical_url)) invited.set(row.canonical_url, { name: row.display_name || null, createdAt: row.created_at });
  }
  const urls = [...invited.keys()];
  const joined = new Map<string, string>();
  const messaged = new Set<string>();
  for (let at = 0; at < urls.length; at += PAGE) {
    const page = urls.slice(at, at + PAGE);
    const [peers, messages] = await Promise.all([
      client.from('cowork_linkedin_peers').select('canonical_url,first_seen')
        .eq('organization_id', own.organization_id).eq('user_id', own.user_id).in('canonical_url', page).limit(PAGE),
      client.from('cowork_linkedin_jobs').select('canonical_url')
        .eq('organization_id', own.organization_id).eq('user_id', own.user_id).eq('kind', 'message')
        .in('status', ['queued', 'claimed', 'confirmed', 'uncertain']).in('canonical_url', page).limit(4 * PAGE),
    ]);
    if (peers.error || messages.error) throw new Error('No se pudieron leer las conexiones de LinkedIn.');
    for (const row of (peers.data || []) as Array<{ canonical_url: string; first_seen: string | null }>) {
      joined.set(row.canonical_url, row.first_seen || invited.get(row.canonical_url)!.createdAt);
    }
    for (const row of (messages.data || []) as Array<{ canonical_url: string }>) messaged.add(row.canonical_url);
  }
  const accepted = urls.filter(url => joined.has(url) && !messaged.has(url)).map(url => ({
    name: invited.get(url)!.name,
    daysSince: Math.max(0, Math.floor((nowMs - Date.parse(joined.get(url)!)) / DAY_MS)),
  }));
  return { status: 'ok', accepted };
}

type Dependencies = {
  interested: typeof readInterestedWaiting;
  attention: typeof readRepliesAttention;
  followups: typeof readCoworkFollowupsToday;
  linkedin: typeof readLinkedinAccepted;
  approvals: typeof readPendingApprovals;
  steps: typeof readCampaignSteps;
};
const defaults: Dependencies = {
  interested: readInterestedWaiting, attention: (client, scope) => readRepliesAttention(client, scope, { own: true }),
  followups: readCoworkFollowupsToday,
  linkedin: readLinkedinAccepted, approvals: readPendingApprovals, steps: readCampaignSteps,
};

/** One source of the list: if it fails the list says so, and the log keeps the reason (never the rows). */
async function attempt<T>(source: string, load: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await load() }; } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.warn(`[cowork-agenda] ${source} unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    return { ok: false };
  }
}

const daysSince = (iso: unknown, nowMs: number) =>
  typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? Math.max(0, Math.floor((nowMs - Date.parse(iso)) / DAY_MS)) : null;

/** «¿Qué toca hoy?» in one read: what waits for an answer, what needs a decision, what goes out by itself and what broke,
 * already ranked by commercial value and counted. Each source can fail on its own: the list then says which one it could
 * not read instead of passing a partial list as complete. */
export async function readCoworkAgenda(
  client: SupabaseClient, scope: Scope, dependencies: Partial<Dependencies> = {}, nowMs = Date.now(),
): Promise<CoworkAgenda> {
  const deps = { ...defaults, ...dependencies };
  const [interested, attention, followups, linkedin, approvals, steps] = await Promise.all([
    attempt('interested', () => deps.interested(client, scope, nowMs)),
    attempt('attention', () => deps.attention(client, scope)),
    attempt('followups', () => deps.followups(client, scope, nowMs)),
    attempt('linkedin', () => deps.linkedin(client, scope, nowMs)),
    attempt('approvals', () => deps.approvals(client, scope, nowMs)),
    attempt('steps', () => deps.steps(client, scope)),
  ]);

  const sources = {} as Record<AgendaSourceKey, AgendaSourceStatus>;
  sources.interested = !interested.ok ? 'unavailable' : interested.value.truncated ? 'partial' : 'ok';
  sources.attention = !attention.ok ? 'unavailable' : attention.value.truncated ? 'partial' : 'ok';
  const attentionRows = attention.ok ? attention.value : null;
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
  const person = (row: Record<string, unknown>) => ({ name: text(row.name), email: text(row.email), company: text(row.company) });

  const interestedRows = interested.ok ? interested.value.items.map(item => ({
    name: item.name, email: item.email, company: item.company, daysWaiting: item.daysWaiting, contactedId: item.contactedId,
    intent: item.replyIntent === 'meeting_request' ? 'meeting_request' as const : 'positive' as const,
  })) : [];
  const unclassified = (attentionRows?.unclassified || []).map(row => ({
    ...person(row as Record<string, unknown>), daysWaiting: daysSince((row as { replied_at?: unknown }).replied_at, nowMs) ?? 0,
    contactedId: text((row as { id?: unknown }).id),
  }));
  const autoReplies = (attentionRows?.automatic || []).filter(row => {
    const age = daysSince((row as { replied_at?: unknown }).replied_at, nowMs);
    return age !== null && age <= AGENDA_AUTO_REPLY_DAYS;
  }).length;
  const bounces = (attentionRows?.failures || []).filter(row => {
    const age = daysSince((row as { sent_at?: unknown }).sent_at, nowMs);
    return age !== null && age <= AGENDA_BOUNCE_DAYS;
  }).map(row => {
    const action = String((row as { action?: unknown }).action || '');
    return { ...person(row as Record<string, unknown>),
      action: action === 'retry_later' ? 'temporary' as const : action === 'do_not_contact_fix_email' ? 'fix_email' as const : 'review' as const };
  });
  const coverages = attentionRows ? [attentionRows.coverage.gmail, attentionRows.coverage.outlook].filter(Boolean) : [];
  const mailboxSynced = coverages.length ? coverages.every(coverage => coverage!.windowComplete) : null;

  const campaigns: AgendaFollowupCampaign[] = followups.ok ? followups.value.campaigns.map(campaign => ({
    campaign: campaign.name, recipients: campaign.recipients, ready: campaign.ready, scheduledLater: campaign.scheduledLater,
    heldCompanyReplied: campaign.heldCompanyReplied, heldNegotiation: campaign.heldNegotiation,
    historyIncomplete: campaign.historyIncomplete, retryWait: campaign.retryWait, needsReconcile: campaign.needsReconcile,
    terminal: campaign.terminal, waiting: campaign.waiting, done: campaign.done, spacingMinutes: campaign.spacingMinutes,
  })) : [];
  sources.followups = !followups.ok ? 'unavailable'
    : followups.value.failed > 0 || followups.value.truncated ? 'partial'
      : followups.value.campaigns.length ? 'ok' : 'none';

  sources.linkedin = linkedin.ok ? linkedin.value.status : 'unavailable';
  sources.approvals = !approvals.ok ? 'unavailable' : approvals.value.truncated ? 'partial' : 'ok';
  sources.campaignSteps = !steps.ok ? 'unavailable' : !steps.value.enabled ? 'none' : steps.value.truncated ? 'partial' : 'ok';

  const now = new Date(nowMs);
  return buildCoworkAgenda({
    interested: interestedRows, unclassified, autoReplies, bounces,
    approvals: approvals.ok ? { count: approvals.value.count, oldestDays: approvals.value.oldestDays, examples: approvals.value.examples }
      : { count: 0, oldestDays: null, examples: [] },
    campaignSteps: steps.ok ? { count: steps.value.count, examples: steps.value.examples } : { count: 0, examples: [] },
    followups: campaigns,
    linkedinAccepted: linkedin.ok ? linkedin.value.accepted : [],
    sources, mailboxSynced,
    timing: {
      timeZone: 'America/Santiago', day: santiagoDayBounds(now).day,
      weekday: new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'long' }).format(now),
    },
  });
}
