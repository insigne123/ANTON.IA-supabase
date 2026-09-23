import { z } from 'zod';
import { coworkDocumentSchema } from './contracts';
import { coworkCampaignDraftSchema } from './campaign-proposal';
import { coworkCodeProposalSchema } from './code-proposal';
import { coworkSearchCriteriaSchema, type CoworkSearchCriteria } from './search-proposal';
import { coworkReadTaskSchema, executeCoworkParallelReads } from './parallel-reads';
import { collectCoworkLeadRows } from './lead-export';
import { coworkReadPlanSchema, executeCoworkReadPlan } from './read-plan';
import { specialistTasksSchema, type SpecialistTask } from './specialists';
import { COWORK_DOMAIN_FIXED_READS, COWORK_DOMAIN_ENTITY_READS, type CoworkDomainRead } from './domain-reads';
import { coworkProfilePatchSchema, type CoworkProfilePatch } from './profile-proposal';
import { coworkSavedSearchCreateSchema, coworkSavedSearchUpdateSchema, coworkSavedSearchDeleteSchema,
  type CoworkSavedSearchCreate, type CoworkSavedSearchUpdate, type CoworkSavedSearchDelete } from './saved-search-proposal';
import { coworkCrmRecordPatchSchema, type CoworkCrmRecordPatch } from './crm-record-proposal';
import { coworkCrmAssignSchema, coworkExceptionResolveSchema, coworkMissionControlSchema,
  type CoworkCrmAssign, type CoworkExceptionResolve, type CoworkMissionControl } from './team-proposals';
import { coworkMessageContextPatchSchema, type CoworkMessageContextPatch } from './message-context-proposal';

export const coworkEffectKindSchema = z.enum(['save_contact', 'start_research',
  'request_draft', 'enrich_contact', 'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
  'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete', 'campaign_stop_v2',
  'crm_update_record', 'campaign_prepare_draft_v2',
  'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update', 'enrich_batch',
  'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message']);
export type CoworkEffectKind = z.infer<typeof coworkEffectKindSchema>;

export const coworkDecisionSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'research.get_existing', 'reads.parallel', 'reads.plan', 'specialists.review',
    'crm.search', 'crm.get_lead', 'contacted.search', 'contacted.timeline', 'contacted.account', 'replies.meeting_chain', 'replies.attention', 'replies.stalled', 'metrics.overview', 'metrics.rates', 'metrics.diagnose', 'metrics.channels', 'metrics.incidents', 'deliverability.check', 'deliverability.bounces', 'deliverability.sender', 'app.context', 'draft.get', 'campaigns.list', 'files.list', 'saved_searches.list', 'profile.get',
    'privacy.contactability_batch', 'lists.review_batch',
    'crm.propose_note', 'prospecting.propose_search',
    'leads.save_contact', 'research.start', 'draft.request', 'lead.enrich', 'email.send',
    'campaign.create', 'campaign.activate', 'campaign.pause', 'code.execute',
    'profile.update', 'saved_search.create', 'saved_search.update', 'saved_search.delete', 'campaign.stop_v2',
    'crm.update_record', 'campaign.prepare_draft_v2',
    'crm.assign_lead', 'exception.resolve', 'mission.control', 'message_context.update',
    'lead.enrich_batch', 'campaign.schedule_batch', 'linkedin.invite', 'linkedin.message',
    'campaigns.batch_report', 'campaigns.next_touch', 'campaigns.retry_review', 'campaigns.company_plan',
    'linkedin.network', 'linkedin.inbox', 'linkedin.quota', 'linkedin.followups', 'linkedin.jobs',
    'answer', ...COWORK_DOMAIN_FIXED_READS, ...COWORK_DOMAIN_ENTITY_READS]),
  reads: z.array(coworkReadTaskSchema).min(1).max(3).nullable().optional(),
  plan: coworkReadPlanSchema.nullable().optional(),
  specialists: specialistTasksSchema.nullable().optional(),
  query: z.string().max(120).nullable(),
  leadId: z.string().uuid().nullable(),
  leadIds: z.array(z.string().uuid()).min(1).max(5).nullable().optional(),
  stepId: z.string().uuid().nullable().optional(),
  enrollmentId: z.string().uuid().nullable().optional(),
  profile: coworkProfilePatchSchema.nullable().optional(),
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
  campaign: coworkCampaignDraftSchema.nullable().optional(),
  code: coworkCodeProposalSchema.nullable().optional(),
  providerId: z.string().regex(/^apollo:[A-Za-z0-9_-]{1,200}$/).nullable().optional(),
  snapshotId: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(1).max(4000).nullable().optional(),
  searchCriteria: coworkSearchCriteriaSchema.nullable().optional(),
  answer: coworkDocumentSchema.nullable(),
}).strict();

