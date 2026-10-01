import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import { coworkMailboxIdentity, type CoworkMailProvider } from '@/lib/server/cowork/sender-identity';

export type MailProvider = CoworkMailProvider;

export type MailSenderStatus =
  | { provider: MailProvider; state: 'connected'; email: string }
  | { provider: MailProvider; state: 'not_connected' }
  | { provider: MailProvider; state: 'unverified' };

/** Who an email will really come from: the mailbox the provider says, never the editable profile. «not_connected» is certain
 * (no token stored); «unverified» means a token exists but the provider did not confirm it (expired consent, outage), so the
 * page warns without blocking. Tokens never leave this module. */
export async function resolveMailSender(userId: string, provider: MailProvider): Promise<MailSenderStatus> {
  const client = getSupabaseAdminClient();
  const token = await tokenService.getToken(client, userId, provider);
  if (!token?.refresh_token) return { provider, state: 'not_connected' };
  try {
    const refreshed = provider === 'google'
      ? await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!)
      : await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
    if (!refreshed?.access_token) return { provider, state: 'unverified' };
    // Microsoft rotates refresh tokens: keep the new one, as every other Outlook caller does.
    if (provider === 'outlook' && refreshed.refresh_token) {
      await client.from('provider_tokens')
        .update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('provider', provider);
    }
    const identity = await coworkMailboxIdentity(provider, refreshed.access_token);
    return { provider, state: 'connected', email: identity.email };
  } catch {
    return { provider, state: 'unverified' };
  }
}
