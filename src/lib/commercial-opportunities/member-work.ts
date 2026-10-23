// What the person working an opportunity can do and see: the steps they can take on its stage, the decisions they put to the
// administrators («Propongo no postular», «Necesito que decidan») and the order of their list. Pure: the page and the server
// (which re-checks every step) share it.
import { z } from 'zod';
import { isOpportunityAdmin, type WorkRecord } from './workspace';

export type WorkState = WorkRecord['state'];

/** The stages a person who is not an administrator can set; the rest (assigned, won, lost, archived) are the administrators'. */
export const MEMBER_STATES: readonly WorkState[] = ['working', 'blocked', 'submitted'];
/** The stages an administrator closed: a member does not reopen them. */
export const CLOSED_BY_ADMIN: readonly WorkState[] = ['won', 'lost', 'archived'];
const FINISHED: readonly WorkState[] = ['submitted', ...CLOSED_BY_ADMIN];
/** Whether the offer was already handed in or the opportunity closed: «how to apply» is behind it, so the page stops pushing it. */
export const isFinished = (state: WorkState | null | undefined) => FINISHED.includes(state ?? 'assigned');

export type MemberStep = { to: WorkState; label: string; /** A blocked stage needs its reason; the others may carry a note. */ needsNote?: boolean; primary?: boolean };

/** The next steps on offer from a stage: one main way forward and the exits, each with the words the person reads. */
export function memberSteps(state: WorkState | null | undefined): MemberStep[] {
  switch (state) {
    case 'assigned':
    case undefined:
    case null:
      return [{ to: 'working', label: 'Empezar a gestionarla', primary: true }, { to: 'blocked', label: 'Reportar un bloqueo', needsNote: true }];
    case 'working':
      return [{ to: 'submitted', label: 'Marcar como presentada', primary: true }, { to: 'blocked', label: 'Reportar un bloqueo', needsNote: true }];
    case 'blocked':
      return [{ to: 'working', label: 'Retomarla', primary: true }];
    case 'submitted':
      return [{ to: 'working', label: 'Volver a gestión' }];
    default:
      return [];
  }
}

/** The stages an administrator can move an opportunity to from the page itself: every one but where it already is. */
export const ADMIN_STAGES: readonly WorkState[] = ['assigned', 'working', 'blocked', 'submitted', 'won', 'lost', 'archived'];
export const adminMoves = (from: WorkState | null | undefined): WorkState[] => ADMIN_STAGES.filter(state => state !== from);

/** Whether a person who is not an administrator may take the opportunity from `from` to `to`. */
export function memberMayMove(from: WorkState | null | undefined, to: WorkState) {
  if (!MEMBER_STATES.includes(to)) return false;
  return !CLOSED_BY_ADMIN.includes(from ?? 'assigned') && from !== 'unassigned';
}

export const DECISION_TYPES = ['ask', 'no_go'] as const;
export type DecisionType = typeof DECISION_TYPES[number];
export const decisionSchema = z.object({ type: z.enum(DECISION_TYPES), text: z.string().trim().min(3).max(1000), dueAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict();
export const decisionReplySchema = z.object({ text: z.string().trim().min(2).max(1000) }).strict();
export const stateNoteSchema = z.string().trim().min(3).max(500);

export const DECISION_LABELS: Record<DecisionType, string> = { ask: 'Pide una decisión', no_go: 'Propone no postular' };
/** The line the activity keeps: «Propone no postular: …». */
export const decisionBody = (type: DecisionType, text: string) => `${DECISION_LABELS[type]}: ${text.replace(/\s+/g, ' ').trim()}`;
export const replyBody = (text: string) => `Respuesta a la decisión: ${text.replace(/\s+/g, ' ').trim()}`;

export type ActivityLike = { id: string; kind: string; body: string; actor_id: string | null; created_at: string; data?: Record<string, unknown> | null };
export type OpenDecision = { id: string; type: DecisionType; body: string; dueAt: string | null; actorId: string | null; at: string };

/**
 * The decision still waiting for an answer: the newest line of the activity that puts one (a request or a proposal not to bid) when
 * no later line answers it. The activity comes newest first, as the page reads it.
 */
export function openDecision(activity: readonly ActivityLike[]): OpenDecision | null {
  const latest = activity.find(line => line.kind === 'decision' && typeof line.data?.type === 'string');
  if (!latest) return null;
  const type = latest.data?.type;
  if (type !== 'ask' && type !== 'no_go') return null;
  return { id: latest.id, type, body: latest.body, dueAt: typeof latest.data?.dueAt === 'string' ? latest.data.dueAt : null, actorId: latest.actor_id, at: latest.created_at };
}

/** The filters of the list of someone who works their opportunities, in the order they read. «Mi trabajo» is what is still open. */
export const MEMBER_FILTERS: ReadonlyArray<readonly [string, string]> = [['all', 'Mi trabajo'], ['assigned', 'Nuevas asignaciones'], ['working', 'En gestión'], ['blocked', 'Bloqueadas'], ['done', 'Presentadas y cerradas']];
/** Whether an opportunity in `state` belongs to the filter. «Presentadas y cerradas» is read from the whole list; the others ask the server for their stage. */
export function memberFilter(filter: string, state: WorkState | null | undefined) {
  const current = state ?? 'assigned';
  if (filter === 'done') return isFinished(current);
  if (filter === 'all' || filter === 'recommended') return !isFinished(current);
  return current === filter;
}
/** What the list is asked for: the stages the server knows by name, and everything for the one that is read here. */
export const memberView = (filter: string) => (filter === 'done' ? 'all' : filter);

/**
 * Who fixes the prices of the offer: an administrator, whoever was left in charge, or any member of the team while nobody is in
 * charge (someone has to be able to). The prices are the company's commitment, so the rest of the team reads them but does not set them.
 */
export function canSetPrices(role: string | null | undefined, userId: string, responsibleId: string | null | undefined) {
  return isOpportunityAdmin(role) || !responsibleId || responsibleId === userId;
}

export const fitProposalSchema = z.object({ question: z.string().trim().min(2).max(320), answer: z.string().trim().min(1).max(500) }).strict();
export const fitResolveSchema = z.object({ activityId: z.string().uuid(), accept: z.boolean() }).strict();
export type FitProposal = { id: string; question: string; answer: string; actorId: string | null; at: string };
/** The answers members gave to «¿Cumplimos?» that no administrator has confirmed or dropped yet, the oldest first. */
export function pendingFitProposals(activity: readonly ActivityLike[]): FitProposal[] {
  return activity.flatMap(line => {
    const data = line.data;
    if (line.kind !== 'fit_proposal' || data?.status !== 'pending' || typeof data.question !== 'string' || typeof data.answer !== 'string') return [];
    return [{ id: line.id, question: data.question, answer: data.answer, actorId: line.actor_id, at: line.created_at }];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
