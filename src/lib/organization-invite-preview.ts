export type InviteRole = 'owner' | 'admin' | 'member';

export type InviteRow = {
  email: string | null;
  role: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
};

export type InvitePreview =
  | { status: 'invalid' }
  | {
      status: 'valid' | 'expired' | 'used' | 'revoked';
      organizationName: string;
      role: InviteRole;
      /** The invited address with most of its local part hidden, so a forwarded link does not expose it. */
      emailHint: string;
      expiresAt: string | null;
      signedIn: boolean;
      /** Whether the signed-in account is the invited one; null without a session. */
      matchesSession: boolean | null;
    };

export const INVITE_ROLE_LABELS: Record<InviteRole, string> = { owner: 'propietario', admin: 'administrador', member: 'miembro' };

const normalizeEmail = (email: string | null | undefined) => String(email || '').trim().toLowerCase();

/** «valentina.rios@yago-qa.cl» → «va•••@yago-qa.cl». */
export function maskEmail(email: string | null | undefined): string {
  const [local, domain, ...rest] = normalizeEmail(email).split('@');
  if (!local || !domain || rest.length) return '';
  return `${local.slice(0, local.length <= 2 ? 1 : 2)}•••@${domain}`;
}

/**
 * What the invitation page may show before anyone accepts: the organization, the role and whom it is for. The order
 * matches accept_organization_invite_v1, which refuses revoked, accepted and expired invitations in that order.
 */
export function describeInvitePreview(
  invite: InviteRow | null,
  organizationName: string | null,
  { now, sessionEmail }: { now: number; sessionEmail: string | null },
): InvitePreview {
  if (!invite || !organizationName) return { status: 'invalid' };
  const expiresAt = invite.expires_at ? Date.parse(invite.expires_at) : Number.NaN;
  const status = invite.revoked_at ? 'revoked'
    : invite.accepted_at ? 'used'
      : !Number.isFinite(expiresAt) || expiresAt <= now ? 'expired'
        : 'valid';
  const role: InviteRole = invite.role === 'owner' || invite.role === 'admin' ? invite.role : 'member';
  const signedIn = Boolean(normalizeEmail(sessionEmail));
  return {
    status,
    organizationName,
    role,
    emailHint: maskEmail(invite.email),
    expiresAt: invite.expires_at,
    signedIn,
    matchesSession: signedIn ? normalizeEmail(sessionEmail) === normalizeEmail(invite.email) : null,
  };
}

/** The accept API answers in English (accept_organization_invite_v1); the page shows this instead. */
export function inviteAcceptErrorMessage(message: string | null | undefined): string {
  const text = String(message || '');
  if (/another email/i.test(text)) return 'Esta invitación es para otro correo. Entra con la cuenta a la que llegó la invitación.';
  if (/invalid or expired|invalid invitation|token is invalid/i.test(text)) return 'La invitación venció o ya se usó. Pide una nueva a quien te invitó.';
  if (/unauthori|sesi[oó]n|401/i.test(text)) return 'Tu sesión venció. Vuelve a iniciar sesión para aceptar.';
  return 'No pudimos aceptar la invitación. Intenta de nuevo.';
}
