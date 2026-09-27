import { z } from 'zod';

export const coworkRequestSchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(1).max(20000),
  mode: z.enum(['approval', 'autonomous']).default('approval'),
  parentRunId: z.string().uuid().nullable().optional(),
}).strict();

export type CoworkRunStatus = 'queued' | 'running' | 'waiting_approval' | 'waiting_workers' | 'completed' | 'failed' | 'cancelled';

export type CoworkRun = {
  id: string;
  message: string;
  mode: 'approval' | 'autonomous';
  status: CoworkRunStatus;
  created_at: string;
  /** Previous turn in the same conversation, when this run continues one. */
  parent_run_id?: string | null;
  /** True when the worker admitted this run to resume after an effect or search. */
  automatic?: boolean;
  depth?: number;
};

export type CoworkEvent = {
  sequence: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/** A tool event that carries the assistant's own explanation next to a proposal.
 * It is recorded right before the approval card, is never a data read, and is
 * shown as the assistant's message for that turn. */
export const COWORK_NOTE_ACTION = 'assistant.note';

export function coworkNoteText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { action?: unknown; result?: { reply?: unknown } | null };
  if (record.action !== COWORK_NOTE_ACTION) return null;
  const reply = record.result?.reply;
  return typeof reply === 'string' && reply.trim() ? reply.trim() : null;
}

/** A tool event with the short plan the person sees while the turn works: what
 * Cowork will consult and do, in order. Like the note it is never a data read,
 * never reaches the model as an observation, and never carries an ID. */
export const COWORK_PLAN_ACTION = 'assistant.plan';

/** `read`: the consultation that completes the step; null for the step that
 * writes the answer. */
export type CoworkPlanStep = { label: string; read: string | null };
export const COWORK_PLAN_LIMITS = { steps: 5, label: 80 } as const;

export function coworkPlanSteps(payload: unknown): CoworkPlanStep[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { action?: unknown; result?: { steps?: unknown } | null };
  if (record.action !== COWORK_PLAN_ACTION || !Array.isArray(record.result?.steps)) return null;
  const steps = record.result.steps.flatMap((step: unknown) => {
    const { label, read } = (step || {}) as { label?: unknown; read?: unknown };
    if (typeof label !== 'string' || !label.trim() || label.length > COWORK_PLAN_LIMITS.label) return [];
    return [{ label: label.trim(), read: typeof read === 'string' && /^[a-z_]+(?:\.[a-z_]+)+$/.test(read) ? read : null }];
  }).slice(0, COWORK_PLAN_LIMITS.steps);
  return steps.length > 1 ? steps : null;
}

/** Tool events the assistant wrote about itself (its note, its plan), not data it read. */
export function coworkIsAssistantEvent(payload: unknown): boolean {
  const action = payload && typeof payload === 'object' ? (payload as { action?: unknown }).action : null;
  return action === COWORK_NOTE_ACTION || action === COWORK_PLAN_ACTION;
}

/** A quick reply the person can click to continue: `label` is what the button
 * shows, `message` is what gets sent. The decision accepts generous lengths so
 * one long chip never rejects the whole answer; `coworkSuggestions` keeps only
 * the ones that fit (see answer-quality.ts). */
export const coworkSuggestionSchema = z.object({
  label: z.string().max(120),
  message: z.string().max(600),
}).strict();

export type CoworkSuggestion = { label: string; message: string };

export const COWORK_SUGGESTION_LIMITS = { count: 3, label: 40, message: 200 } as const;

/** Structural read of stored quick replies for the UI. The worker already
 * cleaned them (answer-quality.ts); this only refuses shapes that do not fit. */
export function coworkStoredSuggestions(value: unknown): CoworkSuggestion[] {
  if (!Array.isArray(value)) return [];
  const fits = (text: unknown, max: number): text is string => typeof text === 'string' && text.trim().length > 1 && text.length <= max;
  return value
    .filter(item => item && fits(item.label, COWORK_SUGGESTION_LIMITS.label) && fits(item.message, COWORK_SUGGESTION_LIMITS.message))
    .slice(0, COWORK_SUGGESTION_LIMITS.count)
    .map(item => ({ label: item.label.trim(), message: item.message.trim() }));
}

