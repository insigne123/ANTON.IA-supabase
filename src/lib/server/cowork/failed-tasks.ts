import { failedTasks } from '@/lib/cowork/overview';
import { groupCoworkThreads } from '@/lib/cowork/presentation';

type Client = any;

/**
 * «Para hoy» (plan de uso A2): the person's conversations whose last turn failed in the last two weeks, through their own session,
 * as the list groups them (the latest 100 turns) and without the ones they deleted. Null when they cannot be read.
 */
export async function readFailedTasks(client: Client, scope: { userId: string; organizationId: string }, now = Date.now()) {
  const [runs, settings] = await Promise.all([
    client.from('cowork_runs').select('id,message,mode,status,created_at,parent_run_id,root_run_id').eq('user_id', scope.userId)
      .eq('organization_id', scope.organizationId).order('created_at', { ascending: false }).limit(100),
    client.from('cowork_thread_settings').select('root_run_id,hidden_at').eq('user_id', scope.userId).eq('organization_id', scope.organizationId).limit(1000),
  ]);
  if (runs.error) return null;
  const hidden = new Set<string>(((settings.error ? [] : settings.data || []) as any[]).filter(row => row.hidden_at).map(row => String(row.root_run_id)));
  return failedTasks(groupCoworkThreads((runs.data || []) as any[]), hidden, now);
}
