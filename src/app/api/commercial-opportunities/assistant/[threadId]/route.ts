import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { readAssistantThread } from '@/lib/server/commercial-opportunities/workspace-assistant';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const auth = await requireOpportunityWorkspace(); const threadId = z.string().uuid().parse((await context.params).threadId);
    return opportunitiesJson(await readAssistantThread(auth.admin, opportunityScope(auth), threadId));
  } catch (error) { return opportunitiesError(error); }
}
