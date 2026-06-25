import type { AuthContext } from '@/lib/server/auth-utils';
import { selectSupliaModelTier } from '@/ai/model-router';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { ensureSupliaPromptConversationContext } from '@/lib/server/suplia-conversation-context';
import { insertSupliaArtifacts, mapSupliaArtifactRow, updateSupliaArtifact } from '@/lib/server/suplia-artifacts';
import { normalizeSupliaBrainWorkflowRequest, repairSupliaNoOpOperationalOutput, runSupliaBrain, type SupliaBrainOutput, type SupliaBrainOutputResult, type SupliaBrainToolResult } from '@/lib/server/suplia-brain';
import { buildSupliaContext } from '@/lib/server/suplia-context';
import { createSupliaJobFromMessage, loadSupliaJobsForConversation, runSupliaJob } from '@/lib/server/suplia-job-runner';
import { canRunWithoutApproval, getSupliaPolicy } from '@/lib/server/suplia-policy';
import { getSupliaTool } from '@/lib/server/suplia-tools';
import { mapSupliaToolRunRow, recordSupliaToolPendingApproval, runSupliaTool } from '@/lib/server/suplia-tool-runner';
import { buildSupliaArtifactChangeSummary, selectSupliaArtifactUpdateTarget } from '@/lib/suplia/artifacts';
import { classifySupliaIntent } from '@/lib/suplia/intent';
import { buildSupliaJobIntroMessage } from '@/lib/suplia/job-narration';
import type { SupliaArtifact, SupliaAskAnswerPayload, SupliaChatResponse, SupliaConversation, SupliaMemory, SupliaMessage, SupliaMessagePart, SupliaPendingAction } from '@/lib/suplia/types';
import { formatSupliaWorkflowPlan, generateSupliaWorkflowPlan } from '@/lib/server/suplia-workflow-plan';

type AgentOutput = SupliaBrainOutput;
type AgentOutputResult = SupliaBrainOutputResult;

function mapConversation(row: any): SupliaConversation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: any): SupliaMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapPendingAction(row: any): SupliaPendingAction {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    jobId: row.job_id,
    stepId: row.step_id,
    actionType: row.action_type,
    status: row.status,
    title: row.title,
    description: row.description,
    payload: row.payload || {},
    result: row.result,
    errorMessage: row.error_message,
    riskLevel: row.risk_level,
    requiresApproval: row.requires_approval,
    approvalKind: row.approval_kind,
    approvalReason: row.approval_reason,
    toolName: row.tool_name,
    toolRunId: row.tool_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: any): SupliaMemory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    scope: row.scope,
    memoryType: row.memory_type,
    key: row.key,
    value: row.value || {},
    confidence: Number(row.confidence || 0),
    status: row.status,
    sourceConversationId: row.source_conversation_id,
    sourceJobId: row.source_job_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean || 'Nueva conversacion';
}

