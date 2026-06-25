export type SupliaRole = 'user' | 'assistant' | 'system' | 'tool';

export type SupliaAskOption = {
  label: string;
  description?: string | null;
};

export type SupliaAskQuestion = {
  header?: string | null;
  question: string;
  options?: SupliaAskOption[];
  multi?: boolean | null;
  allowOther?: boolean | null;
};

export type SupliaAskAnswer = {
  header?: string | null;
  question: string;
  answers: string[];
};

export type SupliaAskAnswerPayload = {
  askId: string;
  answers: SupliaAskAnswer[];
};

export type SupliaMessagePart =
  | { type: 'text'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; language?: string | null; content: string }
  | {
      type: 'ask';
      askId: string;
      header?: string | null;
      question?: string | null;
      options?: SupliaAskOption[];
      questions?: SupliaAskQuestion[];
      multi?: boolean | null;
      allowOther?: boolean | null;
      submitLabel?: string | null;
    }
  | { type: 'artifact-card'; artifactId?: string | null; artifactType: SupliaArtifactType | string; title: string }
  | { type: 'job-progress'; jobId: string; status?: string | null; label?: string | null }
  | { type: 'approval-request'; actionId: string; title: string; approvalKind?: SupliaApprovalKind | string | null }
  | { type: 'tool-call'; toolRunId?: string | null; toolName: string; status?: string | null };

export type SupliaConversation = {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  status: 'active' | 'archived';
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type SupliaMessage = {
  id: string;
  conversationId: string;
  role: SupliaRole;
  content: string;
  metadata?: (Record<string, unknown> & { parts?: SupliaMessagePart[]; answerToAsk?: SupliaAskAnswerPayload | null }) | null;
  createdAt: string;
};

export type SupliaArtifactType =
  | 'plan'
  | 'icp_strategy'
  | 'search_plan'
  | 'email_draft'
  | 'lead_list'
  | 'crm_summary'
  | 'note'
  | 'tool_result'
  | 'company_shortlist'
  | 'person_shortlist'
  | 'campaign_draft'
  | 'campaign_preview'
  | 'personalized_email_draft'
  | 'pipeline_summary'
  | 'reply_brief'
  | 'thread_reply_draft'
  | 'mission_draft'
  | 'mailbox_search'
  | 'mailbox_contact_list'
  | 'gmail_thread_summary'
  | 'risk_report';

export type SupliaArtifact = {
  id: string;
  conversationId: string;
  organizationId?: string | null;
  userId?: string | null;
  jobId?: string | null;
  sourceMessageId?: string | null;
  type: SupliaArtifactType;
  artifactKind?: string | null;
  status?: 'active' | 'archived' | 'deleted' | string | null;
  versionNumber?: number | null;
  title: string;
  content?: string | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type SupliaArtifactVersion = {
  id: string;
  artifactId: string;
  conversationId: string;
  organizationId: string;
  userId?: string | null;
  sourceMessageId?: string | null;
  jobId?: string | null;
  versionNumber: number;
  title: string;
  content?: string | null;
  data?: Record<string, unknown> | null;
  changeSummary?: string | null;
  createdAt: string;
};

export type SupliaPendingActionStatus = 'pending' | 'approved' | 'executed' | 'cancelled' | 'failed';
export type SupliaToolRunStatus = 'queued' | 'running' | 'completed' | 'requires_approval' | 'cancelled' | 'failed';
export type SupliaRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SupliaApprovalKind = 'none' | 'simple' | 'strong';

export type SupliaPendingAction = {
  id: string;
  conversationId: string;
  jobId?: string | null;
  stepId?: string | null;
  actionType: 'email.send' | 'campaign.create' | 'crm.update' | 'antonia.create_mission' | string;
  status: SupliaPendingActionStatus;
  title: string;
  description?: string | null;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  riskLevel?: SupliaRiskLevel | null;
  requiresApproval?: boolean | null;
  approvalKind?: SupliaApprovalKind | null;
  approvalReason?: string | null;
  toolName?: string | null;
  toolRunId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupliaToolRun = {
  id: string;
  conversationId: string;
  organizationId: string;
  jobId?: string | null;
  stepId?: string | null;
  agentRunId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  pendingActionId?: string | null;
  toolName: string;
  status: SupliaToolRunStatus;
  inputPayload: Record<string, unknown>;
  outputPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  riskLevel: SupliaRiskLevel;
  requiresApproval: boolean;
  approvalKind: SupliaApprovalKind;
  approvalReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  modelTier?: string | null;
  modelName?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  estimatedCost?: number | null;
  createdAt: string;
};

export type SupliaJobStatus = 'draft' | 'planning' | 'waiting_approval' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type SupliaJobStepStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type SupliaAgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SupliaJobEventSeverity = 'debug' | 'info' | 'success' | 'warning' | 'error';
export type SupliaMemoryStatus = 'inferred' | 'proposed' | 'approved' | 'rejected' | 'archived';

export type SupliaJob = {
  id: string;
  conversationId: string;
  organizationId: string;
  userId?: string | null;
  title: string;
  goal: string;
  jobType: string;
  status: SupliaJobStatus;
  priority: number;
  currentStepId?: string | null;
  progressCurrent: number;
  progressTotal: number;
  progressLabel?: string | null;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  cancelledAt?: string | null;
  pausedAt?: string | null;
};

export type SupliaJobStep = {
  id: string;
  jobId: string;
  conversationId: string;
  organizationId: string;
  stepOrder: number;
  stepKey: string;
  stepType: string;
  agentName?: string | null;
  title: string;
  description?: string | null;
  status: SupliaJobStepStatus;
  dependsOnStepIds: string[];
  canRunInParallel: boolean;
  requiresApproval: boolean;
  approvalActionId?: string | null;
  toolRunId?: string | null;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorMessage?: string | null;
  progressCurrent: number;
  progressTotal: number;
  retryCount: number;
  maxAttempts: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupliaAgentRun = {
  id: string;
  jobId: string;
  stepId?: string | null;
  conversationId: string;
  organizationId: string;
  userId?: string | null;
  agentName: string;
  status: SupliaAgentRunStatus;
  modelTier?: string | null;
  modelName?: string | null;
  reasoningSummary?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
};

export type SupliaJobEvent = {
  id: string;
  jobId?: string | null;
  stepId?: string | null;
  agentRunId?: string | null;
  toolRunId?: string | null;
  organizationId: string;
  eventType: string;
  title: string;
  message?: string | null;
  severity: SupliaJobEventSeverity;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SupliaMemory = {
  id: string;
  organizationId: string;
  userId?: string | null;
  scope: string;
  memoryType: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  status: SupliaMemoryStatus;
  sourceConversationId?: string | null;
  sourceJobId?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupliaChatResponse = {
  conversation: SupliaConversation | null;
  messages: SupliaMessage[];
  artifacts: SupliaArtifact[];
  pendingActions: SupliaPendingAction[];
  toolRuns?: SupliaToolRun[];
  conversations?: SupliaConversation[];
  jobs?: SupliaJob[];
  activeJob?: SupliaJob | null;
  jobSteps?: SupliaJobStep[];
  agentRuns?: SupliaAgentRun[];
  jobEvents?: SupliaJobEvent[];
  memories?: SupliaMemory[];
};
