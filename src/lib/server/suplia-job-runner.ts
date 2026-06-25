import { randomUUID } from 'crypto';

import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { insertSupliaArtifacts } from '@/lib/server/suplia-artifacts';
import { getSupliaPolicy } from '@/lib/server/suplia-policy';
import { recordSupliaToolPendingApproval } from '@/lib/server/suplia-tool-runner';
import { runSupliaAgent, type SupliaAgentPendingAction } from '@/lib/server/suplia-agent-registry';
import { getSupliaParallelBatchLabel, pickSupliaRunnableStepBatch } from '@/lib/suplia/job-parallelism';
import { buildSupliaApprovalRequiredMessage, buildSupliaStepCompletedMessage, buildSupliaStepStartedMessage } from '@/lib/suplia/job-narration';
import { buildSupliaThreadResponseStepKey, findSupliaActionableReplyCandidate } from '@/lib/suplia/job-transition-helpers';
import { getSupliaRetryAfterMs, getSupliaRuntimeErrorCode, SupliaRuntimeError } from '@/lib/suplia/runtime';
import { getSupliaStepTimeoutMs } from '@/lib/suplia/tool-limits';
import type {
  SupliaAgentRun,
  SupliaJob,
  SupliaJobEvent,
  SupliaJobStep,
} from '@/lib/suplia/types';

const JOB_STEP_DEFINITIONS = [
  {
    step_order: 1,
    step_key: 'planner',
    step_type: 'agent',
    agent_name: 'planner',
    title: 'Plan operativo',
    description: 'Ordena el objetivo, define el flujo seguro y evita acciones sensibles automaticas.',
  },
  {
    step_order: 2,
    step_key: 'plan_approval',
    step_type: 'agent',
    agent_name: 'planner',
    title: 'Aprobacion del plan',
    description: 'Revisa el plan antes de continuar con ICP y busqueda.',
    requires_approval: true,
  },
  {
    step_order: 3,
    step_key: 'icp_strategy',
    step_type: 'agent',
    agent_name: 'icp-strategist',
    title: 'ICP y search plan',
    description: 'Propone segmentos, roles, senales y criterios de busqueda antes de consumir creditos.',
  },
  {
    step_order: 4,
    step_key: 'prospector_approval',
    step_type: 'agent',
    agent_name: 'prospector',
    title: 'Aprobacion de busqueda',
    description: 'Prepara la busqueda externa como aprobacion humana sin ejecutarla.',
    requires_approval: true,
  },
];

const GMAIL_JOB_STEP_DEFINITIONS = [
  {
    step_order: 1,
    step_key: 'gmail_analysis_plan',
    step_type: 'agent',
    agent_name: 'gmail-analyst',
    title: 'Plan de busqueda Gmail',
    description: 'Prepara una query limitada y segura sin leer Gmail todavia.',
  },
  {
    step_order: 2,
    step_key: 'gmail_search_approval',
    step_type: 'agent',
    agent_name: 'gmail-analyst',
    title: 'Aprobacion de lectura Gmail',
    description: 'Deja la lectura de Gmail como aprobacion humana simple por privacidad.',
    requires_approval: true,
  },
];

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const JOB_LOCK_STALE_MS = 4 * 60 * 1000;
const JOB_MAX_PARALLEL_STEPS = 3;
const JOB_HEARTBEAT_MS = 15000;

function nowIso() {
  return new Date().toISOString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new SupliaRuntimeError('timeout', `${label} excedio el timeout de ${timeoutMs}ms.`, { retryAfterMs: 10000 })), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function heartbeatSupliaJob(auth: AuthContext, jobId: string, lockToken?: string | null) {
  const admin = getSupabaseAdminClient();
  const query = admin
    .from('suplia_jobs')
    .update({ last_heartbeat_at: nowIso(), updated_at: nowIso() })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId);
  if (lockToken) query.eq('lock_token', lockToken);
  await query;
}

