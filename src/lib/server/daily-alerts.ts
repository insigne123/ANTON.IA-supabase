import type { SupabaseClient } from '@supabase/supabase-js';
import { dayInZone, dayStartInZone, shiftDay } from '@/lib/admin/chile-time';
import { alertEmail, composeAlert, type AlertFacts, type AlertOpportunity, type AlertPerson } from '@/lib/daily-alerts';
import { commitmentDueToday, replyNeedsAnswer } from '@/lib/home/today';
import { dropDay, dropHref, type DropItem } from '@/lib/lead-drops';
import { preferredFullName } from '@/lib/lead-name';
import { reportWeek } from '@/lib/weekly-report';
import { dropPdf } from '@/lib/server/lead-drops';
import { readPersonGoal } from '@/lib/server/weekly-goals';
import type { SendSelf } from '@/lib/server/weekly-report';

/** The reads and the delivery of «Avisos» (src/lib/daily-alerts.ts), with the service client and an explicit organization. */
type Client = SupabaseClient;
export type AlertScope = { organizationId: string; userId: string };

export class DailyAlertsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const CLOSED_WORK = new Set(['won', 'lost', 'archived', 'submitted']);
const CLOSING_DAYS = 3;
const READY_SCAN = 1000;

/** Whether the person gets the alerts: on unless they turned them off in «Tu semana». */
export function readAlertsEmail(signatures: unknown) {
  const settings = (signatures as any)?.daily_alerts;
  return !(settings && typeof settings === 'object' && settings.email === false);
}

/** On or off, keeping the rest of the person's signatures. */
export async function saveAlertsEmail(client: Client, userId: string, on: boolean) {
  const current: any = await client.from('profiles').select('signatures').eq('id', userId).maybeSingle();
  if (current.error) throw new DailyAlertsError('No pudimos leer tu perfil.', 503);
  const signatures = current.data?.signatures && typeof current.data.signatures === 'object' ? current.data.signatures : {};
  const saved = await client.from('profiles').update({ signatures: { ...signatures, daily_alerts: { ...(signatures.daily_alerts || {}), email: on } } }).eq('id', userId);
  if (saved.error) throw new DailyAlertsError('No pudimos guardar tu preferencia.', 503);
  return { alerts: on };
}

/**
 * What the morning alert can say to one person: replies, commitments, contacts that got an email, research that finished
 * and opportunities closing, since `since`; plus the goal of the week. Opportunities only when the person may see them:
 * theirs, and the recommended ones nobody has when they manage Oportunidades.
 */
