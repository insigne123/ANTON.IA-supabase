import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleRates, compareChannels, detectIncidents, diagnoseHypotheses, extractMeetingCompletions } from '@/lib/metrics';
import { readMailboxCoverage } from './reply-reads';
import { readRepliesStalled } from './reply-reads';

type Scope = { userId: string; organizationId: string };

const WINDOW_30_ISO = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

async function fetchMetricsContacts(client: SupabaseClient, scope: Scope, extra = '') {
  const since = WINDOW_30_ISO();
  const columns: string = `id,sent_at,replied_at,reply_intent,bounced_at,delivery_status,provider${extra}`;
  const { data, error } = await client.from('contacted_leads')
    .select(columns)
    .eq('organization_id', scope.organizationId)
    .or(`sent_at.gte.${since},replied_at.gte.${since},bounced_at.gte.${since}`)
    .order('sent_at', { ascending: false }).limit(2000);
  if (error) throw new Error('No se pudieron calcular las métricas.');
  if ((data || []).length >= 2000) throw new Error('Historial truncado: no se pueden calcular tasas completas.');
  return (data as unknown as Array<Record<string, unknown>>) || [];
}

async function fetchCommitmentDates(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('contacted_leads')
    .select('id,data->commitment')
    .eq('organization_id', scope.organizationId)
    .not('replied_at', 'is', null).limit(500);
  if (error) throw new Error('No se pudieron calcular las métricas.');
  if ((data || []).length >= 500) throw new Error('Historial de compromisos truncado.');
  const rows = (data as Array<{ commitment?: { kind?: string; completedAt?: string | null }; 'data->commitment'?: { kind?: string; completedAt?: string | null } | null }>) || [];
  return extractMeetingCompletions(rows.map((row) => ({ data: { commitment: row.commitment ?? row['data->commitment'] ?? null } })));
}

async function fetchUnsubDates(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('unsubscribed_emails')
    .select('created_at').eq('organization_id', scope.organizationId)
    .gte('created_at', WINDOW_30_ISO()).limit(500);
  if (error) throw new Error('No se pudieron calcular las métricas.');
  if ((data || []).length >= 500) throw new Error('Historial de bajas truncado.');
  return ((data as Array<{ created_at?: string | null }>) || []).map((row) => row.created_at);
}

/** 7.1 Rates with period, unit, denominator and source per metric. */
export async function readMetricsRates(client: SupabaseClient, scope: Scope) {
  const [contacts, unsubscribedAt, meetingsAt] = await Promise.all([
    fetchMetricsContacts(client, scope),
    fetchUnsubDates(client, scope),
    fetchCommitmentDates(client, scope),
  ]);
  const rates = assembleRates({ contacts: contacts as never, unsubscribedAt, meetingsAt });
  return { scope: 'organization_metrics', ...rates, coverage: await readMailboxCoverage(client, scope),
    limitation: 'Tasas por contacto con la cantidad de envíos sobre la que se calculan; null significa sin envíos, no cero.' };
}

/** 7.2 Hypothesis tests against data; untestable stays untestable. */
export async function readMetricsDiagnose(client: SupabaseClient, scope: Scope) {
  const [contacts, stalled] = await Promise.all([
    fetchMetricsContacts(client, scope, ',conversation_outbound_at'),
    readRepliesStalled(client, scope),
  ]);
  return { scope: 'organization_metrics', period: 'last_30_days',
    hypotheses: diagnoseHypotheses({ contacts: contacts as never, stalledPositives: stalled.total }),
    coverage: await readMailboxCoverage(client, scope) };
}

/** 7.3 Channel comparison that refuses to generalize without denominators. */
export async function readMetricsChannels(client: SupabaseClient, scope: Scope) {
  const since = WINDOW_30_ISO();
  const [contacts, meetingsAt, jobs, threads, sends, sweep] = await Promise.all([
    fetchMetricsContacts(client, scope),
    fetchCommitmentDates(client, scope),
    client.from('cowork_linkedin_jobs').select('status,created_at').eq('organization_id', scope.organizationId).gte('created_at', since).limit(200),
    client.from('cowork_linkedin_threads').select('last_direction,last_at,reply_needed,resolved_at').eq('organization_id', scope.organizationId).gte('last_at', since).limit(200),
    client.from('extension_linkedin_sends').select('status,created_at').eq('organization_id', scope.organizationId).gte('created_at', since).limit(200),
    client.from('cowork_linkedin_sweep_state').select('kind,last_completed_at,cursor,has_more,observed_count').eq('organization_id', scope.organizationId).limit(10),
  ]);
  const failed = [jobs, threads, sends, sweep].find((result) => result.error)?.error;
  if (failed) throw new Error('No se pudo comparar canales.');
  const rates = assembleRates({ contacts: contacts as never, unsubscribedAt: [], meetingsAt });
  const jobsByStatus = countBy((jobs.data as Array<{ status?: string }>) || [], (row) => String(row.status || 'unknown'));
  const sendsByStatus = countBy((sends.data as Array<{ status?: string }>) || [], (row) => String(row.status || 'unknown'));
  const inboundThreads = ((threads.data as Array<{ last_direction?: string; last_at?: string }>) || [])
    .filter((row) => row.last_direction === 'in' && row.last_at && Date.parse(row.last_at) >= Date.parse(since)).length;
  const pendingReplies = ((threads.data as Array<{ reply_needed?: boolean; resolved_at?: string | null }>) || [])
    .filter((row) => row.reply_needed && !row.resolved_at).length;
  const linkedinSent = Number(jobsByStatus.confirmed || 0) + Number(sendsByStatus.confirmed || 0);
  const comparison = compareChannels({
    email: { channel: 'email', period: 'last_30_days', sent: rates.last_30_days.sent, replies: rates.last_30_days.humanReplies,
      positives: rates.last_30_days.positives, meetings: rates.last_30_days.meetingsConfirmed, pending: 0, sources: ['contacted_leads'] },
    linkedin: { channel: 'linkedin', period: 'last_30_days', sent: linkedinSent, replies: inboundThreads,
      positives: 0, meetings: 0, pending: pendingReplies, sources: ['cowork_linkedin_jobs', 'extension_linkedin_sends', 'cowork_linkedin_threads'] },
  });
  return { scope: 'organization_metrics', ...comparison,
    linkedinDetail: { jobsByStatus, sendsByStatus, inboundThreads, pendingReplies,
      sweep: (sweep.data as unknown[]) || [], positivesUnknown: true, meetingsUnknown: true },
    coverage: await readMailboxCoverage(client, scope),
    limitation: 'LinkedIn aún no registra positivos ni reuniones vinculadas; cualquier comparación es, como máximo, cautelosa.' };
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] || 0) + 1;
  return counts;
}