async function ensureSupliaJobRunnable(auth: AuthContext, jobId: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('suplia_jobs')
    .select('status')
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (data?.status === 'cancelled') throw new SupliaRuntimeError('cancelled', 'El job fue cancelado.');
  if (data?.status === 'paused') throw new SupliaRuntimeError('paused', 'El job fue pausado.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function buildJobTitle(message: string) {
  const clean = String(message || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Job de SUPL.IA';
  return clean.length > 68 ? `${clean.slice(0, 65)}...` : clean;
}

export function shouldCreateSupliaJobFromMessage(message: string) {
  if (isGmailMailboxJobMessage(message)) return true;
  const text = String(message || '').toLowerCase();
  const asksForProspecting = /\b(promociona|promocionar|campana|campaña|prospecta|prospectar|apollo|pdl|leads?|empresas?|constructora|constructoras|segmenta|segmentar|icp|audiencia|publico objetivo|público objetivo)\b/i.test(text);
  const asksForWorkflow = /\b(busca|buscar|encuentra|encontrar|arma|armar|crea|crear|prepara|preparar|lanza|lanzar|investiga|investigar)\b/i.test(text);
  const directEmailOnly = /\b(envia|enviar|manda|mandar)\b/i.test(text) && /[^@\s]+@[^@\s]+\.[^@\s]+/.test(text);
  return asksForProspecting && asksForWorkflow && !directEmailOnly;
}

export function isGmailMailboxJobMessage(message: string) {
  const text = String(message || '').toLowerCase();
  const mentionsMailbox = /\b(gmail|mail|correo|correos|bandeja|enviados|inbox|hilos|mensajes|mailbox)\b/i.test(text);
  const asksForSearch = /\b(dime|busca|buscar|encuentra|encontrar|revisa|revisar|analiza|analizar|lista|listar)\b/i.test(text);
  const asksContacted = /\b(contacte|contacté|contactado|contactados|a quienes|a quien|leads?|personas?|contactos?)\b/i.test(text);
  const directEmailOnly = /\b(envia|enviar|manda|mandar)\b/i.test(text) && /[^@\s]+@[^@\s]+\.[^@\s]+/.test(text);
  return mentionsMailbox && asksForSearch && asksContacted && !directEmailOnly;
}

export function mapSupliaJobRow(row: any): SupliaJob {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    title: row.title,
    goal: row.goal,
    jobType: row.job_type,
    status: row.status,
    priority: Number(row.priority || 0),
    currentStepId: row.current_step_id,
    progressCurrent: Number(row.progress_current || 0),
    progressTotal: Number(row.progress_total || 0),
    progressLabel: row.progress_label,
    inputPayload: asRecord(row.input_payload),
    outputPayload: asRecord(row.output_payload),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    pausedAt: row.paused_at,
  };
}

export function mapSupliaJobStepRow(row: any): SupliaJobStep {
  return {
    id: row.id,
    jobId: row.job_id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    stepOrder: Number(row.step_order || 0),
    stepKey: row.step_key,
    stepType: row.step_type,
    agentName: row.agent_name,
    title: row.title,
    description: row.description,
    status: row.status,
    dependsOnStepIds: Array.isArray(row.depends_on_step_ids) ? row.depends_on_step_ids : [],
    canRunInParallel: Boolean(row.can_run_in_parallel),
    requiresApproval: Boolean(row.requires_approval),
    approvalActionId: row.approval_action_id,
    toolRunId: row.tool_run_id,
    inputPayload: asRecord(row.input_payload),
    outputPayload: asRecord(row.output_payload),
    errorMessage: row.error_message,
    progressCurrent: Number(row.progress_current || 0),
    progressTotal: Number(row.progress_total || 0),
    retryCount: Number(row.retry_count || 0),
    maxAttempts: Number(row.max_attempts || 3),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSupliaAgentRunRow(row: any): SupliaAgentRun {
  return {
    id: row.id,
    jobId: row.job_id,
    stepId: row.step_id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    agentName: row.agent_name,
    status: row.status,
    modelTier: row.model_tier,
    modelName: row.model_name,
    reasoningSummary: row.reasoning_summary,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export function mapSupliaJobEventRow(row: any): SupliaJobEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    stepId: row.step_id,
    agentRunId: row.agent_run_id,
    toolRunId: row.tool_run_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    metadata: asRecord(row.metadata),
    createdAt: row.created_at,
  };
}

export async function recordSupliaJobEvent(input: {
  organizationId: string;
  jobId?: string | null;
  stepId?: string | null;
  agentRunId?: string | null;
  toolRunId?: string | null;
  eventType: string;
  title: string;
  message?: string | null;
  severity?: 'debug' | 'info' | 'success' | 'warning' | 'error';
  metadata?: Record<string, unknown>;
}) {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('suplia_job_events').insert({
    organization_id: input.organizationId,
    job_id: input.jobId || null,
    step_id: input.stepId || null,
    agent_run_id: input.agentRunId || null,
    tool_run_id: input.toolRunId || null,
    event_type: input.eventType,
    title: input.title,
    message: input.message || null,
    severity: input.severity || 'info',
    metadata: input.metadata || {},
  });
  if (error) console.warn('[SUPLIA/job event] insert failed:', error.message || error);
}

async function appendSupliaJobChatMessage(input: {
  auth: AuthContext;
  conversationId: string;
  jobId: string;
  sourceKey: string;
  content: string;
  stepId?: string | null;
  actionId?: string | null;
  parts?: Array<Record<string, unknown>>;
}) {
  const admin = getSupabaseAdminClient();
  const metadata = {
    generatedBy: 'suplia-job-runner',
    sourceKey: input.sourceKey,
    jobId: input.jobId,
    stepId: input.stepId || null,
    actionId: input.actionId || null,
    parts: input.parts && input.parts.length > 0 ? input.parts : [{ type: 'text', text: input.content }],
  };

  const { data: existing, error: existingError } = await admin
    .from('suplia_messages')
    .select('id')
    .eq('conversation_id', input.conversationId)
    .eq('organization_id', input.auth.organizationId)
    .contains('metadata', { sourceKey: input.sourceKey })
    .limit(1)
    .maybeSingle();
  if (existingError) console.warn('[SUPLIA/job chat] lookup failed:', existingError.message || existingError);
  if (existing) return;

  const { error } = await admin.from('suplia_messages').insert({
    conversation_id: input.conversationId,
    organization_id: input.auth.organizationId,
    user_id: input.auth.user.id,
    role: 'assistant',
    content: input.content,
    metadata,
    created_at: nowIso(),
  });
  if (error) console.warn('[SUPLIA/job chat] insert failed:', error.message || error);
}

export async function createSupliaJobFromMessage(auth: AuthContext, input: { conversationId: string; message: string; messageId?: string | null; skipPlanApproval?: boolean; approvedPlan?: Record<string, unknown> | null; sourceActionId?: string | null; jobType?: 'prospecting_campaign' | 'gmail_mailbox_analysis' }) {
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  const isGmailJob = input.jobType ? input.jobType === 'gmail_mailbox_analysis' : isGmailMailboxJobMessage(input.message);
  const stepDefinitions = isGmailJob
    ? GMAIL_JOB_STEP_DEFINITIONS
    : input.skipPlanApproval
      ? JOB_STEP_DEFINITIONS.filter((step) => step.step_key !== 'planner' && step.step_key !== 'plan_approval')
      : JOB_STEP_DEFINITIONS;

  const { data: job, error: jobError } = await admin
    .from('suplia_jobs')
    .insert({
      conversation_id: input.conversationId,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      title: buildJobTitle(input.message),
      goal: input.message.trim(),
      job_type: isGmailJob ? 'gmail_mailbox_analysis' : 'prospecting_campaign',
      status: 'queued',
      progress_total: stepDefinitions.length,
      progress_label: 'En cola',
      input_payload: { sourceMessageId: input.messageId || null, sourceActionId: input.sourceActionId || null, source: isGmailJob ? 'gmail_mailbox' : 'prospecting', approvedPlan: input.approvedPlan || null },
      queued_at: timestamp,
      updated_at: timestamp,
    })
    .select('*')
    .single();
  if (jobError) throw jobError;

  const { error: stepsError } = await admin.from('suplia_job_steps').insert(stepDefinitions.map((step) => ({
    ...step,
    job_id: job.id,
    conversation_id: input.conversationId,
    organization_id: auth.organizationId,
    status: 'queued',
    input_payload: { goal: input.message.trim(), approvedPlan: input.approvedPlan || null },
    progress_total: 1,
    requires_approval: Boolean(step.requires_approval),
  })));
  if (stepsError) throw stepsError;

  await recordSupliaJobEvent({
    organizationId: auth.organizationId,
    jobId: job.id,
    eventType: 'job.created',
    title: 'Job creado',
    message: isGmailJob ? 'SUPL.IA preparo un analisis Gmail con aprobacion antes de leer el mailbox.' : 'SUPL.IA preparo un trabajo persistente con subagentes visibles.',
    metadata: { messageId: input.messageId || null, jobType: isGmailJob ? 'gmail_mailbox_analysis' : 'prospecting_campaign' },
  });

  return mapSupliaJobRow(job);
}

async function getJobWithSteps(auth: AuthContext, jobId: string) {
  const admin = getSupabaseAdminClient();
  const { data: job, error: jobError } = await admin
    .from('suplia_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return null;

  const { data: steps, error: stepsError } = await admin
    .from('suplia_job_steps')
    .select('*')
    .eq('job_id', job.id)
    .order('step_order', { ascending: true });
  if (stepsError) throw stepsError;

  return { job, steps: steps || [] };
}

async function acquireJobLock(auth: AuthContext, jobId: string) {
  const current = await getJobWithSteps(auth, jobId);
  if (!current) return null;
  if (TERMINAL_JOB_STATUSES.has(current.job.status) || current.job.status === 'paused' || current.job.status === 'waiting_approval') return null;

  const lockedAt = current.job.locked_at ? new Date(current.job.locked_at).getTime() : 0;
  if (current.job.lock_token && lockedAt && Date.now() - lockedAt < JOB_LOCK_STALE_MS) return null;

  const lockToken = randomUUID();
  const now = nowIso();
  const admin = getSupabaseAdminClient();
  const lockQuery = admin
    .from('suplia_jobs')
    .update({
      status: 'running',
      lock_token: lockToken,
      locked_at: now,
      last_heartbeat_at: now,
      started_at: current.job.started_at || now,
      updated_at: now,
      progress_label: 'Ejecutando subagentes',
    })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId);
  if (current.job.lock_token) {
    lockQuery.eq('lock_token', current.job.lock_token);
  } else {
    lockQuery.is('lock_token', null);
  }

  const { data, error } = await lockQuery
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return { lockToken, job: data };
}

async function releaseJobLock(auth: AuthContext, jobId: string, lockToken: string) {
  const admin = getSupabaseAdminClient();
  await admin
    .from('suplia_jobs')
    .update({ lock_token: null, locked_at: null, last_heartbeat_at: nowIso(), updated_at: nowIso() })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .eq('lock_token', lockToken);
}

async function updateJobProgress(auth: AuthContext, job: any, steps: any[], patch: Record<string, unknown> = {}) {
  const admin = getSupabaseAdminClient();
  const completed = steps.filter((step) => step.status === 'completed').length;
  const waiting = steps.find((step) => step.status === 'waiting_approval');
  const failed = steps.find((step) => step.status === 'failed');
  const running = steps.find((step) => step.status === 'running');
  const queued = steps.find((step) => step.status === 'queued');
  const allDone = steps.length > 0 && completed === steps.length;
  const status = String(patch.status || (allDone ? 'completed' : waiting ? 'waiting_approval' : failed ? 'failed' : 'running'));
  const activeStep = waiting || running || queued || null;
  const progressLabel = String(
    patch.progress_label ||
    (allDone ? 'Completado' : waiting ? 'Esperando aprobacion' : failed ? 'Error' : activeStep?.title || 'Ejecutando')
  );
  const finishedAt = allDone || failed ? nowIso() : null;

  const update: Record<string, unknown> = {
    status,
    current_step_id: activeStep?.id || null,
    progress_current: completed,
    progress_total: steps.length,
    progress_label: progressLabel,
    updated_at: nowIso(),
    ...patch,
  };

  if (finishedAt && !job.finished_at && (status === 'completed' || status === 'failed')) update.finished_at = finishedAt;
  if (status === 'completed') update.error_message = null;

  await admin.from('suplia_jobs').update(update).eq('id', job.id).eq('organization_id', auth.organizationId);
}

async function persistStepActions(params: {
  auth: AuthContext;
  job: any;
  step: any;
  agentRunId: string;
  actions: SupliaAgentPendingAction[];
  modelTier?: string | null;
  modelName?: string | null;
}) {
  if (!params.actions.length) return [];
  const admin = getSupabaseAdminClient();
  const rows = params.actions.map((action) => {
    const policy = getSupliaPolicy(action.actionType);
    return {
      conversation_id: params.job.conversation_id,
      organization_id: params.auth.organizationId,
      user_id: params.auth.user.id,
      job_id: params.job.id,
      step_id: params.step.id,
      action_type: action.actionType,
      status: 'pending',
      title: action.title,
      description: action.description || policy.approvalReason,
      payload: action.payload || {},
      risk_level: policy.riskLevel,
      requires_approval: policy.requiresApproval,
      approval_kind: policy.approvalKind,
      approval_reason: policy.approvalReason,
      tool_name: action.actionType,
    };
  });

  const { data, error } = await admin.from('suplia_pending_actions').insert(rows).select('*');
  if (error) throw error;

  for (const action of data || []) {
    const toolRun = await recordSupliaToolPendingApproval({
      auth: params.auth,
      conversationId: params.job.conversation_id,
      jobId: params.job.id,
      stepId: params.step.id,
      agentRunId: params.agentRunId,
      pendingActionId: action.id,
      toolName: action.tool_name || action.action_type,
      input: action.payload || {},
      modelTier: params.modelTier as any,
      modelName: params.modelName || null,
    });

    await admin
      .from('suplia_pending_actions')
      .update({ tool_run_id: toolRun.id, updated_at: nowIso() })
      .eq('id', action.id);
    await admin
      .from('suplia_job_steps')
      .update({ approval_action_id: action.id, tool_run_id: toolRun.id, updated_at: nowIso() })
      .eq('id', params.step.id);

    const content = buildSupliaApprovalRequiredMessage({
      action_type: action.action_type,
      title: action.title,
      description: action.description,
      payload: action.payload || {},
    });
    await appendSupliaJobChatMessage({
      auth: params.auth,
      conversationId: params.job.conversation_id,
      jobId: params.job.id,
      stepId: params.step.id,
      actionId: action.id,
      sourceKey: `job:${params.job.id}:action:${action.id}:approval_required`,
      content,
      parts: [
        { type: 'text', text: content },
        { type: 'approval-request', actionId: action.id, title: action.title, approvalKind: action.approval_kind || 'simple' },
      ],
    });
  }

  return data || [];
}

async function insertJobStepIfMissing(params: {
  auth: AuthContext;
  job: any;
  stepOrder: number;
  stepKey: string;
  stepType?: string;
  agentName: string;
  title: string;
  description: string;
  dependsOnStepIds?: string[];
  requiresApproval?: boolean;
  canRunInParallel?: boolean;
  inputPayload?: Record<string, unknown>;
}) {
  const admin = getSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from('suplia_job_steps')
    .select('*')
    .eq('job_id', params.job.id)
    .eq('organization_id', params.auth.organizationId)
    .eq('step_key', params.stepKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await admin
    .from('suplia_job_steps')
    .insert({
      job_id: params.job.id,
      conversation_id: params.job.conversation_id,
      organization_id: params.auth.organizationId,
      step_order: params.stepOrder,
      step_key: params.stepKey,
      step_type: params.stepType || 'agent',
      agent_name: params.agentName,
      title: params.title,
      description: params.description,
      status: 'queued',
      depends_on_step_ids: params.dependsOnStepIds || [],
      can_run_in_parallel: Boolean(params.canRunInParallel),
      requires_approval: Boolean(params.requiresApproval),
      input_payload: params.inputPayload || {},
      progress_total: 1,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function appendStepsAfterApproval(params: {
  auth: AuthContext;
  job: any;
  step: any;
  actionType: string;
  result: Record<string, unknown>;
}) {
  const { auth, job, step, actionType, result } = params;

  if (actionType === 'prospecting.search_companies') {
    const companyScoring = await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 5,
      stepKey: 'company_scoring',
      agentName: 'company-scorer',
      title: 'Scoring de empresas',
      description: 'Prioriza empresas encontradas contra el ICP y descarta duplicados internos.',
      dependsOnStepIds: [step.id],
      inputPayload: { searchResult: result },
    });
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 6,
      stepKey: 'people_search_approval',
      agentName: 'prospector',
      title: 'Aprobacion para buscar personas',
      description: 'Prepara busqueda de decisores en empresas priorizadas sin consumir creditos hasta aprobar.',
      dependsOnStepIds: [companyScoring.id],
      requiresApproval: true,
      inputPayload: { companyScoringStepId: companyScoring.id },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Siguientes pasos agregados',
      message: 'SUPL.IA agrego scoring de empresas y aprobacion para buscar personas.',
      severity: 'info',
    });
  }

  if (actionType === 'prospecting.search_people') {
    const leadScoring = await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 7,
      stepKey: 'lead_scoring',
      agentName: 'lead-scorer',
      title: 'Scoring de leads',
      description: 'Prioriza personas contra ICP, rol, email y guardrails de contactabilidad.',
      dependsOnStepIds: [step.id],
      inputPayload: { peopleSearchResult: result },
    });
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 8,
      stepKey: 'enrichment_approval',
      agentName: 'enricher',
      title: 'Aprobacion para enrichment',
      description: 'Prepara enrichment de leads priorizados con aprobacion humana.',
      dependsOnStepIds: [leadScoring.id],
      requiresApproval: true,
      inputPayload: { leadScoringStepId: leadScoring.id },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Siguientes pasos agregados',
      message: 'SUPL.IA agrego scoring de leads y aprobacion de enrichment.',
      severity: 'info',
    });
  }

  if (actionType === 'lead.enrich_batch' || actionType === 'lead.enrich') {
    const copywriting = await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 9,
      stepKey: 'copywriting',
      agentName: 'copywriter',
      title: 'Personalizacion de emails',
      description: 'Genera borradores personalizados por lead usando datos reales o placeholders claros.',
      dependsOnStepIds: [step.id],
      inputPayload: { enrichmentResult: result },
    });
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 10,
      stepKey: 'compliance_preflight',
      agentName: 'compliance',
      title: 'Preflight compliance',
      description: 'Valida contactabilidad, placeholders, copy riesgoso y bloqueos antes de cualquier envio.',
      dependsOnStepIds: [copywriting.id],
      inputPayload: { copywritingStepId: copywriting.id },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Siguientes pasos agregados',
      message: 'SUPL.IA agrego personalizacion de emails y preflight compliance.',
      severity: 'info',
    });
  }

  if (actionType === 'campaign.create_draft') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 11,
      stepKey: 'campaign_launch_approval',
      agentName: 'campaign-operator',
      title: 'Aprobacion para lanzar campana',
      description: 'Prepara el lanzamiento como aprobacion fuerte separada del guardado del borrador.',
      dependsOnStepIds: [step.id],
      requiresApproval: true,
      inputPayload: { campaignDraftResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Lanzamiento preparado',
      message: 'SUPL.IA agrego una aprobacion fuerte separada para lanzar la campana.',
      severity: 'info',
    });
  }

  if (actionType === 'campaign.launch' || actionType === 'campaign.resume' || actionType === 'email.bulk_send') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 12,
      stepKey: 'reply_monitoring',
      agentName: 'reply-analyst',
      title: 'Monitoreo de replies',
      description: 'Sincroniza replies y resume respuestas recientes despues de una accion de contacto.',
      dependsOnStepIds: [step.id],
      canRunInParallel: true,
      inputPayload: { sourceAction: actionType, sourceResult: result },
    });
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 14,
      stepKey: 'crm_followup',
      agentName: 'crm-operator',
      title: 'Seguimiento CRM',
      description: 'Detecta seguimientos pendientes y prepara tareas aprobables si hay oportunidades estancadas.',
      dependsOnStepIds: [step.id],
      canRunInParallel: true,
      inputPayload: { sourceAction: actionType, sourceResult: result },
    });
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 15,
      stepKey: 'memory_capture',
      agentName: 'memory-agent',
      title: 'Memoria operativa',
      description: 'Propone criterios reutilizables derivados del job para futuras decisiones.',
      dependsOnStepIds: [step.id],
      canRunInParallel: true,
      inputPayload: { sourceAction: actionType, sourceResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Post-contacto agregado',
      message: 'SUPL.IA agrego monitoreo de replies, seguimiento CRM y memoria operativa.',
      severity: 'info',
    });
  }

  if (actionType === 'gmail.find_contacted_leads' || actionType === 'gmail.search_messages' || actionType === 'gmail.search_threads' || actionType === 'gmail.get_message' || actionType === 'gmail.get_thread') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 3,
      stepKey: 'reporter',
      agentName: 'reporter',
      title: 'Resumen final',
      description: 'Resume la lectura Gmail aprobada y sus resultados principales.',
      dependsOnStepIds: [step.id],
      inputPayload: { sourceAction: actionType, sourceResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Resumen Gmail agregado',
      message: 'SUPL.IA agrego un cierre auditable del analisis Gmail.',
      severity: 'info',
    });
  }

  if (actionType === 'memory.save' || actionType === 'memory.forget') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 16,
      stepKey: 'reporter',
      agentName: 'reporter',
      title: 'Resumen final',
      description: 'Resume decisiones, aprobaciones y resultados principales del job.',
      dependsOnStepIds: [step.id],
      inputPayload: { sourceAction: actionType, sourceResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Resumen final agregado',
      message: 'SUPL.IA agrego un cierre auditable del job.',
      severity: 'info',
    });
  }
}

