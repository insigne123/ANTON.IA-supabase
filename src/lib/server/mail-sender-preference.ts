import type { SupabaseClient } from '@supabase/supabase-js';
import { isMailProvider, resolveMailProvider, type MailConnections, type MailProvider } from '@/lib/mail-sender';

export type MailSenderPreference = { connected: MailConnections; preferred: MailProvider | null; resolved: MailProvider | null };

/**
 * The person's connected mailboxes (provider_tokens, as Conexiones shows them), the one they chose to send by default
 * (profiles.default_mail_provider) and the one that sends. Never a token. A read that fails counts as nothing connected
 * or nothing chosen: callers keep their previous behavior.
 */
export async function readMailSenderPreference(client: SupabaseClient, userId: string): Promise<MailSenderPreference> {
  const [tokens, profile] = await Promise.all([
    client.from('provider_tokens').select('provider').eq('user_id', userId),
    client.from('profiles').select('default_mail_provider').eq('id', userId).maybeSingle(),
  ]);
  const connected: MailConnections = { google: false, outlook: false };
  if (!tokens.error) {
    for (const row of (tokens.data || []) as Array<{ provider?: unknown }>) {
      if (isMailProvider(row.provider)) connected[row.provider] = true;
    }
  }
  const raw = profile.error ? null : (profile.data as { default_mail_provider?: unknown } | null)?.default_mail_provider;
  const preferred = isMailProvider(raw) ? raw : null;
  return { connected, preferred, resolved: resolveMailProvider(connected, preferred) };
}