/** 7.4 Systemic failures with what to do about each. */
export async function readMetricsIncidents(client: SupabaseClient, scope: Scope) {
  const org = scope.organizationId;
  const [steps, activeEnrollments, repliedEmails, dncEmails, unclassified, unclassifiedTotal, sweepErrors, syncErrors, exceptions] = await Promise.all([
    client.from('campaign_recipient_steps').select('id,enrollment_id,state,due_at').eq('organization_id', org)
      .in('state', ['not_due', 'approved', 'review_required', 'deferred', 'pending_initial_send']).limit(200),
    client.from('campaign_enrollments').select('id,recipient_email,status').eq('organization_id', org).eq('status', 'active').limit(500),
    client.from('contacted_leads').select('email').eq('organization_id', org).not('replied_at', 'is', null).limit(1000),
    client.from('contacted_leads').select('email').eq('organization_id', org).eq('evaluation_status', 'do_not_contact').limit(1000),
    client.from('contacted_leads').select('id,name,email,replied_at').eq('organization_id', org)
      .not('replied_at', 'is', null).is('reply_intent', null).order('replied_at', { ascending: false }).limit(10),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org)
      .not('replied_at', 'is', null).is('reply_intent', null),
    client.from('cowork_mailbox_sweep_state').select('provider,last_error,updated_at').eq('organization_id', org)
      .not('last_error', 'is', null).limit(10),
    client.from('contacted_leads').select('reply_sync_error').eq('organization_id', org)
      .not('reply_sync_error', 'is', null).limit(500),
    client.from('antonia_exceptions').select('id,title,category,severity,created_at').eq('organization_id', org)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(20),
  ]);
  const failed = [steps, activeEnrollments, repliedEmails, dncEmails, unclassified, unclassifiedTotal, sweepErrors, syncErrors, exceptions]
    .find((result) => result.error)?.error;
  if (failed) throw new Error('No se pudieron detectar fallas.');
  const emailSet = (rows: unknown) => new Set(((rows as Array<{ email?: string | null }>) || [])
    .map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
  const repliedSet = emailSet(repliedEmails.data);
  const dncSet = emailSet(dncEmails.data);
  const contactsByEmail = new Map<string, { replied_at?: string | null; evaluation_status?: string | null }>();
  for (const email of repliedSet) contactsByEmail.set(email, { replied_at: 'observed', evaluation_status: null });
  for (const email of dncSet) {
    contactsByEmail.set(email, { replied_at: contactsByEmail.get(email)?.replied_at ?? null, evaluation_status: 'do_not_contact' });
  }
  const stepEnrollments = new Map(((activeEnrollments.data as Array<{ id: string; recipient_email?: string | null; status?: string | null }>) || []).map((row) => [row.id, row]));
  const stepIds = ((steps.data as Array<{ enrollment_id?: string | null }>) || []).map((row) => String(row.enrollment_id || '')).filter(Boolean);
  if (stepIds.length) {
    const missing = stepIds.filter((id) => !stepEnrollments.has(id));
    if (missing.length) {
      const extra = await client.from('campaign_enrollments').select('id,recipient_email,status')
        .eq('organization_id', org).in('id', missing.slice(0, 200));
      if (!extra.error) for (const row of (extra.data as Array<{ id: string; recipient_email?: string | null; status?: string | null }>) || []) stepEnrollments.set(row.id, row);
    }
  }
  const syncCounts = countBy(((syncErrors.data as Array<{ reply_sync_error?: string }>) || []), (row) => String(row.reply_sync_error || 'unknown'));
  return { scope: 'organization_metrics',
    checks: detectIncidents({
      steps: (steps.data as Array<{ id: string; enrollment_id?: string | null; state?: string | null; due_at?: string | null }>) || [],
      enrollments: [...stepEnrollments.values()],
      contactsByEmail,
      unclassified: ((unclassified.data as Array<{ id: string; name?: string | null; email?: string | null; replied_at?: string | null }>) || []),
      sweepErrors: ((sweepErrors.data as Array<{ provider?: string; last_error?: string | null }>) || [])
        .map((row) => ({ provider: String(row.provider), last_error: row.last_error ?? null })),
      syncErrorCounts: Object.entries(syncCounts).map(([state, count]) => ({ state, count })),
      openExceptions: ((exceptions.data as Array<{ id: string; title?: string | null; category?: string | null; severity?: string | null }>) || []),
    }),
    unclassifiedTruncated: Number((unclassifiedTotal as { count?: number }).count || 0) > 10,
    coverage: await readMailboxCoverage(client, scope) };
}
