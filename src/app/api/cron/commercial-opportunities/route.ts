import { NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  findHiringProfile, lastRunOf, lastScheduledRunAt, refreshHiringProfileFromPerfil, supabaseHiringStore, supabaseTenderStore,
} from '@/lib/server/commercial-opportunities/store';
import { scheduleDue } from '@/lib/commercial-opportunities/schedule';
import { DAILY_JSEARCH_QUERIES } from '@/lib/commercial-opportunities/search-terms';
import { generateRoleVariants } from '@/lib/server/commercial-opportunities/search-ai';
import { hiringSyncEnvironment, monthStart, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';
import { runTenderSync } from '@/lib/server/commercial-opportunities/tender-sync';
import {
  DAILY_BUDGET_MS, JSEARCH_MONTH_SPENT, dailyOpportunityPlan, dailyTenderSearch, jsearchQuotaSpentThisMonth,
} from '@/lib/server/commercial-opportunities/daily';
import { markTicketRejected, resolveTicketForOrganization } from '@/lib/server/commercial-opportunities/tickets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The daily sync of «Oportunidades» (plan 8, phase 3), called by the Firebase scheduler. For every active search profile:
 * public tenders (free, with the Mercado Público ticket of a member of the organization) and the cheap hiring source
 * (JSearch, within the month's cap). LinkedIn stays on «Buscar ahora», where the person sees its cost first.
 */
export async function POST(request: Request) {
  const headers = firebaseSchedulerResponseHeaders();
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const client = getSupabaseAdminClient();
  // Plan 15: with each organization's schedule; before its columns exist, the profiles as they were (every day at 8).
  const profiles = (columns: string) => client.from('commercial_opportunity_profiles').select(columns)
    .eq('active', true).not('created_by', 'is', null).order('created_at', { ascending: true }).limit(50);
  let { data, error } = await profiles('organization_id,created_by,schedule_enabled,schedule_days,schedule_hour');
  if (error) ({ data, error } = await profiles('organization_id,created_by'));
  if (error) {
    console.error('[cron/commercial-opportunities] profiles:', error);
    return NextResponse.json({ error: 'No se pudieron leer los perfiles de búsqueda.' }, { status: 500, headers });
  }
  const env = hiringSyncEnvironment();
  const plan = dailyOpportunityPlan((data || []) as unknown as Array<{ organization_id: string; created_by: string }>, { jsearch: Boolean(env.jsearchKey) });
  const results = [];
  const pending: string[] = [];
  let notDue = 0;
  const started = Date.now();
  for (const item of plan) {
    // The tick runs every hour: each organization searches on its days, from its hour, once a day.
    const lastScheduled = await lastScheduledRunAt(client, { userId: item.userId, organizationId: item.organizationId }).catch(() => null);
    if (!scheduleDue(item.schedule, new Date().toISOString(), lastScheduled)) { notDue++; continue; }
    // Inside the route's 300 s: organizations left for later are named in the answer and searched the next morning.
    if (Date.now() - started > DAILY_BUDGET_MS) { pending.push(item.organizationId); continue; }
    const scope = { userId: item.userId, organizationId: item.organizationId };
    const outcome: Record<string, unknown> = { organizationId: item.organizationId };
    try {
      const found = await findHiringProfile(client, scope);
      if (!found) { results.push({ ...outcome, skipped: 'sin perfil de búsqueda' }); continue; }
      // Plan 15: the offer and the tender words follow the «Perfil» of whoever created the search.
      const profile = await refreshHiringProfileFromPerfil(client, scope, found).catch(() => found);
      const storeScope = { ...scope, profileId: profile.id };
      if (item.tenders) {
        // The ticket of a member of the organization (Plan 10); without any, the run is recorded as skipped.
        const store = supabaseTenderStore(client, storeScope, 'schedule');
        outcome.tenders = await dailyTenderSearch({
          resolveTicket: () => resolveTicketForOrganization(client, { organizationId: item.organizationId, creatorId: item.userId }),
          search: ticket => runTenderSync({ store, profile, ticket, organizationId: item.organizationId }),
          skip: (source, reason) => store.startRun({ source, status: 'skipped', error: reason }),
          markRejected: userId => markTicketRejected(client, userId),
        });
      }
      const jsearchSpent = item.hiring && jsearchQuotaSpentThisMonth(await lastRunOf(client, scope, 'jsearch'), monthStart(new Date().toISOString()));
      if (jsearchSpent) {
        await supabaseHiringStore(client, storeScope, 'schedule').startRun({ source: 'jsearch', status: 'skipped', error: JSEARCH_MONTH_SPENT });
        outcome.hiring = { skipped: JSEARCH_MONTH_SPENT };
      } else if (item.hiring && !profile.roles.length) {
        outcome.hiring = { skipped: 'sin cargos guardados' };
      } else if (item.hiring) {
        outcome.hiring = await runHiringSync({ store: supabaseHiringStore(client, storeScope, 'schedule'), profile, env, capUsd: monthlyCapUsd(),
          organizationId: item.organizationId, only: ['jsearch'], variants: await generateRoleVariants(profile.roles), queryCap: DAILY_JSEARCH_QUERIES })
          .then(result => (result.status === 'capped' ? { capped: true } : { status: result.status, qualifying: result.qualifying, costUsd: result.costUsd,
            errors: result.sources.filter(source => source.error).map(source => source.error) }),
            failure => ({ error: failure instanceof Error ? failure.message : 'error' }));
      }
    } catch (failure) {
      outcome.error = failure instanceof Error ? failure.message : 'error';
    }
    results.push(outcome);
  }
  if (pending.length) console.warn(`[cron/commercial-opportunities] ${pending.length} organizations left for tomorrow (time budget).`);
  return NextResponse.json({ ok: true, organizations: results.length, notDue, results, pending }, { headers });
}
