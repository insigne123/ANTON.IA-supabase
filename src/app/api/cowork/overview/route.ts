import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { readCoworkLinkedinQuota } from '@/lib/server/cowork/linkedin-reads';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { coworkFirstName, type CoworkOverview } from '@/lib/cowork/overview';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { loadCoworkSinceLastVisit } from '@/lib/server/cowork/since-visit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

type Count = { count?: number | null; error?: unknown };
type Session = Awaited<ReturnType<typeof requireCoworkAccess>>['supabase'];

/** Your contacts with an email that nobody in the organization has written to (the same record Cowork's contacted.search reads),
 * through your session. Up to 500 contacts are compared; a failed read leaves the figure out. */
async function contactsToWrite(client: Session, scope: { userId: string; organizationId: string }) {
  const leads = await client.from('leads').select('email').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .not('email', 'is', null).neq('email', '').limit(500);
  if (leads.error) throw leads.error;
  const emails = Array.from(new Set(((leads.data || []) as Array<{ email: string | null }>).map(row => String(row.email || '').trim()).filter(Boolean)));
  if (!emails.length) return 0;
  const written = new Set<string>();
  for (let start = 0; start < emails.length; start += 100) {
    const chunk = emails.slice(start, start + 100);
    const sent = await client.from('contacted_leads').select('email').eq('organization_id', scope.organizationId).in('email', chunk);
    if (sent.error) throw sent.error;
    for (const row of (sent.data || []) as Array<{ email: string | null }>) written.add(String(row.email || '').trim().toLowerCase());
  }
  return emails.filter(email => !written.has(email.toLowerCase())).length;
}
const counted = (result: PromiseSettledResult<Count>) =>
  result.status === 'fulfilled' && !result.value.error && typeof result.value.count === 'number' ? result.value.count : null;

/**
 * The Cowork home's figures (plan 2, V7), on the same scope Cowork reads and through your session:
 * your saved contacts (and how many have an email), your campaigns, your LinkedIn invitations of
 * the week, your first name and whether there is an offer to write with, what changed since your last
 * turn (names of who replied or was researched, counts of the rest) and how many contacts with an email never got one. No addresses. A figure that fails is null; the others still arrive.
 */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const own = (table: string) => auth.supabase.from(table).select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
    const opportunities = await canUseOpportunities(getSupabaseAdminClient(), auth.user, auth.organizationId);
    const [contacts, withEmail, campaigns, linkedin, context, since, toWrite] = await Promise.allSettled([
      own('leads'),
      own('leads').not('email', 'is', null).neq('email', ''),
      own('bulk_campaigns'),
      // LinkedIn jobs are not readable through a session (only the worker's role): the same two
      // counts Cowork's linkedin.quota reads, scoped to you. Only the numbers leave the server.
      Promise.resolve().then(() => readCoworkLinkedinQuota(getSupabaseAdminClient(), scope)),
      loadCoworkUserContext(auth.supabase, scope, { memories: false }),
      // «Desde tu última visita»: replies, research and opportunities through your session; LinkedIn as the quota above.
      loadCoworkSinceLastVisit({ client: auth.supabase, admin: getSupabaseAdminClient, opportunities }, scope),
      // «Para hoy»: who has an email and never got one.
      contactsToWrite(auth.supabase, scope),
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
      since: since.status === 'fulfilled' ? since.value : null,
      toWrite: toWrite.status === 'fulfilled' ? toWrite.value : null,
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