/** Same line of text, ignoring spacing and Markdown emphasis. */
export function coworkSameLine(a: string, b: string) {
  const plain = (text: string) => text.replace(/[*_\s]+/g, ' ').trim().toLowerCase();
  return plain(a) === plain(b);
}

/** The reply without its closing question, for a chat that shows the question apart. */
export function coworkReplyBody(reply: string, question: string | null): string {
  if (!question) return reply;
  const lines = reply.trimEnd().split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last < 0 || !coworkSameLine(lines[last], question)) return reply;
  return lines.slice(0, last).join('\n').trimEnd();
}

/** A closing question as saved by the worker (already sanitized there); anything else reads as none. */
export function coworkStoredQuestion(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 3 && value.length <= 300 && /\?\s*$/.test(value) ? value.trim() : null;
}

/** Structured results the chat renders as cards (Generative UI): the person
 * sees, copies, opens or exports them instead of reading them out of prose.
 * The shapes are generous so an oversized table never costs the whole answer;
 * the worker trims them to what a card shows (answer-quality.ts). */
export const coworkEmailDraftBlockSchema = z.object({
  type: z.literal('email_draft'),
  title: z.string().max(200),
  /** Recipients as observed (names or emails); null when the email is generic. */
  to: z.array(z.string().max(300)).max(100).nullable(),
  subject: z.string().max(400),
  body: z.string().max(12000),
}).strict();
export const coworkSequenceBlockSchema = z.object({
  type: z.literal('sequence'),
  title: z.string().max(200),
  /** day: the day each email goes out, counting the first as day 1. */
  steps: z.array(z.object({ day: z.number().int().min(0).max(365), subject: z.string().max(400), body: z.string().max(8000) }).strict()).max(12),
}).strict();
export const coworkTableBlockSchema = z.object({
  type: z.literal('table'),
  title: z.string().max(200),
  columns: z.array(z.string().max(120)).max(20),
  rows: z.array(z.array(z.string().max(1000)).max(20)).max(200),
}).strict();
export const coworkMetricsBlockSchema = z.object({
  type: z.literal('metrics'),
  title: z.string().max(200),
  /** «Últimos 7 días», «septiembre 2026»: every figure is read with its period. */
  period: z.string().max(120).nullable(),
  items: z.array(z.object({ label: z.string().max(120), value: z.string().max(80), detail: z.string().max(300).nullable() }).strict()).max(12),
}).strict();
export const coworkBlockSchema = z.discriminatedUnion('type', [
  coworkEmailDraftBlockSchema, coworkSequenceBlockSchema, coworkTableBlockSchema, coworkMetricsBlockSchema,
]);
export type CoworkBlock = z.infer<typeof coworkBlockSchema>;
export const COWORK_BLOCK_LIMIT = 4;

/** Blocks as saved by the worker; a malformed one is skipped, never the whole answer. */
export function coworkStoredBlocks(value: unknown): CoworkBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = coworkBlockSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, COWORK_BLOCK_LIMIT);
}

export const coworkDocumentSchema = z.object({
  reply: z.string().min(1).max(20000),
  document: z.object({ title: z.string().min(1).max(160), content: z.string().min(1).max(40000) }).nullable(),
  /** The closing question on the next step, apart from the reply so it is never lost or buried. */
  question: z.string().max(400).nullable().optional(),
  /** Emails, sequences, tables and figures to show as cards (rule 11). */
  blocks: z.array(coworkBlockSchema).max(10).nullable().optional(),
  suggestions: z.array(coworkSuggestionSchema).max(6).nullable().optional(),
}).strict();

const transitions: Record<CoworkRunStatus, readonly CoworkRunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'waiting_workers', 'completed', 'failed', 'cancelled'],
  waiting_workers: ['queued', 'cancelled'],
  waiting_approval: ['queued', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionCoworkRun(from: CoworkRunStatus, to: CoworkRunStatus) {
  return transitions[from].includes(to);
}
