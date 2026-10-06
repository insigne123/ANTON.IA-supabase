import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkWorkspaceDigest, type CoworkWorkspace } from '@/lib/cowork/workspace';
import { readCoworkAgenda } from './agenda-read';
import { readCoworkLinkedinQuota } from './linkedin-reads';

type Scope = { userId: string; organizationId: string };

/** The account's state with every turn (Plan 13). Off unless COWORK_WORKSPACE_ENABLED=true. */
export function coworkWorkspaceEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_WORKSPACE_ENABLED === 'true';
}

/** Past this the turn starts without it: the state helps, but never at the cost of waiting. */
export const COWORK_WORKSPACE_TIMEOUT_MS = 2500;

type Count = { count?: number | null; error?: unknown };
const counted = (result: PromiseSettledResult<Count>) =>
  result.status === 'fulfilled' && !result.value.error && typeof result.value.count === 'number' ? result.value.count : null;

/**
 * The person's own contacts (and how many have an email), campaigns, LinkedIn week and today's agenda, read with the worker's
 * client and always scoped to the person and their organization, as the Cowork home and «¿Qué toca hoy?» read them. Each part
 * can fail on its own; the whole is best effort and null when nothing arrives in time.
 */
export async function loadCoworkWorkspace(
  client: SupabaseClient, scope: Scope, timeoutMs = COWORK_WORKSPACE_TIMEOUT_MS,
  reads: { linkedin: typeof readCoworkLinkedinQuota; agenda: typeof readCoworkAgenda } = { linkedin: readCoworkLinkedinQuota, agenda: readCoworkAgenda },
): Promise<CoworkWorkspace | null> {
  const own = (table: string) => client.from(table).select('id', { count: 'exact', head: true })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const all = Promise.allSettled([
    own('leads'),
    own('leads').not('email', 'is', null).neq('email', ''),
    own('bulk_campaigns'),
    reads.linkedin(client, scope),
    reads.agenda(client, scope),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const settled = await Promise.race([all, late]);
    if (!settled) return null;
    const [contacts, withEmail, campaigns, linkedin, agenda] = settled;
    return coworkWorkspaceDigest({
      contacts: counted(contacts as PromiseSettledResult<Count>),
      withEmail: counted(withEmail as PromiseSettledResult<Count>),
      campaigns: counted(campaigns as PromiseSettledResult<Count>),
      linkedin: linkedin.status === 'fulfilled' ? linkedin.value : null,
      agenda: agenda.status === 'fulfilled' ? agenda.value : null,
    });
  } finally {
    clearTimeout(timer);
  }
}
