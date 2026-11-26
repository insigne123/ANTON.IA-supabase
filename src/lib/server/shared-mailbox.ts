import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkMailboxIdentity } from '@/lib/server/cowork/sender-identity';
import type { MailProvider } from '@/lib/mail-sender';

/**
 * The mailbox of a whole organization (organization_shared_mailboxes): a team that writes from one address connects it once.
 * When a member signs in with exactly that mailbox, the connection is given to everyone in the organization, and to whoever
 * joins later (migrations 20261126170000 and 20261126180000), except someone who also works in another team: the mailbox
 * must not write for that company. Any other mailbox a member connects stays their own.
 */
export type SharedMailboxOutcome = { shared: boolean; members: number };

type Deps = {
  admin?: any;
  /** The address the provider says this consent is for. */
  mailboxEmail?: (provider: MailProvider, accessToken: string) => Promise<string>;
};

const NOT_SHARED: SharedMailboxOutcome = { shared: false, members: 0 };

/**
 * Call it right after a person's mailbox connection was saved. It never throws: the mailbox is connected either way, and a
 * failure here only means the others still have to connect.
 */
export async function shareMailboxAfterConnect(
  input: { userId: string; provider: MailProvider; accessToken: string | null },
  deps: Deps = {},
): Promise<SharedMailboxOutcome> {
  try {
    const admin = deps.admin || getSupabaseAdminClient();
    const mailboxEmail = deps.mailboxEmail || (async (provider, accessToken) => (await coworkMailboxIdentity(provider, accessToken)).email);
    // A connection saved again keeps its mark: it is the person's own until the address is checked below.
    const own = await admin.from('provider_tokens').update({ shared_organization_id: null })
      .eq('user_id', input.userId).eq('provider', input.provider).not('shared_organization_id', 'is', null);
    if (own.error) throw own.error;
    if (!input.accessToken) return NOT_SHARED;

    const memberships = await admin.from('organization_members').select('organization_id').eq('user_id', input.userId);
    if (memberships.error) throw memberships.error;
    const organizationIds = ((memberships.data || []) as Array<{ organization_id?: string | null }>)
      .map((row) => String(row.organization_id || '')).filter(Boolean);
    if (organizationIds.length === 0) return NOT_SHARED;

    const listed = await admin.from('organization_shared_mailboxes').select('organization_id,email')
      .eq('provider', input.provider).in('organization_id', organizationIds);
    if (listed.error) throw listed.error;
    const mailboxes = (listed.data || []) as Array<{ organization_id: string; email: string }>;
    if (mailboxes.length === 0) return NOT_SHARED;

    const email = (await mailboxEmail(input.provider, input.accessToken)).trim().toLowerCase();
    const match = mailboxes.find((row) => String(row.email || '').trim().toLowerCase() === email);
    if (!match) return NOT_SHARED;

    const shared = await admin.rpc('share_organization_mailbox_v1', {
      p_organization_id: match.organization_id, p_user_id: input.userId, p_provider: input.provider,
    });
    if (shared.error) throw shared.error;
    return { shared: true, members: Math.max(0, Math.trunc(Number(shared.data) || 0)) };
  } catch (error) {
    // Only what failed: never a token or an address.
    console.warn('[shared-mailbox] could not share the connection', { provider: input.provider, error: error instanceof Error ? error.message : 'unknown' });
    return NOT_SHARED;
  }
}