export type CoworkReadAction = CoworkDomainRead | 'privacy.contactability_batch' | 'lists.review_batch' | 'leads.search' | 'leads.get' | 'research.get_existing'
  | 'crm.search' | 'crm.get_lead' | 'contacted.search' | 'contacted.timeline' | 'contacted.account' | 'replies.meeting_chain' | 'replies.attention' | 'replies.stalled' | 'metrics.overview' | 'metrics.rates' | 'metrics.diagnose' | 'metrics.channels' | 'metrics.incidents' | 'deliverability.check' | 'deliverability.bounces' | 'deliverability.sender' | 'app.context' | 'draft.get' | 'campaigns.list' | 'files.list' | 'saved_searches.list' | 'profile.get'
  | 'campaigns.batch_report' | 'campaigns.next_touch' | 'campaigns.retry_review' | 'campaigns.company_plan'
  | 'linkedin.network' | 'linkedin.inbox' | 'linkedin.quota' | 'linkedin.followups' | 'linkedin.jobs';
export type CoworkEffectAction = 'leads.save_contact' | 'research.start' | 'draft.request' | 'lead.enrich' | 'email.send' | 'campaign.create' | 'campaign.activate' | 'campaign.pause' | 'code.execute'
  | 'profile.update' | 'saved_search.create' | 'saved_search.update' | 'saved_search.delete' | 'campaign.stop_v2'
  | 'crm.update_record' | 'campaign.prepare_draft_v2'
  | 'crm.assign_lead' | 'exception.resolve' | 'mission.control' | 'message_context.update' | 'lead.enrich_batch'
  | 'campaign.schedule_batch' | 'linkedin.invite' | 'linkedin.message';
export type CoworkObservation = { action: CoworkReadAction | 'specialists.review'; input: string; result: unknown; task?: { id: string; dependsOn: string[] } };
type Decision = z.infer<typeof coworkDecisionSchema>;

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
  if (action === 'saved_search.create') {
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
        || payload.action === 'leads.search' || payload.action === 'leads.get'));
  }
  if (action === 'campaign.schedule_batch') {
    return observationRunId(observations, history, currentRunId, payload =>
      payload.action === 'campaigns.batch_report'
      && (payload.result as { campaign?: { id?: string } } | null)?.campaign?.id === targetId);
  }
  if (action === 'linkedin.invite' || action === 'linkedin.message') {
    return observationRunId(observations, history, currentRunId, payload =>
      (payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact'
        || payload.action === 'leads.search' || payload.action === 'leads.get'
        || payload.action === 'linkedin.followups'));
  }
  return observationRunId(observations, history, currentRunId, payload =>
    collectCoworkLeadRows([payload]).some(row => row.id === targetId));
}

/** Origin for code.execute: input files must have been observed via files.list.
 * Runs without inputs anchor to the proposing run itself (allowed as origin). */
function codeOriginRunId(
  wanted: string[], observations: CoworkObservation[], history: CoworkHistoryTurn[], currentRunId: string,
): string | null {
  if (wanted.length === 0) return currentRunId || null;
  const names = wanted.map(name => name.toLowerCase());
  const seenHere = new Set<string>();
  for (const observation of observations) {
    if (observation.action !== 'files.list') continue;
    const files = (observation.result as { files?: Array<{ name?: string }> } | null)?.files;
    if (Array.isArray(files)) for (const file of files) seenHere.add(String(file.name || '').toLowerCase());
  }
  if (names.every(name => seenHere.has(name))) return currentRunId || null;
  for (const turn of history) {
    const seen = new Set<string>();
    for (const item of turn.observations) {
      if (!item || typeof item !== 'object') continue;
      const payload = item as Record<string, unknown>;
      if (payload.action !== 'files.list') continue;
      const files = (payload.result as { files?: Array<{ name?: string }> } | null)?.files;
      if (Array.isArray(files)) for (const file of files) seen.add(String(file.name || '').toLowerCase());
    }
    if (names.every(name => seen.has(name))) return turn.runId;
  }
  return null;
}

