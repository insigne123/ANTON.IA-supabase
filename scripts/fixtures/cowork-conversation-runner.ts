// Runs one corpus case through the real Cowork loop and decision context with
// fixture tools. The decider is injected: a scripted one for offline tests, or
// the configured model for `scripts/evaluate-cowork-conversations.ts --live`.
import { coworkAgentInstructions } from '../../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../../src/lib/cowork/decision-context';
import { runCoworkReadLoop, type CoworkObservation, type CoworkRejection, type coworkDecisionSchema } from '../../src/lib/cowork/agent-loop';
import { COWORK_NOTE_ACTION, coworkNoteText } from '../../src/lib/cowork/contracts';
import { coworkFailureMessage } from '../../src/lib/cowork/failure-messages';
import { polishCoworkAnswer } from '../../src/lib/cowork/answer-quality';
import { CORPUS_NOW, corpusRead, corpusStageEffect, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';
import type { z } from 'zod';

type Decision = z.infer<typeof coworkDecisionSchema>;
export type CorpusContext = ReturnType<typeof coworkDecisionContext>;
export type CorpusDecider = (context: CorpusContext, meta: { caseId: string; turn: number }) => Promise<Decision>;

export const corpusInstructions = coworkAgentInstructions({
  externalSearch: true, automaticExternalSearch: false,
  threadBudget: 'Hilo automático: paso 1 de 5. Efectos usados 0/6; búsquedas externas 0/2; borradores 0/3. Búsquedas disponibles hoy: 49.',
});

export type CorpusOutcome = { id: string; result: CorpusTurnResult; checks: Array<{ label: string; passed: boolean }>; passed: boolean };

export function scoreCorpusCase(entry: CorpusCase, result: CorpusTurnResult): CorpusOutcome {
  const checks = entry.checks.map(check => {
    let passed = false;
    try { passed = check.test(result); } catch { passed = false; }
    return { label: check.label, passed };
  });
  return { id: entry.id, result, checks, passed: checks.every(check => check.passed) };
}

export async function runCorpusCase(entry: CorpusCase, decide: CorpusDecider): Promise<CorpusOutcome> {
  const turns = (entry.history || []).map((turn, index) => ({
    runId: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, at: turn.at, request: turn.request,
    reply: turn.reply, document: null, observations: turn.observations || [], ...(turn.actions ? { actions: turn.actions } : {}),
  }));
  const actions: string[] = [];
  const recorded: CoworkObservation[] = [];
  const result: CorpusTurnResult = { actions, reply: '', document: null, proposal: null, search: null, note: null, failed: null };
  let decision = 0;
  try {
    const answer = await runCoworkReadLoop({
      message: entry.request, runId: '00000000-0000-4000-9000-000000000099', history: turns,
      signal: new AbortController().signal, authorize: async () => {},
      decide: (observations, mustAnswer, rejections: CoworkRejection[] = []) => decide(coworkDecisionContext(corpusInstructions, {
        history: { turns, olderTurnsOmitted: false }, request: entry.request, observations, mustAnswer,
        executionPolicy: { mode: 'approval' }, ...(rejections.length ? { rejectedDecisions: rejections } : {}),
      }, CORPUS_NOW, 'America/Santiago'), { caseId: entry.id, turn: decision++ }),
      execute: async (action, value) => { actions.push(action); return corpusRead(action, value); },
      record: async observation => { recorded.push(observation); },
      proposeSearch: async criteria => { result.search = criteria as unknown as Record<string, unknown>; },
      proposeNote: async () => { result.proposal = { kind: 'crm_note', label: 'Nota CRM' }; },
      proposeEffect: async proposal => {
        corpusStageEffect(proposal);
        result.proposal = { kind: proposal.kind, label: proposal.label, ...(proposal.campaign ? { campaign: proposal.campaign } : {}) };
      },
    });
    const polished = polishCoworkAnswer(answer);
    result.reply = polished.reply;
    result.document = polished.document;
    result.suggestions = polished.suggestions || [];
  } catch (error) {
    result.failed = coworkFailureMessage(error);
  }
  const note = recorded.find(observation => observation.action === COWORK_NOTE_ACTION);
  result.note = note ? coworkNoteText(note) : null;
  return scoreCorpusCase(entry, result);
}
