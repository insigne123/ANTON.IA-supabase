import NextDynamic from 'next/dynamic';
import { notFound, redirect } from 'next/navigation';
import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesUser } from '@/lib/server/commercial-opportunities/access';
import { OpportunityWorkWorkspace } from '@/components/commercial-opportunities/OpportunityWorkWorkspace';
import { opportunityWorkspaceEnabled } from '@/lib/commercial-opportunities/workspace';

// The screen from before the workspace shows only without OPPORTUNITIES_WORKSPACE_ENABLED (on in production since 13 Oct): it
// loads on its own, so it does not travel in the code of everyone who opens Oportunidades (OPP-38).
const OpportunitiesWorkspace = NextDynamic(() => import('@/components/commercial-opportunities/OpportunitiesWorkspace').then(module => module.OpportunitiesWorkspace));

export const dynamic = 'force-dynamic';

/** «Oportunidades» (plan 8, phase 3): only the accounts in OPPORTUNITIES_ALLOWED_EMAILS; any other gets a 404. */
export default async function OpportunitiesPage() {
  try {
    const auth = await requireOpportunitiesUser();
    return opportunityWorkspaceEnabled() ? <OpportunityWorkWorkspace key={`${auth.user.id}:${auth.organizationId}`} /> : <OpportunitiesWorkspace key={`${auth.user.id}:${auth.organizationId}`} />;
  } catch (error) {
    // A session that ended (revoked or expired) signs in again and comes back; any other refusal is a page that does not exist.
    if (error instanceof AuthError) { if (error.status === 401) redirect('/login?next=%2Fopportunities'); notFound(); }
    throw error;
  }
}
