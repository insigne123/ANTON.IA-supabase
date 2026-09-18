import { z } from 'zod';
import { coworkDocumentSchema } from './contracts';
import { coworkCampaignDraftSchema } from './campaign-proposal';
import { coworkSearchCriteriaSchema, type CoworkSearchCriteria } from './search-proposal';
import { coworkReadTaskSchema, executeCoworkParallelReads } from './parallel-reads';
import { collectCoworkLeadRows } from './lead-export';

export const coworkEffectKindSchema = z.enum(['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause']);
export type CoworkEffectKind = z.infer<typeof coworkEffectKindSchema>;

export const coworkDecisionSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'research.get_existing', 'reads.parallel',
    'crm.search', 'crm.get_lead', 'contacted.search', 'contacted.timeline', 'metrics.overview', 'app.context', 'draft.get', 'campaigns.list',
    'crm.propose_note', 'prospecting.propose_search',
    'leads.save_contact', 'research.start', 'draft.request', 'lead.enrich', 'email.send',
    'campaign.create', 'campaign.activate', 'campaign.pause', 'answer']),
  reads: z.array(coworkReadTaskSchema).min(1).max(3).nullable().optional(),
  query: z.string().max(120).nullable(),
  leadId: z.string().uuid().nullable(),
  draftId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  campaign: coworkCampaignDraftSchema.nullable().optional(),
  providerId: z.string().regex(/^apollo:[A-Za-z0-9_-]{1,200}$/).nullable().optional(),
  snapshotId: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(1).max(4000).nullable().optional(),
  searchCriteria: coworkSearchCriteriaSchema.nullable().optional(),
  answer: coworkDocumentSchema.nullable(),
}).strict();

export type CoworkReadAction = 'leads.search' | 'leads.get' | 'research.get_existing'
  | 'crm.search' | 'crm.get_lead' | 'contacted.search' | 'contacted.timeline' | 'metrics.overview' | 'app.context' | 'draft.get' | 'campaigns.list';
export type CoworkEffectAction = 'leads.save_contact' | 'research.start' | 'draft.request' | 'lead.enrich' | 'email.send' | 'campaign.create' | 'campaign.activate' | 'campaign.pause';
export type CoworkObservation = { action: CoworkReadAction; input: string; result: unknown };
type Decision = z.infer<typeof coworkDecisionSchema>;

export type CoworkEffectProposal = { kind: CoworkEffectKind; targetId: string; label: string; originRunId: string; campaign?: z.infer<typeof coworkCampaignDraftSchema> };

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
  return observationRunId(observations, history, currentRunId, payload =>
    collectCoworkLeadRows([payload]).some(row => row.id === targetId));
}

function effectLabel(action: CoworkEffectAction, targetId: string): string {
  if (action === 'leads.save_contact') return `Guardar contacto ${targetId.slice(0, 120)}`;
  if (action === 'research.start') return `Investigar contacto ${targetId.slice(0, 120)}`;
  if (action === 'lead.enrich') return `Enriquecer contacto ${targetId.slice(0, 120)}`;
  if (action === 'email.send') return `Enviar correo del borrador ${targetId.slice(0, 120)}`;
  if (action === 'campaign.create') return 'Crear borrador de campaña';
  if (action === 'campaign.activate') return `Aprobar y activar campaña ${targetId.slice(0, 120)}`;
  if (action === 'campaign.pause') return `Pausar campaña ${targetId.slice(0, 120)}`;
  return `Preparar borrador del informe ${targetId.slice(0, 120)}`;
}

/** Run a previous completed (or the current paused) work whose events hold observations. */
export type CoworkHistoryTurn = { runId: string; observations: unknown[] };

