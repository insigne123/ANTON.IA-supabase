import { NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { ensureHiringProfile, supabaseHiringStore, supabaseTenderStore } from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';
import { runTenderSync } from '@/lib/server/commercial-opportunities/tender-sync';
import { dailyOpportunityPlan, dailyTenderSearch } from '@/lib/server/commercial-opportunities/daily';
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
  const { data, error } = await client.from('commercial_opportunity_profiles').select('organization_id,created_by')
    .eq('active', true).not('created_by', 'is', null).order('created_at', { ascending: true }).limit(50);
  if (error) {
    console.error('[cron/commercial-opportunities] profiles:', error);
    return NextResponse.json({ error: 'No se pudieron leer los perfiles de búsqueda.' }, { status: 500, headers });
  }
  const env = hiringSyncEnvironment();
  const plan = dailyOpportunityPlan((data || []) as Array<{ organization_id: string; created_by: string }>, { jsearch: Boolean(env.jsearchKey) });
  const results = [];
  for (const item of plan) {
    const scope = { userId: item.userId, organizationId: item.organizationId };
    const outcome: Record<string, unknown> = { organizationId: item.organizationId };
    try {
      const profile = await ensureHiringProfile(client, scope);
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
      if (item.hiring) {
        outcome.hiring = await runHiringSync({ store: supabaseHiringStore(client, storeScope, 'schedule'), profile, env, capUsd: monthlyCapUsd(),
          organizationId: item.organizationId, only: ['jsearch'] })
          .then(result => (result.status === 'capped' ? { capped: true } : { status: result.status, qualifying: result.qualifying, costUsd: result.costUsd,
            errors: result.sources.filter(source => source.error).map(source => source.error) }),
            failure => ({ error: failure instanceof Error ? failure.message : 'error' }));
      }
    } catch (failure) {
      outcome.error = failure instanceof Error ? failure.message : 'error';
    }
    results.push(outcome);
  }
  return NextResponse.json({ ok: true, organizations: results.length, results }, { headers });
}
