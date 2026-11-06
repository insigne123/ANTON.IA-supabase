import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readMailboxSignature, type MailboxSignature } from '@/lib/server/mailbox-signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * «Traer mi firma»: the signature the person already uses, read with their own connection. Without `provider`, the accounts
 * they connected are tried in turn (Outlook, then Gmail), so the screen needs to know nothing before asking.
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const asked = req.nextUrl.searchParams.get('provider');
    const tokens = await getSupabaseAdminClient().from('provider_tokens').select('provider').eq('user_id', user.id);
    if (tokens.error) throw tokens.error;
    type Mailbox = 'gmail' | 'outlook';
    const providers = (tokens.data || []).map(row => (row.provider === 'google' ? 'gmail' : String(row.provider)));
    const connected: Mailbox[] = (['outlook', 'gmail'] as const).filter(value => providers.includes(value));
    const order: Mailbox[] = asked === 'gmail' || asked === 'outlook' ? [asked] : connected;
    let result: MailboxSignature = { provider: order[0] || 'outlook', html: null, reason: 'not_connected' };
    for (const provider of order) {
      result = await readMailboxSignature(user.id, provider);
      if (result.html) break;
    }
    return NextResponse.json({ ...result, connected }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleAuthError(error);
  }
}
