import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { enqueueTenderProfileSuggestion, readTenderProfileSuggestion, readTenderProfileView, reconsiderWithTenderProfile, saveTenderProfile } from '@/lib/server/commercial-opportunities/workspace-tender-profile';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** «Ficha para licitaciones»: what the company is and can do when it bids. Admins only. */
export async function GET() {
  try {
    const auth = await requireOpportunityWorkspace();
    return opportunitiesJson(await readTenderProfileView(auth.admin, opportunityScope(auth)));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('save'), profile: z.unknown(), expectedRevision: z.number().int().min(0) }).strict(),
      z.object({ action: z.literal('suggest'), requestId: z.string().uuid() }).strict(),
      z.object({ action: z.literal('reconsider') }).strict(),
    ]).parse(await request.json());
    if (body.action === 'save') return opportunitiesJson(await saveTenderProfile(auth.admin, scope, { profile: body.profile, expectedRevision: body.expectedRevision }));
    if (body.action === 'reconsider') return opportunitiesJson({ queued: await reconsiderWithTenderProfile(auth.admin, scope) }, 202);
    const key = await enqueueTenderProfileSuggestion(auth.admin, scope, body.requestId);
    // Read now, while the person waits; a worker that took it first leaves the page to ask again.
    await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'profile').catch(() => null);
    const done = await readTenderProfileSuggestion(auth.admin, scope.organizationId, key);
    return opportunitiesJson(done ?? { state: 'queued', error: null, suggestion: null }, done?.state === 'ready' ? 200 : 202);
  } catch (error) { return opportunitiesError(error); }
}
