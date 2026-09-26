import { z } from 'zod';
import { COWORK_NOTE_ACTION, coworkDocumentSchema } from './contracts';
import { coworkSuggestions, polishCoworkText } from './answer-quality';
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
    'crm.search', 'crm.get_lead', 'contacted.search', 'contacted.timeline', 'contacted.account', 'replies.meeting_chain', 'replies.attention', 'replies.stalled', 'metrics.overview', 'metrics.rates', 'metrics.diagnose', 'metrics.channels', 'metrics.incidents', 'deliverability.check', 'deliverability.bounces', 'deliverability.sender', 'compliance.check', 'compliance.law', 'compliance.obligation', 'app.context', 'draft.get', 'campaigns.list', 'files.list', 'saved_searches.list', 'profile.get',
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
  | 'crm.search' | 'crm.get_lead' | 'contacted.search' | 'contacted.timeline' | 'contacted.account' | 'replies.meeting_chain' | 'replies.attention' | 'replies.stalled' | 'metrics.overview' | 'metrics.rates' | 'metrics.diagnose' | 'metrics.channels' | 'metrics.incidents' | 'deliverability.check' | 'deliverability.bounces' | 'deliverability.sender' | 'compliance.check' | 'compliance.law' | 'compliance.obligation' | 'app.context' | 'draft.get' | 'campaigns.list' | 'files.list' | 'saved_searches.list' | 'profile.get'
  | 'campaigns.batch_report' | 'campaigns.next_touch' | 'campaigns.retry_review' | 'campaigns.company_plan'
  | 'linkedin.network' | 'linkedin.inbox' | 'linkedin.quota' | 'linkedin.followups' | 'linkedin.jobs';
export type CoworkEffectAction = 'leads.save_contact' | 'research.start' | 'draft.request' | 'lead.enrich' | 'email.send' | 'campaign.create' | 'campaign.activate' | 'campaign.pause' | 'code.execute'
  | 'profile.update' | 'saved_search.create' | 'saved_search.update' | 'saved_search.delete' | 'campaign.stop_v2'
  | 'crm.update_record' | 'campaign.prepare_draft_v2'
  | 'crm.assign_lead' | 'exception.resolve' | 'mission.control' | 'message_context.update' | 'lead.enrich_batch'
  | 'campaign.schedule_batch' | 'linkedin.invite' | 'linkedin.message';
export type CoworkObservation = { action: CoworkReadAction | 'specialists.review' | typeof COWORK_NOTE_ACTION; input: string; result: unknown; task?: { id: string; dependsOn: string[] } };
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

/** Display name for lead-scoped effects, resolved from already-observed rows.
 * Never invents: falls back to null and the caller keeps the raw target. */
