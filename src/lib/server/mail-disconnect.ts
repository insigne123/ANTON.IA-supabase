import type { SupabaseClient } from '@supabase/supabase-js';

import { isMailProvider, type MailProvider } from '@/lib/mail-sender';
import { decryptStoredToken } from '@/lib/server/token-crypto';

export type MailDisconnectResult = {
  /** False when there was nothing to remove (already disconnected): the answer is the same, so a retry is harmless. */
  disconnected: boolean;
  /** The default sender after the change: the other connected mailbox, or none. */
  preferred: MailProvider | null;
};

/** Google lets the app revoke a refresh token; it is best effort, so a slow or failed answer never blocks the disconnection. */
export async function revokeGoogleRefreshToken(token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Removes the stored mailbox connection for one provider. The token row goes first, so nothing sends from that mailbox
 * after this answers; Google's token is then revoked (Microsoft has no simple per-token revocation). If that mailbox was
 * the default sender, the default moves to the other connected one or is cleared, as Conexiones shows it.
 */
export async function disconnectMailProvider(
  admin: SupabaseClient,
  userId: string,
  provider: MailProvider,
  deps: { revokeGoogle?: (token: string) => Promise<void>; warn?: (message: string) => void } = {},
): Promise<MailDisconnectResult> {
  const revokeGoogle = deps.revokeGoogle ?? ((token: string) => revokeGoogleRefreshToken(token));
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  const { data: stored, error: readError } = await admin
    .from('provider_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (readError) throw readError;

  const { error: deleteError } = await admin.from('provider_tokens').delete().eq('user_id', userId).eq('provider', provider);
  if (deleteError) throw deleteError;

  const encrypted = (stored as { refresh_token?: string | null } | null)?.refresh_token;
  if (provider === 'google' && encrypted) {
    let token: string | null = null;
    try { token = decryptStoredToken(encrypted); } catch { token = null; }
    if (token) await revokeGoogle(token).catch((error: unknown) => warn(`[mail-disconnect] Google revoke failed: ${error instanceof Error ? error.message : 'unknown'}`));
  }

  const [remaining, profile] = await Promise.all([
    admin.from('provider_tokens').select('provider').eq('user_id', userId),
    admin.from('profiles').select('default_mail_provider').eq('id', userId).maybeSingle(),
  ]);
  const connected = new Set(((remaining.data || []) as Array<{ provider?: unknown }>).map((row) => row.provider).filter(isMailProvider));
  const raw = (profile.data as { default_mail_provider?: unknown } | null)?.default_mail_provider;
  let preferred: MailProvider | null = isMailProvider(raw) ? raw : null;
  if (preferred === provider || (preferred && !connected.has(preferred))) {
    preferred = connected.has('google') ? 'google' : connected.has('outlook') ? 'outlook' : null;
    const { error: updateError } = await admin.from('profiles').update({ default_mail_provider: preferred }).eq('id', userId);
    // The connection is already gone; a stale preference only falls back to the connected mailbox when sending.
    if (updateError) warn(`[mail-disconnect] Default sender not updated: ${updateError.message}`);
  }

  return { disconnected: Boolean(stored), preferred };
}
