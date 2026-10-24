import { z } from 'zod';
import { COWORK_AGENT_ACTION, COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, COWORK_PLAN_LIMITS, COWORK_WRITTEN_ACTION, coworkDocumentSchema, coworkSameLine, type CoworkBlock, type CoworkPlanStep, type CoworkWebAction } from './contracts';
import { coworkBlocks, coworkChoices, coworkQuestion, coworkSuggestions, polishCoworkText, withoutRepeatedAside, withoutTrailingQuestions } from './answer-quality';
import { coworkCampaignDraftSchema } from './campaign-proposal';
import { coworkCodeProposalSchema, type CoworkCodeProposal } from './code-proposal';
import { coworkSearchCriteriaSchema, coworkSearchStrategy, type CoworkSearchCriteria } from './search-proposal';
import { coworkExplainsSearchScope, coworkMentionsPlaces, coworkSearchScope, coworkSearchScopeNotice, type CoworkSearchDefaults } from './search-scope';
import { coworkReadTaskSchema, executeCoworkParallelReads } from './parallel-reads';
import { collectCoworkLeadRows, collectCoworkRecommendedLeadIds } from './lead-export';
import { coworkCampaignEmails, coworkEditedEmails, coworkOnlyUsesVersion, coworkPersonalEmails, type CoworkEditedEmail, type CoworkPersonalEmail } from './blocks';
import { coworkReadPlanSchema, executeCoworkReadPlan } from './read-plan';
import { coworkRequestedMetricQuery } from './metric-period';
import { specialistTasksSchema, type SpecialistTask } from './specialists';
import { COWORK_DOMAIN_FIXED_READS, COWORK_DOMAIN_ENTITY_READS, type CoworkDomainRead } from './domain-reads';
import { coworkProfileDecisionSchema, coworkProfilePatchFromDecision, type CoworkProfilePatch } from './profile-proposal';
import { coworkSavedSearchCreateSchema, coworkSavedSearchUpdateSchema, coworkSavedSearchDeleteSchema,
  type CoworkSavedSearchCreate, type CoworkSavedSearchUpdate, type CoworkSavedSearchDelete } from './saved-search-proposal';
import { coworkCrmRecordPatchSchema, type CoworkCrmRecordPatch } from './crm-record-proposal';
import { coworkCrmAssignSchema, coworkExceptionResolveSchema, coworkMissionControlSchema,
  type CoworkCrmAssign, type CoworkExceptionResolve, type CoworkMissionControl } from './team-proposals';
import { coworkMessageContextPatchSchema, type CoworkMessageContextPatch } from './message-context-proposal';
import { COWORK_MAX_COORDINATOR_CALLS, COWORK_TURN_DEFAULTS, type CoworkTurnBudget, type CoworkTurnCeiling } from './turn-budget';
import { coworkSameName, coworkWithDemoNote, coworkWriteBriefSchema, type CoworkWriteBrief } from './writer';
import { coworkDesignBriefSchema, type CoworkDesignBrief } from './design-brief';
import { coworkAnalysisBriefSchema, coworkAnalystFallback, type CoworkAnalysisBrief } from './analyst';
import { coworkWithCharts } from './charts';
import { coworkContactsImportSchema, type CoworkContactsImportInput } from './contacts-import';
import { coworkReplyThreadSchema, type CoworkReplyThreadInput } from './reply-proposal';
import { coworkLinkedinBatchLeads, coworkLinkedinBatchSchema, type CoworkLinkedinBatchInput } from './linkedin-batch';
import { coworkPrepareBatchPeople, coworkPrepareBatchSchema, type CoworkPrepareBatchInput } from './prepare-batch';
import { coworkBuyingRoleRank, coworkDecidesPurchase } from './buying-role';
import { coworkThreadMemorySchema, type CoworkThreadMemory } from './thread-memory';
import { coworkCorrectionVerdict, type CoworkCorrectionVerdict } from './correction-guard';
import { withCoworkReports } from './report-document';
import { COWORK_NEXT_STEP_RULE } from './next-step';
import { coworkPreferenceAlreadyKept, coworkPreferenceSchema, coworkPreferenceSuggestion, coworkRememberSuggestion, type CoworkPreference } from './preference-proposal';
import { coworkTaskPlanProblem, coworkTaskPlanSchema, type CoworkTaskPlan } from './task-plan';
import type { CoworkHarnessConfig } from './harness-config';

export const coworkEffectKindSchema = z.enum(['save_contact', 'start_research',
  'request_draft', 'enrich_contact', 'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
  'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete', 'campaign_stop_v2',
  'crm_update_record', 'campaign_prepare_draft_v2',
  'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update', 'enrich_batch',
  'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message', 'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch', 'campaign_retry', 'enrich_phone',
  'lead_prepare_batch', 'memory_save', 'task_plan']);
export type CoworkEffectKind = z.infer<typeof coworkEffectKindSchema>;

/** The strict output makes the model fill every field, and on a search or an artifact it sometimes fills `campaign`
 * with filler (an invalid address, an empty subject). That no longer rejects the decision: the field keeps its
 * problem, and only campaign.create, the one action that uses it, sends the problem back (Plan 12, 4a-4). */
const INVALID_CAMPAIGN = Symbol('invalid campaign');
function campaignProblem(value: unknown): string | null {
  return value && typeof value === 'object' && INVALID_CAMPAIGN in value ? String((value as { [INVALID_CAMPAIGN]: unknown })[INVALID_CAMPAIGN]) : null;
}

export const coworkDecisionSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'research.get_existing', 'reads.parallel', 'reads.plan', 'specialists.review',
    'crm.search', 'crm.get_lead', 'contacted.search', 'contacted.timeline', 'contacted.account', 'replies.meeting_chain', 'replies.attention', 'replies.stalled', 'metrics.overview', 'metrics.rates', 'metrics.diagnose', 'metrics.channels', 'metrics.incidents', 'deliverability.check', 'site.read', 'leads.count', 'leads.summary', 'deliverability.bounces', 'deliverability.sender', 'compliance.check', 'compliance.law', 'compliance.obligation', 'app.context', 'draft.get', 'campaigns.list', 'files.list', 'files.read', 'saved_searches.list', 'profile.get',
    'privacy.contactability_batch', 'lists.review_batch',
    'crm.propose_note', 'prospecting.propose_search',
    'leads.save_contact', 'research.start', 'draft.request', 'lead.enrich', 'email.send', 'email.reply_thread', 'campaign.retry', 'lead.enrich_phone',
    'campaign.create', 'campaign.activate', 'campaign.pause', 'code.execute',
    'profile.update', 'saved_search.create', 'saved_search.update', 'saved_search.delete', 'campaign.stop_v2',
    'crm.update_record', 'campaign.prepare_draft_v2',
    'crm.assign_lead', 'exception.resolve', 'mission.control', 'message_context.update',
    'lead.enrich_batch', 'campaign.schedule_batch', 'linkedin.invite', 'linkedin.message', 'linkedin.invite_batch', 'linkedin.message_batch', 'contacts.import',
    'contacts.prepare_batch', 'preference.save', 'task.plan',
    'campaigns.batch_report', 'campaigns.next_touch', 'campaigns.retry_review', 'campaigns.company_plan',
    'linkedin.network', 'linkedin.inbox', 'linkedin.quota', 'linkedin.followups', 'linkedin.jobs', 'icp.analyze', 'leads.recommend', 'opportunities.list',
    'answer', 'draft.write', 'artifact.create', 'analysis.write', ...COWORK_DOMAIN_FIXED_READS, ...COWORK_DOMAIN_ENTITY_READS]),
  // Four: three reads that count and the writing context, which does not (FREE_READS).
  reads: z.array(coworkReadTaskSchema).min(1).max(4).nullable().optional(),
  plan: coworkReadPlanSchema.nullable().optional(),
  /** The steps the person sees while the turn works (rule 12); only the first consulting decision uses it. */
  outline: z.array(z.object({ label: z.string().max(300), read: z.string().max(80).nullable() }).strict()).max(10).nullable().optional(),
  specialists: specialistTasksSchema.nullable().optional(),
  query: z.string().max(500).nullable(),
  leadId: z.string().uuid().nullable(),
  leadIds: z.array(z.string().uuid()).min(1).max(5).nullable().optional(),
  stepId: z.string().uuid().nullable().optional(),
  enrollmentId: z.string().uuid().nullable().optional(),
  profile: coworkProfileDecisionSchema.nullable().optional(),
  savedSearch: z.union([coworkSavedSearchCreateSchema, coworkSavedSearchUpdateSchema, coworkSavedSearchDeleteSchema]).nullable().optional(),
  crmRecord: coworkCrmRecordPatchSchema.nullable().optional(),
  crmAssign: coworkCrmAssignSchema.nullable().optional(),
  exceptionResolve: coworkExceptionResolveSchema.nullable().optional(),
  missionControl: coworkMissionControlSchema.nullable().optional(),
  messageContext: coworkMessageContextPatchSchema.nullable().optional(),
  draftId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  spacingMinutes: z.number().int().min(5).max(480).nullable().optional(),
  linkedinMessage: z.string().trim().min(1).max(1200).nullable().optional(),
  campaign: coworkCampaignDraftSchema.nullable().optional().catch(({ input, error }) => (campaignProblem(input) !== null ? input : { [INVALID_CAMPAIGN]: issueSummary(error) || 'formato inválido' }) as never),
  code: coworkCodeProposalSchema.nullable().optional(),
  providerId: z.string().regex(/^apollo:[A-Za-z0-9_-]{1,200}$/).nullable().optional(),
  snapshotId: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(1).max(4000).nullable().optional(),
  searchCriteria: coworkSearchCriteriaSchema.nullable().optional(),
  /** draft.write: the brief the Writer gets instead of the coordinator writing the emails itself (writer.ts). */
  write: coworkWriteBriefSchema.nullable().optional(),
  /** artifact.create: the brief the Designer gets to write the code of an artifact (designer.ts, Plan 12). */
  design: coworkDesignBriefSchema.nullable().optional(),
  /** analysis.write: the question the Analyst answers with what the turn read (analyst.ts, Plan 12, 4b). */
  analysis: coworkAnalysisBriefSchema.nullable().optional(),
  /** contacts.import: the uploaded file whose contacts to save and, if needed, which column is which (contacts-import.ts). */
  contactsImport: coworkContactsImportSchema.nullable().optional(),
  /** email.reply_thread: the conversation read with replies.thread and the final text of the reply to propose sending in its thread (reply-proposal.ts). */
  replyThread: coworkReplyThreadSchema.nullable().optional(),
  /** linkedin.invite_batch / linkedin.message_batch: the saved contacts observed in this thread (and, for messages, the text of each) to approve with one decision (linkedin-batch.ts). */
  linkedinBatch: coworkLinkedinBatchSchema.nullable().optional(),
  /** contacts.prepare_batch: the goal (save, email or research) and the people seen in this thread, approved with one decision (prepare-batch.ts). */
  prepareBatch: coworkPrepareBatchSchema.nullable().optional(),
  /** preference.save: the preference to remember in the next turns and for whom (preference-proposal.ts, Plan 12, 5). */
  preference: coworkPreferenceSchema.nullable().optional(),
  /** task.plan: the steps of a long task, what it may spend and its goal (task-plan.ts, Plan 13, 4c). */
  task: coworkTaskPlanSchema.nullable().optional(),
  /** The summary of the whole conversation, updated with the final decision of a turn (thread-memory.ts); null on reads. */
  memory: coworkThreadMemorySchema.nullable().optional(),
  answer: coworkDocumentSchema.nullable(),
}).strict();

export type CoworkReadAction = CoworkDomainRead | 'privacy.contactability_batch' | 'lists.review_batch' | 'leads.search' | 'leads.get' | 'research.get_existing'
  | 'crm.search' | 'crm.get_lead' | 'contacted.search' | 'contacted.timeline' | 'contacted.account' | 'replies.meeting_chain' | 'replies.attention' | 'replies.stalled' | 'metrics.overview' | 'metrics.rates' | 'metrics.diagnose' | 'metrics.channels' | 'metrics.incidents' | 'deliverability.check' | 'site.read' | 'leads.count' | 'leads.summary' | 'deliverability.bounces' | 'deliverability.sender' | 'compliance.check' | 'compliance.law' | 'compliance.obligation' | 'app.context' | 'draft.get' | 'campaigns.list' | 'files.list' | 'files.read' | 'saved_searches.list' | 'profile.get'
  | 'campaigns.batch_report' | 'campaigns.next_touch' | 'campaigns.retry_review' | 'campaigns.company_plan'
  | 'linkedin.network' | 'linkedin.inbox' | 'linkedin.quota' | 'linkedin.followups' | 'linkedin.jobs' | 'icp.analyze' | 'leads.recommend'
  | 'opportunities.list';
export type CoworkEffectAction = 'leads.save_contact' | 'research.start' | 'draft.request' | 'lead.enrich' | 'email.send' | 'campaign.create' | 'campaign.activate' | 'campaign.pause' | 'code.execute'
  | 'profile.update' | 'saved_search.create' | 'saved_search.update' | 'saved_search.delete' | 'campaign.stop_v2'
  | 'crm.update_record' | 'campaign.prepare_draft_v2'
  | 'crm.assign_lead' | 'exception.resolve' | 'mission.control' | 'message_context.update' | 'lead.enrich_batch'
  | 'campaign.schedule_batch' | 'linkedin.invite' | 'linkedin.message' | 'linkedin.invite_batch' | 'linkedin.message_batch' | 'contacts.import' | 'email.reply_thread' | 'campaign.retry' | 'lead.enrich_phone'
  | 'contacts.prepare_batch' | 'preference.save' | 'task.plan';
export type CoworkObservation = { action: CoworkReadAction | CoworkWebAction | 'specialists.review' | typeof COWORK_NOTE_ACTION | typeof COWORK_PLAN_ACTION | typeof COWORK_WRITTEN_ACTION | typeof COWORK_AGENT_ACTION; input: string; result: unknown; task?: { id: string; dependsOn: string[] } };
export type Decision = z.infer<typeof coworkDecisionSchema>;

export type CoworkEffectProposal = { kind: CoworkEffectKind; targetId: string; label: string; originRunId: string;
  campaign?: z.infer<typeof coworkCampaignDraftSchema>; code?: z.infer<typeof coworkCodeProposalSchema>;
  profile?: CoworkProfilePatch;
  savedSearch?: CoworkSavedSearchCreate | CoworkSavedSearchUpdate | CoworkSavedSearchDelete;
  crmRecord?: CoworkCrmRecordPatch;
  crmAssign?: CoworkCrmAssign; exceptionResolve?: CoworkExceptionResolve; missionControl?: CoworkMissionControl;
  messageContext?: CoworkMessageContextPatch;
  enrichBatch?: string[];
  scheduleBatch?: { campaignId: string; spacingMinutes?: number };
  linkedinJob?: { leadId: string; message?: string };
  contactsImport?: CoworkContactsImportInput;
  replyThread?: CoworkReplyThreadInput;
  linkedinBatch?: CoworkLinkedinBatchInput;
  prepareBatch?: CoworkPrepareBatchInput;
  preference?: CoworkPreference;
  task?: CoworkTaskPlan;
  /** The turn that proposed it read the open web (search, page or Investigadora): what a page says is data, but a page can try to steer the agent,
   * so the autonomous mode does not approve it by itself (execution-policy.ts). */
  fromWeb?: boolean;
  campaignId?: string; enrollmentId?: string; stepId?: string };

function observationRunId(
  observations: unknown[], history: CoworkHistoryTurn[], currentRunId: string,
  matches: (payload: Record<string, unknown>) => boolean,
): string | null {
  if (observations.some(item => item && typeof item === 'object' && matches(item as Record<string, unknown>))) {
    if (currentRunId) return currentRunId;
  }
  for (const turn of history) {
    if (turn.observations.some(item => item && typeof item === 'object' && matches(item as Record<string, unknown>))) return turn.runId;
  }
  return null;
}

function effectTargetRun(
  action: CoworkEffectAction, targetId: string,
  observations: CoworkObservation[], history: CoworkHistoryTurn[], currentRunId: string,
): string | null {
  if (action === 'email.send') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'draft.get'
      && (payload.result as { draftId?: string } | null)?.draftId === targetId);
  }
  if (action === 'campaign.activate' || action === 'campaign.pause') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.list'
      && Array.isArray((payload.result as { campaigns?: Array<{ id?: string }> } | null)?.campaigns)
      && ((payload.result as { campaigns: Array<{ id?: string }> }).campaigns.some(campaign => campaign.id === targetId)));
  }
  if (action === 'campaign.create') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.list');
  }
  if (action === 'draft.request') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'research.get_existing'
      && (payload.result as { availability?: string } | null)?.availability === 'available'
      && (payload.result as { research?: { snapshotId?: string } } | null)?.research?.snapshotId === targetId);
  }
  if (action === 'profile.update') {
    return observationRunId(observations, history, currentRunId, payload => payload.action === 'profile.get');
  }
  if (action === 'saved_search.create' || action === 'preference.save' || action === 'task.plan') {
    return currentRunId || null;
  }
  if (action === 'saved_search.update' || action === 'saved_search.delete') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'saved_searches.list'
      && Array.isArray((payload.result as { items?: Array<{ id?: string }> } | null)?.items)
      && ((payload.result as { items: Array<{ id?: string }> }).items.some(item => item.id === targetId)));
  }
  if (action === 'campaign.stop_v2') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.inbox'
      && Array.isArray((payload.result as { items?: Array<{ enrollmentId?: string }> } | null)?.items)
      && ((payload.result as { items: Array<{ enrollmentId?: string }> }).items.some(item => item.enrollmentId === targetId)));
  }
  if (action === 'crm.update_record') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'crm.record'
      && Array.isArray((payload.result as { records?: Array<{ gid?: string }> } | null)?.records)
      && ((payload.result as { records: Array<{ gid?: string }> }).records.some(record => record.gid === targetId)));
  }
  if (action === 'campaign.prepare_draft_v2') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.step_context'
      && (payload.result as { stepId?: string } | null)?.stepId === targetId);
  }
  if (action === 'crm.assign_lead') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'crm.collaboration'
      && (payload.result as { leadId?: string } | null)?.leadId === targetId);
  }
  if (action === 'exception.resolve') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'exceptions.list'
      && Array.isArray((payload.result as { items?: Array<{ id?: string }> } | null)?.items)
      && ((payload.result as { items: Array<{ id?: string }> }).items.some(item => item.id === targetId)));
  }
  if (action === 'mission.control') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'missions.list'
      && Array.isArray((payload.result as { items?: Array<{ id?: string }> } | null)?.items)
      && ((payload.result as { items: Array<{ id?: string }> }).items.some(item => item.id === targetId)));
  }
  if (action === 'message_context.update') {
    return observationRunId(observations, history, currentRunId, payload => payload.action === 'message.context');
  }
  if (action === 'lead.enrich_batch') {
    return observationRunId(observations, history, currentRunId, payload =>
      (payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact'
        || payload.action === 'leads.search' || payload.action === 'leads.get' || payload.action === 'leads.recommend'));
  }
  if (action === 'contacts.prepare_batch') {
    // The server checks each person against everything the conversation saw; this only anchors the proposal to a turn that saw people.
    return observationRunId(observations, history, currentRunId, payload =>
      (payload.action === 'prospecting.search' || payload.action === 'leads.search' || payload.action === 'leads.get'
        || payload.action === 'leads.recommend' || payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact'));
  }
  if (action === 'campaign.schedule_batch') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.batch_report'
      && (payload.result as { campaign?: { id?: string } } | null)?.campaign?.id === targetId);
  }
  if (action === 'email.reply_thread') {
    // Only a conversation read with replies.thread, and one that takes a reply: the code's advice, not the model's reading of the intent.
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'replies.thread'
      && (payload.result as { contactedId?: string; advice?: string; available?: boolean } | null)?.available === true
      && (payload.result as { contactedId?: string } | null)?.contactedId === targetId
      && (payload.result as { advice?: string } | null)?.advice === 'reply');
  }
  if (action === 'campaign.retry') {
    // Only a campaign whose failed sends were read with campaigns.retry_review, and one that has something to retry: the code's count, not the model's.
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.retry_review'
      && (payload.result as { campaignId?: string } | null)?.campaignId === targetId
      && Number((payload.result as { summary?: { retryable?: number } } | null)?.summary?.retryable) > 0);
  }
  if (action === 'linkedin.invite' || action === 'linkedin.message' || action === 'linkedin.invite_batch' || action === 'linkedin.message_batch') {
    return observationRunId(observations, history, currentRunId, payload =>
      (payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact'
        || payload.action === 'leads.search' || payload.action === 'leads.get' || payload.action === 'leads.recommend'
        || payload.action === 'linkedin.followups'));
  }
  return observationRunId(observations, history, currentRunId, payload =>
    collectCoworkLeadRows([payload]).some(row => row.id === targetId) || collectCoworkRecommendedLeadIds([payload]).has(targetId));
}

