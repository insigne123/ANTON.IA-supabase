import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '@/lib/server/auth-utils';
import { repliesWaiting } from '@/lib/home/today';
import { groupCoworkThreads } from '@/lib/cowork/presentation';
import { listCoworkRuns } from '@/lib/server/cowork/runs';
import { readCoworkThreadSettings } from '@/lib/server/cowork/thread-settings';
import { readHomeOpportunities } from './home-opportunities';

/** The numbers beside three entries of the menu (APP-23); null where the person has no access or the read failed: then nothing shows. */
export type NavPending = { conversations: number | null; cowork: number | null; opportunities: number | null };

type Scope = { supabase: SupabaseClient; admin: SupabaseClient; user: { id: string }; organizationId: string; now: Date };

/** People who wrote and wait for an answer: the rule of «Por responder», over the same recent replies «Hoy» reads. */
async function conversations({ supabase, user, organizationId }: Scope) {
  const { data, error } = await supabase.from('contacted_leads').select('id,email,reply_intent,replied_at,conversation_resolved_at,conversation_outbound_at')
    .eq('organization_id', organizationId).eq('user_id', user.id).not('replied_at', 'is', null).order('replied_at', { ascending: false }).limit(200);
  if (error) throw error;
  return repliesWaiting(data || []);
}

/** Conversations of Cowork whose proposal waits for the person, as its list counts them (the same runs, without the deleted ones). */
async function cowork({ supabase, user, organizationId }: Scope) {
  const access = await supabase.rpc('cowork_has_access', { target_organization_id: organizationId });
  if (access.error || access.data !== true) return null;
  const auth = { supabase, user, organizationId } as unknown as AuthContext;
  const settings = await readCoworkThreadSettings(supabase as any, { userId: user.id, organizationId }).catch(() => ({ hiddenRootIds: [] as string[] }));
  const runs = await listCoworkRuns(auth, { hiddenRootIds: settings.hiddenRootIds });
  return groupCoworkThreads(runs as any).filter(thread => thread.status === 'waiting_approval').length;
}

export async function readNavPending(scope: Scope): Promise<NavPending> {
  const [replies, approvals, opportunities] = await Promise.all([
    conversations(scope).catch(() => null),
    cowork(scope).catch(() => null),
    readHomeOpportunities(scope.admin, scope.user, scope.organizationId, scope.now).then(today => today ? today.attention : null).catch(() => null),
  ]);
  return { conversations: replies, cowork: approvals, opportunities };
}
