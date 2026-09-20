import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { coworkDecisionSchema, runCoworkReadLoop } from '@/lib/cowork/agent-loop';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { coworkWorkerConfigured } from './runs';
import { loadCoworkHistory } from './conversation-context';
import { processCoworkSearchQueue } from './external-search';
import { processCoworkDraftQueue } from './draft-from-research';
import { coworkExecutionPolicy } from '@/lib/cowork/execution-policy';
import { coworkThreadBudgets } from '@/lib/cowork/thread-budget';
import { loadCoworkThreadStats } from './thread-stats';
import { getDailyQuotaStatus, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { coworkOperationHash, createCoworkOperationGateway } from './operations';
import { coworkReadCapabilities } from './read-capabilities';
import { processCoworkEffectQueue, resolveCoworkEffect } from './effects';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { stageCoworkCampaignDefinition } from './campaign-ops';
import { stageCoworkCode } from './code-runner';
import { hashCoworkCodeProposal } from '@/lib/cowork/code-proposal';
import { getBulkCampaign } from '@/lib/server/bulk-campaigns';
import { resolveCoworkSender } from './sender';
import { coworkAgentInstructions } from '@/lib/cowork/agent-instructions';

/** Fase 1 (CW-06): fairness signal. When a queue item was served in the previous
 * tick, a waiting conversation run goes first so queues can never starve replies.
 * Fail-open to the historical order when the signal is unreadable. */
async function servedQueueRecently(
  client: ReturnType<typeof getSupabaseAdminClient>,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 150000).toISOString();
    const checks = await Promise.all([
      client.from('cowork_search_proposals').select('run_id').eq('status', 'executing').gt('started_at', since).limit(1),
      client.from('cowork_effect_proposals').select('run_id').eq('status', 'executing').gt('updated_at', since).limit(1),
      client.from('cowork_draft_requests').select('run_id').eq('status', 'executing').gt('started_at', since).limit(1),
    ]);
    return checks.some(check => !check.error && (check.data || []).length > 0);
  } catch {
    return false;
  }
}

/** Read-only worker: bounded app queries and drafting; no implicit mutations. */
export async function processCoworkQueue() {
  if (process.env.COWORK_ENABLED !== 'true' || !coworkWorkerConfigured()) return { processed: 0 };
  const client = getSupabaseAdminClient();
  if (await servedQueueRecently(client)) {
    const conversation = await processCoworkConversationRun();
    if (conversation.claimed) return { processed: conversation.processed };
  }
  // Owner-approved effects first: they carry an explicit grant and unblock threads.
  const effect = await processCoworkEffectQueue();
  if (effect.claimed) return { processed: effect.processed };
  const draft = await processCoworkDraftQueue();
  if (draft.claimed) return { processed: draft.processed };
  const search = await processCoworkSearchQueue();
  if (search.claimed) return { processed: search.processed };
  const conversation = await processCoworkConversationRun();
  return { processed: conversation.processed };
}