/** Display name for lead-scoped effects, resolved from already-observed rows.
 * Never invents: falls back to null and the caller keeps the raw target. */
function describeLeadTarget(
  action: CoworkEffectAction, targetId: string,
  observations: CoworkObservation[], history: CoworkHistoryTurn[],
): string | null {
  if (action === 'email.reply_thread') return observedThreadName(targetId, observations, history);
  if (action === 'campaign.activate' || action === 'campaign.pause') return observedCampaignName(targetId, observations, history);
  if (action !== 'leads.save_contact' && action !== 'research.start' && action !== 'lead.enrich' && action !== 'lead.enrich_phone') return null;
  return observedLeadName(targetId, observations, history);
}

/** «Nombre» of a campaign campaigns.list showed in this thread (activating or pausing one requires it), or null. */
function observedCampaignName(campaignId: string, observations: CoworkObservation[], history: CoworkHistoryTurn[]): string | null {
  const payloads = [...observations, ...history.flatMap(turn => turn.observations || [])];
  for (const payload of payloads as Array<{ action?: unknown; result?: unknown } | null>) {
    if (payload?.action !== 'campaigns.list') continue;
    const campaigns = (payload.result as { campaigns?: Array<{ id?: string; name?: string | null }> } | null)?.campaigns;
    const name = String((Array.isArray(campaigns) ? campaigns.find(campaign => campaign?.id === campaignId)?.name : '') || '').trim();
    if (name) return name.slice(0, 120);
  }
  return null;
}

/** «Nombre (Empresa)» of the person of a conversation read with replies.thread in this thread, or null. */
function observedThreadName(contactedId: string, observations: CoworkObservation[], history: CoworkHistoryTurn[]): string | null {
  const payloads = [...observations, ...history.flatMap(turn => turn.observations || [])];
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object' || (payload as { action?: unknown }).action !== 'replies.thread') continue;
    const result = (payload as { result?: { contactedId?: string; name?: string | null; company?: string | null } | null }).result;
    if (result?.contactedId !== contactedId) continue;
    const name = String(result.name || '').trim();
    const company = String(result.company || '').trim();
    return name && company ? `${name} (${company})` : name || null;
  }
  return null;
}

/** «Nombre (Empresa)» of a contact seen in this thread, or null. */
function observedLeadName(leadId: string, observations: CoworkObservation[], history: CoworkHistoryTurn[]): string | null {
  const payloads = [...observations, ...history.flatMap(turn => turn.observations || [])];
  for (const row of collectCoworkLeadRows(payloads)) {
    if (row.id !== leadId) continue;
    const name = String(row.name || '').trim();
    const company = String((row as Record<string, unknown>).company || '').trim();
    if (name && company) return `${name} (${company})`;
    if (name) return name;
  }
  // A person leads.recommend put first (Plan 15) shows with the name it gave.
  for (const payload of payloads as Array<{ action?: unknown; result?: unknown } | null>) {
    if (payload?.action !== 'leads.recommend') continue;
    const top = (payload.result as { top?: Array<{ leadId?: string; name?: string | null; company?: string | null }> } | null)?.top;
    const item = Array.isArray(top) ? top.find(entry => entry?.leadId === leadId) : null;
    const name = String(item?.name || '').trim();
    const company = String(item?.company || '').trim();
    if (name) return company ? `${name} (${company})` : name;
  }
  return null;
}

/** Upload names an observation shows: every file of files.list, or the one files.read found. */
function observedUploads(observation: { action?: unknown; result?: unknown }): string[] {
  if (observation.action === 'files.list') {
    const files = (observation.result as { files?: Array<{ name?: string }> } | null)?.files;
    return Array.isArray(files) ? files.map(file => String(file.name || '').toLowerCase()) : [];
  }
  if (observation.action !== 'files.read') return [];
  const result = observation.result as { found?: boolean; name?: string } | null;
  return result?.found === true && typeof result.name === 'string' ? [result.name.toLowerCase()] : [];
}

/** Origin for code.execute: input files must have been observed via files.list
 * or files.read. Runs without inputs anchor to the proposing run itself (allowed as origin). */
function codeOriginRunId(
  wanted: string[], observations: CoworkObservation[], history: CoworkHistoryTurn[], currentRunId: string,
): string | null {
  if (wanted.length === 0) return currentRunId || null;
  const names = wanted.map(name => name.toLowerCase());
  const seenHere = new Set(observations.flatMap(observedUploads));
  if (names.every(name => seenHere.has(name))) return currentRunId || null;
  for (const turn of history) {
    const seen = new Set(turn.observations.flatMap(item => item && typeof item === 'object' ? observedUploads(item as Record<string, unknown>) : []));
    if (names.every(name => seen.has(name))) return turn.runId;
  }
  return null;
}

/** Origin for contacts.import: the file must have been seen via files.list or files.read; «archivo.xlsx#Hoja» names a sheet of it. */
function importOriginRunId(file: string, observations: CoworkObservation[], history: CoworkHistoryTurn[], currentRunId: string): string | null {
  const asked = file.trim().toLowerCase();
  const hash = asked.lastIndexOf('#');
  for (const name of hash > 0 ? [asked.slice(0, hash).trim(), asked] : [asked]) {
    const origin = codeOriginRunId([name], observations, history, currentRunId);
    if (origin) return origin;
  }
  return null;
}

function effectLabel(action: CoworkEffectAction, targetId: string, targetName?: string | null): string {
  const named = (verb: string) => targetName ? `${verb} ${targetName}` : `${verb} ${targetId.slice(0, 120)}`;
  if (action === 'leads.save_contact') return named('Guardar contacto');
  if (action === 'research.start') return named('Investigar contacto');
  // The lookup brings the email and, when the provider has it, the LinkedIn profile (round 25: «Buscar su correo» to invite by LinkedIn).
  if (action === 'lead.enrich') return named('Buscar los datos de');
  if (action === 'email.send') return `Enviar correo del borrador ${targetId.slice(0, 120)}`;
  if (action === 'campaign.create') return 'Crear borrador de campaña';
  // A campaign by its name, never its ID («Aprobar y activar campaña 00000000-…»), as the worker labels it when staging.
  if (action === 'campaign.activate') return targetName ? `Aprobar y activar campaña «${targetName}»` : 'Aprobar y activar la campaña';
  if (action === 'campaign.pause') return targetName ? `Pausar campaña «${targetName}»` : 'Pausar la campaña';
  if (action === 'code.execute') return 'Ejecutar código en entorno aislado';
  if (action === 'profile.update') return 'Actualizar tu perfil comercial';
  if (action === 'saved_search.create') return 'Guardar búsqueda';
  if (action === 'saved_search.update') return 'Actualizar búsqueda guardada';
  if (action === 'saved_search.delete') return 'Eliminar búsqueda guardada';
  if (action === 'campaign.stop_v2') return 'Detener seguimiento de campaña';
  if (action === 'crm.update_record') return 'Actualizar ficha comercial';
  if (action === 'campaign.prepare_draft_v2') return 'Preparar borrador del paso';
  if (action === 'crm.assign_lead') return 'Asignar o reservar contacto';
  if (action === 'exception.resolve') return 'Resolver incidencia';
  if (action === 'mission.control') return 'Pausar o reactivar misión';
  if (action === 'message_context.update') return 'Actualizar contexto de redacción';
  if (action === 'lead.enrich_batch') return 'Buscar el correo de varios contactos';
  if (action === 'campaign.schedule_batch') return 'Programar envíos';
  if (action === 'linkedin.invite') return 'Proponer invitación LinkedIn';
  if (action === 'linkedin.message') return 'Proponer mensaje LinkedIn';
  if (action === 'linkedin.invite_batch') return 'Proponer invitaciones en LinkedIn para varias personas';
  if (action === 'linkedin.message_batch') return 'Proponer mensajes en LinkedIn para varias personas';
  if (action === 'contacts.import') return 'Guardar contactos';
  if (action === 'email.reply_thread') return targetName ? `Responder a ${targetName} en su hilo` : 'Responder en el hilo de una conversación';
  if (action === 'campaign.retry') return 'Reintentar los envíos fallidos de una campaña';
  if (action === 'lead.enrich_phone') return named('Revelar el teléfono de');
  if (action === 'contacts.prepare_batch') return 'Preparar contactos';
  if (action === 'preference.save') return 'Recordar una preferencia';
  if (action === 'task.plan') return 'Plan de la tarea';
  return `Preparar borrador del informe ${targetId.slice(0, 120)}`;
}

/** Run a previous completed (or the current paused) work whose events hold observations. */
export type CoworkHistoryTurn = { runId: string; observations: unknown[];
  /** The cards of that answer (emails, sequences, tables): a campaign asked for next carries the first email it wrote for each person. */
  blocks?: ReadonlyArray<{ type: string }>;
  /** What that answer said, with its closing question last: a «dale» answers it. */
  reply?: string };

/**
 * What the Writer reads besides this turn's reads (round 2 readings): the saved contacts this conversation already read, so «escríbele
 * al primero» of the previous answer goes to that person's address, and the emails of the previous answer, which a follow-up continues
 * and an edit changes. People the brief names that nobody read are looked up first (`lookup`, one search per name, up to three):
 * «no tenemos su correo observado» was said of a saved contact with an address.
 */
export async function coworkWriterObservations(brief: CoworkWriteBrief, observations: CoworkObservation[], history: CoworkHistoryTurn[],
  lookup?: (name: string) => Promise<CoworkObservation | null>): Promise<CoworkObservation[]> {
  const isRead = (item: unknown): item is CoworkObservation => {
    const action = (item as { action?: unknown } | null)?.action;
    return action === 'leads.search' || action === 'leads.get';
  };
  const earlierReads = history.flatMap(turn => turn.observations || []).filter(isRead);
  const known = collectCoworkLeadRows([...observations, ...earlierReads]);
  const missing = (brief.recipients ?? []).filter(entry => !entry.includes('@')
    && !known.some(row => typeof row.email === 'string' && row.email.includes('@') && coworkSameName(String(row.name ?? ''), entry)));
  if (lookup && missing.length && missing.length <= 3) {
    for (const name of missing) {
      const found = await lookup(name).catch(() => null);
      if (found) observations.push(found);
    }
  }
  const emails = (history.at(-1)?.blocks || []).flatMap(block => {
    const draft = block as { type: string; to?: unknown; subject?: unknown; body?: unknown };
    return draft.type === 'email_draft' && typeof draft.subject === 'string' && typeof draft.body === 'string'
      ? [{ to: Array.isArray(draft.to) ? draft.to : [], subject: draft.subject, body: draft.body }] : [];
  });
  const earlier: CoworkObservation[] = emails.length ? [{ action: COWORK_WRITTEN_ACTION, input: '', result: { scope: 'earlier_answer', emails } }] : [];
  return [...earlierReads, ...observations, ...earlier];
}

/** A decision the loop refuses but the model can correct on its next decision.
 * The run only fails if the last decision is still invalid. */
export class CoworkDecisionRejected extends Error {
  constructor(message: string, readonly feedback: string, readonly userFacing = false) {
    super(message);
    this.name = 'CoworkDecisionRejected';
  }
}

/** previous: the answer a correction has to edit (the closing correction and the judge's), so the model
 * fixes what was pointed out and keeps the rest instead of writing it again from scratch. */
export type CoworkRejection = { action: string; reason: string; previous?: CoworkAnswer };

/**
 * Why a turn could not finish, when a stronger model can still answer it (Plan 14, 2). Odysseus hands a failed turn of its
 * small model to a stronger «teacher»; Cowork does the same once per turn with COWORK_RESCUE_MODEL: instead of «No pude
 * completar esta respuesta», an answer with what the turn read, what was missing and the next step.
 */
export type CoworkTurnFailure = 'reads_at_last_decision' | 'rejected_at_last_decision' | 'invalid_at_last_decision'
  | 'model_unavailable' | 'no_answer' | 'unexpected';

const RESCUE_REASONS: Record<CoworkTurnFailure, string> = {
  reads_at_last_decision: 'se acabaron las decisiones del turno mientras seguía consultando',
  rejected_at_last_decision: 'la última decisión del turno fue rechazada',
  invalid_at_last_decision: 'la última decisión no cumplió el formato',
  model_unavailable: 'el modelo tardó demasiado o no respondió',
  no_answer: 'el turno terminó sin respuesta final',
  unexpected: 'falló una consulta del turno',
};

/** What the rescue reads, as one more refused decision: answer now with what was observed, nothing else. */
export function coworkRescueNote(failure: CoworkTurnFailure): string {
  return `Este turno no alcanzó a terminar (${RESCUE_REASONS[failure]}). Responde ahora con action answer usando solo lo observado: `
    + 'en la primera frase, qué revisaste o hiciste y qué faltó; después lo útil que encontraste, y termina con una pregunta corta que proponga el siguiente paso concreto. '
    + 'Deja en suggestions una o dos respuestas cortas que la persona pueda tocar para seguir. '
    + 'No propongas acciones ni pidas más lecturas, y no menciones el problema interno ni que hubo un rescate.';
}

/**
 * Whether a failure can be rescued, and which one it is. Never cancellation, lost access or a lost lease (the run is not ours
 * to answer), budgets and quotas (their own message says what to do, and the rescue could not reserve a call anyway), nor a
 * proposal the server refused with its own reason (proposal_rejected already says it plainly).
 */
export function coworkTurnFailure(error: unknown): CoworkTurnFailure | null {
  if (!(error instanceof Error)) return null;
  const status = (error as { status?: number }).status;
  if (error.name === 'AbortError' || error.name === 'AuthError' || status === 401 || status === 403) return null;
  if (/COWORK_(?:DAILY|CONVERSATION)_MODEL_BUDGET|reservar presupuesto|Thread (?:effect|search) budget|quota|External search disabled|no longer writable|lease|Acceso Cowork|no está disponible para esta cuenta/i.test(error.message)) return null;
  if (error instanceof CoworkDecisionRejected) return error.userFacing ? null : 'rejected_at_last_decision';
  if (error.name === 'TimeoutError' || /timed out/i.test(error.message) || /(?:OPENAI|GLM)_HTTP_(?:429|5\d\d)/.test(error.message)) return 'model_unavailable';
  if (issueSummary(error)) return 'invalid_at_last_decision';
  if (error.message === 'Cowork tool budget exhausted') return 'reads_at_last_decision';
  if (error.message === 'Cowork did not produce a final answer') return 'no_answer';
  return 'unexpected';
}

const MISSING_PROPOSAL_FIELDS = 'Faltan datos de la propuesta: usa un ID observado como objetivo y completa el objeto que exige la acción (campaign, code, profile, savedSearch, crmRecord, stepId, crmAssign, exceptionResolve, missionControl, messageContext, leadIds, linkedinMessage, linkedinBatch, prepareBatch, campaignId, contactsImport o preference).';

/**
 * Reads that do not count toward the turn's ceiling: the organization's writing context is one small, fixed read the
 * Writer needs for a sequence. «Crea una campaña para mis contactos con correo» needs contacts, sends and campaigns
 * besides it, and with three reads the turn stopped before writing (round g1, 16 Oct 2026).
 */
export const FREE_READS: ReadonlySet<string> = new Set(['message.context']);

function budgetFeedback(readsUsed: number, maximum: number) {
  const left = Math.max(0, maximum - readsUsed);
  return left > 0
    ? `Solo quedan ${left} lecturas en este trabajo: pide como máximo ${left} o responde con lo observado.`
    : 'No quedan lecturas en este trabajo (message.context no cuenta): responde con lo observado o propone un paso sobre un objetivo ya observado.';
}

/** Specialists cite observations by index 0 to 2 (specialists.ts): a review sees at most three. */
const SPECIALIST_OBSERVATIONS = 3;

function rejected(message: string, feedback: string) {
  return new CoworkDecisionRejected(message, feedback);
}

/** A proposal keeps only its explanation, so a document sent with it would be
 * lost while the note claims it was delivered. The model gets one chance to
 * deliver the document first; on the last decision the proposal stands. */
const DOCUMENT_WITH_PROPOSAL = 'Entregaste un documento junto con una propuesta y el documento se perdería. Si el usuario pidió un documento, entrégalo con answer (reply y document) y ofrece la acción en answer.question; si no, propón la acción con document null.';

/** Every decision that proposes something for approval: an effect, a note or a search. */
const PROPOSAL_ACTIONS = new Set<string>(['crm.propose_note', 'prospecting.propose_search',
  'leads.save_contact', 'research.start', 'draft.request', 'lead.enrich', 'email.send',
  'campaign.create', 'campaign.activate', 'campaign.pause', 'code.execute',
  'profile.update', 'saved_search.create', 'saved_search.update', 'saved_search.delete', 'campaign.stop_v2',
  'crm.update_record', 'campaign.prepare_draft_v2',
  'crm.assign_lead', 'exception.resolve', 'mission.control', 'message_context.update',
  'lead.enrich_batch', 'campaign.schedule_batch', 'linkedin.invite', 'linkedin.message', 'linkedin.invite_batch', 'linkedin.message_batch', 'contacts.import', 'email.reply_thread', 'campaign.retry',
  'contacts.prepare_batch']);
const USE_VERSION_ONLY = 'El usuario tocó «Usar esta versión»: solo fija su texto y todavía no quiere crear nada. No propongas acciones: responde en una frase que usarás su versión tal cual (sin reescribirla) y pregunta el siguiente paso, por ejemplo crear la campaña pausada con ella.';
const VERSION_KEPT_ANSWER = {
  reply: 'Listo: desde ahora uso tu versión tal cual, sin cambiarla.', document: null, question: '¿Creo la campaña pausada con ella?',
  suggestions: [{ label: 'Crear la campaña', message: 'Sí, crea la campaña pausada con esta versión' }],
};
/** When the Designer fails on the last decision: what happened and how to go on, instead of a failed turn. */
const designerFallback: CoworkAnswer = {
  reply: 'Esta vez no pude armar el artefacto. Tu pedido quedó guardado: pídemelo de nuevo y lo intento otra vez, o te lo respondo en el chat con cifras y una tabla.',
  document: null, blocks: null, question: '¿Lo intento de nuevo?',
  suggestions: [{ label: 'Inténtalo de nuevo', message: 'Inténtalo de nuevo' }, { label: 'Respóndeme en el chat', message: 'Respóndeme en el chat con cifras y una tabla' }],
};
/** The Writer failed on the turn's last decision: nothing is left to write it, so the turn says so
 * and offers to try again in one click, instead of failing. */
const writerFallback = (message: string) => ({
  reply: 'No alcancé a escribir los correos en este turno. Lo que consulté quedó guardado.', document: null,
  question: '¿Los escribo ahora?', suggestions: [{ label: 'Sí, escríbelos', message: message.slice(0, 500) }],
});

/** An answer closes with the next-step question and the quick replies that
 * answer it (rules 4 and 9). The model gets one correction per run, never on
 * its last decision: after that the answer stands as it is. */
const CLOSING_FEEDBACK = 'Cierre incompleto:';
/** What the question a closing correction adds may offer: asked for a question, the model used to fill it with a read it could
 * make («¿Te muestro cuáles tienen correo?»), the judge's most frequent complaint (Plan 13). */
const CLOSING_QUESTION_RULE = 'ofrece el paso que sigue y lleva aprobación, nombrado con su dato («¿Armo una campaña pausada para esos 21?», «¿Busco el correo de los 235 que no lo tienen?»), o pide una decisión que solo el usuario puede tomar; nunca ofrezcas una consulta que puedes hacer tú ahora («¿Te muestro…?», «¿Reviso…?», «¿Quieres que te resuma…?»)';

/** A [placeholder] in any text of a card («[tu nombre]»), which would reach the recipient as is. */
function hasFiller(block: CoworkBlock): boolean {
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(block);
  return texts.some(text => /\[[^\]]{2,}\]/.test(text));
}

/** The next-step question: answer.question, or a reply that already ends asking. */
function closingQuestion(answer: { reply: string; question?: unknown }): string | null {
  const fromField = coworkQuestion(answer.question);
  if (fromField) return fromField;
  const last = answer.reply.split('\n').filter(line => line.trim()).pop() || '';
  return /\?\s*$/.test(last) ? last.trim() : null;
}

/** A closing question that offers a free read («¿Reviso tus contactos?», «¿Quieres que te muestre…?»): the
 * judge marked «mala» 55 of the 62 measured turns that closed like this (Plan 12, 4a-4). Offers that need
 * approval («¿Busco su correo?») or write something («¿Te redacto…?») are not reads and stay. */
// «Listo» alone is «ready» («¿Listo para enviarlo?»): it lists only after whom («¿Te listo…?»).
// Plan 15: also «¿Quieres que identifique cuáles…?», «¿Analizo…?», «¿Priorizo…?»: the judge marked them as work handed back.
const OFFERED_READ = /¿\s*(?:(?:quieres|prefieres|deseas|te parece)\s+(?:que\s+)?)?(?:(?:te\s+|les?\s+|lo\s+|la\s+|los\s+|las\s+)?(?:revis[eo]|consult[eo]|mir[eo]|muestr[eo]|revisemos|veamos|resum[ao]|compar[eo]|verifi(?:co|que)|chequ[eo]|identifi(?:co|que)|analiz[oa]|analic[eo]|prioriz[oa]|prioric[eo])|(?:te|les?|los|las)\s+list[eo])\b/i;

