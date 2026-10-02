import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesUser } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

/**
 * The menu asks here whether to show «Oportunidades». Any other account gets `available: false` (the page and the data routes
 * answer 404), so the menu of every person does not log an error.
 */
export async function GET() {
  try {
    await requireOpportunitiesUser();
    return opportunitiesJson({ available: true });
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) return opportunitiesJson({ available: false });
    return opportunitiesError(error);
  }
}
