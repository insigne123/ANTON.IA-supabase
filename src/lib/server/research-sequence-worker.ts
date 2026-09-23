import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { researchSequenceSteps } from '@/lib/outreach-sequence-brief';
import { ResearchSequenceRequestSchema, ResearchSequenceViewSchema } from '@/lib/research-sequence-contracts';
import { createNativeDraft, getCurrentNativeDraft, prepareNativeSequenceBrief } from './native-drafts';
import type { createFirstContactPlan, queryFirstContactPlan } from './campaigns-v2/plan';
import type { pregenerateFirstContactPlanDrafts } from './campaigns-v2/follow-up-drafts';
import type { isCampaignsV2Enabled } from './campaigns-v2/feature-access';
import { validateResearchSequence, RESEARCH_SEQUENCE_EDITORIAL_PROMPT_VERSION } from './research-sequence-editorial';
import { persistResearchGenerationAttempt } from './research-generation-attempts';
import { getSupabaseAdminClient } from './supabase-admin';

const TABLE = 'research_sequence_preparations';
const LEASE_MS = 15 * 60_000;
type Client = ReturnType<typeof getSupabaseAdminClient>;
type Access = { organizationId: string; userId: string };

async function campaignsEnabled(...args: Parameters<typeof isCampaignsV2Enabled>) {
  return (await import('./campaigns-v2/feature-access')).isCampaignsV2Enabled(...args);
}

export async function enqueueResearchSequence(access: Access, raw: unknown, client: Client = getSupabaseAdminClient(), enabled: typeof isCampaignsV2Enabled = campaignsEnabled) {
  const request = ResearchSequenceRequestSchema.parse(raw);
  if (!await enabled(access.organizationId, client)) throw new Error('CAMPAIGNS_V2_DISABLED');
  const requestKey = canonicalSha256({ version: 'research-sequence/v1', ...request });
  const { error } = await client.from(TABLE).upsert({
    organization_id: access.organizationId, user_id: access.userId,
    research_snapshot_id: request.researchSnapshotId, request_key: requestKey, request,
  }, { onConflict: 'organization_id,user_id,request_key', ignoreDuplicates: true });
  if (error) throw error;
  const result = await client.from(TABLE).select('id').eq('organization_id', access.organizationId).eq('user_id', access.userId).eq('request_key', requestKey).single();
  if (result.error) throw result.error;
  return result.data.id as string;
}