function sortMessagesAscending(messages: SupliaMessage[]) {
  return [...messages].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
}

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function loadConversationMessagesForPrompt(conversationId: string, organizationId: string) {
  const admin = getSupabaseAdminClient();
  const pageSize = 1000;
  const maxPages = 10;
  const rows: any[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await admin
      .from('suplia_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows.map(mapMessage);
}

function textPart(text: string) {
  return { type: 'text' as const, text };
}

function artifactPart(artifact: Pick<SupliaArtifact, 'id' | 'type' | 'title'> | { id?: string | null; type: string; title: string }) {
  return {
    type: 'artifact-card' as const,
    artifactId: artifact.id || null,
    artifactType: artifact.type,
    title: artifact.title,
  };
}

function tablePart(table: AgentOutput['tables'][number]) {
  return {
    type: 'table' as const,
    headers: (table.headers || []).map(cleanText).filter(Boolean).slice(0, 8),
    rows: (table.rows || [])
      .map((row) => (Array.isArray(row) ? row : []).map((cell) => cleanText(cell).slice(0, 500)).slice(0, 8))
      .filter((row) => row.some(Boolean))
      .slice(0, 20),
  };
}

function codePart(block: AgentOutput['codeBlocks'][number]) {
  return {
    type: 'code' as const,
    language: cleanText(block.language) || null,
    content: String(block.content || '').slice(0, 12000),
  };
}

type BrainAskRequest = AgentOutput['askRequests'][number];

function normalizeAskQuestions(request: BrainAskRequest) {
  const source = Array.isArray(request.questions) && request.questions.length > 0
    ? request.questions
    : [{
      header: request.header,
      question: request.question,
      options: request.options,
      multi: request.multi,
      allowOther: request.allowOther,
    }];

  return source.map((question) => {
    const options = (question.options || [])
      .map((option) => ({ label: cleanText(option.label), description: cleanText(option.description) || null }))
      .filter((option) => option.label)
      .slice(0, 4);
    return {
      header: cleanText(question.header) || null,
      question: cleanText(question.question),
      options,
      multi: Boolean(question.multi),
      allowOther: question.allowOther !== false || options.length === 0,
    };
  }).filter((question) => question.question).slice(0, 4);
}

function hasValidAskRequest(request: BrainAskRequest) {
  return normalizeAskQuestions(request).length > 0;
}

function buildAskParts(requests: AgentOutput['askRequests'], conversationId: string): SupliaMessagePart[] {
  return (requests || []).filter(hasValidAskRequest).slice(0, 1).map((request, index) => {
    const questions = normalizeAskQuestions(request);
    const askId = cleanText(request.askId) || `${conversationId}:ask:${Date.now()}:${index}`;
    const submitLabel = cleanText(request.submitLabel) || 'Enviar';

    if (questions.length === 1) {
      const question = questions[0]!;
      return {
        type: 'ask' as const,
        askId,
        header: question.header,
        question: question.question,
        options: question.options,
        multi: question.multi,
        allowOther: question.allowOther,
        submitLabel,
      };
    }

    return {
      type: 'ask' as const,
      askId,
      questions,
      submitLabel,
    };
  });
}

type ToolResultForPrompt = SupliaBrainToolResult;

function sanitizeToolRequests(requests: AgentOutput['toolRequests']) {
  const seen = new Set<string>();

  return requests.filter((request) => {
    const toolName = String(request.toolName || '').trim();
    const key = `${toolName}:${JSON.stringify(request.input || {})}`;
    if (!toolName || seen.has(key)) return false;
    if (!getSupliaTool(toolName) || !canRunWithoutApproval(toolName)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4).map((request) => ({
    toolName: String(request.toolName || '').trim(),
    input: request.input || {},
    reason: request.reason,
  }));
}

function isValidEmailAction(action: AgentOutput['pendingActions'][number]) {
  if (action.actionType !== 'email.send') return false;
  const payload = action.payload || {};
  return Boolean(
    String(payload.to || '').trim() &&
    String(payload.subject || '').trim() &&
    String(payload.htmlBody || payload.textBody || '').trim()
  );
}

function isValidProspectingAction(action: AgentOutput['pendingActions'][number]) {
  const payload = action.payload || {};
  if (action.actionType === 'prospecting.search_companies') {
    return Boolean(String(payload.companyName || payload.company || payload.query || '').trim());
  }

  if (action.actionType === 'prospecting.search_people') {
    const hasDomains = Array.isArray(payload.domains) && payload.domains.length > 0;
    const hasCompanyNames = Array.isArray(payload.companyNames) && payload.companyNames.length > 0;
    return hasDomains || hasCompanyNames || Boolean(String(payload.companyName || payload.companies || '').trim());
  }

  return false;
}

function isValidCampaignAction(action: AgentOutput['pendingActions'][number]) {
  const payload = action.payload || {};
  if (action.actionType === 'campaign.launch' || action.actionType === 'campaign.pause' || action.actionType === 'campaign.resume') {
    return Boolean(String(payload.campaignId || payload.id || '').trim());
  }
  if (action.actionType === 'campaign.update') {
    return Boolean(String(payload.campaignId || payload.id || '').trim()) && Boolean(String(payload.name || payload.title || '').trim() || payload.settings || payload.excludedLeadIds);
  }
  if (action.actionType !== 'campaign.create_draft') return false;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  return steps.some((step: any) => String(step?.subject || step?.subjectTemplate || '').trim() && String(step?.bodyHtml || step?.bodyTemplate || '').trim());
}

function isValidBulkSendAction(action: AgentOutput['pendingActions'][number]) {
  if (action.actionType !== 'email.bulk_send') return false;
  const payload = action.payload || {};
  const messages = Array.isArray(payload.messages) ? payload.messages : Array.isArray(payload.items) ? payload.items : [];
  return messages.length > 0;
}

function isValidCrmAction(action: AgentOutput['pendingActions'][number]) {
  const payload = action.payload || {};
  const hasLead = Boolean(String(payload.leadId || payload.ids || '').trim()) || (Array.isArray(payload.leadIds) && payload.leadIds.length > 0);
  if (!hasLead) return false;
  if (action.actionType === 'crm.update_stage') return Boolean(String(payload.stage || payload.status || '').trim());
  if (action.actionType === 'crm.set_next_action') return Boolean(String(payload.nextAction || payload.action || payload.note || '').trim());
  if (action.actionType === 'crm.add_note') return Boolean(String(payload.note || payload.notes || '').trim());
  if (action.actionType === 'crm.assign_owner') return Boolean(String(payload.owner || payload.ownerId || payload.assignee || '').trim());
  return false;
}

function isValidFollowupAction(action: AgentOutput['pendingActions'][number]) {
  if (action.actionType !== 'followup.create_tasks') return false;
  const payload = action.payload || {};
  return Array.isArray(payload.tasks) && payload.tasks.length > 0;
}

function isValidThreadAction(action: AgentOutput['pendingActions'][number]) {
  if (action.actionType !== 'thread.reply_send') return false;
  const payload = action.payload || {};
  if (String(payload.draftId || payload.replyDraftId || '').trim()) return true;
  return Boolean(String(payload.to || '').trim() && String(payload.subject || '').trim() && String(payload.htmlBody || payload.textBody || '').trim());
}

function isValidMemoryAction(action: AgentOutput['pendingActions'][number]) {
  if (action.actionType !== 'memory.save' && action.actionType !== 'memory.forget') return false;
  const payload = action.payload || {};
  return Boolean(String(payload.memoryId || payload.id || '').trim());
}

function isValidAntoniaAction(action: AgentOutput['pendingActions'][number]) {
  const payload = action.payload || {};
  if (action.actionType !== 'antonia.create_mission') return false;
  return Boolean(String(payload.goalSummary || payload.goal || payload.description || '').trim());
}

function isValidGmailAction(action: AgentOutput['pendingActions'][number]) {
  const payload = action.payload || {};
  if (action.actionType === 'gmail.find_contacted_leads') {
    return Boolean(String(payload.topic || payload.query || '').trim());
  }
  if (action.actionType === 'gmail.search_messages' || action.actionType === 'gmail.search_threads') {
    return Boolean(String(payload.query || payload.topic || '').trim());
  }
  if (action.actionType === 'gmail.get_message') return Boolean(String(payload.messageId || payload.id || '').trim());
  if (action.actionType === 'gmail.get_thread') return Boolean(String(payload.threadId || payload.id || '').trim());
  return false;
}

function sanitizeAgentOutput<T extends AgentOutput>(output: T): T {
  const hasAskRequests = (output.askRequests || []).some(hasValidAskRequest);
  const pendingActions = output.pendingActions.filter((action) => {
    if (action.actionType === 'email.send') return isValidEmailAction(action);
    if (action.actionType === 'email.bulk_send') return isValidBulkSendAction(action);
    if (action.actionType === 'prospecting.search_companies' || action.actionType === 'prospecting.search_people') return isValidProspectingAction(action);
    if (action.actionType === 'campaign.create_draft' || action.actionType === 'campaign.update' || action.actionType === 'campaign.launch' || action.actionType === 'campaign.pause' || action.actionType === 'campaign.resume') return isValidCampaignAction(action);
    if (action.actionType === 'crm.update_stage' || action.actionType === 'crm.set_next_action' || action.actionType === 'crm.add_note' || action.actionType === 'crm.assign_owner') return isValidCrmAction(action);
    if (action.actionType === 'followup.create_tasks') return isValidFollowupAction(action);
    if (action.actionType === 'thread.reply_send') return isValidThreadAction(action);
    if (action.actionType === 'memory.save' || action.actionType === 'memory.forget') return isValidMemoryAction(action);
    if (action.actionType === 'antonia.create_mission') return isValidAntoniaAction(action);
    if (action.actionType.startsWith('gmail.')) return isValidGmailAction(action);
    return false;
  });

  return {
    ...output,
    reply: output.reply,
    artifacts: hasAskRequests ? [] : output.artifacts.slice(0, 5),
    tables: hasAskRequests ? [] : (output.tables || []).map(tablePart).filter((table) => table.headers.length > 0 && table.rows.length > 0).slice(0, 3),
    codeBlocks: hasAskRequests ? [] : (output.codeBlocks || []).map(codePart).filter((block) => block.content).slice(0, 3),
    askRequests: hasAskRequests ? (output.askRequests || []).filter(hasValidAskRequest).slice(0, 1) : [],
    toolRequests: hasAskRequests ? [] : sanitizeToolRequests(output.toolRequests || []),
    pendingActions: hasAskRequests ? [] : pendingActions.slice(0, 3),
    workflowRequest: hasAskRequests ? { kind: 'none' } : output.workflowRequest,
  } as T;
}

async function runRequestedTools(params: {
  auth: AuthContext;
  conversationId: string;
  messageId: string;
  requests: AgentOutput['toolRequests'];
  modelTier: ReturnType<typeof selectSupliaModelTier>;
}): Promise<ToolResultForPrompt[]> {
  const results: ToolResultForPrompt[] = [];

  for (const request of sanitizeToolRequests(params.requests)) {
    try {
      const { output } = await runSupliaTool({
        auth: params.auth,
        conversationId: params.conversationId,
        messageId: params.messageId,
        toolName: request.toolName,
        input: request.input || {},
        modelTier: params.modelTier,
      });
      results.push({ toolName: request.toolName, input: request.input || {}, status: 'completed', output });
    } catch (error: any) {
      results.push({
        toolName: request.toolName,
        input: request.input || {},
        status: 'failed',
        error: error?.message || 'No se pudo ejecutar la herramienta.',
      });
    }
  }

  return results;
}

async function persistPendingActions(params: {
  auth: AuthContext;
  conversationId: string;
  messageId: string;
  actions: AgentOutput['pendingActions'];
  modelTier: ReturnType<typeof selectSupliaModelTier>;
}) {
  if (params.actions.length === 0) return;

  const admin = getSupabaseAdminClient();
  const rows = params.actions.map((action) => {
    const toolName = action.actionType;
    const policy = getSupliaPolicy(toolName);
    return {
      conversation_id: params.conversationId,
      organization_id: params.auth.organizationId,
      user_id: params.auth.user.id,
      action_type: action.actionType,
      status: 'pending',
      title: action.title,
      description: action.description || policy.approvalReason,
      payload: action.payload || {},
      risk_level: policy.riskLevel,
      requires_approval: policy.requiresApproval,
      approval_kind: policy.approvalKind,
      approval_reason: policy.approvalReason,
      tool_name: toolName,
    };
  });

  const { data, error } = await admin.from('suplia_pending_actions').insert(rows).select('*');
  if (error) throw error;

  for (const action of data || []) {
    const toolRun = await recordSupliaToolPendingApproval({
      auth: params.auth,
      conversationId: params.conversationId,
      messageId: params.messageId,
      pendingActionId: action.id,
      toolName: action.tool_name || action.action_type,
      input: action.payload || {},
      modelTier: params.modelTier,
    });
    await admin
      .from('suplia_pending_actions')
      .update({ tool_run_id: toolRun.id, updated_at: new Date().toISOString() })
      .eq('id', action.id);
  }
}

async function persistWorkflowPlanApproval(params: {
  auth: AuthContext;
  conversationId: string;
  goal: string;
  context: Awaited<ReturnType<typeof buildSupliaContext>>;
  brainOutput?: AgentOutputResult | null;
}) {
  const admin = getSupabaseAdminClient();
  const { plan, telemetry } = await generateSupliaWorkflowPlan({ goal: params.goal, context: params.context });
  const planContent = formatSupliaWorkflowPlan(plan);
  const [artifact] = await insertSupliaArtifacts(params.auth, [{
    conversationId: params.conversationId,
    sourceMessageId: null,
    type: 'plan',
    title: plan.title || 'Plan de trabajo',
    content: planContent,
    data: { plan, goal: params.goal, telemetry },
    changeSummary: 'Plan inicial creado antes de ejecutar agentes.',
  }]);
  const policy = getSupliaPolicy('workflow.approve_plan');
  const now = new Date().toISOString();
  const { data: action, error: actionError } = await admin
    .from('suplia_pending_actions')
    .insert({
      conversation_id: params.conversationId,
      organization_id: params.auth.organizationId,
      user_id: params.auth.user.id,
      action_type: 'workflow.approve_plan',
      status: 'pending',
      title: 'Aprobar plan de trabajo',
      description: `${plan.summary} Si apruebas, creo el job multiagente y continuo sin consumir creditos externos hasta pedirte otra aprobacion.`,
      payload: {
        goal: params.goal,
        originalMessage: params.goal,
        planTitle: plan.title,
        planSummary: plan.summary,
        steps: plan.steps,
        assumptions: plan.assumptions,
        risks: plan.risks,
        artifactId: artifact?.id || null,
        source: 'suplia_pre_job_plan',
      },
      risk_level: policy.riskLevel,
      requires_approval: policy.requiresApproval,
      approval_kind: policy.approvalKind,
      approval_reason: policy.approvalReason,
      tool_name: 'workflow.approve_plan',
      updated_at: now,
    })
    .select('*')
    .single();
  if (actionError) throw actionError;

  const reply = [
    'Prepare un plan antes de ejecutar agentes.',
    '',
    planContent,
  ].join('\n');

  const { data: messageRow, error: messageError } = await admin.from('suplia_messages').insert({
    conversation_id: params.conversationId,
    organization_id: params.auth.organizationId,
    user_id: params.auth.user.id,
    role: 'assistant',
    content: reply,
    metadata: {
      generatedBy: 'suplia-workflow-plan',
      actionId: action.id,
      artifactId: artifact?.id || null,
      brain: params.brainOutput ? {
        reply: params.brainOutput.reply,
        reasoningSummary: params.brainOutput.reasoningSummary || null,
        workflowRequest: params.brainOutput.workflowRequest || { kind: 'none' },
        modelTelemetry: params.brainOutput.modelTelemetry || null,
      } : null,
      modelTelemetry: telemetry || null,
      parts: [
        textPart(reply),
        ...(artifact ? [artifactPart(artifact)] : []),
        { type: 'approval-request', actionId: action.id, title: action.title, approvalKind: action.approval_kind || 'simple' },
      ],
    },
    created_at: now,
  }).select('id').single();
  if (messageError) throw messageError;

  const toolRun = await recordSupliaToolPendingApproval({
    auth: params.auth,
    conversationId: params.conversationId,
    messageId: messageRow.id,
    pendingActionId: action.id,
    toolName: 'workflow.approve_plan',
    input: action.payload || {},
    modelTier: 'orchestrator',
  });

  const updates: Array<PromiseLike<unknown>> = [
    admin
      .from('suplia_pending_actions')
      .update({ tool_run_id: toolRun.id, updated_at: now })
      .eq('id', action.id),
    admin
      .from('suplia_conversations')
      .update({ updated_at: now })
      .eq('id', params.conversationId)
      .eq('organization_id', params.auth.organizationId),
  ];

  if (artifact?.id) {
    updates.push(admin
      .from('suplia_artifacts')
      .update({ source_message_id: messageRow.id, updated_at: now })
      .eq('id', artifact.id)
      .eq('organization_id', params.auth.organizationId));
  }

  await Promise.all(updates);
}

export async function getSupliaState(auth: AuthContext, conversationId?: string | null): Promise<SupliaChatResponse> {
  const admin = getSupabaseAdminClient();
  const { data: conversationRows, error: conversationsError } = await admin
    .from('suplia_conversations')
    .select('*')
    .eq('organization_id', auth.organizationId)
    .order('updated_at', { ascending: false })
    .limit(24);

  if (conversationsError) throw conversationsError;

  const conversations = (conversationRows || []).map(mapConversation);
  let conversation = conversationId
    ? conversations.find((item) => item.id === conversationId) || null
    : conversations[0] || null;

  if (conversationId && !conversation) {
    const { data, error } = await admin
      .from('suplia_conversations')
      .select('*')
      .eq('organization_id', auth.organizationId)
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw error;
    conversation = data ? mapConversation(data) : null;
  }

  if (!conversation) {
    return { conversation: null, conversations, messages: [], artifacts: [], pendingActions: [], toolRuns: [], jobs: [], activeJob: null, jobSteps: [], agentRuns: [], jobEvents: [], memories: [] };
  }

  const [messagesRes, artifactsRes, actionsRes, toolRunsRes, memoriesRes, jobsState] = await Promise.all([
    admin.from('suplia_messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(200),
    admin.from('suplia_artifacts').select('*').eq('conversation_id', conversation.id).order('updated_at', { ascending: false }).order('created_at', { ascending: false }).limit(30),
    admin.from('suplia_pending_actions').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(30),
    admin.from('suplia_tool_runs').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(40),
    admin.from('suplia_memories').select('*').eq('organization_id', auth.organizationId).in('status', ['proposed', 'approved']).order('updated_at', { ascending: false }).limit(12),
    loadSupliaJobsForConversation(auth, conversation.id),
  ]);

  const firstError = [messagesRes, artifactsRes, actionsRes, toolRunsRes, memoriesRes].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  return {
    conversation,
    conversations,
    messages: sortMessagesAscending((messagesRes.data || []).map(mapMessage)),
    artifacts: (artifactsRes.data || []).map(mapSupliaArtifactRow),
    pendingActions: (actionsRes.data || []).map(mapPendingAction),
    toolRuns: (toolRunsRes.data || []).map(mapSupliaToolRunRow),
    memories: (memoriesRes.data || []).map(mapMemory),
    ...jobsState,
  };
}

export async function processSupliaMessage(auth: AuthContext, input: { conversationId?: string | null; message: string; activeArtifactId?: string | null; answerToAsk?: SupliaAskAnswerPayload | null }): Promise<SupliaChatResponse> {
  const admin = getSupabaseAdminClient();
  const message = input.message.trim();
  if (!message) throw new Error('Mensaje requerido.');

  let conversationId = input.conversationId || null;
  const now = new Date().toISOString();

  if (conversationId) {
    const { data: existing, error } = await admin
      .from('suplia_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!existing) conversationId = null;
  }

  if (!conversationId) {
    const { data, error } = await admin
      .from('suplia_conversations')
      .insert({
        organization_id: auth.organizationId,
        user_id: auth.user.id,
        title: buildTitle(message),
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;
    conversationId = data.id;
  }

  const activeConversationId = conversationId;
  if (!activeConversationId) throw new Error('No se pudo crear la conversacion.');

  const { data: userMessageRow, error: userMessageError } = await admin.from('suplia_messages').insert({
    conversation_id: activeConversationId,
    organization_id: auth.organizationId,
    user_id: auth.user.id,
    role: 'user',
    content: message,
    metadata: { parts: [textPart(message)], ...(input.answerToAsk ? { answerToAsk: input.answerToAsk } : {}) },
    created_at: now,
  }).select('id').single();
  if (userMessageError) throw userMessageError;

  const intent = classifySupliaIntent(message);

  const stateBefore = await getSupliaState(auth, activeConversationId);
  const context = await buildSupliaContext(auth);
  const promptMessages = await loadConversationMessagesForPrompt(activeConversationId, auth.organizationId);
  const conversationContext = await ensureSupliaPromptConversationContext({
    auth,
    conversation: stateBefore.conversation!,
    messages: promptMessages,
  });
  const modelTier = selectSupliaModelTier({ message, messages: promptMessages });
  const artifactUpdateTargetId = selectSupliaArtifactUpdateTarget(intent, input.activeArtifactId, stateBefore.artifacts);
  const plannedOutput = sanitizeAgentOutput(await runSupliaBrain({
    message,
    messages: promptMessages,
    conversationContext: conversationContext.promptContext,
    artifacts: stateBefore.artifacts,
    context,
    allowToolRequests: true,
  }));
  const plannedWorkflowRequest = normalizeSupliaBrainWorkflowRequest(plannedOutput.workflowRequest, message);
  const toolResults = plannedWorkflowRequest.kind === 'none' && plannedOutput.toolRequests.length > 0
    ? await runRequestedTools({
      auth,
      conversationId: activeConversationId,
      messageId: userMessageRow.id,
      requests: plannedOutput.toolRequests,
      modelTier,
    })
    : [];
  const rawAgentOutput = toolResults.length > 0
    ? sanitizeAgentOutput(await runSupliaBrain({
      message,
      messages: promptMessages,
      conversationContext: conversationContext.promptContext,
      artifacts: stateBefore.artifacts,
      context,
      toolResults,
      allowToolRequests: false,
    }))
    : plannedOutput;
  const repairedAgentOutput = sanitizeAgentOutput(repairSupliaNoOpOperationalOutput(rawAgentOutput, message));
  const agentOutput: AgentOutputResult = {
    ...repairedAgentOutput,
    modelTelemetry: rawAgentOutput.modelTelemetry || null,
  };
  const askParts = buildAskParts(agentOutput.askRequests || [], activeConversationId);
  if (askParts.length > 0) {
    const reply = agentOutput.reply.trim() || 'Necesito afinar un dato antes de avanzar.';
    await admin.from('suplia_messages').insert({
      conversation_id: activeConversationId,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      role: 'assistant',
      content: reply,
      metadata: {
        generatedBy: 'suplia-clarification',
        intent,
        artifactUpdateTargetId,
        reasoningSummary: agentOutput.reasoningSummary || null,
        workflowRequest: { kind: 'none' },
        planningModelTelemetry: plannedOutput.modelTelemetry || null,
        modelTelemetry: agentOutput.modelTelemetry || null,
        compactionTelemetry: conversationContext.telemetry,
        toolResults: toolResults.map((result) => ({ toolName: result.toolName, status: result.status })),
        parts: [
          textPart(reply),
          ...askParts,
        ],
      },
      created_at: new Date().toISOString(),
    });

    await admin
      .from('suplia_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', activeConversationId)
      .eq('organization_id', auth.organizationId);

    return getSupliaState(auth, activeConversationId);
  }
  const workflowRequest = normalizeSupliaBrainWorkflowRequest(agentOutput.workflowRequest, message);

  if (workflowRequest.kind === 'plan_approval') {
    await persistWorkflowPlanApproval({
      auth,
      conversationId: activeConversationId,
      goal: workflowRequest.goal || message,
      context,
      brainOutput: agentOutput,
    });

    return getSupliaState(auth, activeConversationId);
  }

  if (workflowRequest.kind === 'gmail_job') {
    const job = await createSupliaJobFromMessage(auth, {
      conversationId: activeConversationId,
      message: workflowRequest.goal || message,
      messageId: userMessageRow.id,
      jobType: 'gmail_mailbox_analysis',
    });
    const jobIntro = buildSupliaJobIntroMessage({ id: job.id, jobType: job.jobType, goal: job.goal });
    const reply = agentOutput.reply.trim() || jobIntro;

    await admin.from('suplia_messages').insert({
      conversation_id: activeConversationId,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      role: 'assistant',
      content: reply,
      metadata: {
        generatedBy: 'suplia-ai-first-gmail-job',
        jobId: job.id,
        intent,
        reasoningSummary: agentOutput.reasoningSummary || null,
        workflowRequest,
        planningModelTelemetry: plannedOutput.modelTelemetry || null,
        modelTelemetry: agentOutput.modelTelemetry || null,
        parts: [
          textPart(reply),
          { type: 'job-progress', jobId: job.id, status: job.status, label: job.progressLabel || 'En cola' },
        ],
      },
      created_at: new Date().toISOString(),
    });

    await runSupliaJob(auth, job.id, { maxSteps: 3 });

    await admin
      .from('suplia_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', activeConversationId)
      .eq('organization_id', auth.organizationId);

    return getSupliaState(auth, activeConversationId);
  }

  const baseMessageMetadata = {
    generatedBy: 'suplia-orchestrator',
    intent,
    artifactUpdateTargetId,
    reasoningSummary: agentOutput.reasoningSummary || null,
    workflowRequest,
    promptContext: {
      mode: conversationContext.promptContext.mode,
      tokenEstimate: conversationContext.promptContext.tokenEstimate,
      thresholdTokens: conversationContext.promptContext.thresholdTokens,
      messageCount: conversationContext.promptContext.messageCount,
      compactedThroughMessageId: conversationContext.promptContext.compactedThroughMessageId || null,
      omittedMessageCount: conversationContext.promptContext.omittedMessageCount || 0,
    },
    planningModelTelemetry: plannedOutput.modelTelemetry || null,
    modelTelemetry: agentOutput.modelTelemetry || null,
    compactionTelemetry: conversationContext.telemetry,
    toolResults: toolResults.map((result) => ({ toolName: result.toolName, status: result.status })),
    parts: [
      textPart(agentOutput.reply),
      ...agentOutput.tables.map(tablePart),
      ...agentOutput.codeBlocks.map(codePart),
      ...agentOutput.artifacts.map((artifact) => artifactPart({ type: artifact.type, title: artifact.title })),
    ],
  };

  const { data: assistantMessageRow, error: assistantError } = await admin.from('suplia_messages').insert({
    conversation_id: activeConversationId,
    organization_id: auth.organizationId,
    user_id: auth.user.id,
    role: 'assistant',
    content: agentOutput.reply,
    metadata: baseMessageMetadata,
    created_at: new Date().toISOString(),
  }).select('id').single();
  if (assistantError) throw assistantError;

  if (agentOutput.artifacts.length > 0) {
    let persistedArtifacts: SupliaArtifact[] = [];
    if (artifactUpdateTargetId) {
      const [firstArtifact, ...extraArtifacts] = agentOutput.artifacts;
      const updatedArtifact = await updateSupliaArtifact(auth, {
        artifactId: artifactUpdateTargetId,
        conversationId: activeConversationId,
        sourceMessageId: assistantMessageRow.id,
        type: firstArtifact.type,
        title: firstArtifact.title,
        content: firstArtifact.content || null,
        data: firstArtifact.data || {},
        changeSummary: buildSupliaArtifactChangeSummary(message),
      });
      const insertedExtras = await insertSupliaArtifacts(auth, extraArtifacts.map((artifact) => ({
        conversationId: activeConversationId,
        sourceMessageId: assistantMessageRow.id,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content || null,
        data: artifact.data || {},
        changeSummary: 'Artifact adicional creado durante una actualizacion.',
      })));
      persistedArtifacts = [updatedArtifact, ...insertedExtras];
    } else {
      persistedArtifacts = await insertSupliaArtifacts(auth, agentOutput.artifacts.map((artifact) => ({
        conversationId: activeConversationId,
        sourceMessageId: assistantMessageRow.id,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content || null,
        data: artifact.data || {},
        changeSummary: 'Creado desde el chat de SUPL.IA.',
      })));
    }

    if (persistedArtifacts.length) {
      await admin
        .from('suplia_messages')
        .update({
          metadata: {
            ...baseMessageMetadata,
            parts: [textPart(agentOutput.reply), ...agentOutput.tables.map(tablePart), ...agentOutput.codeBlocks.map(codePart), ...persistedArtifacts.map((artifact) => artifactPart(artifact))],
          },
        })
        .eq('id', assistantMessageRow.id)
        .eq('organization_id', auth.organizationId);
    }
  }

  if (agentOutput.pendingActions.length > 0) {
    await persistPendingActions({
      auth,
      conversationId: activeConversationId,
      messageId: assistantMessageRow.id,
      actions: agentOutput.pendingActions,
      modelTier,
    });
  }

  await admin
    .from('suplia_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', activeConversationId)
    .eq('organization_id', auth.organizationId);

  return getSupliaState(auth, activeConversationId);
}
