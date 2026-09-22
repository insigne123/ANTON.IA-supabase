// Explicit controlled-account diagnostic. No env files, writes, sends or token migration.
import { createClient } from '@supabase/supabase-js';
import { decryptStoredToken } from '../src/lib/server/token-crypto';
import { readGmailContactMessages } from '../src/lib/server/cowork/gmail-contact-reader';

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Explicit --live required');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== 'https://yfdelflsheurzaicwayi.supabase.co') throw new Error('Unexpected project');
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = 'de3a3194-29b1-449a-828a-53608a7ebe47';
  const { data: identity, error: identityError } = await client.auth.admin.getUserById(owner);
  if (identityError || identity.user?.email?.toLowerCase() !== 'nicolas.yarur.g@yago.cl') throw new Error('Owner identity unavailable');
  const { data, error } = await client.from('provider_tokens').select('refresh_token').eq('user_id', owner).eq('provider', 'google').maybeSingle();
  if (error || !data) { console.log(JSON.stringify({ stage: 'connection', status: 'missing_google_connection', sent: false })); return; }
  const refreshToken = decryptStoredToken(data.refresh_token);
  if (!refreshToken) { console.log(JSON.stringify({ stage: 'connection', status: 'token_unreadable', sent: false })); return; }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!response.ok) { console.log(JSON.stringify({ stage: 'oauth', status: 'reconnect_required', httpStatus: response.status, sent: false })); return; }
  const refreshed = await response.json();
  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${refreshed.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!profile.ok) { console.log(JSON.stringify({ stage: 'gmail_profile', status: 'permission_or_service_unavailable', httpStatus: profile.status, sent: false })); return; }
  const mailbox = await profile.json();
  if (mailbox.emailAddress?.toLowerCase() !== 'nicolas.yarur.g@yago.cl') {
    console.log(JSON.stringify({ stage: 'identity', status: 'connected_mailbox_mismatch', sent: false })); return;
  }
  try {
    const result = await readGmailContactMessages(refreshed.access_token, 'nicogun123@gmail.com');
    console.log(JSON.stringify({ stage: 'read', status: 'verified', mailbox: result.mailbox,
      recipient: result.contact, fetched: result.fetched, returned: result.returned, hasMore: result.hasMore,
      directions: result.messages.map(m => m.direction), sent: false,
      limitation: 'Direct adapter read only. No UI, worker, send or full mailbox acceptance.' }, null, 2));
  } catch {
    console.log(JSON.stringify({ stage: 'read', status: 'read_not_verified', sent: false }));
  }
}
main().catch(() => { console.error('Gmail diagnostic failed; no secrets or provider content displayed.'); process.exitCode = 1; });
