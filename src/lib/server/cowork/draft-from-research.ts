import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getCoworkRun } from './runs';
import { createNativeDraft } from '@/lib/server/native-drafts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';

export const coworkDraftRequestSchema = z.object({ snapshotId: z.string().uuid() }).strict();

export function coworkDraftIdempotencyKey(runId: string, snapshotId: string) {
  return `cowork:${runId}:snapshot:${snapshotId}:initial-draft-v1`;
}

async function validateObservedDraftTarget(auth: AuthContext, runId: string, snapshotId: string) {
  const state = await getCoworkRun(auth, runId);
  if (!state || state.run.status !== 'completed') throw new Error('COWORK_RESULT_UNAVAILABLE');
  const observed = state.events.some((event: { kind: string; payload: Record<string, any> }) =>
    event.kind === 'tool.completed' && event.payload.action === 'research.get_existing'
    && event.payload.result?.availability === 'available' && event.payload.result?.research?.snapshotId === snapshotId);
  if (!observed) throw new Error('COWORK_RESEARCH_NOT_OBSERVED');
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const row = await auth.supabase.from('research_snapshots').select('payload').eq('id', snapshotId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('COWORK_RESULT_UNAVAILABLE');
  const snapshot = ResearchSnapshotV1Schema.parse(row.data.payload);
  if (snapshot.id !== snapshotId || snapshot.scope.ownerUserId !== scope.userId
    || snapshot.scope.organizationId !== scope.organizationId || !snapshot.subject.leadId) throw new Error('COWORK_RESULT_UNAVAILABLE');
  const lead = await auth.supabase.from('leads').select('id').eq('id', snapshot.subject.leadId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (lead.error || !lead.data) throw new Error('COWORK_RESULT_UNAVAILABLE');
  return { scope, snapshot };
}

/** Enqueue only. Generation happens in the scheduled worker so the tab can close. */
export async function requestCoworkDraft(auth: AuthContext, runId: string, body: unknown) {
  if (process.env.COWORK_NATIVE_DRAFTS_ENABLED !== 'true') throw new Error('COWORK_DRAFTS_DISABLED');
  const { snapshotId } = coworkDraftRequestSchema.parse(body);
  await validateObservedDraftTarget(auth, runId, snapshotId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const requested = await client.rpc('cowork_request_draft', {
    p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId, p_snapshot_id: snapshotId,
  });
  if (requested.error) throw requested.error;
  if (!requested.data) throw new Error('COWORK_DRAFT_NOT_QUEUED');
  return requested.data as { status: string; reused: boolean };
}

export async function getCoworkDraftStatus(auth: AuthContext, runId: string, snapshotId: string) {
  z.string().uuid().parse(snapshotId);
  const row = await auth.supabase.from('cowork_draft_requests')
    .select('status,draft_id,updated_at').eq('run_id', runId).eq('snapshot_id', snapshotId)
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return { status: 'none' as const };
  if (row.data.status !== 'completed') return { status: row.data.status as 'pending' | 'executing' | 'failed' };
  const state = await getCoworkRun(auth, runId);
  const completed = state?.events.slice().reverse().find((event: { kind: string; payload: Record<string, any> }) =>
    event.kind === 'draft.completed' && event.payload.snapshotId === snapshotId)?.payload;
  if (!completed) return { status: 'completed' as const, draft: null };
  return {
    status: 'completed' as const,
    draft: {
      id: String(completed.draftId || row.data.draft_id || ''),
      subject: typeof completed.subject === 'string' ? completed.subject : null,
      text: typeof completed.text === 'string' ? completed.text : null,
    },
  };
}

/** Only the scheduled worker generates drafts. Retries reuse the native idempotency key. */
export async function processCoworkDraftQueue() {
  if (process.env.COWORK_ENABLED !== 'true' || process.env.COWORK_NATIVE_DRAFTS_ENABLED !== 'true') {
    return { processed: 0, claimed: false };
  }
  const client = getSupabaseAdminClient();
  const taken = await client.rpc('cowork_take_draft', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (taken.error) throw taken.error;
  const job = taken.data?.[0];
  if (!job) return { processed: 0, claimed: false };
  const scope = { userId: job.user_id, organizationId: job.organization_id };
  const finish = (success: boolean, fields: { draftId?: string; subject?: string | null; text?: string | null; error?: string }) =>
    client.rpc('cowork_finish_draft', {
      p_run_id: job.run_id, p_snapshot_id: job.snapshot_id,
      p_user_id: scope.userId, p_organization_id: scope.organizationId,
      p_success: success, p_draft_id: fields.draftId || null,
      p_subject: fields.subject ?? null, p_text: fields.text ?? null, p_error: fields.error || null,
    });
  try {
    await requireCoworkWorkerAccess(client, scope);
    const snapshotRow = await client.from('research_snapshots').select('payload').eq('id', job.snapshot_id)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (snapshotRow.error || !snapshotRow.data) throw new Error('COWORK_RESULT_UNAVAILABLE');
    const snapshot = ResearchSnapshotV1Schema.parse(snapshotRow.data.payload);
    if (snapshot.id !== job.snapshot_id || snapshot.scope.ownerUserId !== scope.userId
      || snapshot.scope.organizationId !== scope.organizationId || !snapshot.subject.leadId) {
      throw new Error('COWORK_RESULT_UNAVAILABLE');
    }
    const lead = await client.from('leads').select('id').eq('id', snapshot.subject.leadId)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (lead.error || !lead.data) throw new Error('COWORK_RESULT_UNAVAILABLE');
    await requireCoworkWorkerAccess(client, scope);
    const current = await client.from('cowork_runs').select('status').eq('id', job.run_id).single();
    if (current.error || current.data.status === 'cancelled') throw new Error('Draft cancelled');
    const result = await createNativeDraft({
      ...scope, snapshotId: job.snapshot_id,
      idempotencyKey: coworkDraftIdempotencyKey(job.run_id, job.snapshot_id),
    });
    await requireCoworkWorkerAccess(client, scope);
    if (result.status !== 'drafted') {
      const failed = await finish(false, { error: result.message || 'No se pudo preparar el borrador.' });
      if (failed.error) throw failed.error;
      return { processed: 0, claimed: true };
    }
    const finished = await finish(true, {
      draftId: result.draft.draftId,
      subject: result.draft.content.subject,
      text: result.draft.content.text,
    });
    if (finished.error) throw finished.error;
    return { processed: finished.data === true ? 1 : 0, claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo preparar el borrador.';
    if (message === 'Draft cancelled' || message === 'COWORK_RESULT_UNAVAILABLE') {
      const failed = await finish(false, { error: 'No se pudo preparar el borrador. La investigación ya no está disponible.' });
      if (failed.error) throw failed.error;
      return { processed: 0, claimed: true };
    }
    // Unexpected crash (timeout, provider 500): leave executing so the next tick
    // requeues it (native generation is idempotent via the stable key).
    // Only the stale-execution path marks it failed after repeated attempts.
    return { processed: 0, claimed: true };
  }
}
