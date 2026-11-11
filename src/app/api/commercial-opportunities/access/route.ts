import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesUser } from '@/lib/server/commercial-opportunities/access';
import { isOpportunityAdmin, opportunityWorkspaceEnabled } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

/**
 * The menu asks here whether to show «Oportunidades». Any other account gets `available: false` (the page and the data routes
 * answer 404), so the menu of every person does not log an error.
 */
export async function GET() {
  try {
    const auth = await requireOpportunitiesUser();
    // `ticket`: whether this person keeps a Mercado Público ticket. With the workspace on, only who manages «Oportunidades»
    // does; «Conexiones» reads it here so a member is never shown a card whose request would answer 403.
    return opportunitiesJson({ available: true, ticket: !opportunityWorkspaceEnabled() || isOpportunityAdmin(auth.organizationRole) });
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) return opportunitiesJson({ available: false });
    return opportunitiesError(error);
  }
}