export async function readResearchSequence(id: string, userId: string, organizationIds: string[], client: Client = getSupabaseAdminClient()) {
  const result = await client.from(TABLE).select('*').eq('id', id).eq('user_id', userId).in('organization_id', organizationIds).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function researchSequenceView(job: any, dependencies: Pick<SequenceWorkerDependencies, 'getDraft' | 'queryPlan'> = {}) {
  const access = { organizationId: job.organization_id, userId: job.user_id };
  const request = ResearchSequenceRequestSchema.safeParse(job.request);
  const steps = researchSequenceSteps(
    request.success ? request.data.followUpCount : 3,
    request.success ? request.data.offsets : [],
  );
  const initial = job.initial_draft_id ? await (dependencies.getDraft || getCurrentNativeDraft)({ ...access, draftId: job.initial_draft_id }) : null;
  const plan = initial && steps.length ? await (dependencies.queryPlan || (await import('./campaigns-v2/plan')).queryFirstContactPlan)({ ...access, draftId: initial.draftId }) : null;
  const summaries = [initial ? { draftId: initial.draftId, versionId: initial.versionId, subject: initial.content.subject || '', body: initial.content.text || initial.content.html || '' } : null, ...steps.map((_, index) => plan?.steps[index]?.draft || null)];
  const pending = summaries.findIndex((draft) => !draft);
  // A completed review only covers these exact versions. Editing never silently
  // inherits an editorial pass from older copy.
  const changed = job.editorial?.versionIds?.some((id: string, index: number) => id !== summaries[index]?.versionId);
  return ResearchSequenceViewSchema.parse({
    id: job.id, status: changed && ['completed', 'review_required'].includes(job.status) ? 'review_required' : job.status,
    stage: job.stage, error: job.last_error || null,
    retryAt: job.status === 'retry_scheduled' ? job.next_retry_at : null,
    researchSnapshotId: request.success ? request.data.researchSnapshotId : null,
    styleProfileId: request.success ? request.data.styleProfileId : null,
    followUpCount: steps.length,
    offsets: steps.map((step) => step.offsetDays),
    editorial: changed ? null : job.editorial,
    slots: ['Contacto inicial', ...steps.map((step) => step.name)].map((name, index) => ({
      index, name,
      status: summaries[index] ? 'ready' : index === pending && job.status === 'running' ? 'running' : index === pending && job.status === 'failed' ? 'error' : 'queued',
      draftId: summaries[index]?.draftId || null, versionId: summaries[index]?.versionId || null,
      subject: summaries[index]?.subject || null, body: summaries[index]?.body || null,
    })),
  });
}

export async function retryResearchSequence(job: any, client: Client = getSupabaseAdminClient()) {
  if (!['failed', 'review_required', 'completed'].includes(job.status)) return;
  const result = await client.from(TABLE).update({ status: 'queued', stage: job.stage === 'done' ? 'editorial' : job.stage, attempt_count: 0, last_error: null, editorial: null, next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('user_id', job.user_id).eq('organization_id', job.organization_id).eq('status', job.status).eq('updated_at', job.updated_at);
  if (result.error) throw result.error;
}

export type SequenceWorkerDependencies = {
  client?: Client;
  prepareBrief?: typeof prepareNativeSequenceBrief;
  createDraft?: typeof createNativeDraft;
  createPlan?: typeof createFirstContactPlan;
  queryPlan?: typeof queryFirstContactPlan;
  generateFollowUps?: typeof pregenerateFirstContactPlanDrafts;
  getDraft?: typeof getCurrentNativeDraft;
  review?: typeof validateResearchSequence;
  recordResearchAttempt?: typeof persistResearchGenerationAttempt;
  enabled?: typeof isCampaignsV2Enabled;
};

// One persisted stage / one missing email per invocation. Existing native draft
// claims + deterministic reservations protect retries across the provider boundary.
export async function processResearchSequenceQueue(input: { jobId?: string } = {}, dependencies: SequenceWorkerDependencies = {}) {
  const client = dependencies.client || getSupabaseAdminClient();
  const now = new Date();
  let query = client.from(TABLE).select('*')
    .or(`and(status.in.(queued,retry_scheduled),next_retry_at.lte.${now.toISOString()}),and(status.eq.running,heartbeat_at.lt.${new Date(now.getTime() - LEASE_MS).toISOString()})`)
    .order('next_retry_at', { ascending: true }).limit(1);
  if (input.jobId) query = query.eq('id', input.jobId);
  const candidates = await query;
  if (candidates.error) throw candidates.error;
  const candidate = candidates.data?.[0];
  if (!candidate) return { processed: 0 };
  const token = randomUUID();
  let claimQuery = client.from(TABLE).update({ status: 'running', attempt_count: Math.min(4, Number(candidate.attempt_count) + 1), claim_token: token, heartbeat_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', candidate.id).eq('status', candidate.status).eq('updated_at', candidate.updated_at);
  if (candidate.status === 'running') claimQuery = claimQuery.eq('heartbeat_at', candidate.heartbeat_at);
  const claim = await claimQuery.select('*').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return { processed: 0 };
  const job = claim.data;
  const access = { organizationId: job.organization_id, userId: job.user_id };
  const save = async (patch: Record<string, unknown>) => {
    const result = await client.from(TABLE).update({ ...patch, claim_token: null, heartbeat_at: null, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('claim_token', token).eq('status', 'running').select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('SEQUENCE_LEASE_LOST');
  };
  const heartbeat = setInterval(() => {
    void Promise.resolve(client.from(TABLE).update({ heartbeat_at: new Date().toISOString() }).eq('id', job.id).eq('claim_token', token).eq('status', 'running'))
      .then(({ error }) => { if (error) console.error('[sequence-worker] heartbeat failed', { jobId: job.id }); })
      .catch(() => console.error('[sequence-worker] heartbeat failed', { jobId: job.id }));
  }, 30_000);
  const queued = { status: 'queued', attempt_count: 0, last_error: null, next_retry_at: new Date().toISOString() };
  try {
    if (candidate.status === 'running' && Number(candidate.attempt_count) >= 4) throw new Error('La preparación se interrumpió varias veces. Reintenta los correos pendientes.');
    if (!await (dependencies.enabled || campaignsEnabled)(access.organizationId, client)) throw new Error('CAMPAIGNS_V2_DISABLED');
    const request = ResearchSequenceRequestSchema.parse(job.request);
    const steps = researchSequenceSteps(request.followUpCount, request.offsets);
    const finishEditorial = async (drafts: Awaited<ReturnType<typeof getCurrentNativeDraft>>[]) => {
      const editorial = await (dependencies.review || validateResearchSequence)(job.prepared_context.brief, drafts.filter((draft): draft is NonNullable<typeof draft> => Boolean(draft)));
      if (editorial.usage) {
        await (dependencies.recordResearchAttempt || persistResearchGenerationAttempt)({
          organizationId: access.organizationId, userId: access.userId, researchSnapshotId: request.researchSnapshotId,
          stage: 'sequence_editorial', model: editorial.model, promptVersion: RESEARCH_SEQUENCE_EDITORIAL_PROMPT_VERSION,
          inputTokens: editorial.usage.inputTokens, outputTokens: editorial.usage.outputTokens,
          reasoningTokens: editorial.usage.reasoningTokens, passed: editorial.passed,
        });
      }
      await save({ status: editorial.passed ? 'completed' : 'review_required', stage: 'done', editorial, attempt_count: 0, last_error: null });
    };
    if (!job.prepared_context) {
      const prepared = await (dependencies.prepareBrief || prepareNativeSequenceBrief)({ ...access, snapshotId: request.researchSnapshotId, styleProfileId: request.styleProfileId, followUpCount: request.followUpCount });
      await save({ ...queued, prepared_context: prepared, stage: 'initial' });
    } else if (!job.initial_draft_id) {
      const result = await (dependencies.createDraft || createNativeDraft)({ ...access, snapshotId: request.researchSnapshotId,
        styleProfileId: request.styleProfileId, userInstruction: request.instruction,
        idempotencyKey: `research-sequence:${job.id}:initial`, sharedSequenceBrief: job.prepared_context.brief,
        sellerProfile: job.prepared_context.seller, writingStyle: job.prepared_context.writingStyle,
      });
      if (result.status !== 'drafted') throw new Error(result.message);
      await save({ ...queued, initial_draft_id: result.draft.draftId, stage: steps.length ? 'follow_ups' : 'editorial' });
    } else {
      const initial = await (dependencies.getDraft || getCurrentNativeDraft)({ ...access, draftId: job.initial_draft_id });
      if (!initial) throw new Error('NATIVE_DRAFT_NOT_FOUND');
      if (steps.length === 0) {
        await finishEditorial([initial]);
        return { processed: 1 };
      }
      const { plan } = await (dependencies.createPlan || (await import('./campaigns-v2/plan')).createFirstContactPlan)({ ...access, client, deferGeneration: true, body: {
        draftId: initial.draftId, versionId: initial.versionId, styleProfileId: request.styleProfileId,
        sequenceInstruction: request.instruction || 'Conserva el tema del brief compartido y haz avanzar la conversación sin repetir los correos.',
        steps,
      } });
      if (plan.steps.length !== steps.length || plan.autoSend || plan.lifecycleState !== 'draft') throw new Error('La secuencia cambió. Revisa su plan antes de continuar.');
      const missing = plan.steps.find((step) => !step.draft);
      if (missing) {
        await (dependencies.generateFollowUps || (await import('./campaigns-v2/follow-up-drafts')).pregenerateFirstContactPlanDrafts)({ ...access, draftId: initial.draftId, client, maxDrafts: 1,
          sharedSequenceBrief: job.prepared_context.brief, sellerProfile: job.prepared_context.seller, writingStyle: job.prepared_context.writingStyle,
        });
        const refreshed = await (dependencies.queryPlan || (await import('./campaigns-v2/plan')).queryFirstContactPlan)({ ...access, draftId: initial.draftId, client });
        if (!refreshed?.steps.find((step) => step.id === missing.id)?.draft) throw new Error(refreshed?.steps.find((step) => step.id === missing.id)?.draftGeneration.error || 'No se pudo preparar este correo.');
        await save({ ...queued, stage: refreshed.steps.every((step) => step.draft) ? 'editorial' : 'follow_ups' });
      } else {
        const drafts = [initial];
        for (const step of plan.steps) {
          const draft = await (dependencies.getDraft || getCurrentNativeDraft)({ ...access, draftId: step.nativeDraftId! });
          if (!draft) throw new Error('NATIVE_DRAFT_NOT_FOUND');
          drafts.push(draft);
        }
        await finishEditorial(drafts);
      }
    }
    return { processed: 1 };
  } catch (error) {
    const attempt = Number(job.attempt_count);
    await save({ status: attempt >= 4 ? 'failed' : 'retry_scheduled', attempt_count: attempt,
      last_error: error instanceof Error ? error.message.slice(0, 2_000) : 'No se pudo preparar la secuencia.',
      next_retry_at: new Date(Date.now() + Math.min(20, 2 ** attempt) * 60_000).toISOString(),
    });
    console.error('[sequence-worker] stage failed', { jobId: job.id, stage: job.stage, attempt });
    return { processed: 1, failed: 1 };
  } finally { clearInterval(heartbeat); }
}
