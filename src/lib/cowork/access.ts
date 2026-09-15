/** The email is fixed by product policy; configuration can only narrow access. */
export const COWORK_OWNER_EMAIL = 'nicolas.yarur.g@yago.cl';

export type CoworkIdentity = {
  id?: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

export function isCoworkIdentityAllowed(
  user: CoworkIdentity | null | undefined,
  configuration: { enabled?: string; ownerId?: string },
): boolean {
  const ownerId = configuration.ownerId?.trim();
  return configuration.enabled === 'true'
    && Boolean(ownerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId))
    && Boolean(user?.id && user.id === ownerId)
    && user?.email?.trim().toLowerCase() === COWORK_OWNER_EMAIL
    && Boolean(user.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
}
