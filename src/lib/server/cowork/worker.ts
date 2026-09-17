import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { coworkDecisionSchema, runCoworkReadLoop } from '@/lib/cowork/agent-loop';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { coworkWorkerConfigured } from './runs';
import { loadCoworkHistory } from './conversation-context';
import { processCoworkSearchQueue } from './external-search';
import { processCoworkDraftQueue } from './draft-from-research';
import { coworkExecutionPolicy } from '@/lib/cowork/execution-policy';
import { coworkOperationHash, createCoworkOperationGateway } from './operations';
import { coworkReadCapabilities } from './read-capabilities';
import { processCoworkEffectQueue, resolveCoworkEffect } from './effects';
import { coworkAgentInstructions } from '@/lib/cowork/agent-instructions';

/** Read-only worker: bounded app queries and drafting; no implicit mutations. */
export async function processCoworkQueue() {
  if (process.env.COWORK_ENABLED !== 'true' || !coworkWorkerConfigured()) return { processed: 0 };
  // Owner-approved effects first: they carry an explicit grant and unblock threads.
  const effect = await processCoworkEffectQueue();
  if (effect.claimed) return { processed: effect.processed };
  const draft = await processCoworkDraftQueue();
  if (draft.claimed) return { processed: draft.processed };
  const search = await processCoworkSearchQueue();
  if (search.claimed) return { processed: search.processed };
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc('cowork_claim_run', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (error) throw error;
  const run = data?.[0];
  if (!run) return { processed: 0 };
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
    const executionPolicy = coworkExecutionPolicy(run.mode, process.env.COWORK_AUTONOMY_ENABLED === 'true');
    // Reads run through the durable ledger: an identical query replays its
    // stored result instead of hitting the database again after a retry.
    const readGateway = createCoworkOperationGateway(client, coworkReadCapabilities(client, scope));
    const operationScope = { userId: scope.userId, organizationId: scope.organizationId, runId: run.id };
    const instructions = coworkAgentInstructions({
      externalSearch: process.env.COWORK_EXTERNAL_SEARCH_ENABLED === 'true',
      automaticExternalSearch: executionPolicy.automaticExternalSearch,
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
            additionalCapability: instructions.additionalCapability,
            effectCapability: instructions.effectCapability }),
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
        const proposed = await client.rpc('cowork_propose_search', { p_run_id: run.id, p_token: run.lease_token, p_criteria: criteria });
        if (proposed.error || proposed.data !== true) throw new Error('Could not prepare search review');
        waitingApproval = true;
        // Persisted run.mode is user input accepted by admission, never model output.
        // Database primary key permits at most one search proposal per run.
        if (executionPolicy.automaticExternalSearch && process.env.COWORK_AUTONOMY_ENABLED === 'true') {
          await requireCoworkWorkerAccess(client, scope);
          const admitted = await client.rpc('cowork_claim_search', {
            p_run_id: run.id, p_user_id: scope.userId, p_organization_id: scope.organizationId, p_approve: true,
          });
          if (admitted.error) throw admitted.error;
        }
      },
      proposeEffect: async proposal => {
        const proposed = await client.rpc('cowork_propose_effect', {
          p_run_id: run.id, p_token: run.lease_token, p_kind: proposal.kind,
          p_origin_run_id: proposal.originRunId, p_target_id: proposal.targetId, p_label: proposal.label,
        });
        if (proposed.error || proposed.data !== true) throw new Error('Could not prepare effect review');
        waitingApproval = true;
        // Autonomous mode carries the user's standing grant: approve the exact
        // proposed effect so the queue executes it without another round-trip.
        if (executionPolicy.automaticExternalSearch && process.env.COWORK_AUTONOMY_ENABLED === 'true') {
          const approved = await resolveCoworkEffect(client, scope, run.id, true);
          if (!approved) throw new Error('Could not approve effect');
        }
      },
    });
    if (waitingApproval) return { processed: 1 };
    controller.signal.throwIfAborted();
    await requireCoworkWorkerAccess(client, scope);
    const finished = await client.rpc('cowork_finish_run', {
      p_run_id: run.id, p_token: run.lease_token, p_status: 'completed',
      p_payload: { ...result, telemetry },
    });
    if (finished.error) throw finished.error;
    return { processed: finished.data === true ? 1 : 0 };
  } catch {
    // Cancellation invalidates the lease; terminal writes cannot revive it.
    const failed = await client.rpc('cowork_finish_run', {
      p_run_id: run.id, p_token: run.lease_token, p_status: 'failed',
      p_payload: { message: 'No se pudo completar la respuesta. Tu solicitud sigue guardada.' },
    });
    if (failed.error) throw failed.error;
    return { processed: 0 };
  } finally {
    clearInterval(interval);
    clearTimeout(deadline);
  }
}