/** The closing question when it offers a read Cowork could make itself («¿Reviso tus contactos?»), or null. The evaluation counts them. */
export function coworkOfferedRead(answer: { reply: string; question?: unknown }): string | null {
  return offeredRead(answer);
}

function offeredRead(answer: { reply: string; question?: unknown }): string | null {
  const question = closingQuestion(answer);
  return question && OFFERED_READ.test(question) ? question : null;
}

/** A quick reply that asks Cowork to look something up («Sí, revisa…», «Muéstrame mis campañas…», «Busca cuántos…»), not to do
 * something that needs approval («Busca el correo de…», «Prepara una campaña…»): after the read it offered was made, it is stale. */
const READ_CHIP = /^\s*(?:s[íi][,.]?\s*)?(?:revis[ae]|consult[ae]|mir[ae]|mu[ée]strame|muestra|compar[ae]|verific[ae]|chequea|identific[ae]|analiz[ae]|prioriz[ae]|lista|dime\s+(?:cu[áa]nt|cu[áa]l|qui[ée]n)|busca\s+(?:cu[áa]nt|cu[áa]l))/iu;

/**
 * The last word on an offered read (Plan 13): when the turn could not make it (its decisions were spent, or the model offered
 * it again), the answer closes without that question instead of asking permission for work Cowork does without approval. Its
 * quick replies stay as the next step, so it never becomes a dead end; without them the question stays.
 */
export function coworkWithoutOfferedRead<T extends { reply: string; question?: unknown; suggestions?: unknown }>(answer: T): T {
  const offered = offeredRead(answer);
  if (!offered || !coworkSuggestions(answer.suggestions).length) return answer;
  const lines = answer.reply.trimEnd().split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last >= 0 && (coworkSameLine(lines[last], offered) || (/\?\W*$/.test(lines[last]) && OFFERED_READ.test(lines[last])))) {
    lines[last] = withoutTrailingQuestions(lines[last]);
  }
  return { ...answer, reply: lines.join('\n').trimEnd(), question: null };
}

const offeredReadFeedback = (question: string) => `Tu respuesta termina ofreciendo una consulta («${question.slice(0, 160)}») que puedes hacer ahora, sin aprobación. Hazla en esta decisión con la lectura que corresponda y edita tu respuesta anterior (answerToCorrect): agrega lo que encuentres y conserva lo demás que ya decía (lo que reconociste, las cifras, los avisos), sin volver a ofrecerla. Si ninguna lectura disponible la responde, quita esa oferta. Cómo cerrar: ${COWORK_NEXT_STEP_RULE}`;

// «Después los reviso», «más tarde lo veo», «voy a…»: the answer leaves for later something it could do now.
const LEAVES_FOR_LATER = /(?<!\p{L})(?:despu[ée]s|luego|m[áa]s tarde|en otro momento|voy a|te aviso|te indicar[ée])(?!\p{L})/iu;
// A promise in the future tense of what the turn could do now («Revisaré tus contactos», «te prepararé el correo»): round 6, «promete
// «revisaré» y no lo hace».
const PROMISES = /(?<!\p{L})(?:revisar[ée]|preparar[ée]|buscar[ée]|escribir[ée]|redactar[ée]|armar[ée]|consultar[ée]|analizar[ée]|te mostrar[ée]|te dejar[ée])(?!\p{L})/iu;
// A yes: «sí», or «si» typed without the accent when what follows is not a condition («si, dale», «si porfa»). «si no me responde en
// una semana, ¿qué le mando?» is a condition (round 8: it was taken as a yes to the campaign and the follow-up was never written).
const YES = String.raw`(?:sí|si(?=\s*(?:$|[,.!;:]|(?:dale|h[áa]zlo|cr[ée]a\w*|crear|arma\w*|claro|porfa\w*|por favor|adelante|ok|perfecto|listo|me parece|gracias|bueno|quiero)(?!\p{L}))))`;
// «Sí, créala»: a quick reply that answers a question, which then has to be there.
const SAYS_YES = new RegExp(String.raw`^\s*${YES}(?!\p{L})`, 'iu');
const WRITER_FIRST = 'Los correos los escribe la Redactora, no tú: no los pongas en answer.blocks. Elige draft.write con write {kind, recipients, objective, angle, tone, steps, notes, findings}: ella los escribe y la Revisora los revisa antes de mostrarlos.';
// A yes to the campaign the previous answer offered («Sí, crea la campaña pausada», «dale», «créala»)…
const TAKES_OFFER = new RegExp(String.raw`^\s*(?:${YES}|dale|ok(?:ey)?|perfecto|listo|bueno|adelante|h[áa]zlo|cr[ée]ala|cr[ée]a la campa[ñn]a|arma la campa[ñn]a)(?!\p{L})`, 'iu');
// …that does not ask to change its emails («sí, pero con un solo texto para todos»).
/** A «dale» to a closing question that offered the campaign: the emails written now go into it in this same turn (round 15: Luna
 * wrote them after «¿…te preparo el primer correo para dejar la campaña pausada?» + «dale» and asked about the campaign again). */
export function coworkAcceptsCampaignOffer(message: string, history: CoworkHistoryTurn[] | undefined) {
  const before = coworkClosingQuestionOf(history?.at(-1)?.reply);
  return Boolean(before && /campa[ñn]a/i.test(before) && TAKES_OFFER.test(message) && !CHANGES_OFFER.test(message));
}

const CHANGES_OFFER = /(?<!\p{L})(?:pero|aunque|cambia\w*|mismo texto|un solo (?:texto|correo)|sin personalizar)(?!\p{L})/iu;
// …nor asks for the follow-ups too («sí, con sus seguimientos»).
const ASKS_FOLLOW_UPS = /(?<!\p{L})(?:seguimientos?|secuencia|toques|cadencia)(?!\p{L})/iu;

// A question that asks to approve, or to do, what a card on screen already asks (round 3 smoke test: «¿Apruebas la búsqueda de correo
// de Nehal y Katherine?» with a «Sí, busca sus correos» chip, under a card waiting for approval: the chip only sent another question).
const ASKS_APPROVAL = /^¿\s*(?:(?:te|la|lo|las|los)\s+)?(?:apruebas|apruebo|confirmas|confirmo|seguimos|avanzo|avanzamos|busco|buscamos|hago|lanzo|ejecuto)(?!\p{L})/iu;

/** A clarification about a proposal that waits for approval closes without asking for that approval: the card has its buttons. Other
 * next steps stay. */
// Whether the person already approved it is known (round 8: «¿Ya aprobaste la tarjeta para seguir?», with a «Ya la aprobé» chip).
const ASKED_IF_APPROVED = /(?<!\p{L})aprob(?:aste|é)(?!\p{L})/iu;
export function coworkClarificationAnswer<T extends { question?: unknown; suggestions?: unknown }>(answer: T): T {
  const question = coworkQuestion(answer.question);
  const asks = Boolean(question && (ASKS_APPROVAL.test(question) || ASKED_IF_APPROVED.test(question)));
  const all = coworkSuggestions(answer.suggestions);
  const chips = all.filter(chip => !SAYS_YES.test(chip.label) && !SAYS_YES.test(chip.message)
    && !ASKED_IF_APPROVED.test(chip.label) && !ASKED_IF_APPROVED.test(chip.message));
  if (!asks && chips.length === all.length) return answer;
  return { ...answer, ...(asks ? { question: null } : {}), suggestions: chips.length ? chips : null };
}

const CAPABILITIES_FEEDBACK = 'El usuario preguntó qué puedes hacer: responde eso primero, en una lista corta de 5 a 7 líneas («- Buscar prospectos: …»): buscar prospectos nuevos, tus contactos y sus correos, investigar a una persona, correos y campañas, LinkedIn, seguimiento y respuestas, cifras e informes, cada una con un ejemplo de su cuenta y lo que pide aprobación. Después, en una frase, el paso que más le sirve hoy, y la pregunta para darlo.';

/** Whether an answer lists what Cowork does: four or more list lines, or as many capabilities named. */
export function coworkListsCapabilities(reply: string) {
  const lines = reply.split('\n').filter(line => /^\s*(?:[-*•]|\d+[.)])\s/.test(line)).length;
  const plain = reply.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const named = [/prospect/, /correo/, /investig/, /campan/, /linkedin/, /seguimiento|respuesta/, /cifra|metrica|informe/].filter(item => item.test(plain)).length;
  return lines >= 4 || named >= 5;
}

/** The closing question of an answer (its last paragraph, when it asks), or null. */
export function coworkClosingQuestionOf(reply: string | undefined): string | null {
  const last = String(reply || '').trim().split(/\n\s*\n/).pop()?.trim() || '';
  return /^¿[^?]+\?$/u.test(last) ? last : null;
}

// What the closing question offered: something approved on a card (look for emails, invite, save, research, schedule, activate), a
// campaign, or writing (which needs no approval).
const OFFERS_APPROVAL = /^¿\s*(?:te\s+|les\s+|lo\s+|la\s+)?(?:busco|buscamos|invito|invitamos|guardo|guardamos|investigo|investigamos|programo|activo|pauso|detengo|completo|completamos)(?!\p{L})/iu;
const OFFERS_CAMPAIGN = /campa[ñn]a/iu;
const OFFERS_WRITING = /^¿\s*(?:te\s+|les\s+|le\s+)?(?:preparo|escribo|redacto|armo|dejo listo)\s+(?:el|un|los|unos|la|una|su|sus)\s+(?:primer\w*\s+)?(?:correo|borrador|mensaje|seguimiento|secuencia)/iu;

/**
 * A «sí» to what the previous answer offered, which this decision answers with words instead of doing (round 2 readings: «dale, ¿por
 * dónde parto?» to «¿Busco el correo de los 3?» got the same explanation and the same question back, without the card). The feedback
 * that sends it back to do it, or null.
 */
export function coworkAcceptedOfferFeedback(message: string, history: CoworkHistoryTurn[] | undefined): string | null {
  const previous = history?.at(-1);
  const offer = coworkClosingQuestionOf(previous?.reply);
  if (!offer || !TAKES_OFFER.test(message) || CHANGES_OFFER.test(message)) return null;
  return offerDone(`El usuario respondió que sí («${message.slice(0, 120)}») a lo que ofreciste en tu respuesta anterior («${offer.slice(0, 200)}»).`, offer, previous);
}

/**
 * The same offer again, after the person asked what to do next (round 3: «¿y qué debería hacer para mejorar?» got three paragraphs and
 * «¿Dejo lista la campaña pausada para tus 4 contactos con correo?» word for word): the turn does it instead. The feedback, or null.
 */
export function coworkRepeatedOfferFeedback(answer: { reply: string; question?: unknown }, history: CoworkHistoryTurn[] | undefined): string | null {
  const previous = history?.at(-1);
  const before = coworkClosingQuestionOf(previous?.reply);
  const now = closingQuestion(answer);
  if (!before || !now) return null;
  const words = (text: string) => new Set(text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-zñ]{3,}/g) || []);
  const a = words(before);
  const b = words(now);
  const shared = [...a].filter(word => b.has(word)).length;
  if (shared < 3 || shared / Math.min(a.size, b.size) < 0.7) return null;
  return offerDone(`Ya ofreciste esto en tu respuesta anterior («${before.slice(0, 200)}») y el usuario volvió a preguntar qué hacer: no lo ofrezcas de nuevo.`, before, previous);
}

/** What doing the offer means, by what it offered: writing, a campaign (with its email in view) or a card to approve. */
function offerDone(said: string, offer: string, previous: CoworkHistoryTurn | undefined): string | null {
  const extra = 'Si además pregunta algo, respóndelo en esa misma answer.reply, en una o dos frases, sin repetir tu respuesta anterior.';
  const drafted = (previous?.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence');
  // The Writer answers that turn, so a question that came with the «sí» goes in its brief (round 8: «¿y qué debería hacer para
  // mejorar?» got a reply about a signature it had «added»).
  if (OFFERS_WRITING.test(offer)) return `${said} Escríbelo ahora con draft.write. Si además pregunta algo, responde en write.findings, en una o dos frases con su dato (por ejemplo, las 2 o 3 acciones que más mueven sus cifras, la primera este correo), porque la respuesta de ese turno la escribe la Redactora y parte por ahí; answer.reply no se muestra.`;
  if (OFFERS_CAMPAIGN.test(offer)) return drafted
    ? `${said} Propón ahora campaign.create con los correos de esa respuesta (la app copia su texto tal cual), a quienes iban. ${extra}`
    : `${said} La campaña necesita su primer correo a la vista: usa draft.write con kind email y campaign true para esos contactos (un primer correo; los seguimientos, después y si los pide); cuando la Redactora termine, propones la campaña con ese correo. ${extra}`;
  if (OFFERS_APPROVAL.test(offer)) return `${said} Hazlo ahora: propón ese efecto con su tarjeta de aprobación, con los contactos que ya leíste en la conversación (si te faltan sus identificadores, consúltalos primero). ${extra}`;
  return null;
}

// An answer that closes asking whether to look for emails («¿Busco el correo de los 3 contactos que no lo tienen?»).
const OFFERS_EMAIL_LOOKUP = /^¿\s*(?:(?:te\s+|les\s+|lo\s+)?(?:busco|buscamos|completo|completamos)|(?:quieres|te parece) que (?:busque|busquemos)|partimos buscando)\s+(?:el|los|sus|su)\s+correos?(?!\p{L})/iu;

/**
 * Looking for emails is approved on its card, which names the people and the cost: an answer that asks first leaves the person one
 * more message to send and no card (round 2 readings: «No nombra a los 3 ni muestra tarjeta», for «tengo contactos sin correo, ¿qué
 * hago con ellos?»). The feedback that has it proposed now, or null.
 */
export function coworkOfferedLookupFeedback(answer: { reply: string; question?: unknown; blocks?: unknown }): string | null {
  const question = closingQuestion(answer);
  if (!question || !OFFERS_EMAIL_LOOKUP.test(question) || coworkBlocks(answer.blocks).length) return null;
  return `Tu respuesta termina preguntando si buscas correos («${question.slice(0, 160)}»), y esa búsqueda se aprueba en su tarjeta, que muestra a quiénes y cuánto cuesta. Propónla ahora: lead.enrich_batch con los contactos sin correo que leíste (lead.enrich si es una persona); si te faltan sus identificadores, consúltalos primero. En answer.reply nombra a esas personas y di en una o dos frases qué pasa al aprobar.`;
}

/**
 * Looking for emails offered in words becomes its card, built from the saved contacts without an email that the conversation read
 * (round 4: «Te muestro la propuesta de búsqueda a continuación» and no card; before, the turn asked «¿Busco el correo…?» and waited
 * for a «dale»). When the question names some of them, only those. Null when nothing offers it or nobody without an email was read.
 */
// The lookup proposed in the reply itself, with no closing question (round 11: «Propongo buscar el correo de los tres: cuesta 3
// créditos…» and no card).
const PROPOSES_LOOKUP = /\b(?:propongo|te propongo|sugiero|lo primero es|el primer paso es|conviene)\s+(?:buscar|encontrar)\b[^.?!]{0,80}\b(correos?|perfil(?:es)?)\b/i;
/** The sentence of the reply that proposes the lookup, or null. */
const proposedIn = (reply: string, kind: 'correo' | 'perfil') => {
  for (const sentence of reply.split(/(?<=[.!?])\s+|\n+/)) {
    const found = PROPOSES_LOOKUP.exec(sentence);
    if (found && found[1].toLowerCase().startsWith(kind)) return sentence.trim();
  }
  return null;
};

export function coworkLookupProposal(answer: { reply: string; question?: unknown }, message: string, history: CoworkHistoryTurn[] | undefined,
  observations: CoworkObservation[], max = 5): { goal: 'email'; people: Array<{ leadId: string }> } | null {
  const own = closingQuestion(answer) ?? (coworkQuestion(answer.question) ? null : proposedIn(answer.reply, 'correo'));
  const before = coworkClosingQuestionOf(history?.at(-1)?.reply);
  const accepted = Boolean(before && OFFERS_EMAIL_LOOKUP.test(before) && TAKES_OFFER.test(message) && !CHANGES_OFFER.test(message));
  const offer = own && (OFFERS_EMAIL_LOOKUP.test(own) || PROPOSES_LOOKUP.test(own)) ? own : accepted ? before! : null;
  // About LinkedIn, the lookup is for profiles, not this card (round 7: «la tarjeta solo busca correos, así que LinkedIn no avanza»).
  if (!offer || /linked\s?in|perfil/i.test(`${message} ${offer}`)) return null;
  const read = [...(history || []).flatMap(turn => turn.observations || []), ...observations];
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const missing = collectCoworkLeadRows(read).filter(row => uuid.test(row.id) && !(typeof row.email === 'string' && row.email.includes('@')));
  const plain = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const named = missing.filter(row => { const first = plain(String(row.name || '')).split(/\s+/)[0]; return first.length > 2 && plain(offer).includes(first); });
  // Without a name, the offer is for everyone only when it says so («los 3», «tus contactos», «sus correos»); «¿Busco su correo?» about
  // someone who is not saved (round 25: the general manager of Codelco) is not a card for the three saved contacts without one.
  const everyone = /\b(?:contactos|personas|los que no|quienes no|todos|ellos|ellas|sus correos|los correos|(?:los|las|de los|de las)\s+(?:\d+|dos|tres|cuatro|cinco))\b/i.test(plain(offer));
  const people = (named.length ? named : everyone ? missing : missing.length === 1 ? missing : []).slice(0, max);
  return people.length ? { goal: 'email', people: people.map(row => ({ leadId: row.id })) } : null;
}

// Looking for LinkedIn profiles offered in words (round 10: «¿Busco el perfil de LinkedIn de tus 7 contactos guardados?», a «sí» and
// only then the card).
const OFFERS_PROFILE_LOOKUP = /\b(?:busc\w*|encontr\w*|complet\w*)\b[^?]{0,80}\bperfil(?:es)?\b[^?]{0,40}\blinked\s?in\b/i;

/**
 * Looking for LinkedIn profiles offered (or accepted) in words becomes the «Preparar contactos» card with goal linkedin, built from the
 * saved contacts the conversation read that have no profile, the ones who decide the purchase first. Null when nothing offers it or
 * nobody without a profile was read.
 */
export function coworkProfileLookupProposal(answer: { reply: string; question?: unknown }, message: string, history: CoworkHistoryTurn[] | undefined,
  observations: CoworkObservation[], max = 10): { goal: 'linkedin'; people: Array<{ leadId: string }> } | null {
  const own = closingQuestion(answer) ?? (coworkQuestion(answer.question) ? null : proposedIn(answer.reply, 'perfil'));
  const before = coworkClosingQuestionOf(history?.at(-1)?.reply);
  const accepted = Boolean(before && OFFERS_PROFILE_LOOKUP.test(before) && TAKES_OFFER.test(message) && !CHANGES_OFFER.test(message));
  const offer = own && OFFERS_PROFILE_LOOKUP.test(own) ? own : accepted ? before! : null;
  if (!offer) return null;
  const read = [...(history || []).flatMap(turn => turn.observations || []), ...observations];
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const missing = collectCoworkLeadRows(read).filter(row => uuid.test(row.id) && !row.linkedin_url)
    .map((row, index) => ({ row, index })).sort((a, b) => coworkBuyingRoleRank(a.row.title) - coworkBuyingRoleRank(b.row.title) || a.index - b.index).map(item => item.row);
  const plain = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const named = missing.filter(row => { const first = plain(String(row.name || '')).split(/\s+/)[0]; return first.length > 2 && plain(offer).includes(first); });
  // Without names, only who decides the purchase when there are two or more (round 11: «propone pagar 7 perfiles sin priorizar»);
  // the card still lets the person take anyone off.
  const deciders = missing.filter(row => coworkDecidesPurchase(row.title));
  const people = (named.length ? named : deciders.length >= 2 ? deciders : missing).slice(0, max);
  return people.length ? { goal: 'linkedin', people: people.map(row => ({ leadId: row.id })) } : null;
}

/** Whom to invite on LinkedIn, asked in the person's words. */
export function coworkAsksLinkedinInvite(message: string) {
  return /linked\s?in/i.test(message) && /\binvit/i.test(message);
}

/** The read of the saved contacts with a LinkedIn profile came back empty: nobody to invite until their profiles are found. */
export function coworkNoSavedProfiles(observations: CoworkObservation[]) {
  return observations.some(item => item.action === 'leads.search' && (item.result as { withLinkedinOnly?: unknown; returned?: unknown } | null)?.withLinkedinOnly === true
    && (item.result as { returned?: unknown }).returned === 0);
}

type LookupPeople = { goal: 'email' | 'linkedin'; people: Array<{ leadId: string }> };
const listed = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0] ?? '';

