import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesAccess } from './access';
import { isOpportunityAdmin, opportunityWorkspaceEnabled, type WorkScope } from '@/lib/commercial-opportunities/workspace';

export async function requireOpportunityWorkspace() {
  if (!opportunityWorkspaceEnabled()) throw new AuthError('Not Found', 404);
  return requireOpportunitiesAccess();
}
export function opportunityScope(auth: { user: { id: string }; organizationId: string; organizationRole?: string }): WorkScope {
  return { organizationId: auth.organizationId, userId: auth.user.id, role: auth.organizationRole };
}
export function assertOpportunityAdmin(scope: WorkScope) {
  if (!isOpportunityAdmin(scope.role)) throw new AuthError('Esta acción corresponde a un administrador.', 403);
}
/** Every object read, including files, exports and chat, is independently checked. */
export async function assertOpportunityRead(client: SupabaseClient, scope: WorkScope, id: string) {
  const { data, error } = await client.rpc('opportunity_can_read', { p_org: scope.organizationId, p_user: scope.userId, p_opportunity: id });
  if (error || data !== true) throw new AuthError('No encontramos esa oportunidad.', 404);
}
export async function readableOpportunityIds(client: SupabaseClient, scope: WorkScope): Promise<string[] | null> {
  if (isOpportunityAdmin(scope.role)) return null;
  const { data, error } = await client.from('opportunity_participants').select('opportunity_id')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(2000);
  if (error) throw new AuthError('No se pudieron cargar tus asignaciones.', 503);
  return (data || []).map(row => row.opportunity_id);
}
