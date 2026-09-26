import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { prepareCoworkSpecialists, coworkSpecialistInstructions, coworkSpecialistsEnabled,
  specialistTaskSchema, specialistResultSchema, type SpecialistTask } from '@/lib/cowork/specialists';
import type { CoworkObservation } from '@/lib/cowork/agent-loop';
import { coworkIsAssistantEvent } from '@/lib/cowork/contracts';
import { coworkReadTaskSchema } from '@/lib/cowork/parallel-reads';
import { requireCoworkWorkerAccess } from './access';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { reserveCoworkModelCall } from './model-budget';
import { recordCoworkModelUsage } from './model-usage';
import { createCoworkOperationGateway, coworkOperationHash } from './operations';
import { coworkReadCapabilities } from './read-capabilities';
import { coworkSpecialistTools } from '@/lib/cowork/specialists';

export function coworkSpecialistQueueEnabled() {
  return coworkSpecialistsEnabled(process.env) && process.env.COWORK_SPECIALIST_QUEUE_ENABLED === 'true'
    && process.env.COWORK_MODEL_BUDGET_ENABLED === 'true';
}

export class CoworkSpecialistsDeferred extends Error {}

export async function enqueueCoworkSpecialists(client: SupabaseClient, runId: string, token: string,
  tasks: SpecialistTask[], observations: CoworkObservation[]) {
  const assignments = prepareCoworkSpecialists(tasks, observations);
  if (tasks.some(task => task.read) && process.env.COWORK_SPECIALIST_TOOLS_ENABLED !== 'true') {
    throw new Error('Specialist tools disabled');
  }
  const { data, error } = await client.rpc('cowork_enqueue_specialists', {
    p_run_id: runId, p_token: token, p_assignments: assignments,
  });
  if (error || data !== true) throw new Error('No se pudo guardar la revisión de especialistas.');
  throw new CoworkSpecialistsDeferred('Revisión guardada en cola');
}

const observationSchema = z.object({
  action: z.union([coworkReadTaskSchema.innerType().shape.action, z.literal('specialists.review')]),
  input: z.string(), result: z.unknown(),
});

export async function loadCoworkSpecialistResume(client: SupabaseClient,
  scope: { userId: string; organizationId: string }, runId: string): Promise<CoworkObservation[] | undefined> {
  const { data, error } = await client.from('cowork_run_events').select('payload')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .eq('kind', 'tool.completed').order('sequence', { ascending: true }).limit(10);
  if (error) throw new Error('No se pudo recuperar la revisión guardada.');
  // The plan the person saw is not an observation to resume from.
  const observations = (data || []).filter(row => !coworkIsAssistantEvent(row.payload))
    .map(row => observationSchema.parse(row.payload)) as CoworkObservation[];
  if (!observations.some(row => row.action === 'specialists.review')) return undefined;
  if (observations.length > 4) throw new Error('La revisión excede el presupuesto de contexto.');
  return observations;
}

const jobSchema = z.object({
  id: z.string().uuid(), run_id: z.string().uuid(), user_id: z.string().uuid(), organization_id: z.string().uuid(),
  lease_token: z.string().uuid(), role: specialistTaskSchema.shape.role,
  assignment: z.object({ task: specialistTaskSchema,
    evidence: z.array(z.object({ index: z.number().int().min(0).max(2), observation: z.unknown() })).min(1).max(3),
  }),
});