export async function readAlertFacts(client: Client, scope: AlertScope, options: { now: Date; since: string; opportunities: 'none' | 'mine' | 'manager' }): Promise<AlertFacts> {
  const { now, since } = options;
  const own = (table: string, columns: string) => client.from(table).select(columns).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const week = reportWeek(now, 'current');
  const [profile, replied, commitments, enriched, sent, research, goal] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', scope.userId).maybeSingle(),
    own('contacted_leads', 'id,email,name,company,reply_intent,replied_at,conversation_resolved_at,conversation_outbound_at').not('replied_at', 'is', null).order('replied_at', { ascending: false }).limit(200),
    own('contacted_leads', 'id,name,company,data').not('data->commitment', 'is', null).limit(200),
    own('enriched_leads', 'email,created_at').not('email', 'is', null).neq('email', '').order('created_at', { ascending: false }).limit(READY_SCAN),
    own('contacted_leads', 'email').not('sent_at', 'is', null).limit(5000),
    own('lead_research_jobs', 'lead_id,company_name,email,completed_at').in('status', ['completed', 'partial']).gte('completed_at', since).order('completed_at').limit(20),
    readPersonGoal(client, scope, { from: week.from, to: week.to }),
  ]);
  for (const result of [replied, commitments, enriched, sent, research] as any[]) if (result.error) throw new DailyAlertsError('No pudimos leer los pendientes.', 503);

  // Replies: one row per person, the same rule as «Por responder»; new when they arrived after the last alert.
  const waiting = new Map<string, AlertPerson & { repliedAt: string }>();
  for (const row of ((replied as any).data || []).filter(replyNeedsAnswer)) {
    const key = String(row.email || row.id).trim().toLowerCase();
    const known = waiting.get(key);
    if (known) known.name = preferredFullName(known.name, row.name) || known.name;
    else waiting.set(key, { id: String(row.id), name: String(row.name || row.email || 'Contacto').trim(), company: row.company || null, repliedAt: String(row.replied_at) });
  }
  const sinceTime = Date.parse(since);
  const people = [...waiting.values()].sort((a, b) => a.repliedAt.localeCompare(b.repliedAt));
  const newReplies = people.filter(person => Date.parse(person.repliedAt) >= sinceTime);

  // Contacts ready to write: an email nobody wrote to; new when saved after the last alert.
  const written = new Set(((sent as any).data || []).map((row: any) => String(row.email || '').trim().toLowerCase()));
  const ready = new Map<string, string>();
  for (const row of (enriched as any).data || []) {
    const email = String(row.email || '').trim().toLowerCase();
    if (email && !written.has(email) && !ready.has(email)) ready.set(email, String(row.created_at));
  }
  const fresh = [...ready.values()].filter(at => Date.parse(at) >= sinceTime);
  const yesterday = shiftDay(dayInZone(now), -1);

  // Research: the contact's name when it is still in «Por escribir», else the company or the address.
  const finished = ((research as any).data || []) as Array<{ lead_id: string | null; company_name: string | null; email: string | null }>;
  const leadIds = [...new Set(finished.map(row => String(row.lead_id || '')).filter(Boolean))];
  const names = leadIds.length ? await client.from('enriched_leads').select('id,full_name').eq('organization_id', scope.organizationId).in('id', leadIds) : { data: [], error: null };
  const nameOf = new Map<string, string>((((names as any).data || []) as any[]).map(row => [String(row.id), String(row.full_name || '').trim()]));
  const seenResearch = new Set<string>();
  const researchItems = finished.flatMap(row => {
    const key = String(row.lead_id || row.email || row.company_name || '');
    if (!key || seenResearch.has(key)) return [];
    seenResearch.add(key);
    const leadId = row.lead_id && nameOf.has(String(row.lead_id)) ? String(row.lead_id) : null;
    return [{ leadId, name: (leadId && nameOf.get(leadId)) || String(row.company_name || row.email || 'un contacto').trim() }];
  });

  return {
    name: String((profile as any).data?.full_name || '').trim().split(/\s+/)[0] || '',
    newReplies: newReplies.map(({ id, name, company }) => ({ id, name, company })),
    olderPending: people.length - newReplies.length,
    commitments: ((commitments as any).data || []).flatMap((row: any) => {
      const due = commitmentDueToday(row.data?.commitment, now);
      return due ? [{ id: String(row.id), name: String(row.name || 'Contacto').trim(), company: row.company || null, title: due.title, dueAt: due.dueAt }] : [];
    }).sort((a: { dueAt: string }, b: { dueAt: string }) => a.dueAt.localeCompare(b.dueAt)),
    newReady: { count: fresh.length, yesterday: fresh.length > 0 && fresh.every(at => dayInZone(new Date(at)) === yesterday) },
    ready: ready.size,
    research: researchItems,
    closing: options.opportunities === 'none' ? [] : await readClosing(client, scope, now, options.opportunities === 'manager'),
    goal,
  };
}

/**
 * Opportunities closing from now to the end of the third day after today (on Tuesday, until Friday night) that are the
 * person's, or recommended and nobody's when they manage them.
 */
async function readClosing(client: Client, scope: AlertScope, now: Date, manager: boolean): Promise<AlertOpportunity[]> {
  const until = dayStartInZone(shiftDay(dayInZone(now), CLOSING_DAYS + 1)).toISOString();
  const closing: any = await client.from('commercial_opportunities').select('id,kind,title,deadline_at,data').eq('organization_id', scope.organizationId)
    .gte('deadline_at', now.toISOString()).lt('deadline_at', until).order('deadline_at').limit(100);
  if (closing.error) throw new DailyAlertsError('No pudimos leer las oportunidades.', 503);
  const open = ((closing.data || []) as any[]).filter(row => row.data?.evaluation !== 'excluded');
  if (!open.length) return [];
  const work: any = await client.from('opportunity_work').select('opportunity_id,state,responsible_id').eq('organization_id', scope.organizationId).in('opportunity_id', open.map(row => row.id));
  if (work.error) throw new DailyAlertsError('No pudimos leer las oportunidades.', 503);
  const workOf = new Map<string, { state: string; responsible: string | null }>(((work.data || []) as any[]).map(row => [String(row.opportunity_id), { state: String(row.state), responsible: row.responsible_id ? String(row.responsible_id) : null }]));
  return open.flatMap(row => {
    const state = workOf.get(String(row.id));
    if (state && CLOSED_WORK.has(state.state)) return [];
    const mine = state?.responsible === scope.userId;
    const recommended = row.data?.evaluation === 'recommended';
    const nobodys = !state || state.state === 'unassigned' || !state.responsible;
    if (!mine && !(manager && nobodys && recommended)) return [];
    return [{ id: String(row.id), kind: String(row.kind), title: String(row.title || 'Oportunidad').slice(0, 140), deadlineAt: String(row.deadline_at), recommended, mine }];
  }).slice(0, 10);
}

