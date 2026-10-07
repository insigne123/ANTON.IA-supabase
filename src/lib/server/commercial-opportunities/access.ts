import { AuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { canUseOpportunities } from './grants';

export type OpportunitiesContext = AuthContext & { admin: ReturnType<typeof getSupabaseAdminClient> };

/**
 * «Oportunidades» exists only for the accounts that may use it in their active organization: any other signed-in account
 * gets a 404, as if the section did not exist.
 */
export async function requireOpportunitiesUser(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!(await canUseOpportunities(getSupabaseAdminClient(), auth.user, auth.organizationId))) throw new AuthError('Not Found', 404);
  return auth;
}

/**
 * The same check, plus the service client for the data: the tables have no member grants, and every query is scoped to the
 * active organization of the signed-in person, never to an id from the request.
 */
export async function requireOpportunitiesAccess(): Promise<OpportunitiesContext> {
  const auth = await requireOpportunitiesUser();
  return { ...auth, admin: getSupabaseAdminClient() };
}
