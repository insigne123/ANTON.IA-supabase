import type { DraftContextV2 } from '@/lib/server/draft-context-v2';

type DraftEffort = 'low' | 'medium' | 'high';
/** Measured blind against gpt-6-sol: medium on both calls reads as well at about 34 s a draft; high took 74 s for no gain. */
const PRIORITY_WRITE_EFFORT: DraftEffort = 'medium';
const PRIORITY_EDIT_EFFORT: DraftEffort = 'medium';
const DRAFT_EFFORTS = ['low', 'medium', 'high'] as const;
const effortFrom = (value: string | undefined, fallback: DraftEffort): DraftEffort => (
  DRAFT_EFFORTS.find((effort) => effort === value?.trim()) || fallback
);

/**
 * How hard the model thinks on each call of a draft. Priority-A accounts (well researched) used gpt-6-sol; with luna thinking
 * harder they read as well, measured blind (docs/borradores-luna.md). OPENAI_DRAFT_PRIORITY_EFFORT and
 * OPENAI_DRAFT_PRIORITY_EDIT_EFFORT override it. Rewrites and the rest of the accounts keep the client's default (low).
 * Outside the flow because a 'use server' module may only export async functions.
 */
export function draftReasoningEffort(input: { rewrite?: unknown; context: Pick<DraftContextV2, 'quality'> }, pass: 'write' | 'edit'): DraftEffort | undefined {
  if (input.rewrite || input.context.quality.priority !== 'A') return undefined;
  return pass === 'write'
    ? effortFrom(process.env.OPENAI_DRAFT_PRIORITY_EFFORT, PRIORITY_WRITE_EFFORT)
    : effortFrom(process.env.OPENAI_DRAFT_PRIORITY_EDIT_EFFORT, PRIORITY_EDIT_EFFORT);
}