function effectLabel(action: CoworkEffectAction, targetId: string): string {  if (action === 'leads.save_contact') return `Guardar contacto ${targetId.slice(0, 120)}`;
  if (action === 'research.start') return `Investigar contacto ${targetId.slice(0, 120)}`;
  if (action === 'lead.enrich') return `Enriquecer contacto ${targetId.slice(0, 120)}`;
  if (action === 'email.send') return `Enviar correo del borrador ${targetId.slice(0, 120)}`;
  if (action === 'campaign.create') return 'Crear borrador de campaña';
  if (action === 'campaign.activate') return `Aprobar y activar campaña ${targetId.slice(0, 120)}`;
  if (action === 'campaign.pause') return `Pausar campaña ${targetId.slice(0, 120)}`;
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
  if (action === 'lead.enrich_batch') return 'Enriquecer lote de contactos';
  if (action === 'campaign.schedule_batch') return 'Programar lote de envíos';
  if (action === 'linkedin.invite') return 'Proponer invitación LinkedIn';
  if (action === 'linkedin.message') return 'Proponer mensaje LinkedIn';
  return `Preparar borrador del informe ${targetId.slice(0, 120)}`;
}

/** Run a previous completed (or the current paused) work whose events hold observations. */
export type CoworkHistoryTurn = { runId: string; observations: unknown[] };

