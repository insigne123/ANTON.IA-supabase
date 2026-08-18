import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type RetentionRunResult = {
  key: string;
  label: string;
  maxAgeDays: number;
  cutoffIso: string;
  matchedCount: number;
  deletedCount: number;
};

type RetentionPolicy = {
  key: string;
  label: string;
  maxAgeDays: number;
  run: (dryRun: boolean, cutoffs: Record<string, string>) => Promise<RetentionRunResult>;
};

type RetentionFilter = (query: any, cutoffIso: string) => any;

function getCutoffIso(maxAgeDays: number) {
  return new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
}

async function countRows(table: string, cutoffIso: string, applyFilters: RetentionFilter) {
  const query = applyFilters(
    getSupabaseAdminClient().from(table).select('id', { count: 'exact', head: true }),
    cutoffIso
  );
  const { count, error } = await query;

  if (error) throw error;
  return { cutoffIso, count: count || 0 };
}

async function deleteRows(table: string, cutoffIso: string, applyFilters: RetentionFilter) {
  const query = applyFilters(
    getSupabaseAdminClient().from(table).delete().select('id'),
    cutoffIso
  );
  const { data, error } = await query;

  if (error) throw error;
  return { cutoffIso, deletedCount: data?.length || 0 };
}

function researchMessagingRetentionPolicy(input: {
  key: 'outbound_dispatches' | 'messaging_drafts' | 'lead_research_jobs' | 'research_snapshots';
  label: string;
  maxAgeDays: number;
}): RetentionPolicy {
  return {
    ...input,
    async run(dryRun, cutoffs) {
      const cutoffIso = cutoffs[input.key];
      const { data, error } = await getSupabaseAdminClient().rpc('delete_research_messaging_retention_v1', {
        p_resource: input.key,
        p_cutoff: cutoffIso,
        p_dry_run: dryRun,
        p_dispatch_cutoff: cutoffs.outbound_dispatches,
        p_draft_cutoff: cutoffs.messaging_drafts,
        p_job_cutoff: cutoffs.lead_research_jobs,
      });
      if (error) throw error;
      return {
        ...input,
        cutoffIso,
        matchedCount: Number(data?.matchedCount || 0),
        deletedCount: Number(data?.deletedCount || 0),
      };
    },
  };
}

const retentionPolicies: RetentionPolicy[] = [
  researchMessagingRetentionPolicy({
    key: 'outbound_dispatches',
    label: 'Despachos de mensajeria terminales',
    maxAgeDays: 365,
  }),
  researchMessagingRetentionPolicy({
    key: 'messaging_drafts',
    label: 'Borradores de mensajeria sin historial de envio',
    maxAgeDays: 365,
  }),
  researchMessagingRetentionPolicy({
    key: 'lead_research_jobs',
    label: 'Jobs terminales de investigacion',
    maxAgeDays: 180,
  }),
  researchMessagingRetentionPolicy({
    key: 'research_snapshots',
    label: 'Snapshots de investigacion sin referencias',
    maxAgeDays: 180,
  }),
  {
    key: 'lead_research_reports',
    label: 'Lead research reports auxiliares',
    maxAgeDays: 180,
    async run(dryRun, cutoffs) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('updated_at', cutoffIso);
      const cutoffIso = cutoffs.lead_research_reports;
      const { count } = await countRows('lead_research_reports', cutoffIso, applyFilters);
      if (dryRun) {
        return { key: 'lead_research_reports', label: 'Lead research reports auxiliares', maxAgeDays: 180, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('lead_research_reports', cutoffIso, applyFilters);
      return { key: 'lead_research_reports', label: 'Lead research reports auxiliares', maxAgeDays: 180, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'email_events',
    label: 'Eventos de email observability',
    maxAgeDays: 365,
    async run(dryRun, cutoffs) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('event_at', cutoffIso);
      const cutoffIso = cutoffs.email_events;
      const { count } = await countRows('email_events', cutoffIso, applyFilters);
      if (dryRun) {
        return { key: 'email_events', label: 'Eventos de email observability', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('email_events', cutoffIso, applyFilters);
      return { key: 'email_events', label: 'Eventos de email observability', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'lead_responses',
    label: 'Respuestas de leads',
    maxAgeDays: 365,
    async run(dryRun, cutoffs) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('created_at', cutoffIso);
      const cutoffIso = cutoffs.lead_responses;
      const { count } = await countRows('lead_responses', cutoffIso, applyFilters);
      if (dryRun) {
        return { key: 'lead_responses', label: 'Respuestas de leads', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('lead_responses', cutoffIso, applyFilters);
      return { key: 'lead_responses', label: 'Respuestas de leads', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'activity_logs',
    label: 'Logs de actividad interna',
    maxAgeDays: 365,
    async run(dryRun, cutoffs) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('created_at', cutoffIso);
      const cutoffIso = cutoffs.activity_logs;
      const { count } = await countRows('activity_logs', cutoffIso, applyFilters);
      if (dryRun) {
        return { key: 'activity_logs', label: 'Logs de actividad interna', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('activity_logs', cutoffIso, applyFilters);
      return { key: 'activity_logs', label: 'Logs de actividad interna', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'privacy_requests',
    label: 'Solicitudes de privacidad cerradas',
    maxAgeDays: 730,
    async run(dryRun, cutoffs) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query
        .lt('updated_at', cutoffIso)
        .or(`resolved_at.is.null,resolved_at.lt.${cutoffIso}`)
        .in('status', ['resolved', 'rejected']);
      const cutoffIso = cutoffs.privacy_requests;
      const { count } = await countRows('privacy_requests', cutoffIso, applyFilters);
      if (dryRun) {
        return { key: 'privacy_requests', label: 'Solicitudes de privacidad cerradas', maxAgeDays: 730, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('privacy_requests', cutoffIso, applyFilters);
      return { key: 'privacy_requests', label: 'Solicitudes de privacidad cerradas', maxAgeDays: 730, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
];

export async function runPrivacyRetention(input?: { dryRun?: boolean }) {
  const dryRun = Boolean(input?.dryRun);
  const results: RetentionRunResult[] = [];
  const cutoffs = Object.fromEntries(retentionPolicies.map((policy) => [
    policy.key,
    getCutoffIso(policy.maxAgeDays),
  ]));

  for (const policy of retentionPolicies) {
    results.push(await policy.run(dryRun, cutoffs));
  }

  return {
    dryRun,
    executedAt: new Date().toISOString(),
    results,
    summary: results.reduce(
      (acc, item) => {
        acc.matchedCount += item.matchedCount;
        acc.deletedCount += item.deletedCount;
        return acc;
      },
      { matchedCount: 0, deletedCount: 0 }
    ),
  };
}
