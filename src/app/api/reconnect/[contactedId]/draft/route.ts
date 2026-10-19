import { NextResponse } from 'next/server';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { createNativeDraft } from '@/lib/server/native-drafts';
import { listNativeResearchLeadStatuses } from '@/lib/server/native-research';
import { prepareReconnectDraft, ReconnectError } from '@/lib/server/reconnect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The writer and its review take their time, as in «Redactar».
export const maxDuration = 120;

type Context = { params: Promise<{ contactedId: string }> };

/** «Retomar»: prepares a new email for this conversation and returns the draft to open in «Redactar». Sends nothing. */
export async function POST(_req: Request, context: Context) {
  try {
    const auth = await requireAuth();
    const { contactedId } = await context.params;
    if (!contactedId || contactedId.length > 200) throw new AuthError('Conversación no válida.', 400);
    const result = await prepareReconnectDraft(getSupabaseAdminClient(), { organizationId: auth.organizationId, userId: auth.user.id }, contactedId, {
      findSnapshot: async (scope, leadId) => {
        const statuses = await listNativeResearchLeadStatuses({ leadIds: [leadId], access: { ...scope, organizationIds: auth.organizationIds } });
        return statuses.find(status => status.status === 'completed' && status.researchSnapshotId)?.researchSnapshotId
          || statuses.find(status => status.researchSnapshotId)?.researchSnapshotId || null;
      },
      createDraft: async (input) => {
        const result: any = await createNativeDraft(input);
        return { status: result.status, draft: result.draft ? { draftId: result.draft.draftId } : undefined, message: result.message };
      },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleAuthError(error instanceof ReconnectError ? new AuthError(error.message, error.status) : error);
  }
}
