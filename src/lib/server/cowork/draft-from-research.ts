import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getCoworkRun } from './runs';
import { createNativeDraft, getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';

export const coworkDraftRequestSchema = z.object({ snapshotId: z.string().uuid() }).strict();

export function coworkDraftIdempotencyKey(runId: string, snapshotId: string) {
  return `cowork:${runId}:snapshot:${snapshotId}:initial-draft-v1`;
}

async function validateObservedDraftTarget(auth: AuthContext, runId: string, snapshotId: string) {
  const state = await getCoworkRun(auth, runId);
  // Effects execute while the proposing run waits for approval; snapshot scope
  // and observation checks below remain the real guards.
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) throw new Error('COWORK_RESULT_UNAVAILABLE');
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
  if (row.data.status === 'failed') {
    const state = await getCoworkRun(auth, runId);
    const event = state?.events.slice().reverse().find((event: { kind: string; payload: Record<string, any> }) =>
      event.kind === 'draft.failed' && event.payload.snapshotId === snapshotId);
    return { status: 'failed' as const, message: typeof event?.payload.message === 'string' ? event.payload.message : null,
      uncertain: event?.payload.reason === 'draft_outcome_unknown' };
  }
  if (row.data.status !== 'completed') return { status: row.data.status as 'pending' | 'executing' };
  if (!row.data.draft_id) return { status: 'completed' as const, draft: null };
  const current = await getCurrentNativeDraft({
    organizationId: auth.organizationId, userId: auth.user.id, draftId: row.data.draft_id,
  });
  if (!current) return { status: 'completed' as const, draft: null };
  return {
    status: 'completed' as const,
    draft: {
      id: current.draftId,
      versionId: current.versionId,
      subject: current.content.subject,
      text: current.content.text,
    },
  };
}

/** Only the scheduled worker generates drafts. Uncertain outcomes are not replayed automatically. */
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
      p_attempt: job.attempts,
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
    const attempt = await client.from('cowork_draft_requests').select('status,attempts')
      .eq('run_id', job.run_id).eq('snapshot_id', job.snapshot_id).single();
    if (attempt.error || attempt.data.status !== 'executing' || attempt.data.attempts !== job.attempts) {
      return { processed: 0, claimed: true };
    }
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
    // Leave uncertain execution for the stale path; do not automatically generate
    // again because native identity also depends on mutable seller/style data.
    return { processed: 0, claimed: true };
  }
}
