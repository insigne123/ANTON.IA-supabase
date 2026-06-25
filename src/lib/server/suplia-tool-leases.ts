import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { SupliaRuntimeError } from '@/lib/suplia/runtime';
import type { SupliaToolLeasePolicy } from '@/lib/suplia/tool-limits';

export type SupliaToolLease = {
  id: string;
  token: string;
  resourceKey: string;
  expiresAt: string;
};

export async function claimSupliaToolLease(input: {
  auth: AuthContext;
  policy: SupliaToolLeasePolicy;
  jobId?: string | null;
  stepId?: string | null;
  toolRunId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('claim_suplia_tool_lease', {
    p_organization_id: input.auth.organizationId,
    p_resource_key: input.policy.resourceKey,
    p_max_concurrent: input.policy.maxConcurrent,
    p_ttl_seconds: input.policy.ttlSeconds,
    p_job_id: input.jobId || null,
    p_step_id: input.stepId || null,
    p_tool_run_id: input.toolRunId || null,
    p_metadata: input.metadata || {},
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.acquired) {
    throw new SupliaRuntimeError('deferred', `SUPL.IA reprogramo la tool porque ${input.policy.resourceKey} ya esta en uso.`, {
      retryAfterMs: Math.min(input.policy.ttlSeconds * 1000, 60000),
      metadata: { resourceKey: input.policy.resourceKey, activeCount: row?.active_count || 0 },
    });
  }

  return {
    id: row.lease_id,
    token: row.lease_token,
    resourceKey: input.policy.resourceKey,
    expiresAt: row.expires_at,
  } satisfies SupliaToolLease;
}

export async function releaseSupliaToolLease(lease?: SupliaToolLease | null) {
  if (!lease?.token) return;
  const admin = getSupabaseAdminClient();
  const { error } = await admin.rpc('release_suplia_tool_lease', { p_lease_token: lease.token });
  if (error) console.warn('[SUPLIA/tool lease] release failed:', error.message || error);
}