async function appendStepsAfterCompletedStep(params: {
  auth: AuthContext;
  job: any;
  step: any;
  result: Record<string, unknown>;
}) {
  const { auth, job, step, result } = params;

  if (step.step_key === 'compliance_preflight') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 10,
      stepKey: 'campaign_draft_approval',
      agentName: 'campaign-operator',
      title: 'Guardar campana pausada',
      description: 'Convierte los previews aprobados por compliance en una campana guardable como borrador pausado.',
      dependsOnStepIds: [step.id],
      requiresApproval: true,
      inputPayload: { complianceResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Borrador de campana preparado',
      message: 'SUPL.IA agrego una aprobacion para guardar la campana pausada.',
      severity: 'info',
    });
  }

  if (step.step_key === 'reply_monitoring') {
    const classified = asRecord(result.classified);
    const actionable = findSupliaActionableReplyCandidate(classified);

    if (actionable?.contactedId) {
      await insertJobStepIfMissing({
        auth,
        job,
        stepOrder: 13,
        stepKey: buildSupliaThreadResponseStepKey(actionable.contactedId),
        agentName: 'thread-responder',
        title: 'Borrador de respuesta en hilo',
        description: 'Redacta una respuesta para una reply accionable y deja el envio como aprobacion fuerte.',
        dependsOnStepIds: [step.id],
        requiresApproval: true,
        inputPayload: { contactedId: actionable.contactedId, classification: actionable.classification },
      });
      await recordSupliaJobEvent({
        organizationId: auth.organizationId,
        jobId: job.id,
        stepId: step.id,
        eventType: 'job.steps_appended',
        title: 'Respuesta en hilo preparada',
        message: 'SUPL.IA detecto una reply accionable y agrego un borrador de respuesta aprobable.',
        severity: 'info',
      });
    }
  }

  if (step.step_key === 'memory_capture') {
    await insertJobStepIfMissing({
      auth,
      job,
      stepOrder: 16,
      stepKey: 'reporter',
      agentName: 'reporter',
      title: 'Resumen final',
      description: 'Resume decisiones, aprobaciones y resultados principales del job.',
      dependsOnStepIds: [step.id],
      inputPayload: { sourceStep: step.step_key, sourceResult: result },
    });
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: step.id,
      eventType: 'job.steps_appended',
      title: 'Resumen final agregado',
      message: 'SUPL.IA agrego un cierre auditable del job.',
      severity: 'info',
    });
  }
}

