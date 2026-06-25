import type { OpenAiModelTier } from '@/ai/model-router';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getSupliaPolicy } from '@/lib/server/suplia-policy';
import { claimSupliaToolLease, releaseSupliaToolLease, type SupliaToolLease } from '@/lib/server/suplia-tool-leases';
import { getSupliaTool } from '@/lib/server/suplia-tools';
import { isSupliaRuntimeError, SupliaRuntimeError } from '@/lib/suplia/runtime';
import { getSupliaToolLeasePolicy } from '@/lib/suplia/tool-limits';
import type { SupliaToolRun } from '@/lib/suplia/types';

type ToolRunInput = {
  auth: AuthContext;
  conversationId: string;
  jobId?: string | null;
  stepId?: string | null;
  agentRunId?: string | null;
  messageId?: string | null;
  pendingActionId?: string | null;
  existingToolRunId?: string | null;
  toolName: string;
  input: Record<string, unknown>;
  modelTier?: OpenAiModelTier | null;
  modelName?: string | null;
  approvedBy?: string | null;
};

export function mapSupliaToolRunRow(row: any): SupliaToolRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    jobId: row.job_id,
    stepId: row.step_id,
    agentRunId: row.agent_run_id,
    userId: row.user_id,
    messageId: row.message_id,
    pendingActionId: row.pending_action_id,
    toolName: row.tool_name,
    status: row.status,
    inputPayload: row.input_payload || {},
    outputPayload: row.output_payload,
    errorMessage: row.error_message,
    riskLevel: row.risk_level,
    requiresApproval: Boolean(row.requires_approval),
    approvalKind: row.approval_kind,
    approvalReason: row.approval_reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    modelTier: row.model_tier,
    modelName: row.model_name,
    tokenUsage: row.token_usage,
    estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
    createdAt: row.created_at,
  };
}

