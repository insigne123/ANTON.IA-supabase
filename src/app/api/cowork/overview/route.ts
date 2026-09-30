import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { readCoworkLinkedinQuota } from '@/lib/server/cowork/linkedin-reads';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { coworkFirstName, type CoworkOverview } from '@/lib/cowork/overview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

type Count = { count?: number | null; error?: unknown };
const counted = (result: PromiseSettledResult<Count>) =>
  result.status === 'fulfilled' && !result.value.error && typeof result.value.count === 'number' ? result.value.count : null;

/**
 * The Cowork home's figures (plan 2, V7), on the same scope Cowork reads and through your session:
 * your saved contacts (and how many have an email), your campaigns, your LinkedIn invitations of
 * the week, your first name and whether there is an offer to write with. Counts only: no rows,
 * no addresses. A figure that fails is null; the others still arrive.
 */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const own = (table: string) => auth.supabase.from(table).select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
    const [contacts, withEmail, campaigns, linkedin, context] = await Promise.allSettled([
      own('leads'),
      own('leads').not('email', 'is', null).neq('email', ''),
      own('bulk_campaigns'),
      // LinkedIn jobs are not readable through a session (only the worker's role): the same two
      // counts Cowork's linkedin.quota reads, scoped to you. Only the numbers leave the server.
      Promise.resolve().then(() => readCoworkLinkedinQuota(getSupabaseAdminClient(), scope)),
      loadCoworkUserContext(auth.supabase, scope, { memories: false }),
    ]);
    const quota = linkedin.status === 'fulfilled' ? linkedin.value : null;
    const person = context.status === 'fulfilled' ? context.value : null;
    const overview: CoworkOverview = {
      firstName: coworkFirstName(person?.fullName),
      hasOffer: person ? Boolean(person.offer) : null,
      contacts: counted(contacts as PromiseSettledResult<Count>),
      withEmail: counted(withEmail as PromiseSettledResult<Count>),
      campaigns: counted(campaigns as PromiseSettledResult<Count>),
      linkedin: quota ? { used: quota.pending + quota.sent7d, limit: quota.limit } : null,
    };
    return NextResponse.json(overview, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo leer el resumen de tu cuenta.' }, { status: 503, headers: privateHeaders });
  }
}