const COUNT_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
/** The people a reply counts for a lookup («el correo de las tres personas», «los 3 contactos»), when it is not the card's number. */
export function coworkCountsOthers(reply: string, people: number) {
  const plain = reply.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const counts = [...plain.matchAll(/\b(?:los|las|tus|sus|de|a)\s+(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:personas|contactos|correos|perfiles)\b/g)]
    .map(match => Number(match[1]) || COUNT_WORDS[match[1]]);
  return counts.length > 0 && !counts.includes(people);
}

/** «Tengo contactos sin correo, ¿qué hago?»: the person asks about the contacts without an email, not about writing to others. */
export function coworkAsksMissingEmail(message: string) {
  const plain = message.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\bsin (?:correo|email|mail)s?\b/.test(plain) && !/linked\s?in|perfil|\b(?:escrib|redact|campan)/.test(plain);
}

/** What a lookup the loop proposed on its own says: who goes in the card and why, and who waits (rounds 12 and 13: «elige 5 de 7
 * sin explicar por qué»; «el texto pide sincronizar y la tarjeta aparece debajo»). */
export function coworkLookupReply(lookup: LookupPeople, read: unknown[]) {
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const rows = collectCoworkLeadRows(read).filter(row => uuid.test(row.id));
  const chosen = lookup.people.map(person => rows.find(row => row.id === person.leadId)).filter(row => row !== undefined);
  const who = (row: (typeof rows)[number]) => `${row.name}${row.company ? `, de ${row.company}` : ''}`;
  if (lookup.goal === 'email') {
    const ready = rows.filter(row => typeof row.email === 'string' && row.email.includes('@')).length;
    return `Tienes ${chosen.length === 1 ? '1 contacto guardado' : `${chosen.length} contactos guardados`} sin correo: ${listed(chosen.map(who))}. `
      + 'Sin correo no puedes escribirles, así que el paso es buscarlo: 1 crédito por persona, solo con tu aprobación y sin enviar nada. '
      + `En la tarjeta puedes quitar a quien no quieras.${ready ? ` Después, tus ${ready} contactos con correo siguen esperando su primer correo.` : ''}`;
  }
  const waiting = rows.filter(row => !row.linkedin_url && !chosen.includes(row));
  const firsts = waiting.map(row => `${String(row.name || '').split(/\s+/)[0]}${row.title ? ` (${row.title})` : ''}`);
  return 'Ninguno de tus contactos guardados tiene su perfil de LinkedIn todavía, así que aún no hay a quién invitar. '
    + (waiting.length
      ? `Propongo buscar primero el perfil ${chosen.length === 1 ? 'de quien dirige o lidera un área, porque decide o influye' : `de los ${chosen.length} que dirigen o lideran un área, porque deciden o influyen`} en la compra: ${listed(chosen.map(who))}. ${listed(firsts)} ${waiting.length === 1 ? 'queda' : 'quedan'} para después por su cargo.`
      : `Propongo buscar el perfil de ${chosen.length === 1 ? 'tu contacto' : `tus ${chosen.length} contactos`}: ${listed(chosen.map(who))}.`)
    + ` Con su perfil guardado te preparo las invitaciones${quotaOf(read)}; nada se envía sin tu aprobación.`;
}

/** The week's invitation quota, when it was read: its figure, not «tu cupo» (rounds 16–17: «no informa el cupo que se pidió revisar»). */
function quotaOf(read: unknown[]) {
  const quota = read.map(item => (item as { action?: unknown; result?: unknown } | null))
    .find(item => item?.action === 'linkedin.quota')?.result as { remaining?: unknown; limit?: unknown } | undefined;
  return typeof quota?.remaining === 'number' && typeof quota.limit === 'number'
    ? `: te quedan ${quota.remaining} de ${quota.limit} invitaciones esta semana` : ', dentro de tu cupo semanal';
}

// A stand-in read with one saved contact without a profile: whether an answer offers the profile lookup, before reading who.
const MISSING_PROFILE_PROBE: CoworkObservation = { action: 'leads.search', input: '', result: { scope: 'own_saved_contacts',
  items: [{ id: '00000000-0000-4000-8000-000000000000', name: 'Contacto', company: 'Empresa', email: null }] } };

// A stand-in read with one person without an email: whether an answer offers the lookup at all, before reading who.
const MISSING_EMAIL_PROBE: CoworkObservation = { action: 'leads.search', input: '', result: { scope: 'own_saved_contacts',
  items: [{ id: '00000000-0000-4000-8000-000000000000', name: 'Contacto', company: 'Empresa', email: null }] } };

/**
 * The email the person saw in the previous answer, when they accept the campaign it offered (round 2 readings: a «sí, crea la
 * campaña» after one email for Daniela became seven emails, six of them never shown). A sequence card, or an answer with one card per
 * person (coworkPersonalEmails), or a request for the follow-ups too, are left to the rest of the loop.
 */
export function coworkShownCampaignEmails(message: string, history: CoworkHistoryTurn[] | undefined): CoworkEditedEmail[] | null {
  const previous = history?.at(-1);
  const offer = coworkClosingQuestionOf(previous?.reply);
  if (!offer || !OFFERS_CAMPAIGN.test(offer) || !TAKES_OFFER.test(message) || CHANGES_OFFER.test(message) || ASKS_FOLLOW_UPS.test(message)) return null;
  const cards = (previous?.blocks || []).filter(block => block.type === 'email_draft' || block.type === 'sequence');
  if (cards.length !== 1 || cards[0].type !== 'email_draft') return null;
  const shown = coworkCampaignEmails(cards);
  // A follow-up («Re: …») to the email of the answer before goes after it, a week later (round 3: the campaign offered after «si no me
  // responde en una semana, ¿qué le mando?»).
  const follow = cards[0] as { subject?: unknown; to?: unknown };
  const earlier = (history?.at(-2)?.blocks || []).filter(block => block.type === 'email_draft') as Array<{ type: string; subject?: unknown; body?: unknown; to?: unknown }>;
  const first = shown && /^\s*re:/i.test(String(follow.subject || '')) && earlier.length === 1 ? earlier[0] : null;
  const same = (value: unknown) => String(value || '').replace(/^\s*re:\s*/i, '').trim().toLocaleLowerCase('es');
  if (shown && first && typeof first.body === 'string' && same(first.subject) === same(follow.subject)) {
    return [{ subject: String(first.subject), body: first.body, day: 1 }, { ...shown[0], day: 8 }];
  }
  return shown;
}

// A sentence about the follow-ups or the cadence a campaign no longer carries.
const CADENCE = /[^.!?\n]*(?<!\p{L})(?:cadencia|toques|seguimientos)(?!\p{L})[^.!?\n]*[.!?]?[ \t]*/giu;

/** A campaign note without its follow-ups, and saying what comes next instead. */
export function coworkWithoutCadence(reply: string) {
  if (!/(?<!\p{L})(?:cadencia|toques|seguimientos)(?!\p{L})/iu.test(reply)) return reply;
  const rest = reply.replace(CADENCE, ' ').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/([.!?])(?=\p{Lu})/gu, '$1 ').trim();
  return `${rest}${rest ? ' ' : ''}Va solo con este correo; si quieres, después te escribo los seguimientos.`;
}

type ClosingAnswer = { reply: string; document: { title: string } | null; question?: unknown; blocks?: unknown; suggestions?: unknown };

/** What a final answer still needs to close the way every answer of Cowork closes (rules 4, 9 and 11), and what already works and must stay.
 * Both runtimes ask for it: the coordinator loop edits its previous decision, the harness's `responder` sends the answer back. */
export function coworkClosingGaps(answer: ClosingAnswer, context: { read: boolean; metrics?: boolean } = { read: true }): { missing: string[]; keep: string[] } {
  const replies = coworkSuggestions(answer.suggestions);
  const chips = replies.length;
  const blocks = coworkBlocks(answer.blocks);
  const drafts = blocks.some(block => block.type === 'email_draft' || block.type === 'sequence');
  const filler = blocks.some(hasFiller);
  const closesOnChips = !context.read && chips > 0 && !LEAVES_FOR_LATER.test(answer.reply)
    && !replies.some(chip => SAYS_YES.test(chip.label) || SAYS_YES.test(chip.message));
  const missing = [
    closingQuestion(answer) || closesOnChips ? null : `completa answer.question con la pregunta del siguiente paso (regla 4): ${CLOSING_QUESTION_RULE}`,
    // A question apart already gets a one-tap yes (COWORK_YES_CHIP): not worth another call.
    chips || coworkQuestion(answer.question) ? null : 'agrega 1 a 3 respuestas sugeridas que se envíen tal cual al tocarlas (regla 9)',
    // Two or more emails are meant to be copied and kept: they go in a card, not in the chat.
    !answer.document && !drafts && (answer.reply.match(/asunto\s*\d*\s*[:：]/gi) || []).length >= 2
      ? 'pon los correos en un bloque sequence (regla 11) y deja en reply qué escribiste y por qué, sin repetir los correos' : null,
    // A card is copied as is: a [placeholder] would reach the recipient.
    filler ? 'reemplaza los [corchetes] de relleno de los bloques con datos reales (userContext o lo observado) o quítalos' : null,
    // The figures read go in their card, also when they are 0 (round 14: Luna gave them in the text only, «sin tarjeta»).
    context.metrics && !blocks.some(block => block.type === 'metrics') && !answer.document
      ? 'pon las cifras que leíste con metrics.rates en un bloque metrics con su período y sobre cuántos se calculan, también si son 0, y deja en reply la conclusión sin repetirlas todas' : null,
    PROMISES.test(answer.reply) ? `no prometas lo que puedes hacer ahora («${PROMISES.exec(answer.reply)?.[0]}»): dilo hecho con lo que ya consultaste, o ofrécelo en la pregunta final` : null,
  ].filter((item): item is string => Boolean(item));
  // The model edits its previous answer: name what already worked so it keeps it.
  const keep = [answer.document ? `el document «${answer.document.title.slice(0, 80)}»` : null,
    blocks.length && !filler ? 'los bloques' : null,
    closingQuestion(answer) ? 'la pregunta final' : null, chips ? 'las respuestas sugeridas' : null].filter((item): item is string => Boolean(item));
  return { missing, keep };
}

/** read: the turn consulted something. A chat answer (nothing read) that already offers its quick replies closes on them, as in
 * any AI chat (Plan 13): asking for a question too cost another call and mostly repeated a chip. Leaving something for later,
 * or a chip that says yes to a question the answer does not ask, still gets the correction. */
function closingFeedback(answer: ClosingAnswer, context: { read: boolean; metrics?: boolean } = { read: true }): string | null {
  const { missing, keep } = coworkClosingGaps(answer, context);
  if (!missing.length) return null;
  return `${CLOSING_FEEDBACK} ${missing.join(' y ')}. Edita tu respuesta anterior (answerToCorrect) y entrégala completa${keep.length ? `, conservando ${keep.join(' y ')}` : ''}.`;
}

export type CoworkAnswer = z.infer<typeof coworkDocumentSchema>;

/** When the model proposes a search without explaining it, the card still gets a
 * sentence built from the criteria, never a blank next to the approval. */
/** What a proposal does when the model left no explanation of its own: the card
 * never arrives with a generic line when the loop knows what it is about. */
function proposalNote(action: CoworkEffectAction, campaign: z.infer<typeof coworkCampaignDraftSchema> | undefined, person: string | null,
  code?: CoworkCodeProposal): string | null {
  if (campaign) return campaignNote(campaign);
  if (action === 'code.execute') {
    return code?.inputFiles.length
      ? `Propongo analizar ${code.inputFiles.join(', ')} con código en un entorno aislado. Revisa el código y los archivos en la tarjeta antes de aprobar.`
      : 'Propongo ejecutar código en un entorno aislado. Revisa el código en la tarjeta antes de aprobarlo.';
  }
  const who = person || 'este contacto';
  if (action === 'linkedin.message') return `Preparé un mensaje de LinkedIn para ${who}. Revisa el texto en la tarjeta antes de aprobarlo.`;
  if (action === 'linkedin.invite') return `Propongo invitar a ${who} en LinkedIn. Revisa la invitación en la tarjeta antes de aprobarla.`;
  if (action === 'linkedin.invite_batch') return 'Preparé las invitaciones de LinkedIn. En la tarjeta ves a quién va cada una y puedes quitar a quien no quieras antes de aprobarlas.';
  if (action === 'linkedin.message_batch') return 'Preparé los mensajes de LinkedIn, cada uno con su texto. En la tarjeta los lees, puedes quitar a quien no quieras y recién ahí los apruebas.';
  if (action === 'contacts.prepare_batch') return 'Preparé la tarjeta para dejar listas a estas personas con una sola aprobación. En la tarjeta ves qué se hace con cada una (solo lo que le falta) y cuánto cuesta, y puedes quitar a quien no quieras antes de aprobarlo.';
  if (action === 'lead.enrich') return `Propongo buscar el correo de ${who} con el proveedor; usa un crédito. Revísalo antes de aprobar.`;
  if (action === 'research.start') return `Propongo investigar a ${who} para escribirle con más contexto. Revísalo antes de aprobar.`;
  if (action === 'leads.save_contact') return `${person ? `Propongo guardar a ${person} en tus contactos.` : 'Propongo guardar este contacto en ANTON.IA.'} Revísalo antes de aprobar.`;
  if (action === 'contacts.import') return 'Propongo guardar en tus contactos a las personas que aún no están. Revisa en la tarjeta quiénes entran antes de aprobar.';
  if (action === 'lead.enrich_phone') return `Propongo pedir el teléfono de ${who} al proveedor: cuesta 10 créditos y es una persona por aprobación. La tarjeta muestra tu saldo; revísalo antes de aprobar.`;
  if (action === 'campaign.retry') return 'Propongo reintentar los envíos de esa campaña que fallaron por un motivo que se puede reintentar. En la tarjeta ves cuáles son; si la apruebas, vuelven a la cola y salen con los frenos de siempre, sin enviarse dos veces.';
  if (action === 'email.reply_thread') return `Preparé la respuesta para ${who} y la propongo enviar en su hilo. Revisa el texto en la tarjeta antes de aprobarla: si la apruebas, sale tal cual.`;
  if (action === 'preference.save') return 'Propongo recordarlo para tus próximas conversaciones. Revisa en la tarjeta cómo quedará escrito antes de aprobarlo.';
  if (action === 'task.plan') return 'Propongo hacerlo como una tarea: en la tarjeta ves los pasos, lo máximo que puede gastar y lo que nunca hará sin preguntarte. Al aprobarla, sigo paso a paso y te cuento el avance.';
  return null;
}

/** A campaign asked for with the person's exact emails («Crea una campaña pausada
 * con esta versión…») carries that text word for word: the loop copies it over
 * whatever the model wrote, and spaces the emails by the days they came with.
 * First emails the model wrote per person would replace that text, so they go. */
export function coworkCampaignWithExactEmails(campaign: z.infer<typeof coworkCampaignDraftSchema>, emails: CoworkEditedEmail[]) {
  const messages = emails.slice(0, 7).map((email, index) => {
    const previous = index > 0 ? emails[index - 1] : null;
    const fromDays = previous && email.day !== null && previous.day !== null ? email.day - previous.day : null;
    const delayDays = index === 0 ? 0 : Math.max(1, Math.min(90, fromDays ?? campaign.messages[index]?.delayDays ?? 3));
    return { subject: email.subject, body: email.body, delayDays };
  });
  return { ...campaign, messages, firstEmails: [] };
}

/** A campaign to people the Writer wrote one email each for: that email, word for word, is their first one (firstEmails); whatever the
 * model wrote for them is replaced, and people without one keep the common first email. */
export function coworkCampaignWithPersonalEmails(campaign: z.infer<typeof coworkCampaignDraftSchema>, personal: CoworkPersonalEmail[]) {
  const recipients = new Set(campaign.emails.map(email => email.trim().toLowerCase()));
  const own = personal.filter(item => recipients.has(item.email));
  if (!own.length) return campaign;
  const others = campaign.firstEmails.filter(item => !own.some(mine => mine.email === item.email.trim().toLowerCase()));
  const next = { ...campaign, firstEmails: [...others, ...own] };
  return coworkCampaignDraftSchema.safeParse(next).success ? next : campaign;
}

/**
 * A campaign to people named by their address goes to them: the filters by title, industry, country, size or level, and «only
 * contacts found in Buscar», narrow an audience nobody asked to narrow (round 6 with Luna: «Daniela aparece en tus contactos, pero
 * no está disponible para esta audiencia», a saved contact left out by the model's filters). Who was already contacted or replied
 * still counts.
 */
export function coworkCampaignForListedPeople(campaign: z.infer<typeof coworkCampaignDraftSchema>) {
  if (!campaign.emails.length) return campaign;
  return { ...campaign, criteria: { ...campaign.criteria, titles: [], industries: [], countries: [], sizes: [], seniorities: [], enrichedOnly: false } };
}

/**
 * A campaign goes to the addresses the conversation read, as they are: an address the model copied with a slip (another domain, a
 * missing letter) is put back from the contact it names, by the part before the «@» or by the person's name (round 16 with Luna: the
 * staging turned one address down and the campaign went out without José, «su correo no está disponible para esta audiencia»).
 */
export function coworkCampaignWithReadAddresses(campaign: z.infer<typeof coworkCampaignDraftSchema>, read: unknown[]) {
  const plain = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const known = collectCoworkLeadRows(read).flatMap(row => typeof row.email === 'string' && row.email.includes('@')
    ? [{ email: row.email.trim().toLowerCase(), name: plain(String(row.name || '')) }] : []);
  if (!known.length) return campaign;
  const fix = (email: string) => {
    const address = email.trim().toLowerCase();
    if (known.some(item => item.email === address)) return address;
    const local = plain(address.split('@')[0] || '').replace(/[^a-z]/g, '');
    const matches = known.filter(item => item.email.split('@')[0].replace(/[^a-z]/g, '') === local
      || (local.length > 3 && item.name.split(/\s+/).filter(part => part.length > 2).every(part => local.includes(part))));
    return matches.length === 1 ? matches[0].email : email;
  };
  const emails = [...new Set(campaign.emails.map(fix))];
  if (emails.join() === campaign.emails.join()) return campaign;
  const next = { ...campaign, emails, firstEmails: campaign.firstEmails.map(item => ({ ...item, email: fix(item.email) })) };
  return coworkCampaignDraftSchema.safeParse(next).success ? next : campaign;
}

/** The titles searched for are the people the search is for: a role policy never files them as users or referrers (round 18: «marca
 * los jefes de selección pedidos como "Usuarios" y pone como compradores cargos que no busca»). */
export function coworkSearchWithAskedBuyers<T extends { titles?: string[] | null; rolePolicy?: { decisionTerms: string[]; userTerms: string[]; referralTerms: string[]; excludeTerms: string[] } | null }>(criteria: T): T {
  const policy = criteria.rolePolicy;
  if (!policy || !criteria.titles?.length) return criteria;
  const plain = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const asked = new Set(criteria.titles.map(plain));
  const moved = [...policy.userTerms, ...policy.referralTerms].filter(term => asked.has(plain(term)));
  if (!moved.length) return criteria;
  const keep = (terms: string[]) => terms.filter(term => !asked.has(plain(term)));
  return { ...criteria, rolePolicy: { ...policy, decisionTerms: [...new Set([...policy.decisionTerms, ...moved])].slice(0, 10),
    userTerms: keep(policy.userTerms), referralTerms: keep(policy.referralTerms) } };
}

// A guide that closes asking what to explore («¿Qué parte te gustaría conocer mejor?»): round 18 readings wanted the useful step of today.
const OPEN_GUIDE_QUESTION = /\b(?:qu[ée] parte|qu[ée] te gustar[íi]a (?:conocer|saber|ver|probar)|por (?:d[óo]nde|cu[áa]l) (?:quieres|te gustar[íi]a)|algo (?:m[áa]s|en particular))\b/iu;
/** «¿Qué puedes hacer?» closes on a first step that leads somewhere, with its yes, instead of an open question. */
export function coworkGuideWithStep<T extends { reply: string; question?: unknown; suggestions?: unknown }>(answer: T): T {
  const question = typeof answer.question === 'string' ? answer.question : '';
  if (!OPEN_GUIDE_QUESTION.test(question)) return answer;
  const reply = answer.reply.split('\n').filter(line => !(/^\s*¿/.test(line) && OPEN_GUIDE_QUESTION.test(line))).join('\n').trim();
  return { ...answer, reply: reply || answer.reply, question: '¿Te escribo el primer correo para tus contactos con correo y lo dejo como campaña pausada?',
    suggestions: [{ label: 'Sí, escríbelo', message: 'Sí, escribe el primer correo para mis contactos con correo y déjalo como campaña pausada.' },
      { label: 'Buscar prospectos', message: 'Busca prospectos nuevos para mi oferta.' }] };
}

