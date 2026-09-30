// Runs one corpus case through the real Cowork loop and decision context with
// fixture tools. The decider is injected: a scripted one for offline tests, or
// the configured model for `scripts/evaluate-cowork-conversations.ts --live`.
import { coworkAgentInstructions } from '../../src/lib/cowork/agent-instructions';
import { coworkDecisionContext } from '../../src/lib/cowork/decision-context';
import { runCoworkReadLoop, type CoworkAnswer, type CoworkObservation, type CoworkRejection, type coworkDecisionSchema } from '../../src/lib/cowork/agent-loop';
import { COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, coworkNoteText, coworkPlanSteps } from '../../src/lib/cowork/contracts';
import { coworkFailureMessage } from '../../src/lib/cowork/failure-messages';
import { polishCoworkAnswer } from '../../src/lib/cowork/answer-quality';
import { coworkBlocksText } from '../../src/lib/cowork/blocks';
import { coworkTurnCeiling } from '../../src/lib/cowork/turn-budget';
import { coworkJudgeFix, type CoworkJudgement, type CoworkShownAnswer } from '../../src/lib/cowork/judge';
import { coworkWriterBlocks, type CoworkAgentStep, type CoworkWriteBrief, type CoworkWriterOutput } from '../../src/lib/cowork/writer';
import {
  COWORK_IMPORT_FIELDS, COWORK_IMPORT_FIELD_LABEL, COWORK_IMPORT_LIMIT, COWORK_IMPORT_SHOWN, coworkContactKeys, coworkImportColumns, coworkImportPlan,
  coworkImportLabel, coworkImportSummary, type CoworkContactsImportInput,
} from '../../src/lib/cowork/contacts-import';
import { CORPUS_NOW, CORPUS_USER_CONTEXT, corpusRead, corpusStageEffect, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';
import type { z } from 'zod';

type Decision = z.infer<typeof coworkDecisionSchema>;
export type CorpusContext = ReturnType<typeof coworkDecisionContext>;
export type CorpusDecider = (context: CorpusContext, meta: { caseId: string; turn: number }) => Promise<Decision>;
/** The Writer for a corpus case: the real pipeline (writer.ts) with the configured models, or a scripted one. */
export type CorpusWriter = (brief: CoworkWriteBrief, observations: CoworkObservation[], meta: { caseId: string; request: string; userContext: unknown;
  step: (step: CoworkAgentStep) => Promise<void> }) => Promise<CoworkWriterOutput>;
/** The judge in the turn for a corpus case (G2): the real prompt with the configured model, or a scripted judgement. */
export type CorpusJudge = (answer: CoworkAnswer, observations: CoworkObservation[], meta: { caseId: string; request: string; userContext: unknown;
  history: Array<{ request: string; reply: string; observations?: unknown[] }> }) => Promise<CoworkJudgement | null>;

/** The same ceiling the worker reads from the environment (defaults when unset). */
export const corpusCeiling = coworkTurnCeiling();

export const corpusInstructions = coworkAgentInstructions({
  turnCeiling: corpusCeiling, externalSearch: true, automaticExternalSearch: false,
  threadBudget: 'Hilo automático: paso 1 de 5. Efectos usados 0/6; búsquedas externas 0/2; borradores 0/3. Búsquedas disponibles hoy: 49.',
});
/** The same instructions with the Writer on (COWORK_WRITER_ENABLED). */
export const corpusWriterInstructions = coworkAgentInstructions({
  turnCeiling: corpusCeiling, externalSearch: true, automaticExternalSearch: false, writer: true,
  threadBudget: 'Hilo automático: paso 1 de 5. Efectos usados 0/6; búsquedas externas 0/2; borradores 0/3. Búsquedas disponibles hoy: 49.',
});

/** Instructions for a case: with the Writer, and with contacts.import when the case turns it on. */
function instructionsFor(writer: boolean, contactsImport: boolean) {
  if (!contactsImport) return writer ? corpusWriterInstructions : corpusInstructions;
  return coworkAgentInstructions({
    turnCeiling: corpusCeiling, externalSearch: true, automaticExternalSearch: false, writer, contactsImport: true,
    threadBudget: 'Hilo automático: paso 1 de 5. Efectos usados 0/6; búsquedas externas 0/2; borradores 0/3. Búsquedas disponibles hoy: 49.',
  });
}

/**
 * The import as the server stages it (server/cowork/contacts-import.ts), from the files and the saved
 * contacts of the case: the model reads the same refusals, and the judge sees the label and the card the person would.
 */
export function corpusStageImport(input: CoworkContactsImportInput, read: (action: string, input: string) => unknown) {
  const quote = (value: string) => `«${value}»`;
  const file = read('files.read', input.file) as { found?: boolean; name?: string; kind?: string; columns?: string[]; rows?: string[][]; sheet?: string | null } | null;
  if (!file?.found || !file.name) throw new Error(`No encontré ${quote(input.file)} entre los archivos que subiste: léelo primero con files.read y usa su nombre exacto.`);
  if (file.kind !== 'table' || !file.columns || !file.rows) throw new Error('Los contactos se importan desde un CSV, un Excel (.xlsx) o una lista JSON; este archivo no trae una tabla.');
  if (!file.rows.length) throw new Error('El archivo no trae filas para importar.');
  const { columns, unknown } = coworkImportColumns(file.columns, input.columns);
  const headers = file.columns.map(quote).join(', ');
  if (unknown.length) throw new Error(`El archivo no tiene ${unknown.length === 1 ? 'la columna' : 'las columnas'} ${unknown.map(quote).join(', ')}; sus columnas son ${headers}.`);
  if (!columns.name) throw new Error(`No encontré la columna con el nombre de cada persona; las columnas del archivo son ${headers}. Indica cuál es en columns.name.`);
  const saved = (read('leads.search', '') as { items?: Array<{ name?: string | null; email?: string | null; company?: string | null }> } | null)?.items || [];
  const plan = coworkImportPlan({ columns: file.columns, body: file.rows }, columns, new Set(saved.flatMap(coworkContactKeys)));
  if (!plan.contacts.length) {
    throw new Error(plan.duplicates
      ? `No hay contactos nuevos: ${plan.duplicates === 1 ? 'la persona del archivo ya está' : `las ${plan.duplicates} personas del archivo ya están`} en tus contactos.`
      : 'Ninguna fila del archivo trae un nombre para importar.');
  }
  const summary = coworkImportSummary({ file: file.name, sheet: file.sheet ?? null, count: plan.contacts.length, duplicates: plan.duplicates,
    skipped: plan.skipped, withoutEmail: plan.contacts.filter(contact => !contact.email).length, overLimit: plan.overLimit, limit: COWORK_IMPORT_LIMIT,
    columns: COWORK_IMPORT_FIELDS.flatMap(field => columns[field] ? [{ field, label: COWORK_IMPORT_FIELD_LABEL[field], header: columns[field]! }] : []) });
  // The label the worker gives the proposal, and the card as ContactsImportReview draws it.
  return { label: coworkImportLabel(file.name, plan), card: {
    entran: `${summary.headline} ${summary.source}`,
    ...(summary.leftOut.length ? { quedanFuera: summary.leftOut.join(' · ') } : {}),
    columnas: summary.columns,
    contactos: plan.contacts.slice(0, COWORK_IMPORT_SHOWN).map(contact => [contact.name, contact.title, contact.company, contact.email || 'Sin correo'].filter(Boolean).join(' · ')),
    ...(summary.more ? { masContactos: summary.more } : {}),
    notas: summary.notes,
    boton: summary.approve,
  } };
}

export type CorpusOutcome = { id: string; result: CorpusTurnResult; checks: Array<{ label: string; passed: boolean }>; passed: boolean };

export function scoreCorpusCase(entry: CorpusCase, result: CorpusTurnResult): CorpusOutcome {
  const checks = entry.checks.map(check => {
    let passed = false;
    try { passed = check.test(result); } catch { passed = false; }
    return { label: check.label, passed };
  });
  return { id: entry.id, result, checks, passed: checks.every(check => check.passed) };
}

export async function runCorpusCase(entry: CorpusCase, decide: CorpusDecider, write?: CorpusWriter, judge?: CorpusJudge): Promise<CorpusOutcome> {
  const turns = (entry.history || []).map((turn, index) => ({
    runId: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, at: turn.at, request: turn.request,
    reply: turn.reply, document: null, observations: turn.observations || [], ...(turn.actions ? { actions: turn.actions } : {}),
  }));
  const actions: string[] = [];
  const reads: Array<{ action: string; input: string }> = [];
  const recorded: CoworkObservation[] = [];
  const result: CorpusTurnResult = { actions, reads, reply: '', document: null, proposal: null, search: null, note: null, failed: null };
  let decision = 0;
  const instructions = instructionsFor(Boolean(write), Boolean(entry.contactsImport));
  const userContext = entry.world?.userContext === undefined ? CORPUS_USER_CONTEXT : entry.world.userContext;
  let judgedAnswer: CoworkAnswer | null = null;
  try {
    const answer = await runCoworkReadLoop({
      message: entry.request, runId: '00000000-0000-4000-9000-000000000099', history: turns,
      signal: new AbortController().signal, authorize: async () => {}, ceiling: corpusCeiling, contactsImport: Boolean(entry.contactsImport),
      decide: (observations, mustAnswer, rejections: CoworkRejection[] = [], turnBudget) => decide(coworkDecisionContext(instructions, {
        history: { turns, olderTurnsOmitted: false }, request: entry.request, observations, mustAnswer, turnBudget,
        executionPolicy: { mode: 'approval' }, userContext,
        ...(rejections.length ? { rejectedDecisions: rejections } : {}),
      }, CORPUS_NOW, 'America/Santiago'), { caseId: entry.id, turn: decision++ }),
      execute: async (action, value) => { actions.push(action); reads.push({ action, input: value }); return (entry.world?.read ?? corpusRead)(action, value); },
      record: async observation => { recorded.push(observation); },
      proposeSearch: async criteria => { result.search = criteria as unknown as Record<string, unknown>; },
      proposeNote: async () => { result.proposal = { kind: 'crm_note', label: 'Nota CRM' }; },
      ...(write ? { write: async (brief: CoworkWriteBrief, observations: CoworkObservation[]) => {
        const steps: CoworkAgentStep[] = [];
        result.writer = { brief, steps };
        const output = await write(brief, observations, { caseId: entry.id, request: entry.request, userContext, step: async step => { steps.push(step); } });
        return { ...output, document: null, blocks: coworkWriterBlocks(output) };
      } } : {}),
      ...(judge ? { judge: async (answer: CoworkAnswer, observations: CoworkObservation[], turn: { canRead: boolean }) => {
        const judgement = await judge(answer, observations, { caseId: entry.id, request: entry.request, userContext,
          history: turns.map(turn => ({ request: turn.request, reply: turn.reply, observations: turn.observations })) });
        if (!judgement) return null;
        const fix = coworkJudgeFix(judgement, { canRead: turn.canRead, question: answer.question });
        judgedAnswer = fix ? answer : null;
        result.judgeInTurn = { veredicto: judgement.veredicto, scores: judgement.scores, problemas: judgement.problemas, canRead: turn.canRead,
          asked: Boolean(fix), fixed: false };
        return fix;
      } } : {}),
      proposeEffect: async proposal => {
        corpusStageEffect(proposal, entry.world?.savedEmails);
        const staged = proposal.contactsImport ? corpusStageImport(proposal.contactsImport, entry.world?.read ?? corpusRead) : null;
        result.proposal = { kind: proposal.kind, label: staged?.label ?? proposal.label, targetId: proposal.targetId, ...(proposal.campaign ? { campaign: proposal.campaign } : {}),
          ...(proposal.linkedinJob?.message ? { linkedinMessage: proposal.linkedinJob.message } : {}), ...(proposal.code ? { code: proposal.code } : {}),
          ...(proposal.contactsImport ? { contactsImport: { ...proposal.contactsImport, card: staged?.card } } : {}) };
      },
    });
    if (result.judgeInTurn?.asked) result.judgeInTurn.fixed = answer !== judgedAnswer;
    const polished = polishCoworkAnswer(answer);
    result.reply = polished.reply;
    result.document = polished.document;
    result.suggestions = polished.suggestions || [];
    result.blocks = polished.blocks || [];
    result.question = polished.question;
    result.choices = polished.choices;
  } catch (error) {
    result.failed = coworkFailureMessage(error);
  }
  const note = recorded.find(observation => observation.action === COWORK_NOTE_ACTION);
  result.note = note ? coworkNoteText(note) : null;
  const plan = recorded.find(observation => observation.action === COWORK_PLAN_ACTION);
  result.plan = plan ? coworkPlanSteps(plan) : null;
  return scoreCorpusCase(entry, result);
}

/** What the person saw in a corpus turn. */
export function corpusShownAnswer(result: CorpusTurnResult): CoworkShownAnswer {
  const campaign = result.proposal?.campaign as { name?: unknown; objective?: unknown; messages?: unknown; emails?: unknown } | undefined;
  return {
    reply: result.reply,
    cards: result.blocks?.length ? coworkBlocksText(result.blocks) : null,
    question: result.question ?? null,
    quickReplies: (result.suggestions || []).map(chip => chip.message),
    ...(result.choices ? { choices: result.choices } : {}),
    proposal: result.proposal ? { kind: result.proposal.kind, label: result.proposal.label, note: result.note,
      // The review card shows the campaign's name and objective above its recipients and emails.
      ...(campaign ? { detail: { nombre: campaign.name, objetivo: campaign.objective, destinatarios: campaign.emails, correos: campaign.messages } }
        : result.proposal.linkedinMessage ? { detail: result.proposal.linkedinMessage }
        // The code card shows the files it runs on and the code itself.
        : result.proposal.code ? { detail: { archivos: result.proposal.code.inputFiles, codigo: result.proposal.code.code } }
        // The import card shows who comes in, who stays out and the columns (older reports: only the file).
        : result.proposal.contactsImport ? { detail: result.proposal.contactsImport.card ?? { archivo: result.proposal.contactsImport.file } } : {}) } : null,
    search: result.search,
    document: result.document,
    failed: result.failed,
  };
}
