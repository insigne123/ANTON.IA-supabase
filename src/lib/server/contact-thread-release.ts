import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Plan 5, PR-9a: frees for the team the contacts that never replied, 30 days after the last send
 * (release_idle_organization_contact_threads_v1, service role only). It runs with the outbound reconciliation job; a
 * failure here never stops the reconciliation and is reported in its result.
 */
export async function releaseIdleContactThreads(client: RpcClient = getSupabaseAdminClient() as unknown as RpcClient): Promise<{ released: number | null; error?: string }> {
  try {
    const { data, error } = await client.rpc('release_idle_organization_contact_threads_v1', { p_limit: 200 });
    if (error) throw error;
    return { released: Number(data || 0) };
  } catch (error) {
    console.error('[contact-thread-release] failed', error);
    return { released: null, error: 'release_failed' };
  }
}
