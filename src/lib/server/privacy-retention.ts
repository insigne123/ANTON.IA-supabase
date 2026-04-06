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
  run: (dryRun: boolean) => Promise<RetentionRunResult>;
};

type RetentionFilter = (query: any, cutoffIso: string) => any;

function getCutoffIso(maxAgeDays: number) {
  return new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
}

async function countRows(table: string, maxAgeDays: number, applyFilters: RetentionFilter) {
  const cutoffIso = getCutoffIso(maxAgeDays);
  const query = applyFilters(
    getSupabaseAdminClient().from(table).select('id', { count: 'exact', head: true }),
    cutoffIso
  );
  const { count, error } = await query;

  if (error) throw error;
  return { cutoffIso, count: count || 0 };
}

async function deleteRows(table: string, maxAgeDays: number, applyFilters: RetentionFilter) {
  const cutoffIso = getCutoffIso(maxAgeDays);
  const query = applyFilters(
    getSupabaseAdminClient().from(table).delete().select('id'),
    cutoffIso
  );
  const { data, error } = await query;

  if (error) throw error;
  return { cutoffIso, deletedCount: data?.length || 0 };
}

const retentionPolicies: RetentionPolicy[] = [
  {
    key: 'lead_research_reports',
    label: 'Lead research reports auxiliares',
    maxAgeDays: 180,
    async run(dryRun) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('updated_at', cutoffIso);
      const { cutoffIso, count } = await countRows('lead_research_reports', 180, applyFilters);
      if (dryRun) {
        return { key: 'lead_research_reports', label: 'Lead research reports auxiliares', maxAgeDays: 180, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('lead_research_reports', 180, applyFilters);
      return { key: 'lead_research_reports', label: 'Lead research reports auxiliares', maxAgeDays: 180, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'email_events',
    label: 'Eventos de email observability',
    maxAgeDays: 365,
    async run(dryRun) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('event_at', cutoffIso);
      const { cutoffIso, count } = await countRows('email_events', 365, applyFilters);
      if (dryRun) {
        return { key: 'email_events', label: 'Eventos de email observability', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('email_events', 365, applyFilters);
      return { key: 'email_events', label: 'Eventos de email observability', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'lead_responses',
    label: 'Respuestas de leads',
    maxAgeDays: 365,
    async run(dryRun) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('created_at', cutoffIso);
      const { cutoffIso, count } = await countRows('lead_responses', 365, applyFilters);
      if (dryRun) {
        return { key: 'lead_responses', label: 'Respuestas de leads', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('lead_responses', 365, applyFilters);
      return { key: 'lead_responses', label: 'Respuestas de leads', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'activity_logs',
    label: 'Logs de actividad interna',
    maxAgeDays: 365,
    async run(dryRun) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('created_at', cutoffIso);
      const { cutoffIso, count } = await countRows('activity_logs', 365, applyFilters);
      if (dryRun) {
        return { key: 'activity_logs', label: 'Logs de actividad interna', maxAgeDays: 365, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('activity_logs', 365, applyFilters);
      return { key: 'activity_logs', label: 'Logs de actividad interna', maxAgeDays: 365, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
  {
    key: 'privacy_requests',
    label: 'Solicitudes de privacidad cerradas',
    maxAgeDays: 730,
    async run(dryRun) {
      const applyFilters: RetentionFilter = (query, cutoffIso) => query.lt('submitted_at', cutoffIso).in('status', ['resolved', 'rejected']);
      const { cutoffIso, count } = await countRows('privacy_requests', 730, applyFilters);
      if (dryRun) {
        return { key: 'privacy_requests', label: 'Solicitudes de privacidad cerradas', maxAgeDays: 730, cutoffIso, matchedCount: count, deletedCount: 0 };
      }
      const deleted = await deleteRows('privacy_requests', 730, applyFilters);
      return { key: 'privacy_requests', label: 'Solicitudes de privacidad cerradas', maxAgeDays: 730, cutoffIso: deleted.cutoffIso, matchedCount: count, deletedCount: deleted.deletedCount };
    },
  },
];

export async function runPrivacyRetention(input?: { dryRun?: boolean }) {
  const dryRun = Boolean(input?.dryRun);
  const results: RetentionRunResult[] = [];

  for (const policy of retentionPolicies) {
    results.push(await policy.run(dryRun));
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