export async function processCoworkSpecialistQueue(): Promise<{ claimed: boolean; processed: number }> {
  if (process.env.COWORK_ENABLED !== 'true' || !coworkSpecialistQueueEnabled()) return { claimed: false, processed: 0 };
  const client = getSupabaseAdminClient();
  const taken = await client.rpc('cowork_take_specialist', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (taken.error) throw taken.error;
  if (!taken.data?.[0]) return { claimed: false, processed: 0 };
  const job = jobSchema.parse(taken.data[0]);
  const scope = { userId: job.user_id, organizationId: job.organization_id };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 25000);
  let checking = false;
  const authorize = async () => {
    controller.signal.throwIfAborted();
    await requireCoworkWorkerAccess(client, scope);
    const parent = await client.from('cowork_runs').select('status').eq('id', job.run_id)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).single();
    if (parent.error || parent.data?.status !== 'waiting_workers') throw new Error('Specialist cancelled');
  };
  const interval = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { await authorize(); } catch { controller.abort(); } finally { checking = false; }
  }, 3000);
  let usage: Record<string, unknown> | null = null;
  const finish = async (success: boolean, result: unknown, errorCode: string | null) => {
    const response = await client.rpc('cowork_finish_specialist', {
      p_id: job.id, p_token: job.lease_token, p_success: success, p_result: result,
      p_usage: usage, p_error: errorCode,
    });
    if (response.error) throw response.error;
    return response.data === true;
  };
  try {
    await authorize();
    const { task } = job.assignment;
    const evidence = [...job.assignment.evidence];
    if (task.role !== job.role || JSON.stringify(evidence).length > 24000
      || new Set(evidence.map(item => item.index)).size !== evidence.length
      || task.evidence.length !== evidence.length
      || task.evidence.some(index => !evidence.some(item => item.index === index))) throw new Error('Invalid assignment');
    const toolObservations = [];
    if (task.read) {
      if (process.env.COWORK_SPECIALIST_TOOLS_ENABLED !== 'true') throw new Error('Specialist tools disabled');
      // Validate again after loading the durable assignment, before any read.
      const observations: unknown[] = [];
      evidence.forEach(item => { observations[item.index] = item.observation; });
      prepareCoworkSpecialists([task], observations);
      const capabilities = coworkReadCapabilities(client, scope).filter(capability =>
        (coworkSpecialistTools[job.role] as readonly string[]).includes(capability.name) && capability.effect === 'read');
      const gateway = createCoworkOperationGateway(client, capabilities, { authorize, runLease: job.lease_token });
      const result = await gateway.invoke({ ...scope, runId: job.run_id }, {
        capability: task.read.action, input: task.read.input,
        operationId: `specialist:${job.id}:${coworkOperationHash(task.read)}`,
      }, controller.signal);
      const observation = { action: task.read.action, input: task.read.input, result };
      const entry = { index: Math.max(...task.evidence) + 1, observation };
      evidence.push(entry);
      toolObservations.push(entry);
      if (JSON.stringify(evidence).length > 24000) throw new Error('Specialist evidence budget exceeded');
    }
    const reservationId = await reserveCoworkModelCall(client, job.run_id, job.lease_token, job.role, job.id);
    const generated = await generateStructuredWithTelemetry({
      schema: specialistResultSchema, systemPrompt: coworkSpecialistInstructions(task.role),
      prompt: JSON.stringify({ objective: task.objective, evidence }), provider: 'openai',
      openAiModel: process.env.COWORK_MODEL, allowDefaultModelFallback: false,
      maxAttempts: 1, timeoutMs: 20000, maxOutputTokens: 1800, signal: controller.signal,
    });
    const tokens = generated.telemetry.usage;
    await recordCoworkModelUsage(client, reservationId, job.lease_token, generated.telemetry);
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    usage = { model: generated.telemetry.modelName, durationMs: generated.telemetry.durationMs,
      inputTokens: count(tokens?.prompt_tokens), outputTokens: count(tokens?.completion_tokens), totalTokens: count(tokens?.total_tokens) };
    const result = specialistResultSchema.parse(generated.data);
    if (result.findings.some(finding => finding.evidence.some(index => !evidence.some(item => item.index === index)))) throw new Error('Unobserved evidence');
    await authorize(); controller.signal.throwIfAborted();
    return { claimed: true, processed: await finish(true, toolObservations.length ? { ...result, toolObservations } : result, null) ? 1 : 0 };
  } catch {
    await finish(false, null, controller.signal.aborted ? 'interrupted' : 'generation_failed');
    return { claimed: true, processed: 0 };
  } finally { clearTimeout(deadline); clearInterval(interval); }
}
