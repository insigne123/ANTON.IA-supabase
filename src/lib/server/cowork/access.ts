import { AuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';
import { isCoworkIdentityAllowed, type CoworkIdentity } from '@/lib/cowork/access';

export function assertCoworkIdentity(user: CoworkIdentity | null | undefined) {
  if (!isCoworkIdentityAllowed(user, {
    enabled: process.env.COWORK_ENABLED,
    ownerId: process.env.COWORK_OWNER_USER_ID,
  })) throw new AuthError('Cowork no está disponible para esta cuenta.', 403);
}

/** No role, domain, browser flag or user-editable metadata grants access. */
export async function requireCoworkAccess(): Promise<AuthContext> {
  const auth = await requireAuth();
  assertCoworkIdentity(auth.user);
  const { data, error } = await auth.supabase.rpc('cowork_has_access', {
    target_organization_id: auth.organizationId,
  });
  if (error || data !== true) throw new AuthError('Cowork no está disponible para esta cuenta.', 403);
  return auth;
}

/** Workers must call this before each effect, using a trusted server client. */
export async function requireCoworkWorkerAccess(
  client: AuthContext['supabase'],
  scope: { userId: string; organizationId: string },
): Promise<void> {
  const { data, error } = await client.auth.admin.getUserById(scope.userId);
  if (error || !data?.user) throw new AuthError('No se pudo verificar el propietario del trabajo.', 403);
  assertCoworkIdentity(data.user);
  const grant = await client.from('cowork_access_grants').select('enabled')
    .eq('user_id', scope.userId).maybeSingle();
  if (grant.error || grant.data?.enabled !== true) throw new AuthError('Acceso Cowork revocado.', 403);
  const membership = await client.from('organization_members')
    .select('user_id').eq('user_id', scope.userId)
    .eq('organization_id', scope.organizationId).maybeSingle();
  if (membership.error || !membership.data) throw new AuthError('El trabajo ya no tiene acceso a esta organización.', 403);
}
