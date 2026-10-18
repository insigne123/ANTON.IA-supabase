import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { askOpportunityAssistant, deleteAssistantThread, readOpportunityAssistant } from '@/lib/server/commercial-opportunities/workspace-assistant';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** «Asistente»: the person's conversations about the section and the opportunities where they talked with its chat. */
export async function GET() {
  try {
    const auth = await requireOpportunityWorkspace();
    return opportunitiesJson(await readOpportunityAssistant(auth.admin, opportunityScope(auth)));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('ask'), question: z.string().trim().min(2).max(2000), requestId: z.string().uuid(), threadId: z.string().uuid().nullable().optional() }).strict(),
      z.object({ action: z.literal('delete'), threadId: z.string().uuid() }).strict(),
    ]).parse(await request.json());
    if (body.action === 'delete') { await deleteAssistantThread(auth.admin, scope, body.threadId); return opportunitiesJson({ deleted: true }); }
    const { threadId, key } = await askOpportunityAssistant(auth.admin, scope, body);
    // Answered now, as a conversation; if a worker took it first (or this fails), the page waits for that answer.
    const done = await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'assistant').catch(() => null);
    const answered = done?.processed === 1 && done.state === 'ready';
    return opportunitiesJson({ threadId, requestId: body.requestId, answered, state: done?.state ?? 'queued' }, answered ? 200 : 202);
  } catch (error) { return opportunitiesError(error); }
}