async function assertSupliaToolRunnable(input: ToolRunInput) {
  if (!input.jobId && !input.stepId) return;
  const admin = getSupabaseAdminClient();

  if (input.jobId) {
    const { data: job, error } = await admin
      .from('suplia_jobs')
      .select('status')
      .eq('id', input.jobId)
      .eq('organization_id', input.auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (job?.status === 'cancelled') throw new SupliaRuntimeError('cancelled', 'El job fue cancelado.');
    if (job?.status === 'paused') throw new SupliaRuntimeError('paused', 'El job fue pausado.');
  }

  if (input.stepId) {
    const { data: step, error } = await admin
      .from('suplia_job_steps')
      .select('status')
      .eq('id', input.stepId)
      .eq('organization_id', input.auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (step?.status === 'cancelled') throw new SupliaRuntimeError('cancelled', 'El step fue cancelado.');
  }
}

async function heartbeatSupliaTool(input: ToolRunInput) {
  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const writes = [];
  if (input.jobId) {
    writes.push(admin.from('suplia_jobs').update({ last_heartbeat_at: now, updated_at: now }).eq('id', input.jobId).eq('organization_id', input.auth.organizationId));
  }
  if (input.stepId) {
    writes.push(admin.from('suplia_job_steps').update({ locked_at: now, updated_at: now }).eq('id', input.stepId).eq('organization_id', input.auth.organizationId));
  }
  await Promise.all(writes);
}

async function reportSupliaToolProgress(input: ToolRunInput, progress: { current: number; total?: number; label?: string | null; metadata?: Record<string, unknown> }) {
  const admin = getSupabaseAdminClient();
  const current = Math.max(0, Math.floor(Number(progress.current || 0)));
  const total = Math.max(current, Math.floor(Number(progress.total || current || 0)));
  const now = new Date().toISOString();
  const writes = [];

  if (input.stepId) {
    writes.push(admin.from('suplia_job_steps').update({
      progress_current: current,
      progress_total: total,
      updated_at: now,
    }).eq('id', input.stepId).eq('organization_id', input.auth.organizationId));
  }

  if (input.jobId) {
    writes.push(admin.from('suplia_jobs').update({
      progress_label: progress.label || undefined,
      last_heartbeat_at: now,
      updated_at: now,
    }).eq('id', input.jobId).eq('organization_id', input.auth.organizationId));
  }

  await Promise.all(writes);
}

async function upsertStartedToolRun(input: ToolRunInput) {
  const admin = getSupabaseAdminClient();
  const policy = getSupliaPolicy(input.toolName);
  const startedAt = new Date().toISOString();
  const payload = {
    conversation_id: input.conversationId,
    organization_id: input.auth.organizationId,
    job_id: input.jobId || null,
    step_id: input.stepId || null,
    agent_run_id: input.agentRunId || null,
    user_id: input.auth.user.id,
    message_id: input.messageId || null,
    pending_action_id: input.pendingActionId || null,
    tool_name: input.toolName,
    status: 'running',
    input_payload: input.input || {},
    output_payload: null,
    error_message: null,
    risk_level: policy.riskLevel,
    requires_approval: policy.requiresApproval,
    approval_kind: policy.approvalKind,
    approval_reason: policy.approvalReason,
    approved_by: input.approvedBy || null,
    approved_at: input.approvedBy ? startedAt : null,
    started_at: startedAt,
    finished_at: null,
    duration_ms: null,
    model_tier: input.modelTier || null,
    model_name: input.modelName || null,
  };

  if (input.existingToolRunId) {
    const { data, error } = await admin
      .from('suplia_tool_runs')
      .update(payload)
      .eq('id', input.existingToolRunId)
      .eq('organization_id', input.auth.organizationId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (data) return mapSupliaToolRunRow(data);
  }

  const { data, error } = await admin.from('suplia_tool_runs').insert(payload).select('*').single();
  if (error) throw error;
  return mapSupliaToolRunRow(data);
}

export async function recordSupliaToolPendingApproval(input: Omit<ToolRunInput, 'approvedBy' | 'existingToolRunId'>) {
  const admin = getSupabaseAdminClient();
  const policy = getSupliaPolicy(input.toolName);
  const { data, error } = await admin
    .from('suplia_tool_runs')
    .insert({
      conversation_id: input.conversationId,
      organization_id: input.auth.organizationId,
      job_id: input.jobId || null,
      step_id: input.stepId || null,
      agent_run_id: input.agentRunId || null,
      user_id: input.auth.user.id,
      message_id: input.messageId || null,
      pending_action_id: input.pendingActionId || null,
      tool_name: input.toolName,
      status: 'requires_approval',
      input_payload: input.input || {},
      risk_level: policy.riskLevel,
      requires_approval: policy.requiresApproval,
      approval_kind: policy.approvalKind,
      approval_reason: policy.approvalReason,
      model_tier: input.modelTier || null,
      model_name: input.modelName || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapSupliaToolRunRow(data);
}

export async function cancelSupliaToolRun(auth: AuthContext, toolRunId: string) {
  const admin = getSupabaseAdminClient();
  const finishedAt = new Date().toISOString();
  const { data, error } = await admin
    .from('suplia_tool_runs')
    .update({ status: 'cancelled', finished_at: finishedAt })
    .eq('id', toolRunId)
    .eq('organization_id', auth.organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? mapSupliaToolRunRow(data) : null;
}

export async function runSupliaTool(input: ToolRunInput): Promise<{ toolRun: SupliaToolRun; output: Record<string, unknown> }> {
  const admin = getSupabaseAdminClient();
  const tool = getSupliaTool(input.toolName);
  if (!tool) throw new Error(`Tool no soportada: ${input.toolName}`);

  const policy = getSupliaPolicy(input.toolName);
  if (policy.requiresApproval && !input.approvedBy) {
    const toolRun = await recordSupliaToolPendingApproval(input);
    return { toolRun, output: {} };
  }

  const startedAtMs = Date.now();
  let lease: SupliaToolLease | null = null;
  const toolRun = await upsertStartedToolRun(input);

  try {
    await assertSupliaToolRunnable(input);
    const leasePolicy = getSupliaToolLeasePolicy(input.toolName, input.input || {});
    if (leasePolicy) {
      lease = await claimSupliaToolLease({
        auth: input.auth,
        policy: leasePolicy,
        jobId: input.jobId || null,
        stepId: input.stepId || null,
        toolRunId: toolRun.id,
        metadata: { toolName: input.toolName },
      });
    }

    const output = await tool.handler(input.input || {}, {
      auth: input.auth,
      conversationId: input.conversationId,
      jobId: input.jobId || null,
      stepId: input.stepId || null,
      agentRunId: input.agentRunId || null,
      messageId: input.messageId || null,
      pendingActionId: input.pendingActionId || null,
      reportProgress: (progress) => reportSupliaToolProgress(input, progress),
      assertRunnable: () => assertSupliaToolRunnable(input),
      heartbeat: () => heartbeatSupliaTool(input),
    });
    await assertSupliaToolRunnable(input);
    const finishedAt = new Date().toISOString();
    await releaseSupliaToolLease(lease);
    lease = null;
    const { data, error } = await admin
      .from('suplia_tool_runs')
      .update({
        status: 'completed',
        output_payload: output || {},
        error_message: null,
        finished_at: finishedAt,
        duration_ms: Date.now() - startedAtMs,
      })
      .eq('id', toolRun.id)
      .select('*')
      .single();
    if (error) throw error;
    return { toolRun: mapSupliaToolRunRow(data), output: output || {} };
  } catch (error: any) {
    const finishedAt = new Date().toISOString();
    await releaseSupliaToolLease(lease);
    const deferred = isSupliaRuntimeError(error, 'deferred');
    await admin
      .from('suplia_tool_runs')
      .update({
        status: deferred ? 'queued' : 'failed',
        error_message: error?.message || 'Error ejecutando tool',
        finished_at: finishedAt,
        duration_ms: Date.now() - startedAtMs,
      })
      .eq('id', toolRun.id);
    throw error;
  }
}
