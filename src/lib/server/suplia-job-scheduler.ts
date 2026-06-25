import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { runSupliaJob, recordSupliaJobEvent } from '@/lib/server/suplia-job-runner';
import { countActiveSupliaJobsByOrganization, pickSupliaSchedulableJobsByOrganization } from '@/lib/suplia/job-scheduler-helpers';

const LOCK_STALE_MINUTES = 6;
const DEFAULT_MAX_JOBS_PER_ORGANIZATION = 1;

function adminAuthForJob(job: any): AuthContext {
  const admin = getSupabaseAdminClient();
  return {
    user: { id: job.user_id, email: null },
    organizationId: job.organization_id,
    supabase: admin,
  };
}

export async function runSupliaScheduler(input: { organizationId?: string | null; limit?: number; maxJobsPerOrganization?: number } = {}) {
  const admin = getSupabaseAdminClient();
  const limit = Math.max(1, Math.min(Number(input.limit || 5), 20));
  const maxJobsPerOrganization = Math.max(1, Math.min(Number(input.maxJobsPerOrganization || DEFAULT_MAX_JOBS_PER_ORGANIZATION), 3));
  const staleIso = new Date(Date.now() - LOCK_STALE_MINUTES * 60 * 1000).toISOString();

  let query = admin
    .from('suplia_jobs')
    .select('*')
    .in('status', ['queued', 'running', 'planning'])
    .or(`lock_token.is.null,locked_at.lt.${staleIso}`)
    .order('priority', { ascending: false })
    .order('queued_at', { ascending: true })
    .limit(limit * 4);

  if (input.organizationId) query = query.eq('organization_id', input.organizationId);

  let activeQuery = admin
    .from('suplia_jobs')
    .select('id, organization_id')
    .in('status', ['running', 'planning'])
    .gte('locked_at', staleIso);

  if (input.organizationId) activeQuery = activeQuery.eq('organization_id', input.organizationId);

  const [{ data: jobs, error }, { data: activeJobs, error: activeJobsError }] = await Promise.all([query, activeQuery]);
  if (error) throw error;
  if (activeJobsError) throw activeJobsError;

  const selectedJobs = pickSupliaSchedulableJobsByOrganization(
    jobs || [],
    countActiveSupliaJobsByOrganization(activeJobs || []),
    limit,
    maxJobsPerOrganization,
  );

  const results: Array<{ jobId: string; processed: boolean; error?: string }> = [];

  await Promise.all(selectedJobs.map(async (job) => {
    try {
      const result = await runSupliaJob(adminAuthForJob(job), job.id, { maxSteps: 6 });
      results.push({ jobId: job.id, processed: Boolean(result.processed) });
    } catch (error: any) {
      results.push({ jobId: job.id, processed: false, error: error?.message || 'scheduler_error' });
      await recordSupliaJobEvent({
        organizationId: String(job.organization_id || ''),
        jobId: job.id,
        eventType: 'scheduler.error',
        title: 'Error de scheduler',
        message: error?.message || 'No se pudo procesar el job.',
        severity: 'error',
      });
    }
  }));

  return {
    picked: selectedJobs.length,
    results,
  };
}