async function acquireStepLock(auth: AuthContext, step: any) {
  const admin = getSupabaseAdminClient();
  const startedAt = nowIso();
  const lockToken = randomUUID();
  const { data, error } = await admin
    .from('suplia_job_steps')
    .update({
      status: 'running',
      lock_token: lockToken,
      locked_at: startedAt,
      started_at: step.started_at || startedAt,
      updated_at: startedAt,
      error_message: null,
    })
    .eq('id', step.id)
    .eq('organization_id', auth.organizationId)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? { step: data, lockToken, startedAt } : null;
}

async function runStep(auth: AuthContext, job: any, step: any, previousSteps: any[], opts: { updateJobCurrentStep?: boolean } = {}) {
  const admin = getSupabaseAdminClient();
  const stepLock = await acquireStepLock(auth, step);
  if (!stepLock) return { status: 'skipped' };
  const activeStep = stepLock.step;
  const startedAt = stepLock.startedAt;
  const updateJobCurrentStep = opts.updateJobCurrentStep !== false;
  if (updateJobCurrentStep) {
    await admin
      .from('suplia_jobs')
      .update({ current_step_id: activeStep.id, progress_label: activeStep.title, updated_at: startedAt, last_heartbeat_at: startedAt })
      .eq('id', job.id);
  }
  await recordSupliaJobEvent({
    organizationId: auth.organizationId,
    jobId: job.id,
    stepId: activeStep.id,
    eventType: 'step.started',
    title: activeStep.title,
    message: activeStep.description,
  });
  const startedMessage = buildSupliaStepStartedMessage(activeStep);
  await appendSupliaJobChatMessage({
    auth,
    conversationId: job.conversation_id,
    jobId: job.id,
    stepId: activeStep.id,
    sourceKey: `job:${job.id}:step:${activeStep.id}:started`,
    content: startedMessage,
    parts: [
      { type: 'text', text: startedMessage },
      { type: 'job-progress', jobId: job.id, status: 'running', label: activeStep.title || activeStep.step_key },
    ],
  });

  const { data: agentRun, error: agentRunError } = await admin
    .from('suplia_agent_runs')
    .insert({
      job_id: job.id,
      step_id: activeStep.id,
      conversation_id: job.conversation_id,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      agent_name: activeStep.agent_name || 'planner',
      status: 'running',
      input_payload: { jobGoal: job.goal, stepInput: activeStep.input_payload || {} },
      started_at: startedAt,
    })
    .select('*')
    .single();
  if (agentRunError) throw agentRunError;

  try {
    await ensureSupliaJobRunnable(auth, job.id);
    const result = await withTimeout(
      runSupliaAgent(activeStep.agent_name || 'planner', { auth, job, step: activeStep, agentRunId: agentRun.id, previousSteps }),
      getSupliaStepTimeoutMs(),
      activeStep.title || activeStep.step_key || 'step',
    );
    await ensureSupliaJobRunnable(auth, job.id);
    const finishedAt = nowIso();

    if (result.artifacts?.length) {
      await insertSupliaArtifacts(auth, result.artifacts.map((artifact) => ({
        conversationId: job.conversation_id,
        jobId: job.id,
        sourceMessageId: null,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content || null,
        data: artifact.data || {},
        changeSummary: `${activeStep.agent_name || 'Subagente'} genero este artifact.`,
      })));
    }

    const actions = await persistStepActions({
      auth,
      job,
      step: activeStep,
      agentRunId: agentRun.id,
      actions: result.pendingActions || [],
      modelTier: result.modelTier,
      modelName: result.modelName,
    });

    await admin
      .from('suplia_agent_runs')
      .update({
        status: 'completed',
        model_tier: result.modelTier,
        model_name: result.modelName,
        token_usage: result.tokenUsage || null,
        estimated_cost: result.estimatedCost ?? null,
        output_payload: result.output || {},
        reasoning_summary: result.reasoningSummary || null,
        finished_at: finishedAt,
      })
      .eq('id', agentRun.id);

    const waitingForApproval = result.status === 'waiting_approval' || actions.length > 0;
    await admin
      .from('suplia_job_steps')
      .update({
        status: waitingForApproval ? 'waiting_approval' : 'completed',
        lock_token: null,
        locked_at: null,
        output_payload: result.output || {},
        progress_current: waitingForApproval ? 0 : 1,
        progress_total: 1,
        finished_at: waitingForApproval ? null : finishedAt,
        updated_at: finishedAt,
      })
      .eq('id', activeStep.id)
      .eq('lock_token', stepLock.lockToken);

    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: activeStep.id,
      agentRunId: agentRun.id,
      eventType: waitingForApproval ? 'step.waiting_approval' : 'step.completed',
      title: waitingForApproval ? 'Esperando aprobacion' : 'Step completado',
      message: waitingForApproval ? 'El subagente preparo una accion sensible para revisar.' : result.reasoningSummary || activeStep.title,
      severity: waitingForApproval ? 'warning' : 'success',
    });

    if (!waitingForApproval) {
      const completedMessage = buildSupliaStepCompletedMessage(activeStep, result.reasoningSummary || null);
      await appendSupliaJobChatMessage({
        auth,
        conversationId: job.conversation_id,
        jobId: job.id,
        stepId: activeStep.id,
        sourceKey: `job:${job.id}:step:${activeStep.id}:completed`,
        content: completedMessage,
        parts: [
          { type: 'text', text: completedMessage },
          { type: 'job-progress', jobId: job.id, status: 'running', label: result.reasoningSummary || activeStep.title || activeStep.step_key },
        ],
      });
    }

    if (!waitingForApproval) {
      await appendStepsAfterCompletedStep({ auth, job, step: activeStep, result: result.output || {} });
    }

    return { status: waitingForApproval ? 'waiting_approval' : 'completed' };
  } catch (error: any) {
    const failedAt = nowIso();
    const runtimeCode = getSupliaRuntimeErrorCode(error);
    const cancelled = runtimeCode === 'cancelled';
    const paused = runtimeCode === 'paused';
    const deferred = runtimeCode === 'deferred' || runtimeCode === 'rate_limited';
    const retryCount = cancelled || paused || deferred ? Number(activeStep.retry_count || 0) : Number(activeStep.retry_count || 0) + 1;
    const canRetry = !cancelled && (paused || deferred || retryCount < Number(activeStep.max_attempts || 3));
    const nextStatus = cancelled ? 'cancelled' : canRetry ? 'queued' : 'failed';
    const delayMs = paused || deferred ? getSupliaRetryAfterMs(error, 10000) : Math.min(60000, 2000 * 2 ** Math.max(0, retryCount - 1));

    await admin
      .from('suplia_agent_runs')
      .update({ status: cancelled ? 'cancelled' : 'failed', error_message: error?.message || 'Error ejecutando subagente', finished_at: failedAt })
      .eq('id', agentRun.id);
    await admin
      .from('suplia_job_steps')
      .update({
        status: nextStatus,
        lock_token: null,
        locked_at: null,
        error_message: error?.message || 'Error ejecutando subagente',
        retry_count: retryCount,
        scheduled_for: new Date(Date.now() + delayMs).toISOString(),
        updated_at: failedAt,
      })
      .eq('id', activeStep.id)
      .eq('lock_token', stepLock.lockToken);
    await recordSupliaJobEvent({
      organizationId: auth.organizationId,
      jobId: job.id,
      stepId: activeStep.id,
      agentRunId: agentRun.id,
      eventType: cancelled ? 'step.cancelled' : deferred ? 'step.deferred' : canRetry ? 'step.retry_scheduled' : 'step.failed',
      title: cancelled ? 'Step cancelado' : deferred ? 'Step reprogramado' : canRetry ? 'Reintento programado' : 'Step fallido',
      message: error?.message || 'Error ejecutando subagente',
      severity: cancelled || canRetry ? 'warning' : 'error',
    });

    if (!canRetry && !cancelled) throw error;
    return { status: 'queued' };
  }
}