/** What a proposed campaign does, when the model left no explanation of its own. */
function campaignNote(campaign: z.infer<typeof coworkCampaignDraftSchema>): string {
  const people = campaign.emails.length;
  const emails = campaign.messages.length;
  const own = campaign.firstEmails.length;
  const first = own ? ` El primer correo va escrito para ${own === people ? (people === 1 ? 'esa persona' : 'cada una') : `${own} de ${people === 1 ? 'esa persona' : 'ellas'}`}.` : '';
  return `Preparé la campaña «${campaign.name}» para ${people} ${people === 1 ? 'contacto' : 'contactos'}, con ${emails} ${emails === 1 ? 'correo' : 'correos'}.${first} Al aprobarla queda guardada sin enviar: nada sale hasta que la actives, y activarla pide otra aprobación.`;
}

/** A search asked as the first step of a longer request («busca… y después armame
 * una campaña») says what comes after it, even when the model left no note. */
const LATER_STEP = /(?<!\p{L})(?:campa[ñn]as?|secuencias?|escribirles|mandarles|enviarles)(?!\p{L})/iu;

function searchNote(criteria: CoworkSearchCriteria, request = ''): string {
  if (criteria.linkedinUrl) {
    return 'Propongo consultar ese perfil exacto de LinkedIn (aproximadamente 1 crédito del proveedor). Revisa el enlace antes de aprobar. Esta consulta no guarda el contacto ni envía una invitación.';
  }
  // The model sometimes repeats a term («retail», «retail»): each one is named once.
  const unique = (items: string[]) => items.map(item => item.trim())
    .filter((item, index, all) => item && all.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index);
  const titles = unique(criteria.titles || []).slice(0, 3);
  const places = unique([...(criteria.locations || []), ...(criteria.companyLocations || [])]).slice(0, 2);
  const industries = unique(criteria.industries || []).slice(0, 2);
  const list = (items: string[], last: string) => items.length > 1 ? `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}` : items[0];
  // «Traer más» continues the same search: a later page, or the next people of the same companies.
  const verb = (criteria.page || 1) > 1 || criteria.offset ? 'seguir buscando' : 'buscar';
  if (coworkSearchStrategy(criteria) === 'companies_first') return [
    `Propongo ${verb} empresas`,
    industries.length ? ` del rubro ${list(industries, 'y')}` : '',
    ` y, dentro de ellas, hasta ${criteria.limit} personas`,
    titles.length ? ` con cargos como ${list(titles, 'o')}` : '',
    places.length ? `, en ${list(places, 'y')}` : '',
    '. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.',
    LATER_STEP.test(request) ? ' Cuando veas los resultados y guardes a quienes te sirvan, sigo con la campaña.' : '',
  ].join('');
  return [
    `Propongo ${verb} hasta ${criteria.limit || 25} ${criteria.target === 'companies' ? 'empresas' : 'personas'}`,
    titles.length ? ` con cargos como ${list(titles, 'o')}` : '',
    industries.length ? `, del rubro ${list(industries, 'y')}` : '',
    places.length ? `, en ${list(places, 'y')}` : '',
    '. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.',
    LATER_STEP.test(request) ? ' Cuando veas los resultados y guardes a quienes te sirvan, sigo con la campaña.' : '',
  ].join('');
}

/** The retry only has to fix the closing. Quick replies, options, a closing question or a
 * document the first answer had and the retry dropped come back, unless the
 * retry now carries the emails in the chat itself (then that document would
 * repeat them). */
function completeFrom(first: CoworkAnswer, retry: CoworkAnswer, offered: string | null = null): CoworkAnswer {
  const emailsInChat = (retry.reply.match(/asunto\s*\d*\s*[:：]/gi) || []).length >= 2;
  // A correction that made the read the first answer offered (Plan 16) never gets that offer back: neither its question nor the
  // quick replies that said yes to it or asked for a read. They came back as «Sí, revisa…» once the read was already made.
  const firstQuestion = closingQuestion(first);
  const keptQuestion = offered && firstQuestion && (coworkSameLine(firstQuestion, offered) || OFFERED_READ.test(firstQuestion)) ? null : firstQuestion;
  const firstSuggestions = offered
    ? coworkSuggestions(first.suggestions).filter(chip => !SAYS_YES.test(chip.label) && !SAYS_YES.test(chip.message) && !READ_CHIP.test(chip.message))
    : first.suggestions ?? null;
  return {
    ...retry,
    document: retry.document ?? (emailsInChat ? null : first.document),
    // Blocks come back too, unless they were the problem (a [placeholder] in a card).
    blocks: coworkBlocks(retry.blocks).length ? retry.blocks
      : emailsInChat || coworkBlocks(first.blocks).some(hasFiller) ? null : first.blocks ?? null,
    question: closingQuestion(retry) ? retry.question ?? null : keptQuestion,
    suggestions: coworkSuggestions(retry.suggestions).length ? retry.suggestions : firstSuggestions?.length ? firstSuggestions : null,
    choices: coworkChoices(retry.choices) ? retry.choices : first.choices ?? null,
  };
}

/** The same email lookup already ran in this thread (history.actions): it would
 * spend another credit for the same provider answer. */
function repeatedEnrichment(label: string, history: CoworkHistoryTurn[], kind: 'enrich_contact' | 'enrich_phone' = 'enrich_contact') {
  // Earlier turns named the same lookup «Enriquecer contacto …».
  const name = label.replace(/^Buscar (?:los datos|el correo) de /, '');
  const earlier = new Set([label, `Buscar los datos de ${name}`, `Buscar el correo de ${name}`, `Enriquecer contacto ${name}`]);
  return history.some(turn => ((turn as { actions?: Array<{ kind?: unknown; label?: unknown }> }).actions || [])
    .some(action => action.kind === kind && typeof action.label === 'string' && earlier.has(action.label)));
}

function issueSummary(error: unknown): string | null {
  const issues = (error as { issues?: Array<{ message?: string; path?: Array<string | number> }> } | null)?.issues;
  if (!Array.isArray(issues) || !issues.length) return null;
  return issues.slice(0, 4).map(issue => `${(issue.path || []).join('.') || 'decisión'}: ${issue.message || 'valor inválido'}`).join('; ');
}

/** Schema failures of the model output are correctable; anything else is not. */
function invalidDecisionReason(error: unknown): string | null {
  const summary = issueSummary(error);
  return summary ? `La decisión anterior no cumple el formato (${summary}). Corrígela.`.slice(0, 600) : null;
}

const INTERNAL_ERROR_NAMES = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']);

/** A proposal the server could not stage (for example a recipient outside the
 * audience) goes back to the model; access, cancellation, timeouts and our own bugs do not. */
function proposalRejection(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || !(error instanceof Error)) return error;
  const status = (error as { status?: number }).status;
  // A bug of ours («Cannot read properties of undefined (reading 'from')») is neither a reason the model can fix by rewording nor
  // text for the person: it stops the turn as it is, and the person reads the generic message (failure-messages.ts).
  if (INTERNAL_ERROR_NAMES.has(error.name) || ['AuthError', 'AbortError', 'TimeoutError', 'CoworkDecisionRejected'].includes(error.name) || status === 401 || status === 403) return error;
  const reason = (issueSummary(error) || error.message || 'motivo no informado').slice(0, 300);
  return new CoworkDecisionRejected(error.message, `La propuesta no se pudo preparar: ${reason}`, true);
}

const ID_TEXT = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i;
const NOT_A_STEP_READ = new Set(['answer', 'reads.parallel', 'reads.plan']);
/** What the loop wrote about itself (its note, its plan, the Writer's emails): never data an agent can analyze. */
const ASSISTANT_ACTIONS = new Set<string>([COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, COWORK_WRITTEN_ACTION]);
/** Whether the turn consulted something (the account or the web), as opposed to only writing its own notes, plan and drafts. */
export const coworkTurnRead = (observations: ReadonlyArray<Pick<CoworkObservation, 'action'>>) => observations.some(item => !ASSISTANT_ACTIONS.has(item.action));
const readsOpportunities = (decision: Decision) => decision.action === 'opportunities.list'
  || Boolean(decision.reads?.some(task => task.action === 'opportunities.list'))
  || Boolean(decision.plan?.some(task => task.read.action === 'opportunities.list'));

/** The plan as the person reads it: two to five short steps without IDs or
 * [filler]. A step keeps its read only when it names one the loop runs, so the
 * chat can check it off when that read completes. */
export function coworkOutline(value: Decision['outline']): CoworkPlanStep[] | null {
  if (!value) return null;
  const actions = new Set<string>(coworkDecisionSchema.shape.action.options);
  const steps = value.flatMap(step => {
    let label = polishCoworkText(step.label).replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');
    if (label.length < 3 || ID_TEXT.test(label) || /\[[^\]]{2,}\]/.test(label)) return [];
    if (label.length > COWORK_PLAN_LIMITS.label) {
      const cut = label.slice(0, COWORK_PLAN_LIMITS.label - 1);
      label = `${cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut}…`;
    }
    const read = step.read && actions.has(step.read) && !NOT_A_STEP_READ.has(step.read) ? step.read : null;
    return [{ label: label[0].toUpperCase() + label.slice(1), read }];
  }).slice(0, COWORK_PLAN_LIMITS.steps);
  return steps.length > 1 ? steps : null;
}

/**
 * The quick reply that keeps a preference (Plan 12, 5 and Plan 14, 4): one asked to remember, or a standing instruction said in
 * passing («siempre firma como Nico»), as Odysseus and ChatGPT learn durable facts from the conversation. Here it is only a
 * suggestion: touching it asks Cowork to remember, which proposes the card. Never when Cowork already remembers it, and never twice.
 */
export function coworkWithPreferenceSuggestion<T extends { suggestions?: CoworkAnswer['suggestions'] }>(input: { message: string; preferences?: boolean; userContext?: unknown }, answer: T): T {
  if (!input.preferences) return answer;
  const memories = (input.userContext as { memories?: unknown } | null | undefined)?.memories;
  const suggestion = coworkPreferenceSuggestion(input.message, Array.isArray(memories) ? memories.map(String) : []);
  const current = answer.suggestions || [];
  if (!suggestion || current.some(chip => /recu[eé]rd|record/i.test(`${chip.label} ${chip.message}`))) return answer;
  return { ...answer, suggestions: [...current.slice(0, 2), suggestion] };
}

/** The turn's answer with the chart its reads allow (charts.ts); the loop below is what produces it. */
export async function runCoworkReadLoop(input: Parameters<typeof runCoworkLoop>[0]): Promise<Awaited<ReturnType<typeof runCoworkLoop>>> {
  const observations: CoworkObservation[] = [...(input.resumedObservations || [])];
  let proposed = false;
  const proposeEffect = input.proposeEffect;
  const answer = await runCoworkLoop(proposeEffect ? { ...input, proposeEffect: async proposal => { proposed = true; await proposeEffect(proposal); } } : input, observations);
  return coworkFinishAnswer(input, answer, observations, proposed);
}

/** What every turn's answer goes through on its way out, whichever runtime wrote it: the preference chip, the offers that cannot be made, the chart its reads allow. */
export function coworkFinishAnswer(input: Pick<CoworkLoopInput, 'message' | 'preferences' | 'userContext' | 'offeredReads'>, answer: CoworkAnswer,
  observations: CoworkObservation[], proposed: boolean): CoworkAnswer {
  const kept = proposed ? answer : coworkWithPreferenceSuggestion(input, coworkKeptPreferenceAnswer(input, answer));
  // With offered reads on, an offer the turn could not make leaves rather than asking permission for it.
  const closed = proposed || !input.offeredReads ? kept : coworkWithoutSecondaryReadChips(coworkWithoutOfferedRead(kept), observations);
  return coworkWithCharts<typeof closed>(coworkWithoutAgendaAside(closed, observations), observations);
}

/**
 * Plan 16 (pending measurement): after reading, a quick reply other than the first that asks for another free read («Revisa mis
 * contactos y dime cuáles…») was the judge's most frequent complaint: the read belonged in the answer. The first one, which answers
 * the closing question, stays, and so do the ones that ask for something else (write, propose, search for new people).
 */
export function coworkWithoutSecondaryReadChips<T extends { suggestions?: unknown }>(answer: T, observations: CoworkObservation[]): T {
  const chips = coworkSuggestions(answer.suggestions);
  if (chips.length < 2 || !observations.some(item => !ASSISTANT_ACTIONS.has(item.action))) return answer;
  const kept = chips.filter((chip, index) => index === 0 || !READ_CHIP.test(chip.message));
  return kept.length === chips.length ? answer : { ...answer, suggestions: kept };
}

/**
 * The «Por cierto, …» aside brings up what is pending today (workspace.ts). When the turn read today's agenda, the answer is
 * about exactly that, so the aside only repeats it, even when it names nobody («Por cierto, todavía espera respuesta»; Plan 15).
 */
export function coworkWithoutAgendaAside<T extends { reply: string }>(answer: T, observations: Pick<CoworkObservation, 'action'>[]): T {
  if (!observations.some(item => item.action === 'agenda.today')) return answer;
  const reply = withoutRepeatedAside(answer.reply, '', true);
  return reply === answer.reply ? answer : { ...answer, reply };
}

// A sentence that says something was proposed, saved or waits for approval.
const PROPOSAL_CLAIM = /[^.!?\n]*(?:propong|propuest|queda(?:rá)? (?:guardad|registrad|pendiente)|(?:espera|requiere|necesita|pide) (?:tu )?aprobaci|cuando (?:la |lo )?apruebes|al aprobar)[^.!?\n]*[.!?]?[ \t]*/giu;

/**
 * Asked to remember what memories already keep, the answer must say so, never that it proposes it (Plan 12, 5). Seen with the
 * real model: after the loop sent the repeat back, it still wrote «propongo guardarla» in a plain answer, with no card. With no
 * effect proposed in the turn, such a sentence is false: it goes, and the answer says what is true.
 */
function coworkKeptPreferenceAnswer<T extends { reply: string }>(input: { message: string; preferences?: boolean; userContext?: unknown }, answer: T): T {
  if (!input.preferences) return answer;
  const asked = coworkRememberSuggestion(input.message)?.message.replace(/^Recuerda que /, '');
  const memories = (input.userContext as { memories?: unknown } | null | undefined)?.memories;
  const list = Array.isArray(memories) ? memories.map(String) : [];
  if (!asked || !coworkPreferenceAlreadyKept(asked, list) || !answer.reply.match(PROPOSAL_CLAIM)?.some(Boolean)) return answer;
  const rest = answer.reply.replace(PROPOSAL_CLAIM, '').trim();
  const kept = list.find(memory => coworkPreferenceAlreadyKept(asked, [memory])) || asked;
  return { ...answer, reply: `Ya lo tengo presente: «${kept.replace(/[.\s]+$/u, '')}». Lo aplico en tus conversaciones.${rest ? `\n\n${rest}` : ''}` };
}

/** Bounded read-only loop. Tool outputs are observations, never instructions. */
export type CoworkLoopInput = Parameters<typeof runCoworkLoop>[0];

class StageStop extends Error {}

/**
 * One decision of a proposal (a campaign, a search, a note, an effect) through the checks the coordinator loop has always applied:
 * the target must have been observed, the campaign carries the emails the person saw, a lookup already run is not asked again, and
 * the thread's budgets hold. The harness runtime decides in tool calls; it stages what it decided here, so no proposal reaches the
 * person's approval by a shorter road. A proposal that cannot be staged comes back as what to fix, never as an exception.
 */
export async function coworkStageDecision(input: CoworkLoopInput, decision: unknown, observations: CoworkObservation[]):
  Promise<{ ok: true; answer: CoworkAnswer } | { ok: false; problem: string }> {
  const parsed = coworkDecisionSchema.safeParse(decision);
  if (!parsed.success) return { ok: false, problem: `La propuesta no cumple el formato (${issueSummary(parsed.error) || 'campos inválidos'}). Corrígela.` };
  let given = false;
  let problem = '';
  try {
    const answer = await runCoworkLoop({
      ...input, resumedObservations: undefined, seeded: observations, metricPeriods: false, offeredReads: false, judge: undefined, rescue: undefined,
      ceiling: { decisions: 3, reads: 0, softDeadlineMs: 600_000 },
      decide: async (_observations, _mustAnswer, rejections = []) => {
        if (!given) { given = true; return parsed.data; }
        problem = rejections.at(-1)?.reason || 'La propuesta no se pudo preparar.';
        throw new StageStop();
      },
    }, []);
    return { ok: true, answer };
  } catch (error) {
    if (error instanceof StageStop) return { ok: false, problem };
    throw error;
  }
}

