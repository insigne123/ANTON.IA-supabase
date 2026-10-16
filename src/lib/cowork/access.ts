/** The email is fixed by product policy; configuration can only narrow access. */
export const COWORK_OWNER_EMAIL = 'nicolas.yarur.g@yago.cl';
/**
 * Who may use Cowork, fixed by product policy: the owner and the QA account that evaluates Cowork in production
 * (16 Oct 2026). Configuration (COWORK_OWNER_USER_ID, COWORK_ALLOWED_USER_IDS) can only narrow it to the ids it names.
 */
export const COWORK_ALLOWED_EMAILS: readonly string[] = [COWORK_OWNER_EMAIL, 'nicolas.yarur.g+qa@yago.cl'];

export type CoworkIdentity = {
  id?: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids configured for Cowork: the owner's and the allowed list (comma separated), valid UUIDs only, once each. */
export function coworkUserIds(configuration: { ownerId?: string; allowedIds?: string }): string[] {
  return [...new Set([configuration.ownerId, ...String(configuration.allowedIds || '').split(',')]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => UUID.test(value)))];
}

export function isCoworkEmailAllowed(email: string | null | undefined) {
  return COWORK_ALLOWED_EMAILS.includes(String(email || '').trim().toLowerCase());
}

export function isCoworkIdentityAllowed(
  user: CoworkIdentity | null | undefined,
  configuration: { enabled?: string; ownerId?: string; allowedIds?: string },
): boolean {
  const ids = coworkUserIds(configuration);
  return configuration.enabled === 'true'
    && Boolean(user?.id && ids.includes(user.id.toLowerCase()))
    && isCoworkEmailAllowed(user?.email)
    && Boolean(user?.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
}