/** Bounded read-only loop. Tool outputs are observations, never instructions. */
export async function runCoworkReadLoop(input: {
  message: string;
  runId?: string;
  history?: CoworkHistoryTurn[];
  resumedObservations?: CoworkObservation[];
  signal: AbortSignal;
  authorize: () => Promise<void>;
  decide: (observations: CoworkObservation[], mustAnswer: boolean) => Promise<Decision>;
  execute: (action: CoworkReadAction, value: string) => Promise<unknown>;
  record: (observation: CoworkObservation) => Promise<void>;
  review?: (tasks: SpecialistTask[], observations: CoworkObservation[]) => Promise<unknown>;
  proposeNote?: (leadId: string, note: string) => Promise<void>;
  proposeSearch?: (criteria: CoworkSearchCriteria) => Promise<void>;
  proposeEffect?: (proposal: CoworkEffectProposal) => Promise<void>;
}) {
  const observations: CoworkObservation[] = [...(input.resumedObservations || [])];
  if (observations.length) {
    // The pre-queue phase already spent reads/model decisions. Resume only
    // synthesis, never a second tool or specialist budget in the same run.
    input.signal.throwIfAborted(); await input.authorize();
    const decision = coworkDecisionSchema.parse(await input.decide(observations, true));
    input.signal.throwIfAborted(); await input.authorize();
    if (decision.action !== 'answer' || !decision.answer) throw new Error('Resumed review must produce a final answer');
    return decision.answer;
  }
  let readsUsed = 0;
  let reviewed = false;
  for (let turn = 0; turn < 4; turn++) {
    input.signal.throwIfAborted();
    await input.authorize();
    const decision = coworkDecisionSchema.parse(await input.decide(observations, turn === 3 || readsUsed >= 3));
    input.signal.throwIfAborted();
    if (decision.action === 'answer') {
      if (!decision.answer) throw new Error('Missing final answer');
      return decision.answer;
    }
    if (decision.action === 'specialists.review') {
      if (reviewed || turn === 3 || !input.review || !decision.specialists || !observations.length) {
        throw new Error('Specialist review unavailable or budget exhausted');
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
    if (decision.action === 'prospecting.propose_search') {
      if (!input.proposeSearch || !decision.searchCriteria) throw new Error('Invalid external search proposal');
      await input.authorize(); input.signal.throwIfAborted();
      await input.proposeSearch(coworkSearchCriteriaSchema.parse(decision.searchCriteria));
      return { reply: decision.searchCriteria.target === 'companies'
        ? 'Revisa los criterios antes de buscar empresas.' : 'Revisa los criterios antes de buscar nuevos contactos.', document: null };
    }
    if (decision.action === 'crm.propose_note') {
      if (!input.proposeNote || !decision.leadId || !decision.note) throw new Error('Invalid note proposal');
      const observed = observations.some(observation => {
        const result = observation.result as { items?: Array<{ id?: string }> } | null;
        return Array.isArray(result?.items) && result.items.some(item => item.id === decision.leadId);
      });
      if (!observed) throw new Error('Note target must be observed first');
      await input.authorize();
      input.signal.throwIfAborted();
      await input.proposeNote(decision.leadId, decision.note);
      return { reply: 'Revisa el cambio de nota antes de guardarlo.', document: null };
    }
    if (decision.action === 'leads.save_contact' || decision.action === 'research.start' || decision.action === 'draft.request' || decision.action === 'lead.enrich' || decision.action === 'email.send' || decision.action === 'campaign.create' || decision.action === 'campaign.activate' || decision.action === 'campaign.pause' || decision.action === 'code.execute'
      || decision.action === 'profile.update' || decision.action === 'saved_search.create' || decision.action === 'saved_search.update' || decision.action === 'saved_search.delete' || decision.action === 'campaign.stop_v2'
      || decision.action === 'crm.update_record' || decision.action === 'campaign.prepare_draft_v2'
      || decision.action === 'crm.assign_lead' || decision.action === 'exception.resolve' || decision.action === 'mission.control'
      || decision.action === 'message_context.update' || decision.action === 'lead.enrich_batch'
      || decision.action === 'campaign.schedule_batch'
      || decision.action === 'linkedin.invite' || decision.action === 'linkedin.message') {
      if (!input.proposeEffect) throw new Error('Effect proposals unavailable');
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
        : decision.action === 'linkedin.message' ? 'linkedin_message' : 'request_draft';
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
        : decision.action === 'campaign.schedule_batch' ? decision.campaignId
        : decision.action === 'linkedin.invite' || decision.action === 'linkedin.message' ? 'new-linkedin-job'
        : decision.leadId;
      const campaign = decision.action === 'campaign.create' ? decision.campaign ?? undefined : undefined;
      const code = decision.action === 'code.execute' ? decision.code ?? undefined : undefined;
      const profile = decision.action === 'profile.update' ? decision.profile ?? undefined : undefined;
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
      if (!targetId) throw new Error('Missing effect target');
      if (decision.action === 'campaign.create' && !campaign) throw new Error('Missing campaign definition');
      if (decision.action === 'code.execute' && !code) throw new Error('Missing code proposal');
      if (decision.action === 'profile.update' && !profile) throw new Error('Missing profile patch');
      if ((decision.action === 'saved_search.create' || decision.action === 'saved_search.update' || decision.action === 'saved_search.delete') && !savedSearch) {
        throw new Error('Missing saved-search proposal');
      }
      if (decision.action === 'campaign.stop_v2' && (!campaignId || !enrollmentId)) throw new Error('Missing campaign stop target');
      if (decision.action === 'crm.update_record' && !crmRecord) throw new Error('Missing CRM record patch');
      if (decision.action === 'campaign.prepare_draft_v2' && !stepId) throw new Error('Missing campaign step target');
      if (decision.action === 'crm.assign_lead' && !crmAssign) throw new Error('Missing collaboration assignment');
      if (decision.action === 'exception.resolve' && !exceptionResolve) throw new Error('Missing exception triage');
      if (decision.action === 'mission.control' && !missionControl) throw new Error('Missing mission control');
      if (decision.action === 'message_context.update' && !messageContext) throw new Error('Missing message context patch');
      const enrichBatch = decision.action === 'lead.enrich_batch' ? decision.leadIds ?? undefined : undefined;
      if (decision.action === 'lead.enrich_batch' && (!enrichBatch || !enrichBatch.length)) throw new Error('Missing batch targets');
      const linkedinJob = decision.action === 'linkedin.invite' && decision.leadId ? { leadId: decision.leadId }
        : decision.action === 'linkedin.message' && decision.leadId && decision.linkedinMessage
          ? { leadId: decision.leadId, message: decision.linkedinMessage } : undefined;
      if (decision.action === 'linkedin.invite' && !linkedinJob) throw new Error('Missing invite target');
      if (decision.action === 'linkedin.message' && !linkedinJob) throw new Error('Missing message target and text');
      const scheduleBatch = decision.action === 'campaign.schedule_batch' && decision.campaignId
        ? { campaignId: decision.campaignId, ...(decision.spacingMinutes == null ? {} : { spacingMinutes: decision.spacingMinutes }) }
        : undefined;
      if (decision.action === 'campaign.schedule_batch' && !scheduleBatch) throw new Error('Missing batch schedule');
      const originRunId = decision.action === 'code.execute'
        ? codeOriginRunId(code?.inputFiles || [], observations, input.history || [], input.runId || '')
        : effectTargetRun(decision.action, targetId, observations, input.history || [], input.runId || '');
      if (!originRunId) throw new Error('Effect target must be observed first');
      await input.authorize();
      input.signal.throwIfAborted();
      await input.proposeEffect({ kind, targetId, label: effectLabel(decision.action, targetId), originRunId,
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
        ...(linkedinJob === undefined ? {} : { linkedinJob }) });
      return { reply: 'Revisa la propuesta antes de ejecutar el cambio.', document: null };
    }
    if (turn === 3) throw new Error('Cowork tool budget exhausted');
    if (decision.action === 'reads.plan') {
      if (!decision.plan || readsUsed + decision.plan.length > 3) throw new Error('Cowork tool budget exhausted');
      readsUsed += decision.plan.length;
      const results = await executeCoworkReadPlan(decision.plan, {
        signal: input.signal, authorize: input.authorize,
        execute: read => input.execute(read.action, read.input),
        record: (task, result) => input.record({
          action: task.read.action, input: task.read.input, result,
          task: { id: task.id, dependsOn: task.dependsOn },
        }),
      });
      observations.push(...results.map(({ task, result }) => ({ ...task.read, result })));
      continue;
    }
    if (decision.action === 'reads.parallel') {
      if (!decision.reads || readsUsed + decision.reads.length > 3) throw new Error('Cowork tool budget exhausted');
      readsUsed += decision.reads.length;
      const results = await executeCoworkParallelReads(decision.reads, {
        signal: input.signal, authorize: input.authorize,
        execute: task => input.execute(task.action, task.input),
        record: (task, result) => input.record({ action: task.action, input: task.input, result }),
      });
      observations.push(...decision.reads.map((task, index) => ({ ...task, result: results[index] })));
      continue;
    }
    if (decision.action === 'privacy.contactability_batch' || decision.action === 'lists.review_batch') {
      // One batch consumes the turn's read budget: at most 5 minimized checks.
      if (!decision.leadIds || readsUsed > 0) throw new Error('Cowork tool budget exhausted');
      readsUsed = 3;
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
    if (readsUsed >= 3) throw new Error('Cowork tool budget exhausted');
    readsUsed++;
    const value = COWORK_DOMAIN_FIXED_READS.some(action => action === decision.action) ? ''
      : decision.action === 'leads.search' || decision.action === 'crm.search' || decision.action === 'contacted.search' || decision.action === 'deliverability.check'
      ? (decision.query ?? (decision.reads?.length === 1 && decision.reads[0].action === decision.action
          ? decision.reads[0].input : null))
        : decision.action === 'metrics.overview' || decision.action === 'metrics.rates' || decision.action === 'metrics.diagnose' || decision.action === 'metrics.channels' || decision.action === 'metrics.incidents' || decision.action === 'deliverability.bounces' || decision.action === 'deliverability.sender' || decision.action === 'app.context' || decision.action === 'campaigns.list' || decision.action === 'files.list' || decision.action === 'saved_searches.list' || decision.action === 'profile.get'
        || decision.action === 'linkedin.network' || decision.action === 'linkedin.inbox' || decision.action === 'linkedin.quota'
        || decision.action === 'linkedin.followups' || decision.action === 'linkedin.jobs'
        || decision.action === 'replies.attention' || decision.action === 'replies.stalled'
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
    if (value === null || value === undefined) throw new Error('Missing tool argument');
    await input.authorize();
    input.signal.throwIfAborted();
    const result = await input.execute(decision.action, value);
    input.signal.throwIfAborted();
    const observation = { action: decision.action, input: value, result };
    await input.authorize();
    await input.record(observation);
    observations.push(observation);
  }
  throw new Error('Cowork did not produce a final answer');
}