async function runCoworkLoop(input: {
  message: string;
  runId?: string;
  history?: CoworkHistoryTurn[];
  resumedObservations?: CoworkObservation[];
  /** The harness runtime's wiring (harness-turn.ts); this coordinator loop ignores it. */
  harness?: CoworkHarnessConfig;
  /** What the turn already read, outside this loop (the harness runtime): the effect checks see it, and unlike resumed observations the
   * decisions below still run in full. */
  seeded?: CoworkObservation[];
  /** The emails the Writer already wrote in this turn, for a campaign decided next (the harness runtime). */
  writtenSeed?: { emails: CoworkEditedEmail[] | null; personal: CoworkPersonalEmail[] | null; answer: CoworkAnswer } | null;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  /** How much this turn may spend; the coordinator decides within it (turn-budget.ts). */
  ceiling?: CoworkTurnCeiling;
  /** Clock for the soft deadline, injectable in tests. */
  now?: () => number;
  /** rejections: earlier decisions of this run the loop refused, with the reason.
   * budget: what is left of the ceiling at this decision. */
  decide: (observations: CoworkObservation[], mustAnswer: boolean, rejections?: CoworkRejection[], budget?: CoworkTurnBudget) => Promise<Decision>;
  execute: (action: CoworkReadAction, value: string) => Promise<unknown>;
  record: (observation: CoworkObservation) => Promise<void>;
  review?: (tasks: SpecialistTask[], observations: CoworkObservation[]) => Promise<unknown>;
  proposeNote?: (leadId: string, note: string) => Promise<void>;
  proposeSearch?: (criteria: CoworkSearchCriteria, context?: { fromWeb?: boolean }) => Promise<void>;
  proposeEffect?: (proposal: CoworkEffectProposal) => Promise<void>;
  /** The Writer: writes the emails of a `draft.write` decision and returns the turn's answer. */
  write?: (brief: CoworkWriteBrief, observations: CoworkObservation[]) => Promise<CoworkAnswer>;
  /** Lease-fenced delivery of the final Writer version into an approved task graph. */
  onWriteDelivery?: (answer: CoworkAnswer) => Promise<void>;
  /** The Designer: writes the artifact of an `artifact.create` decision, stores it and returns the turn's answer (COWORK_CODE_ARTIFACTS_ENABLED). */
  design?: (brief: CoworkDesignBrief, observations: CoworkObservation[]) => Promise<CoworkAnswer>;
  /** The Analyst: answers the question of an `analysis.write` decision with what the turn read (COWORK_ANALYST_ENABLED). */
  analyze?: (brief: CoworkAnalysisBrief, observations: CoworkObservation[]) => Promise<CoworkAnswer>;
  /** A question about a proposal that waits for approval: it is answered, never turned into a new proposal or the same one. */
  clarification?: boolean;
  /** contacts.import may be proposed (COWORK_CONTACTS_IMPORT_ENABLED, once its migration is applied). */
  contactsImport?: boolean;
  /** email.reply_thread may be proposed (COWORK_REPLY_THREAD_ENABLED; its reply_thread migration is applied in production). */
  replyThread?: boolean;
  /** campaign.retry may be proposed (COWORK_CAMPAIGN_RETRY_ENABLED; its campaign_retry effect is in the migration 20260930170000). */
  campaignRetry?: boolean;
  /** lead.enrich_phone may be proposed (COWORK_PHONE_REVEAL_ENABLED; its enrich_phone effect is in the migration 20260930170000). */
  phoneReveal?: boolean;
  /** linkedin.invite_batch / linkedin.message_batch may be proposed (COWORK_LINKEDIN_BATCH_ENABLED; its migration is applied in production). */
  linkedinBatch?: boolean;
  /** contacts.prepare_batch may be proposed (on unless COWORK_PREPARE_BATCH_ENABLED=false; its kind is in the migration 20261001210000). */
  prepareBatch?: boolean;
  /** preference.save may be proposed (COWORK_PREFERENCES_ENABLED; its memory_save kind is in the migration 20261006160000). */
  preferences?: boolean;
  /** task.plan may be proposed (COWORK_TASKS_ENABLED, outside a running task; its task_plan kind is in the migration 20261007120000). */
  tasks?: boolean;
  /** opportunities.list may be read: the owner of the run is in OPPORTUNITIES_ALLOWED_EMAILS (server/cowork/opportunities-read.ts). */
  opportunities?: boolean;
  /** The judge (plan 2, G2): reads the coordinator's final answer before it is shown and returns
   * what to fix, or null when it stands. At most once per turn, and only with a decision to spare;
   * `canRead` says whether its correction may still make a read (a decision for it and one to answer). */
  judge?: (answer: CoworkAnswer, observations: CoworkObservation[], turn: { canRead: boolean }) => Promise<string | null>;
  /** Whether the judge's correction was kept (coworkCorrectionVerdict), once it arrives. */
  onCorrection?: (verdict: CoworkCorrectionVerdict) => void;
  /** An answer that closes offering a read it could make gets it made first (COWORK_OFFERED_READS_ENABLED). */
  offeredReads?: boolean;
  /** Exact user period/scope counts can be obtained without spending a model decision on obvious routing. */
  metricPeriods?: boolean;
  /** Who the person is and what they sell: figures from it are not new when a correction uses them. */
  userContext?: unknown;
  /** Keeps the summary of the conversation a decision carries (thread-memory.ts). Best effort: it never fails the turn. */
  remember?: (memory: CoworkThreadMemory) => Promise<void>;
  /** Where a search looks when nobody said where: the places in «Perfil», or the account's default (search-scope.ts). */
  searchDefaults?: CoworkSearchDefaults | null;
  /** What a search has to keep, when it is not this turn's message: inside a long task, the plan the person approved (its
   * goal and steps), since its turns run by themselves with an automatic message. */
  scopeRequest?: string;
  /** One last decision by a stronger model when the turn would fail (Plan 14, 2): it may only answer. Null when it cannot
   * (no time or budget left); its answer stands as the turn's. */
  rescue?: (observations: CoworkObservation[], rejections: CoworkRejection[], failure: CoworkTurnFailure) => Promise<Decision | null>;
  /** The turn was rescued, and why. */
  onRescue?: (failure: CoworkTurnFailure) => void;
}, observations: CoworkObservation[]) {
  if (input.seeded?.length) observations.push(...input.seeded);
  const remember = async (decision: Decision) => {
    if (decision.memory && input.remember) await input.remember(decision.memory).catch(() => undefined);
  };
  // A preference asked for next to a writing task (Plan 12, 5): the Writer applied it, and a quick reply keeps it for next time.
  // Seen with the real model: the Writer's own suggestions never offered it, so the preference was lost.
  const withRememberSuggestion = (answer: CoworkAnswer): CoworkAnswer => coworkWithPreferenceSuggestion(input, answer);
  if (observations.length && !input.seeded) {
    // The pre-queue phase already spent reads/model decisions. Resume only
    // synthesis, never a second tool or specialist budget in the same run.
    input.signal.throwIfAborted(); await input.authorize();
    const decision = coworkDecisionSchema.parse(await input.decide(observations, true));
    await remember(decision);
    input.signal.throwIfAborted(); await input.authorize();
    if (decision.action === 'draft.write' && decision.write && input.write) {
      return withRememberSuggestion(await input.write(decision.write, await coworkWriterObservations(decision.write, observations, input.history ?? [])));
    }
    if (decision.action === 'artifact.create' && decision.design && input.design) return input.design(decision.design, observations);
    if (decision.action === 'analysis.write' && decision.analysis && input.analyze) return input.analyze(decision.analysis, observations);
    if (decision.action !== 'answer' || !decision.answer) throw new Error('Resumed review must produce a final answer');
    return withCoworkReports(decision.answer, observations);
  }
  const ceiling = input.ceiling ?? COWORK_TURN_DEFAULTS;
  const now = input.now ?? Date.now;
  const startedAt = now();
  // The offered read may add one decision past the ceiling (below), never past what the ledger admits.
  let last = ceiling.decisions - 1;
  // Past the soft deadline the turn wraps up: the next decision answers with what it has.
  const late = () => now() - startedAt >= ceiling.softDeadlineMs;
  let readsUsed = 0;
  let reviewed = false;
  const rejections: CoworkRejection[] = [];
  // The model's own explanation travels with the approval card instead of a
  // canned line; it is persisted as a note event, never as a data read.
  const recordNote = async (text: string) => {
    const reply = polishCoworkText(text).trim();
    if (!reply) return null;
    await input.authorize();
    input.signal.throwIfAborted();
    await input.record({ action: COWORK_NOTE_ACTION, input: '', result: { reply } });
    return reply;
  };
  const explain = (decision: Decision) => recordNote(decision.answer?.reply || '');
  // The plan shows up before the first read, so the person sees what is coming
  // while it works. Only the first consulting decision draws it.
  let outlined = false;
  const recordPlan = async (decision: Decision) => {
    if (outlined) return;
    outlined = true;
    const steps = coworkOutline(decision.outline);
    if (!steps) return;
    await input.authorize();
    input.signal.throwIfAborted();
    await input.record({ action: COWORK_PLAN_ACTION, input: '', result: { steps } });
  };
  // The answer that got the closing correction. From then on the loop never ends
  // worse than that answer: no more reads, and a failed retry returns it.
  let closingFallback: CoworkAnswer | null = null;
  // The answer the judge asked to fix: it stands if the correction fails or runs out of time. The
  // correction may make one more read (typically the one the answer offered), then answers.
  let judged = false;
  let judgedFallback: CoworkAnswer | null = null;
  let judgeReadsAt = 0;
  let judgeCanRead = false;
  const judgeReadDone = () => judgedFallback !== null && readsUsed > judgeReadsAt;
  // That read may go past the ceiling: it is the one the answer offered instead of making it.
  const readLimit = () => judgedFallback && judgeCanRead && !judgeReadDone() ? Math.max(ceiling.reads, judgeReadsAt + 1) : ceiling.reads;
  let campaignsListed = false;
  let filesListed = false;
  // The correction that makes the read an answer offered is the loop's, not the judge's: it is not reported as one.
  let offerCorrected = false;
  let offeredText: string | null = null;
  // A search that dropped or changed the place asked for goes back once (Plan 14, 1); after that, the card shows its criteria.
  let scopeCorrected = false;
  // An answer that carried emails the coordinator wrote itself, sent back once to the Writer; it stands if the Writer fails.
  let coordinatorEmails: CoworkAnswer | null = null;
  let writerFailed = false;
  // The «sí» to the previous answer's offer went back once (coworkAcceptedOfferFeedback).
  let offerTaken = false;
  // A campaign accepted without its email went back once to be written first.
  let campaignRedirected = false;
  // The turn's last word when it would fail (Plan 14, 2): an answer already given stands first; then, once, the rescue.
  let rescued = false;
  const rescueOr = async (error: unknown): Promise<CoworkAnswer> => {
    if (input.signal.aborted) throw error;
    const standing = closingFallback ?? judgedFallback ?? written?.answer ?? coordinatorEmails ?? null;
    if (standing && (error instanceof CoworkDecisionRejected || coworkTurnFailure(error))) return standing;
    const failure = input.rescue && !rescued ? coworkTurnFailure(error) : null;
    if (!failure) throw error;
    rescued = true;
    let decision: Decision | null = null;
    try {
      await input.authorize();
      const given = await input.rescue!(observations, rejections.slice(), failure);
      decision = given ? coworkDecisionSchema.parse(given) : null;
    } catch (rescueError) {
      if (input.signal.aborted) throw rescueError;
      decision = null;
    }
    if (!decision || decision.action !== 'answer' || !decision.answer?.reply?.trim()) throw error;
    await remember(decision);
    input.onRescue?.(failure);
    return withCoworkReports(decision.answer, observations);
  };
  const keepsVersionOnly = coworkOnlyUsesVersion(input.message);
  const requestedMetrics = coworkRequestedMetricQuery(input.message);
  const smallTalk = input.message.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const informationOnly = /^(?:hola(?: anton(?: ia)?| cowork)?|buen(?:os dias|as tardes|as noches)|(?:hola )?(?:que haces|que puedes hacer(?: tu| por mi)?|dime (?:todo )?(?:lo )?que puedes hacer|como me puedes ayudar|para que sirves))$/.test(smallTalk);
  // «¿Qué puedes hacer por mí?» asks for what Cowork does, not only for the next step (round 3: two lines that only offered a campaign).
  const capabilitiesAsked = informationOnly && /(?:que haces|que puedes hacer|como me puedes ayudar|para que sirves)/.test(smallTalk);
  let capabilitiesChecked = false;
  if (requestedMetrics && input.metricPeriods && !observations.some(item => item.action === 'metrics.rates') && readsUsed < readLimit()) {
    await input.authorize(); input.signal.throwIfAborted();
    const query = JSON.stringify(requestedMetrics);
    if (!outlined) {
      await input.record({ action: COWORK_PLAN_ACTION, input: '', result: { steps: [
        { label: requestedMetrics.scope === 'own' ? 'Cuento tu actividad del período' : 'Cuento la actividad del equipo', read: 'metrics.rates' },
        { label: 'Te resumo las cifras y su base', read: null },
      ] } });
      outlined = true;
    }
    readsUsed++;
    const result = await input.execute('metrics.rates', query);
    await input.authorize(); input.signal.throwIfAborted();
    const observation: CoworkObservation = { action: 'metrics.rates', input: query, result };
    await input.record(observation); observations.push(observation);
  }
  // Emails the Writer wrote when the person asked for the campaign in the same request (Plan 12, 4a-2): the next
  // decision proposes it with them, word for word. Whatever happens after, the Writer's answer is never lost.
  let written: { emails: CoworkEditedEmail[] | null; personal: CoworkPersonalEmail[] | null; answer: CoworkAnswer } | null = input.writtenSeed ?? null;
  for (let turn = 0; turn <= last; turn++) {
    input.signal.throwIfAborted();
    await input.authorize();
    const overdue = late();
    const budget: CoworkTurnBudget = { reads: readLimit(), readsLeft: Math.max(0, readLimit() - readsUsed), decisionsLeft: last - turn };
    let decision: Decision;
    try {
      decision = coworkDecisionSchema.parse(await input.decide(observations,
        informationOnly || turn === last || readsUsed >= readLimit() || closingFallback !== null || overdue || judgeReadDone(), rejections.slice(), budget));
    } catch (error) {
      const reason = invalidDecisionReason(error);
      const standing = closingFallback ?? judgedFallback;
      if (standing && !input.signal.aborted) return standing;
      if (input.signal.aborted) throw error;
      // A model that timed out or answered out of format on the last decision: the rescue answers instead of failing.
      if (reason === null || turn === last) return rescueOr(error);
      rejections.push({ action: 'decision', reason });
      continue;
    }
    input.signal.throwIfAborted();
    if (requestedMetrics) {
      const bind = (value: string) => value.trim().startsWith('{') ? value : JSON.stringify(requestedMetrics);
      if (decision.action === 'metrics.rates') decision.query = bind(decision.query || '');
      if (decision.action === 'reads.parallel') decision.reads = decision.reads?.map(task => task.action === 'metrics.rates' ? { ...task, input: bind(task.input) } : task);
      if (decision.action === 'reads.plan') decision.plan = decision.plan?.map(task => task.read.action === 'metrics.rates' ? { ...task, read: { ...task.read, input: bind(task.read.input) } } : task);
    }
    await remember(decision);
    try {
      // An email lookup offered or accepted in words goes out as its card, with no other decision.
      const offersLookup = decision.action === 'answer' && decision.answer && input.proposeEffect && input.prepareBatch && !input.clarification && !informationOnly;
      let forcedReply: string | null = null;
      let lookup: LookupPeople | null = offersLookup
        ? coworkLookupProposal(decision.answer!, input.message, input.history, observations) : null;
      // Offered from the account's figures, before anyone was read (round 5: «¿Busco el correo de los 3…?» with no card): who still
      // lacks an email is read first, the read the card needs.
      if (offersLookup && !lookup && coworkLookupProposal(decision.answer!, input.message, input.history, [MISSING_EMAIL_PROBE])) {
        const probe: CoworkObservation = { action: 'leads.search', input: 'sin correo', result: await input.execute('leads.search', 'sin correo') };
        await input.record(probe);
        observations.push(probe);
        lookup = coworkLookupProposal(decision.answer!, input.message, input.history, observations);
      }
      // «¿A quién invito por LinkedIn?» with no saved profile: finding them is the step, offered or not, before any search for new
      // people (round 12: Luna asked to sync the network and stopped there; the Haiku coordinator proposed a prospect search).
      const searchesInstead = decision.action === 'prospecting.propose_search' && input.proposeEffect && input.prepareBatch && !input.clarification && !informationOnly;
      if ((offersLookup || searchesInstead) && !lookup && coworkAsksLinkedinInvite(input.message) && coworkNoSavedProfiles(observations)) {
        const offer = { reply: '', question: '¿Busco el perfil de LinkedIn de tus contactos guardados?' };
        if (!coworkProfileLookupProposal(offer, input.message, input.history, observations)) {
          const probe: CoworkObservation = { action: 'leads.search', input: '', result: await input.execute('leads.search', '') };
          await input.record(probe);
          observations.push(probe);
        }
        lookup = coworkProfileLookupProposal(offer, input.message, input.history, observations);
        if (lookup) forcedReply = coworkLookupReply(lookup, [...(input.history || []).flatMap(item => item.observations || []), ...observations]);
      }
      // «Tengo contactos sin correo, ¿qué hago?»: looking for their email is the step (round 13: Luna sent the person to write to the
      // others first and offered no card).
      // Also when it answered without reading anyone or went to write an email nobody asked for (round 16: a generic «Hola nombre»).
      const writesInstead = decision.action === 'draft.write' && input.proposeEffect && input.prepareBatch && !input.clarification && !informationOnly;
      if ((offersLookup || writesInstead) && !lookup && coworkAsksMissingEmail(input.message)) {
        const offer = { reply: '', question: '¿Busco el correo de los contactos que no lo tienen?' };
        if (!coworkLookupProposal(offer, input.message, input.history, observations)) {
          const probe: CoworkObservation = { action: 'leads.search', input: 'sin correo', result: await input.execute('leads.search', 'sin correo') };
          await input.record(probe);
          observations.push(probe);
        }
        lookup = coworkLookupProposal(offer, input.message, input.history, observations);
        if (lookup) forcedReply = coworkLookupReply(lookup, [...(input.history || []).flatMap(item => item.observations || []), ...observations]);
      }
      // A LinkedIn profile lookup offered in words is its card too; with nobody read yet, the saved contacts are read first.
      if (offersLookup && !lookup) lookup = coworkProfileLookupProposal(decision.answer!, input.message, input.history, observations);
      if (offersLookup && !lookup && coworkProfileLookupProposal(decision.answer!, input.message, input.history, [MISSING_PROFILE_PROBE])) {
        const probe: CoworkObservation = { action: 'leads.search', input: '', result: await input.execute('leads.search', '') };
        await input.record(probe);
        observations.push(probe);
        lookup = coworkProfileLookupProposal(decision.answer!, input.message, input.history, observations);
      }
      // Looking for several emails is always the «Preparar contactos» card, with a box to take anyone off (round 6: «la tarjeta incluye a
      // las 3 y pide escribir para quitar a Carlos»).
      if (decision.action === 'lead.enrich_batch' && decision.leadIds?.length && input.prepareBatch) {
        decision = { ...decision, action: 'contacts.prepare_batch', prepareBatch: { goal: 'email', people: decision.leadIds.map(leadId => ({ leadId })) } } as Decision;
      }
      if (lookup && (decision.action === 'prospecting.propose_search' || decision.action === 'draft.write')) {
        decision = { ...decision, action: 'contacts.prepare_batch', prepareBatch: lookup, searchCriteria: undefined, write: undefined,
          answer: { reply: forcedReply ?? '', document: null } } as Decision;
      }
      if (lookup && decision.answer) {
        const reply = decision.answer.reply.split('\n').filter(line => !/^\s*¿/.test(line) && !/a continuaci[óo]n\.?\s*$/i.test(line)).join('\n').trim();
        // A reply that counts other people than the card («busco el correo de las tres» over a card with two, round 18) says it again.
        const read = [...(input.history || []).flatMap(item => item.observations || []), ...observations];
        const said = forcedReply ?? (coworkCountsOthers(reply || decision.answer.reply, lookup.people.length) ? coworkLookupReply(lookup, read) : (reply || decision.answer.reply));
        decision = { ...decision, action: 'contacts.prepare_batch', prepareBatch: lookup,
          answer: { ...decision.answer, reply: said, question: null, suggestions: null } } as Decision;
      }
      if (informationOnly && decision.action !== 'answer') throw rejected('Orientation needs no tools', 'El usuario solo saluda o pregunta qué haces. Responde con las capacidades disponibles y el contexto ya recibido, sin consultas ni propuestas de ejecución.');
      if (decision.action === 'draft.write') {
        // «Usar esta versión» keeps the person's text as it is: nobody rewrites it.
        if (keepsVersionOnly) {
          if (turn === last) return VERSION_KEPT_ANSWER;
          throw rejected('Version kept, nothing to write', USE_VERSION_ONLY);
        }
        // On the last decision nobody is left to write it: the answer that got the closing
        // correction, or a line that offers to try again, instead of a failed turn.
        const lastResort = () => closingFallback ?? judgedFallback ?? coordinatorEmails ?? writerFallback(input.message);
        if (!input.write) {
          if (turn === last) return lastResort();
          throw rejected('Writer unavailable', 'La redacción delegada no está disponible: entrega tú el texto en answer.blocks (regla 11).');
        }
        // The decision schema already checked the brief; it only has to be there.
        if (!decision.write) {
          if (turn === last) return lastResort();
          throw rejected('Missing write brief', 'Elegiste draft.write sin encargo: incluye write {kind, recipients, objective, angle, tone, steps, notes, findings}.');
        }
        let answer: CoworkAnswer;
        try {
          const brief = decision.write;
          const lookup = async (name: string): Promise<CoworkObservation | null> => {
            const observation: CoworkObservation = { action: 'leads.search', input: name, result: await input.execute('leads.search', name) };
            await input.record(observation);
            return observation;
          };
          answer = await input.write(brief, await coworkWriterObservations(brief, observations, input.history ?? [], lookup));
          const normalized = coworkBlocks(answer.blocks);
          if (answer.blocks?.length && JSON.stringify(normalized) !== JSON.stringify(answer.blocks)) answer = { ...answer, blocks: normalized.length ? normalized : null };
          await input.onWriteDelivery?.(answer);
        } catch (error) {
          if (input.signal.aborted) throw error;
          writerFailed = true;
          if (turn === last) return lastResort();
          // A failed Writer does not end the turn: the coordinator writes it, as before.
          throw rejected('Writer failed', 'La Redactora no pudo escribir esta vez: entrega tú el texto en answer.blocks (regla 11), sin mencionarle esto al usuario.');
        }
        const asked: boolean = Boolean((decision.write.campaign || coworkAcceptsCampaignOffer(input.message, input.history)) && !written && turn < last && input.proposeEffect);
        const emails: CoworkEditedEmail[] | null = asked ? coworkCampaignEmails(answer.blocks) : null;
        // One email per person (Plan 15): each becomes that person's first email in the campaign.
        const personal: CoworkPersonalEmail[] | null = asked && !emails ? coworkPersonalEmails(answer.blocks) : null;
        if (!emails && !personal) return withRememberSuggestion(coworkWithDemoNote(answer));
        written = { emails, personal, answer };
        observations.push({ action: COWORK_WRITTEN_ACTION, input: '', result: emails ? {
          scope: 'writer_output', emails,
          next: 'La Redactora ya escribió estos correos y el usuario pidió la campaña: propón ahora campaign.create con ellos (la app copia su texto) a los contactos guardados con correo que leíste. En answer.reply di a quiénes va, cuántos correos lleva y que queda pausada hasta otra aprobación; habla en primera persona («los correos que te escribí»), sin nombrar a la Redactora ni a la Revisora; no hables de versiones anteriores ni nombres el remitente si no lo leíste en app.context. Si nadie puede recibirla, responde con answer y di por qué; los correos se muestran igual.',
        } : {
          scope: 'writer_output', firstEmails: personal,
          next: 'La Redactora ya escribió el primer correo de cada persona y el usuario pidió la campaña: propón ahora campaign.create con emails sus correos (la app copia el texto de cada una como su primer correo) y, en messages, un primer correo común con «Hola {{nombre}},» para quien quede sin el suyo. En answer.reply di a quiénes va, que cada una recibe su propio primer correo y que queda pausada hasta otra aprobación; habla en primera persona («los correos que te escribí»), sin nombrar a la Redactora ni a la Revisora; no hables de versiones anteriores ni nombres el remitente si no lo leíste en app.context. Si nadie puede recibirla, responde con answer y di por qué; los correos se muestran igual.',
        } });
        continue;
      }
      if (decision.action === 'artifact.create') {
        // On the last decision nobody is left to answer without it: a line that offers to try again.
        const lastResort = () => closingFallback ?? judgedFallback ?? designerFallback;
        if (!input.design) {
          if (turn === last) return lastResort();
          throw rejected('Artifacts unavailable', 'Los artefactos todavía no están disponibles: entrega la respuesta con un bloque metrics o table (regla 11) o un document.');
        }
        if (!decision.design) {
          if (turn === last) return lastResort();
          throw rejected('Missing design brief', 'Elegiste artifact.create sin encargo: incluye design {title, goal, tables, previous, change}.');
        }
        try {
          return await input.design(decision.design, observations);
        } catch (error) {
          if (input.signal.aborted) throw error;
          if (turn === last) return lastResort();
          throw rejected('Designer failed', `La Diseñadora no pudo esta vez (${error instanceof Error ? error.message.slice(0, 200) : 'error'}): entrega tú la respuesta con un bloque metrics o table, o un document.`);
        }
      }
      if (decision.action === 'analysis.write') {
        // On the last decision nobody is left to answer without it: a line that offers to try again.
        const lastResort = () => closingFallback ?? judgedFallback ?? coworkAnalystFallback(input.message);
        if (!input.analyze) {
          if (turn === last) return lastResort();
          throw rejected('Analyst unavailable', 'La Analista no está disponible: entrega tú la respuesta con answer (regla 11).');
        }
        if (!decision.analysis) {
          if (turn === last) return lastResort();
          throw rejected('Missing analysis brief', 'Elegiste analysis.write sin encargo: incluye analysis {question, focus, notes}.');
        }
        // The Analyst writes from what the turn read: without data there is nothing to analyze yet.
        if (!observations.some(item => !ASSISTANT_ACTIONS.has(item.action))) {
          if (turn === last) return lastResort();
          throw rejected('Analysis before reading', 'La Analista escribe con lo que consultaste: primero consulta los datos que responden la pregunta (por ejemplo metrics.rates, metrics.channels o campaigns.batch_report) y después usa analysis.write.');
        }
        try {
          return await input.analyze(decision.analysis, observations);
        } catch (error) {
          if (input.signal.aborted) throw error;
          if (turn === last) return lastResort();
          throw rejected('Analyst failed', 'La Analista no pudo esta vez: entrega tú la respuesta con answer (regla 11).');
        }
      }
      if (decision.action === 'answer') {
        // The campaign was not proposed after all: the Writer's emails are the answer, as without 4a-2.
        if (written) return written.answer;
        if (!decision.answer) throw rejected('Missing final answer', 'Elegiste answer sin contenido: entrega answer.reply con la respuesta completa.');
        // Emails go through the Writer (its checks, the Reviewer and one correction) while it can still write: an answer that
        // carries them itself goes back once as a draft.write, and stands if the Writer then fails (v7 reading: one written this
        // way had every defect the checks catch). A version the person sent, or a Writer that already failed, is not sent back.
        if (input.write && !coordinatorEmails && !writerFailed && !keepsVersionOnly && !coworkEditedEmails(input.message) && turn < last && !late()
          && !closingFallback && !judgedFallback && coworkBlocks(decision.answer.blocks).some(block => block.type === 'email_draft' || block.type === 'sequence')) {
          coordinatorEmails = decision.answer;
          rejections.push({ action: 'answer', reason: WRITER_FIRST });
          continue;
        }
        if (capabilitiesAsked && !capabilitiesChecked && !closingFallback && turn < last && !late() && !coworkListsCapabilities(decision.answer.reply)) {
          capabilitiesChecked = true;
          closingFallback = decision.answer;
          rejections.push({ action: 'answer', reason: CAPABILITIES_FEEDBACK, previous: decision.answer });
          continue;
        }
        // A «sí» to what the previous answer offered is done, not answered again: once per turn, with a decision to spare.
        const accepted = !offerTaken && !input.clarification && !closingFallback && !judgedFallback && !written && !informationOnly && turn < last && !late()
          ? coworkAcceptedOfferFeedback(input.message, input.history) ?? coworkRepeatedOfferFeedback(decision.answer, input.history)
            ?? (input.proposeEffect ? coworkOfferedLookupFeedback(decision.answer) : null) : null;
        if (accepted) {
          offerTaken = true;
          closingFallback = decision.answer;
          rejections.push({ action: 'answer', reason: accepted, previous: decision.answer });
          continue;
        }
        // The reports it names go complete in document, written by the app from what this turn read (report-document.ts).
        decision.answer = withCoworkReports(decision.answer, observations);
        if (closingFallback) return completeFrom(closingFallback, decision.answer);
        // The judge's correction edits the judged answer: it keeps what the correction dropped, and
        // it is kept only if it is one (not empty, not the same, no figures without support).
        if (judgedFallback) {
          const corrected = completeFrom(judgedFallback, decision.answer, offerCorrected ? offeredText : null);
          const verdict = coworkCorrectionVerdict(judgedFallback, corrected, [observations, input.history ?? [], input.userContext ?? null]);
          if (!offerCorrected) input.onCorrection?.(verdict);
          return verdict.keep === 'first' ? judgedFallback : corrected;
        }
        // A correction needs one more decision, and time for it.
        const closing = turn < last && !late()
          ? closingFeedback(decision.answer, { read: observations.some(item => !ASSISTANT_ACTIONS.has(item.action)),
            metrics: observations.some(item => item.action === 'metrics.rates') }) : null;
        if (closing) {
          // Asked directly, not thrown: the catch below returns closingFallback once it is set.
          closingFallback = decision.answer;
          rejections.push({ action: 'answer', reason: closing, previous: decision.answer });
          continue;
        }
        // An answer that offers a read it could make gets it made, as a judge's correction would: one more
        // read (past the ceiling if needed) and the edited answer, with the offered one standing if that fails.
        // A turn that spent its decisions reading gets the two it needs, up to the ledger's coordinator calls:
        // that was where most offers stayed unmade (Plan 12, final round).
        const offered = !informationOnly && input.offeredReads && !judged && !keepsVersionOnly && turn + 2 <= Math.max(last, COWORK_MAX_COORDINATOR_CALLS - 1) && !late()
          ? offeredRead(decision.answer) : null;
        if (offered) {
          last = Math.max(last, turn + 2);
          judged = true;
          offerCorrected = true;
          offeredText = offered;
          judgedFallback = decision.answer;
          judgeReadsAt = readsUsed;
          judgeCanRead = true;
          rejections.push({ action: 'answer', reason: offeredReadFeedback(offered), previous: decision.answer });
          continue;
        }
        // The judge reads the answer once, with a decision to spare and time for it; its
        // correction is the next decision, and the judged answer stands if that one fails. Keeping
        // a version only confirms it: there is nothing for a correction to do.
        if (input.judge && !judged && !judgedFallback && !keepsVersionOnly && turn < last && !late()) {
          judged = true;
          const canRead = turn + 2 <= last;
          const fix = await input.judge(decision.answer, observations, { canRead }).catch(error => {
            if (input.signal.aborted) throw error;
            return null;
          });
          input.signal.throwIfAborted();
          if (fix) {
            judgedFallback = decision.answer;
            judgeReadsAt = readsUsed;
            judgeCanRead = canRead;
            rejections.push({ action: 'answer', reason: fix, previous: decision.answer });
            continue;
          }
        }
        return informationOnly ? coworkGuideWithStep(decision.answer) : decision.answer;
      }
      if (decision.action === 'specialists.review' && (closingFallback ?? judgedFallback)) return (closingFallback ?? judgedFallback)!;
      if (decision.action === 'specialists.review') {
        if (reviewed || turn === last || !input.review || !decision.specialists || !observations.length) {
          throw rejected('Specialist review unavailable or budget exhausted', 'La revisión de especialistas no está disponible ahora: continúa con lecturas o responde.');
        }
        if (observations.length + decision.specialists.filter(task => task.read).length > SPECIALIST_OBSERVATIONS) {
          throw rejected('Specialist review sees at most three observations', 'La revisión de especialistas solo está disponible con hasta 3 consultas en el turno: responde con lo observado.');
        }
        reviewed = true;
        await input.authorize(); input.signal.throwIfAborted();
        const result = await input.review(decision.specialists, observations);
        await input.authorize(); input.signal.throwIfAborted();
        const observation: CoworkObservation = { action: 'specialists.review', input: '', result };
        await input.record(observation);
        observations.push(observation);
        continue;
      }
      // «Usar esta versión» only keeps the person's text: the model proposed a campaign
      // anyway in 1 to 3 of every 3 runs, so the loop turns any proposal back into the answer.
      if (keepsVersionOnly && PROPOSAL_ACTIONS.has(decision.action)) {
        // On the last decision the confirmation itself is the answer, never a failed turn.
        if (turn === last) return VERSION_KEPT_ANSWER;
        throw rejected('Version kept, nothing proposed yet', USE_VERSION_ONLY);
      }
      if (decision.action === 'prospecting.propose_search') {
        if (!input.proposeSearch || !decision.searchCriteria) {
          throw rejected('Invalid external search proposal', input.proposeSearch
            ? 'Para proponer una búsqueda incluye searchCriteria completo.' : 'La búsqueda externa no está disponible: responde con lo que tienes.');
        }
        const parsed = coworkSearchCriteriaSchema.safeParse(decision.searchCriteria);
        if (!parsed.success) throw rejected('Invalid external search proposal', `Criterios de búsqueda inválidos: ${issueSummary(parsed.error)}. Corrígelos.`);
        if (decision.answer?.document && turn < last) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
        // The place asked for stays in the search, and a search with no place gets the person's market (Plan 14, 1). Inside a
        // long task the search is approved by itself: nobody would see the card before it spends the quota.
        const scope = coworkSearchScope(parsed.data, input.scopeRequest ?? input.message, input.searchDefaults ?? null);
        if (scope.problem && turn < last && !scopeCorrected && !coworkExplainsSearchScope(decision.answer?.reply || '', scope.missing)) {
          scopeCorrected = true;
          throw rejected('Search scope changed', scope.problem);
        }
        const searchCriteria = coworkSearchWithAskedBuyers(scope.criteria);
        if (scope.added && decision.answer?.reply?.trim() && !coworkMentionsPlaces(decision.answer.reply, scope.added.places)) {
          decision.answer = { ...decision.answer, reply: `${decision.answer.reply.trim()} ${coworkSearchScopeNotice(scope.added)}` };
        }
        const note = await explain(decision) ?? await recordNote(searchNote(searchCriteria, input.message));
        await input.authorize(); input.signal.throwIfAborted();
        try { await input.proposeSearch(searchCriteria); } catch (error) { throw proposalRejection(error, input.signal); }
        return { reply: note || (decision.searchCriteria.target === 'companies'
          ? 'Revisa los criterios antes de buscar empresas.' : 'Revisa los criterios antes de buscar nuevos contactos.'), document: null };
      }
      if (decision.action === 'crm.propose_note') {
        if (!input.proposeNote || !decision.leadId || !decision.note) throw rejected('Invalid note proposal', 'Para proponer una nota incluye leadId de un contacto observado y el texto completo en note.');
        const observed = observations.some(observation => {
          const result = observation.result as { items?: Array<{ id?: string }> } | null;
          return Array.isArray(result?.items) && result.items.some(item => item.id === decision.leadId);
        });
        if (!observed) throw rejected('Note target must be observed first', 'El contacto de la nota no aparece en los resultados de este trabajo: búscalo primero con leads.search y usa su id.');
        if (decision.answer?.document && turn < last) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
        const note = await explain(decision);
        await input.authorize();
        input.signal.throwIfAborted();
        try { await input.proposeNote(decision.leadId, decision.note); } catch (error) { throw proposalRejection(error, input.signal); }
        return { reply: note || 'Revisa el cambio de nota antes de guardarlo.', document: null };
      }
      if (decision.action === 'leads.save_contact' || decision.action === 'research.start' || decision.action === 'draft.request' || decision.action === 'lead.enrich' || decision.action === 'email.send' || decision.action === 'campaign.create' || decision.action === 'campaign.activate' || decision.action === 'campaign.pause' || decision.action === 'code.execute'
        || decision.action === 'profile.update' || decision.action === 'saved_search.create' || decision.action === 'saved_search.update' || decision.action === 'saved_search.delete' || decision.action === 'campaign.stop_v2'
        || decision.action === 'crm.update_record' || decision.action === 'campaign.prepare_draft_v2'
        || decision.action === 'crm.assign_lead' || decision.action === 'exception.resolve' || decision.action === 'mission.control'
        || decision.action === 'message_context.update' || decision.action === 'lead.enrich_batch'
        || decision.action === 'campaign.schedule_batch'
        || decision.action === 'linkedin.invite' || decision.action === 'linkedin.message'
        || decision.action === 'linkedin.invite_batch' || decision.action === 'linkedin.message_batch'
        || decision.action === 'contacts.import' || decision.action === 'email.reply_thread' || decision.action === 'campaign.retry' || decision.action === 'lead.enrich_phone'
        || decision.action === 'contacts.prepare_batch' || decision.action === 'preference.save' || decision.action === 'task.plan') {
        if (!input.proposeEffect) throw rejected('Effect proposals unavailable', 'En este contexto no puedes proponer acciones: responde con lo observado.');
        const kind: CoworkEffectKind = decision.action === 'leads.save_contact' ? 'save_contact'
          : decision.action === 'research.start' ? 'start_research'
          : decision.action === 'lead.enrich' ? 'enrich_contact'
          : decision.action === 'email.send' ? 'send_email'
          : decision.action === 'campaign.create' ? 'campaign_create'
          : decision.action === 'campaign.activate' ? 'campaign_activate'
          : decision.action === 'campaign.pause' ? 'campaign_pause'
          : decision.action === 'code.execute' ? 'code_execute'
          : decision.action === 'profile.update' ? 'profile_update'
          : decision.action === 'saved_search.create' ? 'saved_search_create'
          : decision.action === 'saved_search.update' ? 'saved_search_update'
          : decision.action === 'saved_search.delete' ? 'saved_search_delete'
          : decision.action === 'campaign.stop_v2' ? 'campaign_stop_v2'
          : decision.action === 'crm.update_record' ? 'crm_update_record'
          : decision.action === 'campaign.prepare_draft_v2' ? 'campaign_prepare_draft_v2'
          : decision.action === 'crm.assign_lead' ? 'crm_assign_lead'
          : decision.action === 'exception.resolve' ? 'exception_resolve'
          : decision.action === 'mission.control' ? 'mission_control'
          : decision.action === 'message_context.update' ? 'message_context_update'
          : decision.action === 'lead.enrich_batch' ? 'enrich_batch'
          : decision.action === 'campaign.schedule_batch' ? 'campaign_schedule_batch'
          : decision.action === 'linkedin.invite' ? 'linkedin_invite'
          : decision.action === 'linkedin.message' ? 'linkedin_message'
          : decision.action === 'linkedin.invite_batch' ? 'linkedin_invite_batch'
          : decision.action === 'linkedin.message_batch' ? 'linkedin_message_batch'
          : decision.action === 'contacts.import' ? 'contacts_import'
          : decision.action === 'email.reply_thread' ? 'reply_thread'
          : decision.action === 'campaign.retry' ? 'campaign_retry'
          : decision.action === 'lead.enrich_phone' ? 'enrich_phone'
          : decision.action === 'contacts.prepare_batch' ? 'lead_prepare_batch'
          : decision.action === 'preference.save' ? 'memory_save'
          : decision.action === 'task.plan' ? 'task_plan' : 'request_draft';
        const targetId = decision.action === 'leads.save_contact' ? decision.providerId
          : decision.action === 'draft.request' ? decision.snapshotId
          : decision.action === 'email.send' ? decision.draftId
          : decision.action === 'campaign.create' ? 'new-campaign'
          : decision.action === 'campaign.activate' || decision.action === 'campaign.pause' ? decision.campaignId
          : decision.action === 'code.execute' ? 'new-code'
          : decision.action === 'profile.update' ? 'own-profile'
          : decision.action === 'saved_search.create' ? 'new-saved-search'
          : decision.action === 'saved_search.update' || decision.action === 'saved_search.delete'
            ? (decision.savedSearch as { id?: string } | null)?.id ?? null
          : decision.action === 'campaign.stop_v2' ? decision.enrollmentId
          : decision.action === 'crm.update_record' ? decision.crmRecord?.gid ?? null
          : decision.action === 'campaign.prepare_draft_v2' ? decision.stepId
          : decision.action === 'crm.assign_lead' ? decision.crmAssign?.leadId ?? null
          : decision.action === 'exception.resolve' ? decision.exceptionResolve?.exceptionId ?? null
          : decision.action === 'mission.control' ? decision.missionControl?.missionId ?? null
          : decision.action === 'message_context.update' ? 'own-message-context'
          : decision.action === 'lead.enrich_batch' ? 'new-enrich-batch'
          : decision.action === 'campaign.schedule_batch' || decision.action === 'campaign.retry' ? decision.campaignId
          : decision.action === 'linkedin.invite' || decision.action === 'linkedin.message' ? 'new-linkedin-job'
          : decision.action === 'linkedin.invite_batch' || decision.action === 'linkedin.message_batch' ? 'new-linkedin-batch'
          : decision.action === 'contacts.import' ? 'new-contacts-import'
          : decision.action === 'contacts.prepare_batch' ? 'new-prepare-batch'
          : decision.action === 'preference.save' ? 'new-preference'
          : decision.action === 'task.plan' ? 'new-task'
          : decision.action === 'email.reply_thread' ? decision.replyThread?.contactedId ?? null
          : decision.leadId;
        const exactEmails = decision.action === 'campaign.create' ? coworkEditedEmails(input.message) ?? written?.emails
          ?? coworkShownCampaignEmails(input.message, input.history) : null;
        // The first email the Writer wrote for each person, in this turn or in the answer this one continues, goes word for word.
        const personalEmails = decision.action === 'campaign.create' && !exactEmails
          ? written?.personal ?? (TAKES_OFFER.test(input.message) && !CHANGES_OFFER.test(input.message)
            ? coworkPersonalEmails(input.history?.[input.history.length - 1]?.blocks) : null) : null;
        // A «sí» to a campaign the previous answer offered without an email in view: the Writer writes it first, and the campaign
        // goes with it (round 4: the coordinator's own three emails, unseen, after «Me equivoqué antes»).
        if (decision.action === 'campaign.create' && !exactEmails && !personalEmails && !written && !campaignRedirected && input.write && turn < last && !late()
          && /campa[ñn]a/i.test(coworkClosingQuestionOf(input.history?.at(-1)?.reply) || '') && TAKES_OFFER.test(input.message) && !CHANGES_OFFER.test(input.message)
          && !(input.history?.at(-1)?.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence')) {
          campaignRedirected = true;
          throw rejected('Campaign without its email', 'La campaña necesita su primer correo a la vista: usa draft.write con kind email y campaign true para los contactos con correo que leíste (recipients con sus nombres; un primer correo, los seguimientos después y si los pide); cuando la Redactora termine, propones campaign.create con ese correo.');
        }
        const invalidCampaign = decision.action === 'campaign.create' ? campaignProblem(decision.campaign) : null;
        if (invalidCampaign) throw rejected('Invalid campaign definition', `La decisión anterior no cumple el formato (${invalidCampaign}). Corrígela.`.slice(0, 600));
        const campaign = decision.action === 'campaign.create' && decision.campaign
          ? coworkCampaignWithReadAddresses(coworkCampaignForListedPeople(exactEmails ? coworkCampaignWithExactEmails(decision.campaign, exactEmails)
            : personalEmails ? coworkCampaignWithPersonalEmails(decision.campaign, personalEmails) : decision.campaign),
          [...(input.history || []).flatMap(item => item.observations || []), ...observations]) : undefined;
        const code = decision.action === 'code.execute' ? decision.code ?? undefined : undefined;
        // Only what changes: a field sent as null keeps its value.
        const profile = decision.action === 'profile.update' ? coworkProfilePatchFromDecision(decision.profile) ?? undefined : undefined;
        const savedSearch = decision.action === 'saved_search.create' || decision.action === 'saved_search.update' || decision.action === 'saved_search.delete'
          ? decision.savedSearch ?? undefined : undefined;
        const campaignId = decision.action === 'campaign.stop_v2' ? decision.campaignId ?? undefined : undefined;
        const enrollmentId = decision.action === 'campaign.stop_v2' ? decision.enrollmentId ?? undefined : undefined;
        const crmRecord = decision.action === 'crm.update_record' ? decision.crmRecord ?? undefined : undefined;
        const stepId = decision.action === 'campaign.prepare_draft_v2' ? decision.stepId ?? undefined : undefined;
        const crmAssign = decision.action === 'crm.assign_lead' ? decision.crmAssign ?? undefined : undefined;
        const exceptionResolve = decision.action === 'exception.resolve' ? decision.exceptionResolve ?? undefined : undefined;
        const missionControl = decision.action === 'mission.control' ? decision.missionControl ?? undefined : undefined;
        const messageContext = decision.action === 'message_context.update' ? decision.messageContext ?? undefined : undefined;
        if (!targetId) throw rejected('Missing effect target', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'campaign.create' && !campaign) throw rejected('Missing campaign definition', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'code.execute' && !code) throw rejected('Missing code proposal', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'profile.update' && !profile) throw rejected('Missing profile patch', MISSING_PROPOSAL_FIELDS);
        if ((decision.action === 'saved_search.create' || decision.action === 'saved_search.update' || decision.action === 'saved_search.delete') && !savedSearch) {
          throw rejected('Missing saved-search proposal', MISSING_PROPOSAL_FIELDS);
        }
        if (decision.action === 'campaign.stop_v2' && (!campaignId || !enrollmentId)) throw rejected('Missing campaign stop target', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'crm.update_record' && !crmRecord) throw rejected('Missing CRM record patch', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'campaign.prepare_draft_v2' && !stepId) throw rejected('Missing campaign step target', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'crm.assign_lead' && !crmAssign) throw rejected('Missing collaboration assignment', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'exception.resolve' && !exceptionResolve) throw rejected('Missing exception triage', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'mission.control' && !missionControl) throw rejected('Missing mission control', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'message_context.update' && !messageContext) throw rejected('Missing message context patch', MISSING_PROPOSAL_FIELDS);
        const enrichBatch = decision.action === 'lead.enrich_batch' ? decision.leadIds ?? undefined : undefined;
        if (decision.action === 'lead.enrich_batch' && (!enrichBatch || !enrichBatch.length)) throw rejected('Missing batch targets', MISSING_PROPOSAL_FIELDS);
        const linkedinJob = decision.action === 'linkedin.invite' && decision.leadId ? { leadId: decision.leadId }
          : decision.action === 'linkedin.message' && decision.leadId && decision.linkedinMessage
            ? { leadId: decision.leadId, message: decision.linkedinMessage } : undefined;
        if (decision.action === 'linkedin.invite' && !linkedinJob) throw rejected('Missing invite target', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'linkedin.message' && !linkedinJob) throw rejected('Missing message target and text', MISSING_PROPOSAL_FIELDS);
        if ((decision.action === 'linkedin.invite_batch' || decision.action === 'linkedin.message_batch') && !input.linkedinBatch) {
          throw rejected('LinkedIn batch unavailable', 'Proponer un lote de LinkedIn desde Cowork todavía no está disponible: propón a una persona por vez con linkedin.invite o linkedin.message, o deja la lista lista para que la revise el usuario.');
        }
        let linkedinBatch: CoworkLinkedinBatchInput | undefined;
        if (decision.action === 'linkedin.invite_batch' || decision.action === 'linkedin.message_batch') {
          if (!decision.linkedinBatch) throw rejected('Missing batch people', MISSING_PROPOSAL_FIELDS);
          try {
            coworkLinkedinBatchLeads(decision.action === 'linkedin.invite_batch' ? 'invite' : 'message', decision.linkedinBatch);
          } catch (error) { throw rejected('Invalid LinkedIn batch', error instanceof Error ? error.message : MISSING_PROPOSAL_FIELDS); }
          linkedinBatch = decision.linkedinBatch;
        }
        if (decision.action === 'contacts.prepare_batch' && !input.prepareBatch) {
          throw rejected('Prepare batch unavailable', 'Preparar varias personas con una sola aprobación todavía no está disponible: propón el primer paso de la primera persona (leads.save_contact, lead.enrich o research.start) y di que cada una lleva su aprobación.');
        }
        let prepareBatch: CoworkPrepareBatchInput | undefined;
        if (decision.action === 'contacts.prepare_batch') {
          if (!decision.prepareBatch) throw rejected('Missing batch people', MISSING_PROPOSAL_FIELDS);
          try { coworkPrepareBatchPeople(decision.prepareBatch); } catch (error) {
            throw rejected('Invalid prepare batch', error instanceof z.ZodError ? MISSING_PROPOSAL_FIELDS : error instanceof Error ? error.message : MISSING_PROPOSAL_FIELDS);
          }
          prepareBatch = decision.prepareBatch;
        }
        const scheduleBatch = decision.action === 'campaign.schedule_batch' && decision.campaignId
          ? { campaignId: decision.campaignId, ...(decision.spacingMinutes == null ? {} : { spacingMinutes: decision.spacingMinutes }) }
          : undefined;
        if (decision.action === 'campaign.schedule_batch' && !scheduleBatch) throw rejected('Missing batch schedule', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'contacts.import' && !input.contactsImport) {
          throw rejected('Contacts import unavailable', 'Importar contactos desde Cowork todavía no está disponible: di que se importan con «Importar Leads» en la app y sigue con lo que sí puedes hacer.');
        }
        const contactsImport = decision.action === 'contacts.import' ? decision.contactsImport ?? undefined : undefined;
        if (decision.action === 'contacts.import' && !contactsImport) throw rejected('Missing import file', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'email.reply_thread' && !input.replyThread) {
          throw rejected('Reply in thread unavailable', 'Enviar una respuesta dentro del hilo desde Cowork todavía no está disponible: entrega el borrador en un bloque email_draft y di que se envía desde Contactados (Respuestas).');
        }
        if (decision.action === 'campaign.retry' && !input.campaignRetry) {
          throw rejected('Campaign retry unavailable', 'Reintentar envíos desde Cowork todavía no está disponible: di qué envíos se pueden reintentar (campaigns.retry_review) y que se reintentan desde la campaña en la app; los que quedaron sin confirmar si salieron no se reintentan hasta revisar en Contactados si se enviaron.');
        }
        if (decision.action === 'campaign.retry' && !decision.campaignId) throw rejected('Missing campaign', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'lead.enrich_phone' && !input.phoneReveal) {
          throw rejected('Phone reveal unavailable', 'Pedir teléfonos desde Cowork todavía no está disponible: di que no puedes revelar teléfonos y ofrece lo que sí: su correo (lead.enrich, 1 crédito) o escribirle por LinkedIn si tiene perfil.');
        }
        const replyThread = decision.action === 'email.reply_thread' ? decision.replyThread ?? undefined : undefined;
        if (decision.action === 'email.reply_thread' && !replyThread) throw rejected('Missing reply', MISSING_PROPOSAL_FIELDS);
        if (decision.action === 'preference.save' && !input.preferences) {
          throw rejected('Preferences unavailable', 'Guardar preferencias desde Cowork todavía no está disponible: tenlo en cuenta en este trabajo y di que, para que valga siempre, se agrega en Perfil o en el contexto de redacción.');
        }
        const preference = decision.action === 'preference.save' ? decision.preference ?? undefined : undefined;
        if (decision.action === 'preference.save' && !preference) throw rejected('Missing preference', MISSING_PROPOSAL_FIELDS);
        // Seen with the real model: asked to remember what memories already had, it proposed it again word for word.
        const memories = (input.userContext as { memories?: unknown } | null | undefined)?.memories;
        if (preference && coworkPreferenceAlreadyKept(preference.text, Array.isArray(memories) ? memories.map(String) : [])) {
          throw rejected('Preference already remembered', 'Eso ya está entre lo que recuerdas (memories) y ya se aplica: no lo propongas de nuevo. Responde con answer: di en una frase que ya lo tienes presente y que ya lo aplicas, sin decir que lo propones, que lo guardas ni que espera aprobación, y sigue con lo que pidió, si pidió algo más.');
        }
        if (decision.action === 'task.plan' && !input.tasks) {
          throw rejected('Tasks unavailable', 'Las tareas largas no están disponibles aquí: haz el primer paso del pedido ahora (o propón su primera acción con su tarjeta) y di en reply el plan completo con lo que sigue.');
        }
        const task = decision.action === 'task.plan' ? decision.task ?? undefined : undefined;
        if (decision.action === 'task.plan' && !task) throw rejected('Missing task plan', 'Elegiste task.plan sin plan: incluye task {goal, steps [{label, kind: search|prepare|write|campaign}], limits {searches, credits}}.');
        const taskProblem = task ? coworkTaskPlanProblem(task) : null;
        if (taskProblem) throw rejected('Invalid task plan', `El plan no cuadra (${taskProblem}). Corrígelo.`);
        const effectAction = decision.action;
        const originOf = () => effectAction === 'code.execute'
          ? codeOriginRunId(code?.inputFiles || [], observations, input.history || [], input.runId || '')
          // People typed in the conversation come from this run; a file must have been seen.
          : contactsImport ? (contactsImport.file ? importOriginRunId(contactsImport.file, observations, input.history || [], input.runId || '') : input.runId || null)
          : effectTargetRun(effectAction, targetId, observations, input.history || [], input.runId || '');
        let originRunId = originOf();
        // A campaign is proposed next to the list of existing ones. When the model
        // skipped that read, the loop reads it instead of losing the whole proposal
        // (seen with the real model on the last decision, after its three reads).
        // It is one fixed read the loop needs, so it may go past the read budget once.
        if (!originRunId && decision.action === 'campaign.create' && !campaignsListed) {
          campaignsListed = true;
          await input.authorize();
          input.signal.throwIfAborted();
          const listed: CoworkObservation = { action: 'campaigns.list', input: '', result: await input.execute('campaigns.list', '') };
          readsUsed++;
          await input.record(listed);
          observations.push(listed);
          originRunId = effectTargetRun(decision.action, targetId, observations, input.history || [], input.runId || '');
        }
        // The same for code on uploaded files proposed before reading them (seen with an
        // Excel): the loop lists the uploads once instead of rejecting the whole turn away.
        if (!originRunId && (decision.action === 'code.execute' || decision.action === 'contacts.import') && !filesListed) {
          filesListed = true;
          await input.authorize();
          input.signal.throwIfAborted();
          const listed: CoworkObservation = { action: 'files.list', input: '', result: await input.execute('files.list', '') };
          readsUsed++;
          await input.record(listed);
          observations.push(listed);
          originRunId = originOf();
        }
        if (!originRunId) {
          if (decision.action === 'campaign.retry') {
            throw rejected('Retry campaign must be reviewed first', 'Esa campaña no aparece leída con campaigns.retry_review en este hilo, o no tiene envíos reintentables (summary.retryable es 0): léela primero con campaigns.retry_review y usa su campaignId exacto; lo que está terminal o por conciliar no se reintenta.');
          }
          if (decision.action === 'email.reply_thread') {
            throw rejected('Reply conversation must be read first', 'La conversación no aparece leída con replies.thread en este hilo, o su consejo (advice) no es «reply»: léela primero con replies.thread y usa su contactedId exacto; si el consejo es otro, sigue ese consejo y no propongas enviar nada.');
          }
          throw rejected('Effect target must be observed first', decision.action === 'code.execute' || decision.action === 'contacts.import'
            ? `Los archivos de ${decision.action} no están entre las subidas del usuario: usa el nombre exacto que muestra files.list o files.read; si falta, pide subirlo con el clip «Adjuntar archivos».`
            : 'El objetivo de la propuesta no aparece en los resultados de este hilo: consúltalo primero (leads.search, campaigns.list, draft.get o research.get_existing) y usa su ID exacto. Para crear una campaña, los destinatarios deben ser contactos guardados con correo.');
        }
        if (decision.answer?.document && turn < last) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
        const targetName = describeLeadTarget(decision.action, targetId, observations, input.history || []);
        const label = effectLabel(decision.action, targetId, targetName);
        if (kind === 'enrich_phone' && turn < last && repeatedEnrichment(label, input.history || [], 'enrich_phone')) {
          throw rejected('Phone already requested in this thread', 'Ya se pidió el teléfono de este contacto en este hilo (mira history.actions): repetirlo gasta otros 10 créditos. No lo vuelvas a proponer: di que ya se pidió y que llega a los contactos enriquecidos.');
        }
        if (kind === 'enrich_contact' && turn < last && repeatedEnrichment(label, input.history || [])) {
          throw rejected('Enrichment already ran in this thread', 'Ya se buscó el correo de este contacto en este hilo (mira history.actions): repetirlo gasta otro crédito y el proveedor responde lo mismo. No lo vuelvas a proponer; sigue con lo que pidió el usuario (por ejemplo, investigarlo con research.start) o explica la alternativa.');
        }
        // A campaign trimmed to the email the person saw does not announce follow-ups it no longer carries.
        if (campaign && decision.answer?.reply && campaign.messages.length === 1) decision.answer = { ...decision.answer, reply: coworkWithoutCadence(decision.answer.reply) };
        const fallback = proposalNote(decision.action, campaign, targetName
          ?? (decision.leadId ? observedLeadName(decision.leadId, observations, input.history || []) : null), code);
        const note = await explain(decision) ?? (fallback ? await recordNote(fallback) : null);
        await input.authorize();
        input.signal.throwIfAborted();
        try {
        await input.proposeEffect({ kind, targetId, label, originRunId,
          ...(campaign === undefined ? {} : { campaign }), ...(code === undefined ? {} : { code }),
          ...(profile === undefined ? {} : { profile }), ...(savedSearch === undefined ? {} : { savedSearch }),
          ...(campaignId === undefined ? {} : { campaignId }), ...(enrollmentId === undefined ? {} : { enrollmentId }),
          ...(crmRecord === undefined ? {} : { crmRecord }), ...(stepId === undefined ? {} : { stepId }),
          ...(crmAssign === undefined ? {} : { crmAssign }),
          ...(exceptionResolve === undefined ? {} : { exceptionResolve }),
          ...(missionControl === undefined ? {} : { missionControl }),
          ...(messageContext === undefined ? {} : { messageContext }),
          ...(enrichBatch === undefined ? {} : { enrichBatch }),
          ...(scheduleBatch === undefined ? {} : { scheduleBatch }),
          ...(linkedinJob === undefined ? {} : { linkedinJob }),
          ...(contactsImport === undefined ? {} : { contactsImport }),
          ...(replyThread === undefined ? {} : { replyThread }),
          ...(linkedinBatch === undefined ? {} : { linkedinBatch }),
          ...(prepareBatch === undefined ? {} : { prepareBatch }),
          ...(preference === undefined ? {} : { preference }),
          ...(task === undefined ? {} : { task }) });
        } catch (error) { throw proposalRejection(error, input.signal); }
        return { reply: note || 'Revisa la propuesta antes de ejecutar el cambio.', document: null };
      }
      // Only reads remain below: after a closing correction the first answer stands instead.
      if (closingFallback) return closingFallback;
      // After the judge's correction one read decision is allowed; after it, on the last decision
      // or without time, the judged answer stands.
      if (judgedFallback && (judgeReadDone() || turn === last || late())) return judgedFallback;
      if (turn === last) return rescueOr(new Error('Cowork tool budget exhausted'));
      // Checked again here: the decision itself may have run past the soft deadline.
      if (late()) throw rejected('Cowork turn time exhausted', 'Se acabó el tiempo de este turno: responde con lo observado y di en una línea qué queda para el siguiente paso.');
      // «Oportunidades» exists only for the accounts that see the section: for anyone else the read is not there.
      // Next to other reads it is left out, with its step of the plan, and the others run: sent back, the model asked
      // for it again until the turn ran out of decisions (Plan 12, final round: «muéstrame mi pipeline en un gráfico»).
      if (!input.opportunities && decision.action === 'reads.parallel'
        && decision.reads?.some(task => task.action !== 'opportunities.list')) {
        decision.reads = decision.reads.filter(task => task.action !== 'opportunities.list');
        decision.outline = decision.outline?.filter(step => step.read !== 'opportunities.list');
      }
      if (!input.opportunities && readsOpportunities(decision)) {
        throw rejected('Read unavailable', 'Esa consulta no está disponible en esta cuenta: sigue con las demás y no la menciones.');
      }
      await recordPlan(decision);
      if (decision.action === 'reads.plan') {
        if (!decision.plan || readsUsed + decision.plan.length > readLimit()) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed, readLimit()));
        readsUsed += decision.plan.length;
        await executeCoworkReadPlan(decision.plan, {
          signal: input.signal, authorize: input.authorize,
          execute: read => input.execute(read.action, read.input),
          record: async (task, result) => {
            const observation = { action: task.read.action, input: task.read.input, result, task: { id: task.id, dependsOn: task.dependsOn } };
            await input.record(observation); observations.push(observation);
          },
        });
        continue;
      }
      if (decision.action === 'reads.parallel') {
        // A fixed read asked twice (for example, with two periods) is one read.
        const reads = decision.reads?.filter((task, index, all) =>
          all.findIndex(other => other.action === task.action && other.input === task.input) === index);
        const counted = reads ? reads.filter(task => !FREE_READS.has(task.action)).length : 0;
        if (!reads || readsUsed + counted > readLimit()) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed, readLimit()));
        readsUsed += counted;
        await executeCoworkParallelReads(reads, {
          signal: input.signal, authorize: input.authorize,
          execute: task => input.execute(task.action, task.input),
          record: async (task, result) => {
            const observation = { action: task.action, input: task.input, result };
            await input.record(observation); observations.push(observation);
          },
        });
        continue;
      }
      if (decision.action === 'privacy.contactability_batch' || decision.action === 'lists.review_batch') {
        // One batch consumes the turn's read budget: at most 5 minimized checks.
        if (!decision.leadIds || readsUsed > 0) throw rejected('Cowork tool budget exhausted', decision.leadIds
          ? 'Las revisiones en lote solo pueden ser la primera consulta del trabajo: responde o usa lecturas individuales.' : 'Falta leadIds con 1 a 5 contactos observados.');
        readsUsed = ceiling.reads;
        await input.authorize();
        input.signal.throwIfAborted();
        const result = await input.execute(decision.action, JSON.stringify(decision.leadIds));
        input.signal.throwIfAborted();
        const observation = { action: decision.action, input: JSON.stringify(decision.leadIds), result };
        await input.authorize();
        await input.record(observation);
        observations.push(observation);
        continue;
      }
      if (!FREE_READS.has(decision.action) && readsUsed >= readLimit()) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed, readLimit()));
      const value = COWORK_DOMAIN_FIXED_READS.some(action => action === decision.action) ? ''
        : decision.action === 'leads.search' || decision.action === 'crm.search' || decision.action === 'contacted.search' || decision.action === 'deliverability.check' || decision.action === 'site.read' || decision.action === 'leads.count' || decision.action === 'compliance.obligation'
          || decision.action === 'files.read'
        ? (decision.query ?? (decision.reads?.length === 1 && decision.reads[0].action === decision.action
            ? decision.reads[0].input : null))
          : decision.action === 'icp.analyze' || decision.action === 'leads.recommend' || decision.action === 'opportunities.list' || decision.action === 'metrics.rates'
            ? (decision.query ?? '')
          : decision.action === 'metrics.overview' || decision.action === 'metrics.diagnose' || decision.action === 'metrics.channels' || decision.action === 'metrics.incidents' || decision.action === 'deliverability.bounces' || decision.action === 'deliverability.sender' || decision.action === 'compliance.law' || decision.action === 'app.context' || decision.action === 'campaigns.list' || decision.action === 'files.list' || decision.action === 'saved_searches.list' || decision.action === 'profile.get'
          || decision.action === 'linkedin.network' || decision.action === 'linkedin.inbox' || decision.action === 'linkedin.quota'
          || decision.action === 'linkedin.followups' || decision.action === 'linkedin.jobs'
          || decision.action === 'replies.attention' || decision.action === 'replies.stalled' || decision.action === 'leads.summary'
            ? ''
          : decision.action === 'draft.get' || decision.action === 'message.check_terms' || decision.action === 'message.check_evidence'
            ? decision.draftId
          : decision.action === 'campaigns.batch_report' || decision.action === 'campaigns.next_touch'
          || decision.action === 'campaigns.retry_review' || decision.action === 'campaigns.company_plan'
            ? decision.campaignId
          : decision.action === 'campaigns.plan'
            ? decision.draftId
          : decision.action === 'campaigns.step_context'
            ? decision.stepId
          : decision.leadId;
      if (value === null || value === undefined) {
        throw rejected('Missing tool argument', 'Falta el argumento de la consulta (query, leadId, draftId, campaignId o stepId según la acción): complétalo con un valor observado.');
      }
      if (!FREE_READS.has(decision.action)) readsUsed++;
      await input.authorize();
      input.signal.throwIfAborted();
      const result = await input.execute(decision.action, value);
      input.signal.throwIfAborted();
      const observation = { action: decision.action, input: value, result };
      await input.authorize();
      await input.record(observation);
      observations.push(observation);
    } catch (error) {
      // After the Writer wrote, a campaign that could not be proposed leaves its emails as the answer.
      if (written && !input.signal.aborted && (!(error instanceof CoworkDecisionRejected) || turn === last)) return written.answer;
      // Correctable refusals go back to the model; the last decision must stand on its own.
      const standing = closingFallback ?? judgedFallback;
      if (standing && error instanceof CoworkDecisionRejected && !input.signal.aborted) return standing;
      if (input.signal.aborted) throw error;
      if (!(error instanceof CoworkDecisionRejected) || turn === last) return rescueOr(error);
      // A proposal that could not be prepared is fixed without telling the person about the attempt (round 3: «Lo intenté de nuevo:
      // la propuesta anterior no pudo prepararse porque el sistema no dejó usar a Daniela con los filtros»).
      rejections.push({ action: decision.action, reason: error.userFacing
        ? `${error.feedback} Corrígela en esta decisión. Tu nota habla solo de la propuesta que queda, sin contar este intento ni su motivo.` : error.feedback });
    }
  }
  if (written) return written.answer;
  return rescueOr(new Error('Cowork did not produce a final answer'));
}
