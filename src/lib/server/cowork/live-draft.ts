import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { COWORK_DRAFT_PHASES, type CoworkDraftPhase } from '@/lib/cowork/contracts';
import { coworkLiveDraft, type CoworkLiveDraft } from '@/lib/cowork/partial-json';

export { COWORK_DRAFT_PHASES, type CoworkDraftPhase };

/**
 * The answer while it is being written. The worker writes what the model has so
 * far into cowork_run_drafts (at most one write every COWORK_DRAFT_INTERVAL_MS,
 * never two at once) and the run's stream sends it to the page. It only shows;
 * the answer that counts is still the validated one in run.completed.
 */

export const COWORK_DRAFT_INTERVAL_MS = 400;

export function coworkStreamingEnabled() {
  return process.env.COWORK_STREAMING_ENABLED === 'true';
}

/** The answer shows once, after it was reviewed (no text is streamed): nobody sees an answer
 * that a review then replaces. Off, the text streams as it is written, as before. */
export function coworkAnswerHoldEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_ANSWER_HOLD_ENABLED === 'true';
}

export type CoworkDraftCards = CoworkLiveDraft['cards'];
/** reviewing: the answer shown is being checked; it may still change before it is final.
 * phase: a held answer (no text) is being written, reviewed or adjusted. */
export type CoworkDraftProgress = { cards: CoworkDraftCards; reviewing?: true; phase?: CoworkDraftPhase };
export type CoworkDraftSink = (text: string, progress: CoworkDraftProgress) => Promise<boolean>;

/**
 * Turns the model's partial JSON into throttled writes: the latest text is kept
 * and read at most once per interval (never per chunk), written only once the
 * decision is known to be an answer with text, never the same state twice, and
 * the last state on flush. `review()` marks the answer already shown as being
 * checked, so a correction is announced instead of rewritten live. A refused or
 * failed write turns it off for the rest of the run (a lost lease, or the table
 * not there yet): the turn goes on as before.
 *
 * With `hold`, no text is written: only which phase the answer is in (writing, reviewing,
 * adjusting; phases never go back) and how far its cards got, so the page shows the work and
 * the answer appears once, when it is final.
 */
export function coworkDraftWriter(sink: CoworkDraftSink, options: {
  intervalMs?: number; now?: () => number; onDisabled?: (reason: unknown) => void; hold?: boolean;
} = {}) {
  const interval = options.intervalMs ?? COWORK_DRAFT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let disabled = false;
  let latest: CoworkLiveDraft | null = null;
  let pending: string | null = null;
  let written = '';
  let lastAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reviewing = false;
  const hold = options.hold === true;
  let phase: CoworkDraftPhase | null = null;
  const advance = (next: CoworkDraftPhase) => {
    if (phase && COWORK_DRAFT_PHASES.indexOf(next) <= COWORK_DRAFT_PHASES.indexOf(phase)) return false;
    phase = next;
    return true;
  };
  // Held, no text travels, card titles included (a correction may still change them): only the
  // phase and how far each card got.
  const heldCards = (cards: CoworkDraftCards): CoworkDraftCards => cards.map(card => ({ type: card.type, title: null, parts: card.parts }));
  // A correction starts its cards over: the counts the reader already saw only grow, and no card goes away.
  let cardsSeen: CoworkDraftCards = [];
  const onlyGrowing = (cards: CoworkDraftCards): CoworkDraftCards => {
    const next = cards.map((card, index) => ({ ...card, parts: Math.max(card.parts, cardsSeen[index]?.type === card.type ? cardsSeen[index].parts : 0) }));
    for (let index = cards.length; index < cardsSeen.length; index++) next.push(cardsSeen[index]);
    cardsSeen = next;
    return next;
  };
  const stateKey = (draft: CoworkLiveDraft) => hold
    ? `${phase}\u0000${JSON.stringify(heldCards(draft.cards))}`
    : `${draft.reply}\u0000${JSON.stringify(draft.cards)}\u0000${reviewing}`;
  const dirty = () => pending !== null || (latest !== null && stateKey(latest) !== written);
  const disable = (reason: unknown) => {
    if (disabled) return;
    disabled = true;
    if (timer) { clearTimeout(timer); timer = null; }
    options.onDisabled?.(reason);
  };
  const write = async () => {
    if (disabled || inflight) return;
    lastAt = now();
    if (pending !== null) {
      const draft = coworkLiveDraft(pending);
      pending = null;
      if (draft) {
        latest = hold ? { ...draft, cards: onlyGrowing(draft.cards) } : draft;
        if (hold && !phase) advance('writing');
      }
    }
    if (!latest) return;
    const draft = latest;
    const key = stateKey(draft);
    if (key === written) return;
    const progress: CoworkDraftProgress = hold && phase ? { cards: heldCards(draft.cards), phase }
      : reviewing ? { cards: draft.cards, reviewing } : { cards: draft.cards };
    inflight = sink(hold ? '' : draft.reply, progress)
      .then(ok => { if (ok) written = key; else disable(new Error('Cowork draft refused')); }, disable)
      .finally(() => { inflight = null; });
    await inflight;
  };
  const schedule = () => {
    if (disabled || timer) return;
    const wait = lastAt + interval - now();
    if (wait <= 0 && !inflight) { void write(); return; }
    // A write skipped while another was in flight is tried again: new text, or the review mark.
    timer = setTimeout(() => { timer = null; void write().then(() => { if (dirty()) schedule(); }); }, Math.max(wait, 25));
  };
  return {
    /** The model's JSON text so far. */
    push(prefix: string) {
      if (disabled) return;
      pending = prefix;
      schedule();
    },
    /** The answer already shown is being checked (the closing correction): say so, keep its text.
     * Held, the answer being written is now being reviewed. */
    review() {
      if (disabled || (!latest && pending === null)) return;
      if (hold) {
        if (advance('reviewing')) schedule();
        return;
      }
      if (reviewing) return;
      reviewing = true;
      schedule();
    },
    /** A correction of the held answer is being written: say so until the final answer arrives.
     * Not held, a correction is announced by review() and never streamed. */
    adjust() {
      if (disabled || !hold || (!latest && pending === null)) return;
      if (advance('adjusting')) schedule();
    },
    get held() { return hold; },
    /** Writes the latest state if it is not written yet (the end of a decision). */
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (inflight) await inflight;
      await write();
    },
    get disabled() { return disabled; },
  };
}

export type CoworkRunDraft = { text: string; cards: CoworkDraftCards; reviewing: boolean; phase: CoworkDraftPhase | null; updatedAt: string };

const cardsSchema = z.array(z.object({ type: z.string().max(40), title: z.string().max(200).nullable(), parts: z.number().int().min(0).max(1000) })).max(10);

/** The live draft of the person's own run, through RLS; null when there is none or it cannot be
 * read. A held answer has no text, only its phase. */
export async function readCoworkRunDraft(auth: Pick<AuthContext, 'supabase' | 'user' | 'organizationId'>, id: string): Promise<CoworkRunDraft | null> {
  const { data, error } = await auth.supabase.from('cowork_run_drafts')
    .select('text,progress,updated_at').eq('run_id', id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || typeof data.text !== 'string') return null;
  const progress = data.progress as { cards?: unknown; reviewing?: unknown; phase?: unknown } | null;
  const phase = COWORK_DRAFT_PHASES.find(value => value === progress?.phase) ?? null;
  if (!data.text && !phase) return null;
  const cards = cardsSchema.safeParse(progress?.cards);
  return { text: data.text, cards: cards.success ? cards.data : [], reviewing: progress?.reviewing === true, phase, updatedAt: String(data.updated_at) };
}
