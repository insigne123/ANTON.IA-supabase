import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const messages = opportunityDb(await auth.admin.from('opportunity_chat_messages').select('id,question,answer,report_id,created_at')
      .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('user_id', scope.userId).order('created_at').limit(100));
    return opportunitiesJson({ messages });
  } catch (error) { return opportunitiesError(error); }
}