/** Today's «Contacto del día» of the person, once ready; nothing before the migration or while it is being written. */
async function readTodayDrop(client: Client, scope: AlertScope, today: string): Promise<{ id: string; items: DropItem[] } | null> {
  const result: any = await client.from('lead_drops').select('id,items').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('drop_date', today).eq('status', 'ready').maybeSingle();
  const items = (result.error ? [] : result.data?.items || []) as DropItem[];
  return result.data && items.length ? { id: String(result.data.id), items } : null;
}

/**
 * One person's alert of today, kept once per organization and day and sent once: a second run the same day finds the row
 * and does nothing. Nothing to say is kept as «quiet» and not sent. The window starts at the last alert (at most four days
 * back), so what arrived over the weekend reaches Tuesday's alert.
 */
export async function deliverDailyAlert(client: Client, scope: AlertScope, deps: {
  send: SendSelf; appUrl: string; now?: Date; opportunities: 'none' | 'mine' | 'manager'; goalReminders: boolean;
}) {
  const now = deps.now ?? new Date();
  const today = dayInZone(now);
  const last: any = await client.from('daily_alerts').select('alert_date,created_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('alert_date', { ascending: false }).limit(1).maybeSingle();
  if (last.error) throw new DailyAlertsError('No pudimos leer los avisos.', 503);
  if (last.data?.alert_date === today) return { status: 'already_sent' as const };
  const floor = now.getTime() - 4 * 86_400_000;
  const since = new Date(last.data ? Math.max(Date.parse(last.data.created_at), floor) : now.getTime() - 86_400_000).toISOString();
  const [facts, drop] = await Promise.all([
    readAlertFacts(client, scope, { now, since, opportunities: deps.opportunities }),
    dropDay(now) ? readTodayDrop(client, scope, today) : Promise.resolve(null),
  ]);
  facts.drop = drop;
  // A goal that is behind alone is worth an email in one workspace only: whoever belongs to several gets it from one.
  const alert = composeAlert(facts, now, { goalReminders: deps.goalReminders });
  const row = { organization_id: scope.organizationId, user_id: scope.userId, alert_date: today };
  if (!alert) {
    const quiet = await client.from('daily_alerts').insert({ ...row, status: 'quiet', payload: { since, lines: [] } });
    if (quiet.error && quiet.error.code !== '23505') throw new DailyAlertsError('No pudimos guardar el aviso.', 503);
    return { status: quiet.error ? 'already_sent' as const : 'quiet' as const };
  }
  const stored: any = await client.from('daily_alerts').insert({ ...row, status: 'stored', payload: { since, ...alert } }).select('id').single();
  if (stored.error) {
    if (stored.error.code === '23505') return { status: 'already_sent' as const };
    throw new DailyAlertsError('No pudimos guardar el aviso.', 503);
  }
  const profile: any = await client.from('profiles').select('email,signatures').eq('id', scope.userId).maybeSingle();
  const to = String(profile.data?.email || '').trim();
  if (!readAlertsEmail(profile.data?.signatures) || !to) return { status: 'stored' as const };
  // Today's contacts go in the same email, with their research and first emails in a PDF.
  const attachments = drop ? [{ filename: `contacto-del-dia-${today}.pdf`, contentType: 'application/pdf',
    content: await dropPdf(drop.items, { name: facts.name, date: today, link: `${deps.appUrl.replace(/\/$/, '')}${dropHref(drop.id)}` }) }] : undefined;
  const sent = await deps.send({ userId: scope.userId, to, ...alertEmail(alert, facts.name, deps.appUrl, drop), ...(attachments ? { attachments } : {}) });
  const at = new Date().toISOString();
  await client.from('daily_alerts').update(sent.ok ? { status: 'sent', emailed_at: at, email_error: null } : { status: 'failed', email_error: sent.error.slice(0, 300) }).eq('id', stored.data.id);
  if (sent.ok && drop) await client.from('lead_drops').update({ status: 'sent', emailed_at: at, updated_at: at }).eq('id', drop.id).eq('status', 'ready');
  return { status: sent.ok ? 'sent' as const : 'failed' as const };
}
