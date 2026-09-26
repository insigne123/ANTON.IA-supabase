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

export const coworkDocumentSchema = z.object({
  reply: z.string().min(1).max(20000),
  document: z.object({ title: z.string().min(1).max(160), content: z.string().min(1).max(40000) }).nullable(),
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