export async function runSupliaJob(auth: AuthContext, jobId: string, opts: { maxSteps?: number } = {}) {
  const lock = await acquireJobLock(auth, jobId);
  if (!lock) return { processed: false, reason: 'locked_or_not_runnable' };
  const admin = getSupabaseAdminClient();
  const heartbeat = setInterval(() => {
    void heartbeatSupliaJob(auth, jobId, lock.lockToken).catch((error) => console.warn('[SUPLIA/job heartbeat] failed:', error?.message || error));
  }, JOB_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const maxSteps = Math.max(1, Math.min(Number(opts.maxSteps || 8), 20));
    let processedSteps = 0;

    for (let i = 0; i < maxSteps; i++) {
      await heartbeatSupliaJob(auth, jobId, lock.lockToken);
      const current = await getJobWithSteps(auth, jobId);
      if (!current) return { processed: processedSteps > 0, reason: 'job_missing' };
      if (TERMINAL_JOB_STATUSES.has(current.job.status) || current.job.status === 'paused') break;

      const waiting = current.steps.find((step) => step.status === 'waiting_approval');
      if (waiting) {
        await updateJobProgress(auth, current.job, current.steps);
        break;
      }

      const runnableBatch = pickSupliaRunnableStepBatch(current.steps, Date.now(), JOB_MAX_PARALLEL_STEPS);
      if (runnableBatch.length === 0) {
        await updateJobProgress(auth, current.job, current.steps);
        break;
      }

      if (runnableBatch.length === 1) {
        const [step] = runnableBatch;
        await runStep(auth, current.job, step, current.steps.filter((item) => Number(item.step_order || 0) < Number(step.step_order || 0)));
        processedSteps += 1;
        continue;
      }

      const batchStartedAt = nowIso();
      await admin
        .from('suplia_jobs')
        .update({
          current_step_id: runnableBatch[0]?.id || null,
          progress_label: getSupliaParallelBatchLabel(runnableBatch),
          updated_at: batchStartedAt,
        })
        .eq('id', current.job.id)
        .eq('organization_id', auth.organizationId);
      await recordSupliaJobEvent({
        organizationId: auth.organizationId,
        jobId: current.job.id,
        eventType: 'step.parallel_batch_started',
        title: 'Lote paralelo iniciado',
        message: `SUPL.IA inicio ${runnableBatch.length} steps independientes en paralelo.`,
        severity: 'info',
        metadata: { stepIds: runnableBatch.map((step) => step.id), stepKeys: runnableBatch.map((step) => step.step_key) },
      });

      const settled = await Promise.allSettled(runnableBatch.map((step) => runStep(
        auth,
        current.job,
        step,
        current.steps.filter((item) => Number(item.step_order || 0) < Number(step.step_order || 0)),
        { updateJobCurrentStep: false },
      )));
      const rejected = settled.filter((result) => result.status === 'rejected');
      if (rejected.length > 0) {
        await recordSupliaJobEvent({
          organizationId: auth.organizationId,
          jobId: current.job.id,
          eventType: 'step.parallel_batch_partial_failure',
          title: 'Lote paralelo con fallos parciales',
          message: `${rejected.length} de ${settled.length} steps fallaron; los exitosos quedaron persistidos.`,
          severity: 'warning',
          metadata: { errors: rejected.map((item: any) => item.reason?.message || 'unknown_error') },
        });
      }
      processedSteps += runnableBatch.length;
    }

    const finalState = await getJobWithSteps(auth, jobId);
    if (finalState) {
      await updateJobProgress(auth, finalState.job, finalState.steps);
      const allCompleted = finalState.steps.length > 0 && finalState.steps.every((step) => step.status === 'completed');
      if (allCompleted) {
        await recordSupliaJobEvent({
          organizationId: auth.organizationId,
          jobId,
          eventType: 'job.completed',
          title: 'Job completado',
          message: 'SUPL.IA termino el flujo inicial multiagente.',
          severity: 'success',
        });
        await appendSupliaJobChatMessage({
          auth,
          conversationId: finalState.job.conversation_id,
          jobId,
          sourceKey: `job:${jobId}:completed`,
          content: 'Trabajo completado. Ya deje los resultados, artifacts y acciones trazables en esta conversacion.',
          parts: [
            { type: 'text', text: 'Trabajo completado. Ya deje los resultados, artifacts y acciones trazables en esta conversacion.' },
            { type: 'job-progress', jobId, status: 'completed', label: 'Completado' },
          ],
        });
      }
    }

    return { processed: processedSteps > 0, processedSteps };
  } finally {
    clearInterval(heartbeat);
    await releaseJobLock(auth, jobId, lock.lockToken);
  }
}