async function processCoworkConversationRun(): Promise<{ claimed: boolean; processed: number }> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc('cowork_claim_run', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (error) throw error;
  const run = data?.[0];
  if (!run) return { claimed: false, processed: 0 };
  const scope = { userId: run.user_id, organizationId: run.organization_id };
  const controller = new AbortController();
  // Leave time for the terminal write before the route's 120-second deadline.
  const deadline = setTimeout(() => controller.abort(), 105000);
  const authorize = async () => {
    controller.signal.throwIfAborted();
    await requireCoworkWorkerAccess(client, scope);
    const current = await client.from('cowork_runs').select('status,lease_token').eq('id', run.id).single();
    if (current.error || current.data.status !== 'running' || current.data.lease_token !== run.lease_token) {
      controller.abort();
      controller.signal.throwIfAborted();
    }
  };
  let checking = false;
  const interval = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await requireCoworkWorkerAccess(client, scope);
      const current = await client.from('cowork_runs').select('status,lease_token').eq('id', run.id).single();
      if (current.error || current.data.status !== 'running' || current.data.lease_token !== run.lease_token) controller.abort();
    } catch { controller.abort(); }
    finally { checking = false; }
  }, 3000);
  try {
    const telemetry: Array<{ model: string; durationMs: number }> = [];
    await authorize();
    const history = await loadCoworkHistory(client, scope, run.parent_run_id || null);
    let waitingApproval = false;
    const autonomyEnabled = process.env.COWORK_AUTONOMY_ENABLED === 'true';
    const executionPolicy = coworkExecutionPolicy(run.mode, autonomyEnabled);
    // Fase 1 (CW-06): thread budgets bound automatic chains. A single proposal
    // per run keeps these counts accurate for the whole conversational turn.
    const budgets = coworkThreadBudgets(run.mode, autonomyEnabled);
    const stats = await loadCoworkThreadStats(client, scope, run.id);
    const limits = await getEffectiveDailyQuotaLimits({ userId: scope.userId, organizationId: scope.organizationId });
    const searchQuota = await getDailyQuotaStatus({
      userId: scope.userId, organizationId: scope.organizationId, resource: 'search', limit: limits.leadSearch,
    });
    const remainingSearches = Math.max(0, (searchQuota.limit || 0) - (searchQuota.count || 0));
    // Reads run through the durable ledger: an identical query replays its
    // stored result instead of hitting the database again after a retry.
    const readGateway = createCoworkOperationGateway(client, coworkReadCapabilities(client, scope));
    const operationScope = { userId: scope.userId, organizationId: scope.organizationId, runId: run.id };
    const instructions = coworkAgentInstructions({
      externalSearch: process.env.COWORK_EXTERNAL_SEARCH_ENABLED === 'true',
      automaticExternalSearch: executionPolicy.automaticExternalSearch,
      threadBudget: `Hilo automático: paso ${stats.depth + 1} de ${budgets.maxDepth}. Efectos usados ${stats.effects}/${budgets.maxEffects}; búsquedas externas ${stats.searches}/${budgets.maxSearches}; borradores ${stats.drafts}/${budgets.maxDrafts}. Búsquedas disponibles hoy: ${remainingSearches}. Si este es el último paso, cierra con el resumen final sin proponer más efectos ni búsquedas.`,
    });
    const result = await runCoworkReadLoop({
      message: run.message, runId: run.id, history: history.turns, signal: controller.signal, authorize,
      decide: async (observations, mustAnswer) => {
        const turn = await generateStructuredWithTelemetry({
          schema: coworkDecisionSchema,
          systemPrompt: instructions.systemPrompt,
          prompt: JSON.stringify({ history, request: run.message, observations, mustAnswer, executionPolicy,
            parallelReadCapability: instructions.parallelReadCapability,
            researchCapability: instructions.researchCapability,
            externalSearchCapability: instructions.externalSearchCapability,
            extendedReadCapability: instructions.extendedReadCapability,
            additionalCapability: instructions.additionalCapability,
            effectCapability: instructions.effectCapability,
            threadBudgetCapability: instructions.threadBudgetCapability }),
          openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
          provider: 'openai',
          maxAttempts: 1, timeoutMs: 30000, maxOutputTokens: 6000,
          signal: controller.signal,
        });
        telemetry.push({ model: turn.telemetry.modelName, durationMs: turn.telemetry.durationMs });
        return turn.data;
      },
      execute: (action, value) => readGateway.invoke(operationScope, {
        capability: action, input: value,
        operationId: `cowork:${run.id}:${action}:${coworkOperationHash(value)}`,
      }, controller.signal),
      record: async observation => {
        const recorded = await client.rpc('cowork_record_tool_result', {
          p_run_id: run.id, p_token: run.lease_token, p_payload: observation,
        });
        if (recorded.error || recorded.data !== true) throw new Error('Cowork run is no longer writable');
      },
      proposeNote: async (leadId, note) => {
        const proposed = await client.rpc('cowork_propose_note', {
          p_run_id: run.id, p_token: run.lease_token, p_lead_id: leadId, p_note: note,
        });
        if (proposed.error || proposed.data !== true) throw new Error('Could not prepare note review');
        waitingApproval = true;
      },
      proposeSearch: async criteria => {
        if (process.env.COWORK_EXTERNAL_SEARCH_ENABLED !== 'true') throw new Error('External search disabled');
        if (stats.searches >= budgets.maxSearches) throw new Error('Thread search budget exhausted');
        if (!searchQuota.allowed) throw new Error('Daily search quota exhausted');
        const proposed = await client.rpc('cowork_propose_search', { p_run_id: run.id, p_token: run.lease_token, p_criteria: criteria });
        if (proposed.error || proposed.data !== true) throw new Error('Could not prepare search review');
        waitingApproval = true;
        // Persisted run.mode is user input accepted by admission, never model output.
        // Database primary key permits at most one search proposal per run.
        // The flag is re-read here so revoking autonomy mid-flight stops admission.
        if (executionPolicy.automaticExternalSearch && process.env.COWORK_AUTONOMY_ENABLED === 'true') {
          await requireCoworkWorkerAccess(client, scope);
          const admitted = await client.rpc('cowork_claim_search', {
            p_run_id: run.id, p_user_id: scope.userId, p_organization_id: scope.organizationId, p_approve: true,
          });
          if (admitted.error) throw admitted.error;
        }
      },
      proposeEffect: async proposal => {
        if (stats.effects >= budgets.maxEffects) throw new Error('Thread effect budget exhausted');
        // Version-bound review: the proposal pins draftId:versionId:contentHash
        // so execution refuses anything else, even if the draft changed since.
        let targetId = proposal.targetId;
        let label = proposal.label;
        if (proposal.kind === 'send_email') {
          const draft = await getCurrentNativeDraft({ userId: scope.userId, organizationId: scope.organizationId, draftId: proposal.targetId });
          if (!draft || draft.channel !== 'email') throw new Error('Send target unavailable');
          const sender = await resolveCoworkSender(scope);
          targetId = `${draft.draftId}:${draft.versionId}:${hashMessagingDraftContent(draft)}:${sender.provider}:${sender.identityHash}`;
          label = `Enviar «${(draft.content.subject || 'sin asunto').slice(0, 60)}» desde ${sender.email} (rev ${draft.revision})`.slice(0, 280);
        }
        if (proposal.kind === 'campaign_create') {
          if (!proposal.campaign) throw new Error('Missing campaign definition');
          const staged = await stageCoworkCampaignDefinition(scope, run.id, proposal.campaign);
          targetId = run.id;
          label = `Crear campaña «${proposal.campaign.name.slice(0, 80)}» · ${staged.recipients} destinatarios · ${proposal.campaign.messages.length} mensajes (pausada)`;
        }
        if (proposal.kind === 'campaign_activate' || proposal.kind === 'campaign_pause') {
          const campaign = await getBulkCampaign(
            { user: { id: scope.userId }, organizationId: scope.organizationId } as never, proposal.targetId);
          targetId = `${campaign.id}:${campaign.revision}:${campaign.review_hash}`;
          label = `${proposal.kind === 'campaign_activate' ? 'Aprobar y activar' : 'Pausar'} campaña «${String(campaign.definition?.name || campaign.id).slice(0, 80)}» (rev ${campaign.revision})`;
        }
        if (proposal.kind === 'code_execute') {
          if (!proposal.code) throw new Error('Missing code proposal');
          const staged = await stageCoworkCode(scope, run.id, proposal.code);
          const hash = hashCoworkCodeProposal(proposal.code);
          targetId = `code:${hash}`;
          const fileNote = staged.files > 0 ? ` · ${staged.files} archivo${staged.files === 1 ? '' : 's'}` : ' · sin archivos';
          label = `Ejecutar ${proposal.code.language} aislado${fileNote} (máx 120 s)`;
        }
        const proposed = await client.rpc('cowork_propose_effect', {
          p_run_id: run.id, p_token: run.lease_token, p_kind: proposal.kind,
          p_origin_run_id: proposal.originRunId, p_target_id: targetId, p_label: label,
        });
        if (proposed.error || proposed.data !== true) throw new Error('Could not prepare effect review');
        waitingApproval = true;
        // Autonomous mode carries the user's standing grant: approve the exact
        // proposed effect so the queue executes it without another round-trip.
        // The flag is re-read here so revoking autonomy mid-flight stops admission.
        // Sends, campaign activate/pause and code execution never self-approve:
        // they always wait for a human decision. Creating a paused draft is
        // harmless and may proceed.
        if (executionPolicy.automaticExternalSearch && process.env.COWORK_AUTONOMY_ENABLED === 'true'
          && proposal.kind !== 'send_email' && proposal.kind !== 'campaign_activate' && proposal.kind !== 'campaign_pause'
          && proposal.kind !== 'code_execute') {
          const approved = await resolveCoworkEffect(client, scope, run.id, true);
          if (!approved) throw new Error('Could not approve effect');
        }
      },
    });
    if (waitingApproval) return { claimed: true, processed: 1 };
    controller.signal.throwIfAborted();
    await requireCoworkWorkerAccess(client, scope);
    const finished = await client.rpc('cowork_finish_run', {
      p_run_id: run.id, p_token: run.lease_token, p_status: 'completed',
      p_payload: { ...result, telemetry },
    });
    if (finished.error) throw finished.error;
    return { claimed: true, processed: finished.data === true ? 1 : 0 };
  } catch {
    // Cancellation invalidates the lease; terminal writes cannot revive it.
    const failed = await client.rpc('cowork_finish_run', {
      p_run_id: run.id, p_token: run.lease_token, p_status: 'failed',
      p_payload: { message: 'No se pudo completar la respuesta. Tu solicitud sigue guardada.' },
    });
    if (failed.error) throw failed.error;
    return { claimed: true, processed: 0 };
  } finally {
    clearInterval(interval);
    clearTimeout(deadline);
  }
}