/** Bounded read-only loop. Tool outputs are observations, never instructions. */
export async function runCoworkReadLoop(input: {
  message: string;
  runId?: string;
  history?: CoworkHistoryTurn[];
  signal: AbortSignal;
  authorize: () => Promise<void>;
  decide: (observations: CoworkObservation[], mustAnswer: boolean) => Promise<Decision>;
  execute: (action: CoworkReadAction, value: string) => Promise<unknown>;
  record: (observation: CoworkObservation) => Promise<void>;
  proposeNote?: (leadId: string, note: string) => Promise<void>;
  proposeSearch?: (criteria: CoworkSearchCriteria) => Promise<void>;
  proposeEffect?: (proposal: CoworkEffectProposal) => Promise<void>;
}) {
  const observations: CoworkObservation[] = [];
  let readsUsed = 0;
  for (let turn = 0; turn < 4; turn++) {
    input.signal.throwIfAborted();
    await input.authorize();
    const decision = coworkDecisionSchema.parse(await input.decide(observations, turn === 3 || readsUsed >= 3));
    input.signal.throwIfAborted();
    if (decision.action === 'answer') {
      if (!decision.answer) throw new Error('Missing final answer');
      return decision.answer;
    }
    if (decision.action === 'prospecting.propose_search') {
      if (!input.proposeSearch || !decision.searchCriteria) throw new Error('Invalid external search proposal');
      await input.authorize(); input.signal.throwIfAborted();
      await input.proposeSearch(coworkSearchCriteriaSchema.parse(decision.searchCriteria));
      return { reply: 'Revisa los criterios antes de buscar nuevos contactos.', document: null };
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
    if (decision.action === 'leads.save_contact' || decision.action === 'research.start' || decision.action === 'draft.request' || decision.action === 'lead.enrich' || decision.action === 'email.send' || decision.action === 'campaign.create' || decision.action === 'campaign.activate' || decision.action === 'campaign.pause') {
      if (!input.proposeEffect) throw new Error('Effect proposals unavailable');
      const kind: CoworkEffectKind = decision.action === 'leads.save_contact' ? 'save_contact'
        : decision.action === 'research.start' ? 'start_research'
        : decision.action === 'lead.enrich' ? 'enrich_contact'
        : decision.action === 'email.send' ? 'send_email'
        : decision.action === 'campaign.create' ? 'campaign_create'
        : decision.action === 'campaign.activate' ? 'campaign_activate'
        : decision.action === 'campaign.pause' ? 'campaign_pause' : 'request_draft';
      const targetId = decision.action === 'leads.save_contact' ? decision.providerId
        : decision.action === 'draft.request' ? decision.snapshotId
        : decision.action === 'email.send' ? decision.draftId
        : decision.action === 'campaign.create' ? 'new-campaign'
        : decision.action === 'campaign.activate' || decision.action === 'campaign.pause' ? decision.campaignId
        : decision.leadId;
      const campaign = decision.action === 'campaign.create' ? decision.campaign ?? undefined : undefined;
      if (!targetId) throw new Error('Missing effect target');
      if (decision.action === 'campaign.create' && !campaign) throw new Error('Missing campaign definition');
      const originRunId = effectTargetRun(decision.action, targetId, observations, input.history || [], input.runId || '');
      if (!originRunId) throw new Error('Effect target must be observed first');
      await input.authorize();
      input.signal.throwIfAborted();
      await input.proposeEffect(campaign === undefined
        ? { kind, targetId, label: effectLabel(decision.action, targetId), originRunId }
        : { kind, targetId, label: effectLabel(decision.action, targetId), originRunId, campaign });
      return { reply: 'Revisa la propuesta antes de ejecutar el cambio.', document: null };
    }
    if (turn === 3) throw new Error('Cowork tool budget exhausted');
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
    if (readsUsed >= 3) throw new Error('Cowork tool budget exhausted');
    readsUsed++;
    const value = decision.action === 'leads.search' || decision.action === 'crm.search' || decision.action === 'contacted.search'
      ? decision.query
      : decision.action === 'metrics.overview' || decision.action === 'app.context' || decision.action === 'campaigns.list'
        ? ''
        : decision.action === 'draft.get'
          ? decision.draftId
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