export async function completeSupliaApprovalStep(auth: AuthContext, input: { jobId?: string | null; stepId?: string | null; actionId: string; actionType?: string | null; result: Record<string, unknown> }) {
  if (!input.jobId || !input.stepId) return;
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  const { data: job, error: jobError } = await admin
    .from('suplia_jobs')
    .select('*')
    .eq('id', input.jobId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (jobError) throw jobError;
  const { data: step, error: stepError } = await admin
    .from('suplia_job_steps')
    .select('*')
    .eq('id', input.stepId)
    .eq('job_id', input.jobId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (stepError) throw stepError;

  const { error } = await admin
    .from('suplia_job_steps')
    .update({
      status: 'completed',
      output_payload: { approvedActionId: input.actionId, result: input.result || {} },
      progress_current: 1,
      progress_total: 1,
      finished_at: timestamp,
      updated_at: timestamp,
    })
    .eq('id', input.stepId)
    .eq('job_id', input.jobId)
    .eq('organization_id', auth.organizationId);
  if (error) throw error;

  if (job && step && input.actionType) {
    await appendStepsAfterApproval({
      auth,
      job,
      step,
      actionType: input.actionType,
      result: input.result || {},
    });
  }

  await admin
    .from('suplia_jobs')
    .update({ status: 'queued', progress_label: 'Aprobacion ejecutada', updated_at: timestamp })
    .eq('id', input.jobId)
    .eq('organization_id', auth.organizationId)
    .in('status', ['waiting_approval', 'running', 'queued']);

  await recordSupliaJobEvent({
    organizationId: auth.organizationId,
    jobId: input.jobId,
    stepId: input.stepId,
    eventType: 'approval.executed',
    title: 'Aprobacion ejecutada',
    message: 'El resultado aprobado fue asociado al job.',
    severity: 'success',
    metadata: { actionId: input.actionId },
  });

  await runSupliaJob(auth, input.jobId, { maxSteps: 4 });
}

export async function cancelSupliaApprovalStep(auth: AuthContext, input: { jobId?: string | null; stepId?: string | null; actionId: string }) {
  if (!input.jobId || !input.stepId) return;
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  await admin
    .from('suplia_job_steps')
    .update({ status: 'cancelled', error_message: 'Aprobacion cancelada por el usuario.', finished_at: timestamp, updated_at: timestamp })
    .eq('id', input.stepId)
    .eq('job_id', input.jobId)
    .eq('organization_id', auth.organizationId);
  await admin
    .from('suplia_jobs')
    .update({ status: 'cancelled', progress_label: 'Cancelado', cancelled_at: timestamp, finished_at: timestamp, updated_at: timestamp })
    .eq('id', input.jobId)
    .eq('organization_id', auth.organizationId);
  await recordSupliaJobEvent({
    organizationId: auth.organizationId,
    jobId: input.jobId,
    stepId: input.stepId,
    eventType: 'approval.cancelled',
    title: 'Aprobacion cancelada',
    message: 'El job fue cancelado porque la accion sensible no fue aprobada.',
    severity: 'warning',
    metadata: { actionId: input.actionId },
  });
}

export async function pauseSupliaJob(auth: AuthContext, jobId: string) {
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  const { data, error } = await admin
    .from('suplia_jobs')
    .update({ status: 'paused', paused_at: timestamp, lock_token: null, locked_at: null, progress_label: 'Pausado', updated_at: timestamp })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .not('status', 'in', '(completed,failed,cancelled)')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    await recordSupliaJobEvent({ organizationId: auth.organizationId, jobId, eventType: 'job.paused', title: 'Job pausado', severity: 'warning' });
  }
  return data ? mapSupliaJobRow(data) : null;
}

export async function resumeSupliaJob(auth: AuthContext, jobId: string) {
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  const { data, error } = await admin
    .from('suplia_jobs')
    .update({ status: 'queued', paused_at: null, progress_label: 'Reanudado', updated_at: timestamp })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .eq('status', 'paused')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    await recordSupliaJobEvent({ organizationId: auth.organizationId, jobId, eventType: 'job.resumed', title: 'Job reanudado', severity: 'info' });
    await runSupliaJob(auth, jobId, { maxSteps: 4 });
  }
  return data ? mapSupliaJobRow(data) : null;
}