function describeLeadTarget(
  action: CoworkEffectAction, targetId: string,
  observations: CoworkObservation[], history: CoworkHistoryTurn[],
): string | null {
  if (action !== 'leads.save_contact' && action !== 'research.start' && action !== 'lead.enrich') return null;
  const payloads = [...observations, ...history.flatMap(turn => turn.observations || [])];
  for (const row of collectCoworkLeadRows(payloads)) {
    if (row.id !== targetId) continue;
    const name = String(row.name || '').trim();
    const company = String((row as Record<string, unknown>).company || '').trim();
    if (name && company) return `${name} (${company})`;
    if (name) return name;
  }
  return null;
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

function effectLabel(action: CoworkEffectAction, targetId: string, targetName?: string | null): string {
  const named = (verb: string) => targetName ? `${verb} ${targetName}` : `${verb} ${targetId.slice(0, 120)}`;
  if (action === 'leads.save_contact') return named('Guardar contacto');
  if (action === 'research.start') return named('Investigar contacto');
  if (action === 'lead.enrich') return named('Enriquecer contacto');
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

/** A decision the loop refuses but the model can correct on its next decision.
 * The run only fails if the last decision is still invalid. */
export class CoworkDecisionRejected extends Error {
  constructor(message: string, readonly feedback: string, readonly userFacing = false) {
    super(message);
    this.name = 'CoworkDecisionRejected';
  }
}

export type CoworkRejection = { action: string; reason: string };

const MISSING_PROPOSAL_FIELDS = 'Faltan datos de la propuesta: usa un ID observado como objetivo y completa el objeto que exige la acción (campaign, code, profile, savedSearch, crmRecord, stepId, crmAssign, exceptionResolve, missionControl, messageContext, leadIds, linkedinMessage o campaignId).';

function budgetFeedback(readsUsed: number) {
  const left = Math.max(0, 3 - readsUsed);
  return left > 0
    ? `Solo quedan ${left} lecturas en este trabajo: pide como máximo ${left} o responde con lo observado.`
    : 'No quedan lecturas en este trabajo: responde con lo observado o propone un paso sobre un objetivo ya observado.';
}

function rejected(message: string, feedback: string) {
  return new CoworkDecisionRejected(message, feedback);
}

/** A proposal keeps only its explanation, so a document sent with it would be
 * lost while the note claims it was delivered. The model gets one chance to
 * deliver the document first; on the last decision the proposal stands. */
const DOCUMENT_WITH_PROPOSAL = 'Entregaste un documento junto con una propuesta y el documento se perdería. Si el usuario pidió un documento, entrégalo con answer (reply y document) y ofrece la acción como pregunta al final; si no, propón la acción con document null.';

/** An answer closes with the next-step question and the quick replies that
 * answer it (rules 4 and 9). The model gets one correction per run, never on
 * its last decision: after that the answer stands as it is. */
const CLOSING_FEEDBACK = 'Cierre incompleto:';

function closingFeedback(answer: { reply: string; document: { title: string } | null; suggestions?: unknown }): string | null {
  const lines = answer.reply.split('\n').filter(line => line.trim());
  const chips = coworkSuggestions(answer.suggestions).length;
  const missing = [
    /[?¿]/.test(lines[lines.length - 1] || '') ? null : 'termina reply con la pregunta del siguiente paso (regla 4)',
    chips ? null : 'agrega 1 a 3 respuestas sugeridas que se envíen tal cual al tocarlas (regla 9)',
    // Two or more emails are meant to be copied and kept: they go in the document, not in the chat.
    !answer.document && (answer.reply.match(/asunto\s*\d*\s*[:：]/gi) || []).length >= 2
      ? 'pon los correos en document (un ## por correo con «Asunto:») y deja en reply un resumen breve' : null,
  ].filter(Boolean);
  if (!missing.length) return null;
  // The model does not see its previous answer: name what already worked so the retry keeps it.
  const keep = [answer.document ? `el document «${answer.document.title.slice(0, 80)}»` : null,
    chips ? 'las respuestas sugeridas' : null].filter(Boolean);
  return `${CLOSING_FEEDBACK} ${missing.join(' y ')}. Entrega de nuevo la respuesta completa${keep.length ? `, conservando ${keep.join(' y ')}` : ''}.`;
}

type CoworkAnswer = z.infer<typeof coworkDocumentSchema>;

/** When the model proposes a search without explaining it, the card still gets a
 * sentence built from the criteria, never a blank next to the approval. */
function searchNote(criteria: CoworkSearchCriteria): string {
  // The model sometimes repeats a term («retail», «retail»): each one is named once.
  const unique = (items: string[]) => items.map(item => item.trim())
    .filter((item, index, all) => item && all.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index);
  const titles = unique(criteria.titles || []).slice(0, 3);
  const places = unique([...(criteria.locations || []), ...(criteria.companyLocations || [])]).slice(0, 2);
  const industries = unique(criteria.industries || []).slice(0, 2);
  const list = (items: string[], last: string) => items.length > 1 ? `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}` : items[0];
  return [
    `Propongo buscar hasta ${criteria.limit || 25} ${criteria.target === 'companies' ? 'empresas' : 'personas'}`,
    titles.length ? ` con cargos como ${list(titles, 'o')}` : '',
    industries.length ? `, del rubro ${list(industries, 'y')}` : '',
    places.length ? `, en ${list(places, 'y')}` : '',
    '. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.',
  ].join('');
}

/** The retry only has to fix the closing. Quick replies or a document the first
 * answer had and the retry dropped come back, unless the retry now carries the
 * emails in the chat itself (then that document would repeat them). */
function completeFrom(first: CoworkAnswer, retry: CoworkAnswer): CoworkAnswer {
  const emailsInChat = (retry.reply.match(/asunto\s*\d*\s*[:：]/gi) || []).length >= 2;
  return {
    ...retry,
    document: retry.document ?? (emailsInChat ? null : first.document),
    suggestions: coworkSuggestions(retry.suggestions).length ? retry.suggestions : first.suggestions ?? null,
  };
}

/** The same email lookup already ran in this thread (history.actions): it would
 * spend another credit for the same provider answer. */
function repeatedEnrichment(label: string, history: CoworkHistoryTurn[]) {
  return history.some(turn => ((turn as { actions?: Array<{ kind?: unknown; label?: unknown }> }).actions || [])
    .some(action => action.kind === 'enrich_contact' && action.label === label));
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

/** A proposal the server could not stage (for example a recipient outside the
 * audience) goes back to the model; access, cancellation and timeouts do not. */
function proposalRejection(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || !(error instanceof Error)) return error;
  const status = (error as { status?: number }).status;
  if (['AuthError', 'AbortError', 'TimeoutError', 'CoworkDecisionRejected'].includes(error.name) || status === 401 || status === 403) return error;
  const reason = (issueSummary(error) || error.message || 'motivo no informado').slice(0, 300);
  return new CoworkDecisionRejected(error.message, `La propuesta no se pudo preparar: ${reason}`, true);
}

/** Bounded read-only loop. Tool outputs are observations, never instructions. */
export async function runCoworkReadLoop(input: {
  message: string;
  runId?: string;
  history?: CoworkHistoryTurn[];
  resumedObservations?: CoworkObservation[];
  signal: AbortSignal;
  authorize: () => Promise<void>;
  /** rejections: earlier decisions of this run the loop refused, with the reason. */
  decide: (observations: CoworkObservation[], mustAnswer: boolean, rejections?: CoworkRejection[]) => Promise<Decision>;
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
  // The answer that got the closing correction. From then on the loop never ends
  // worse than that answer: no more reads, and a failed retry returns it.
  let closingFallback: CoworkAnswer | null = null;
  for (let turn = 0; turn < 4; turn++) {
    input.signal.throwIfAborted();
    await input.authorize();
    let decision: Decision;
    try {
      decision = coworkDecisionSchema.parse(await input.decide(observations, turn === 3 || readsUsed >= 3 || closingFallback !== null, rejections.slice()));
    } catch (error) {
      const reason = invalidDecisionReason(error);
      if (closingFallback && !input.signal.aborted) return closingFallback;
      if (reason === null || turn === 3 || input.signal.aborted) throw error;
      rejections.push({ action: 'decision', reason });
      continue;
    }
    input.signal.throwIfAborted();
    try {
      if (decision.action === 'answer') {
        if (!decision.answer) throw rejected('Missing final answer', 'Elegiste answer sin contenido: entrega answer.reply con la respuesta completa.');
        if (closingFallback) return completeFrom(closingFallback, decision.answer);
        const closing = turn < 3 ? closingFeedback(decision.answer) : null;
        if (closing) {
          // Asked directly, not thrown: the catch below returns closingFallback once it is set.
          closingFallback = decision.answer;
          rejections.push({ action: 'answer', reason: closing });
          continue;
        }
        return decision.answer;
      }
      if (decision.action === 'specialists.review' && closingFallback) return closingFallback;
      if (decision.action === 'specialists.review') {
        if (reviewed || turn === 3 || !input.review || !decision.specialists || !observations.length) {
          throw rejected('Specialist review unavailable or budget exhausted', 'La revisión de especialistas no está disponible ahora: continúa con lecturas o responde.');
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
        if (!input.proposeSearch || !decision.searchCriteria) {
          throw rejected('Invalid external search proposal', input.proposeSearch
            ? 'Para proponer una búsqueda incluye searchCriteria completo.' : 'La búsqueda externa no está disponible: responde con lo que tienes.');
        }
        const parsed = coworkSearchCriteriaSchema.safeParse(decision.searchCriteria);
        if (!parsed.success) throw rejected('Invalid external search proposal', `Criterios de búsqueda inválidos: ${issueSummary(parsed.error)}. Corrígelos.`);
        if (decision.answer?.document && turn < 3) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
        const note = await explain(decision) ?? await recordNote(searchNote(parsed.data));
        await input.authorize(); input.signal.throwIfAborted();
        try { await input.proposeSearch(parsed.data); } catch (error) { throw proposalRejection(error, input.signal); }
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
        if (decision.answer?.document && turn < 3) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
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
        || decision.action === 'linkedin.invite' || decision.action === 'linkedin.message') {
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
        const scheduleBatch = decision.action === 'campaign.schedule_batch' && decision.campaignId
          ? { campaignId: decision.campaignId, ...(decision.spacingMinutes == null ? {} : { spacingMinutes: decision.spacingMinutes }) }
          : undefined;
        if (decision.action === 'campaign.schedule_batch' && !scheduleBatch) throw rejected('Missing batch schedule', MISSING_PROPOSAL_FIELDS);
        const originRunId = decision.action === 'code.execute'
          ? codeOriginRunId(code?.inputFiles || [], observations, input.history || [], input.runId || '')
          : effectTargetRun(decision.action, targetId, observations, input.history || [], input.runId || '');
        if (!originRunId) throw rejected('Effect target must be observed first', 'El objetivo de la propuesta no aparece en los resultados de este hilo: consúltalo primero (leads.search, campaigns.list, draft.get o research.get_existing) y usa su ID exacto. Para crear una campaña, los destinatarios deben ser contactos guardados con correo.');
        if (decision.answer?.document && turn < 3) throw rejected('Document with proposal', DOCUMENT_WITH_PROPOSAL);
        const targetName = describeLeadTarget(decision.action, targetId, observations, input.history || []);
        const label = effectLabel(decision.action, targetId, targetName);
        if (kind === 'enrich_contact' && turn < 3 && repeatedEnrichment(label, input.history || [])) {
          throw rejected('Enrichment already ran in this thread', 'Ya se buscó el correo de este contacto en este hilo (mira history.actions): repetirlo gasta otro crédito y el proveedor responde lo mismo. No lo vuelvas a proponer; sigue con lo que pidió el usuario (por ejemplo, investigarlo con research.start) o explica la alternativa.');
        }
        const note = await explain(decision);
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
          ...(linkedinJob === undefined ? {} : { linkedinJob }) });
        } catch (error) { throw proposalRejection(error, input.signal); }
        return { reply: note || 'Revisa la propuesta antes de ejecutar el cambio.', document: null };
      }
      // Only reads remain below: after a closing correction the first answer stands instead.
      if (closingFallback) return closingFallback;
      if (turn === 3) throw new Error('Cowork tool budget exhausted');
      if (decision.action === 'reads.plan') {
        if (!decision.plan || readsUsed + decision.plan.length > 3) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed));
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
        // A fixed read asked twice (for example, with two periods) is one read.
        const reads = decision.reads?.filter((task, index, all) =>
          all.findIndex(other => other.action === task.action && other.input === task.input) === index);
        if (!reads || readsUsed + reads.length > 3) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed));
        readsUsed += reads.length;
        const results = await executeCoworkParallelReads(reads, {
          signal: input.signal, authorize: input.authorize,
          execute: task => input.execute(task.action, task.input),
          record: (task, result) => input.record({ action: task.action, input: task.input, result }),
        });
        observations.push(...reads.map((task, index) => ({ ...task, result: results[index] })));
        continue;
      }
      if (decision.action === 'privacy.contactability_batch' || decision.action === 'lists.review_batch') {
        // One batch consumes the turn's read budget: at most 5 minimized checks.
        if (!decision.leadIds || readsUsed > 0) throw rejected('Cowork tool budget exhausted', decision.leadIds
          ? 'Las revisiones en lote solo pueden ser la primera consulta del trabajo: responde o usa lecturas individuales.' : 'Falta leadIds con 1 a 5 contactos observados.');
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
      if (readsUsed >= 3) throw rejected('Cowork tool budget exhausted', budgetFeedback(readsUsed));
      const value = COWORK_DOMAIN_FIXED_READS.some(action => action === decision.action) ? ''
        : decision.action === 'leads.search' || decision.action === 'crm.search' || decision.action === 'contacted.search' || decision.action === 'deliverability.check' || decision.action === 'compliance.obligation'
        ? (decision.query ?? (decision.reads?.length === 1 && decision.reads[0].action === decision.action
            ? decision.reads[0].input : null))
          : decision.action === 'metrics.overview' || decision.action === 'metrics.rates' || decision.action === 'metrics.diagnose' || decision.action === 'metrics.channels' || decision.action === 'metrics.incidents' || decision.action === 'deliverability.bounces' || decision.action === 'deliverability.sender' || decision.action === 'compliance.law' || decision.action === 'app.context' || decision.action === 'campaigns.list' || decision.action === 'files.list' || decision.action === 'saved_searches.list' || decision.action === 'profile.get'
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
      if (value === null || value === undefined) {
        throw rejected('Missing tool argument', 'Falta el argumento de la consulta (query, leadId, draftId, campaignId o stepId según la acción): complétalo con un valor observado.');
      }
      readsUsed++;
      await input.authorize();
      input.signal.throwIfAborted();
      const result = await input.execute(decision.action, value);
      input.signal.throwIfAborted();
      const observation = { action: decision.action, input: value, result };
      await input.authorize();
      await input.record(observation);
      observations.push(observation);
    } catch (error) {
      // Correctable refusals go back to the model; the last decision must stand on its own.
      if (closingFallback && error instanceof CoworkDecisionRejected && !input.signal.aborted) return closingFallback;
      if (!(error instanceof CoworkDecisionRejected) || turn === 3 || input.signal.aborted) throw error;
      rejections.push({ action: decision.action, reason: error.feedback });
    }
  }
  throw new Error('Cowork did not produce a final answer');
}
