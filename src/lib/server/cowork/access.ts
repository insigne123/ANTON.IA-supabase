import { AuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';
import { isCoworkIdentityAllowed, type CoworkIdentity } from '@/lib/cowork/access';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

const coworkOpenToAll = () => process.env.COWORK_OPEN_TO_ALL === 'true';

export function assertCoworkIdentity(user: CoworkIdentity | null | undefined) {
  if (!isCoworkIdentityAllowed(user, {
    enabled: process.env.COWORK_ENABLED,
    ownerId: process.env.COWORK_OWNER_USER_ID,
    allowedIds: process.env.COWORK_ALLOWED_USER_IDS,
    openToAll: process.env.COWORK_OPEN_TO_ALL,
  })) throw new AuthError('Cowork no está disponible para esta cuenta.', 403);
}

/**
 * With Cowork open to everyone (COWORK_OPEN_TO_ALL), a person's first visit creates their grant. An existing grant is
 * left as it is: one an administrator turned off stays off.
 */
export async function ensureCoworkGrant(client: Pick<AuthContext['supabase'], 'from'>, userId: string) {
  const { error } = await client.from('cowork_access_grants')
    .upsert({ user_id: userId, enabled: true }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw new AuthError('Cowork no está disponible para esta cuenta.', 403);
}

/** No role, domain, browser flag or user-editable metadata grants access. */
export async function requireCoworkAccess(): Promise<AuthContext> {
  const auth = await requireAuth();
  assertCoworkIdentity(auth.user);
  const check = () => auth.supabase.rpc('cowork_has_access', { target_organization_id: auth.organizationId });
  let { data, error } = await check();
  if (!error && data !== true && coworkOpenToAll()) {
    await ensureCoworkGrant(getSupabaseAdminClient(), auth.user.id);
    ({ data, error } = await check());
  }
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