export async function cancelSupliaJob(auth: AuthContext, jobId: string) {
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  const { data, error } = await admin
    .from('suplia_jobs')
    .update({ status: 'cancelled', cancelled_at: timestamp, finished_at: timestamp, lock_token: null, locked_at: null, progress_label: 'Cancelado', updated_at: timestamp })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId)
    .not('status', 'in', '(completed,cancelled)')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    await admin
      .from('suplia_job_steps')
      .update({ status: 'cancelled', updated_at: timestamp, finished_at: timestamp })
      .eq('job_id', jobId)
      .eq('organization_id', auth.organizationId)
      .in('status', ['queued', 'running', 'waiting_approval']);
    await admin
      .from('suplia_pending_actions')
      .update({ status: 'cancelled', updated_at: timestamp })
      .eq('job_id', jobId)
      .eq('organization_id', auth.organizationId)
      .eq('status', 'pending');
    await admin
      .from('suplia_tool_runs')
      .update({ status: 'cancelled', finished_at: timestamp })
      .eq('job_id', jobId)
      .eq('organization_id', auth.organizationId)
      .in('status', ['queued', 'running', 'requires_approval']);
    await recordSupliaJobEvent({ organizationId: auth.organizationId, jobId, eventType: 'job.cancelled', title: 'Job cancelado', severity: 'warning' });
  }
  return data ? mapSupliaJobRow(data) : null;
}

