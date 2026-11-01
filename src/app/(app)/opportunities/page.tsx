import { notFound, redirect } from 'next/navigation';
import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesUser } from '@/lib/server/commercial-opportunities/access';
import { OpportunityWorkWorkspace } from '@/components/commercial-opportunities/OpportunityWorkWorkspace';

export const dynamic = 'force-dynamic';

/**
 * «Oportunidades» (plan 8, phase 3): only the accounts in OPPORTUNITIES_ALLOWED_EMAILS; any other gets a 404. The screen from before
 * the workspace (OpportunitiesWorkspace, shown only without OPPORTUNITIES_WORKSPACE_ENABLED, which production has on since 13 Oct) was
 * retired in the audit of 1 Nov 2026 (K2).
 */
export default async function OpportunitiesPage() {
  try {
    const auth = await requireOpportunitiesUser();
    return <OpportunityWorkWorkspace key={`${auth.user.id}:${auth.organizationId}`} />;
  } catch (error) {
    // A session that ended (revoked or expired) signs in again and comes back; any other refusal is a page that does not exist.
    if (error instanceof AuthError) { if (error.status === 401) redirect('/login?next=%2Fopportunities'); notFound(); }
    throw error;
  }
}
