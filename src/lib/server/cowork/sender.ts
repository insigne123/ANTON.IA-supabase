import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import { requireCoworkWorkerAccess } from './access';
import { coworkMailboxIdentity, type CoworkMailProvider } from './sender-identity';

export type { CoworkMailProvider };

export async function resolveCoworkSender(scope: { userId: string; organizationId: string }, preferred?: CoworkMailProvider) {
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  let provider: CoworkMailProvider = preferred || 'google';
  let token = await tokenService.getToken(client, scope.userId, provider);
  if (!preferred && !token?.refresh_token) {
    provider = 'outlook';
    token = await tokenService.getToken(client, scope.userId, provider);
  }
  if (!token?.refresh_token) throw new Error('Reconecta tu cuenta de correo para continuar.');
  const refreshed = provider === 'google'
    ? await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!)
    : await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
  if (provider === 'outlook' && refreshed.refresh_token) {
    const saved = await client.from('provider_tokens').update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() })
      .eq('user_id', scope.userId).eq('provider', provider);
    if (saved.error) throw saved.error;
  }
  const identity = await coworkMailboxIdentity(provider, refreshed.access_token);
  await requireCoworkWorkerAccess(client, scope);
  return identity; // Tokens never leave this helper.
}