export async function retrySupliaJobStep(auth: AuthContext, jobId: string, stepId?: string | null) {
  const admin = getSupabaseAdminClient();
  const timestamp = nowIso();
  let targetStepId = stepId || null;

  if (!targetStepId) {
    const { data: failedStep, error } = await admin
      .from('suplia_job_steps')
      .select('id')
      .eq('job_id', jobId)
      .eq('organization_id', auth.organizationId)
      .in('status', ['failed', 'cancelled'])
      .order('step_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    targetStepId = failedStep?.id || null;
  }

  if (!targetStepId) return null;

  const { data, error } = await admin
    .from('suplia_job_steps')
    .update({ status: 'queued', error_message: null, retry_count: 0, scheduled_for: timestamp, finished_at: null, updated_at: timestamp })
    .eq('id', targetStepId)
    .eq('job_id', jobId)
    .eq('organization_id', auth.organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await admin
    .from('suplia_jobs')
    .update({ status: 'queued', error_message: null, finished_at: null, cancelled_at: null, progress_label: 'Reintentando', updated_at: timestamp })
    .eq('id', jobId)
    .eq('organization_id', auth.organizationId);
  await recordSupliaJobEvent({ organizationId: auth.organizationId, jobId, stepId: targetStepId, eventType: 'step.retry_requested', title: 'Reintento solicitado', severity: 'info' });
  await runSupliaJob(auth, jobId, { maxSteps: 4 });
  return mapSupliaJobStepRow(data);
}

export async function loadSupliaJobsForConversation(auth: AuthContext, conversationId: string) {
  const admin = getSupabaseAdminClient();
  const { data: jobs, error: jobsError } = await admin
    .from('suplia_jobs')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false })
    .limit(8);
  if (jobsError) throw jobsError;

  const mappedJobs = (jobs || []).map(mapSupliaJobRow);
  const activeJob = mappedJobs.find((job) => !TERMINAL_JOB_STATUSES.has(job.status)) || mappedJobs[0] || null;
  if (!activeJob) return { jobs: mappedJobs, activeJob: null, jobSteps: [], agentRuns: [], jobEvents: [] };

  const [stepsRes, agentRunsRes, eventsRes] = await Promise.all([
    admin.from('suplia_job_steps').select('*').eq('job_id', activeJob.id).order('step_order', { ascending: true }),
    admin.from('suplia_agent_runs').select('*').eq('job_id', activeJob.id).order('created_at', { ascending: false }).limit(20),
    admin.from('suplia_job_events').select('*').eq('job_id', activeJob.id).order('created_at', { ascending: false }).limit(30),
  ]);

  const firstError = [stepsRes, agentRunsRes, eventsRes].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  return {
    jobs: mappedJobs,
    activeJob,
    jobSteps: (stepsRes.data || []).map(mapSupliaJobStepRow),
    agentRuns: (agentRunsRes.data || []).map(mapSupliaAgentRunRow),
    jobEvents: (eventsRes.data || []).map(mapSupliaJobEventRow),
  };
}
