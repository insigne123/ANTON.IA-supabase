// Runs one corpus case through the real Cowork loop and decision context with
// fixture tools. The decider is injected: a scripted one for offline tests, or
// the configured model for `scripts/evaluate-cowork-conversations.ts --live`.
import { coworkPreferenceLabel } from '../../src/lib/cowork/preference-proposal';
import { coworkTaskPlanLabel } from '../../src/lib/cowork/task-plan';
import { coworkAgentInstructions } from '../../src/lib/cowork/agent-instructions';
import { coworkTurnIntents } from '../../src/lib/cowork/intents';
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
import { coworkReplyRefusal, type CoworkReplyThread } from '../../src/lib/cowork/reply-thread';
import { coworkReplyBody, coworkReplySubject, type CoworkReplyThreadInput } from '../../src/lib/cowork/reply-proposal';
import {
  coworkBatchCompanyKeys, coworkLinkedinBatchLabel, coworkLinkedinBatchLeads, planLinkedinBatch, type CoworkLinkedinBatchInput,
  type CoworkLinkedinBatchKind,
} from '../../src/lib/cowork/linkedin-batch';
import { normalizeLinkedinProfileUrl } from '../../src/lib/linkedin-url';
import type { CoworkArtifactTableName, CoworkDesignBrief } from '../../src/lib/cowork/design-brief';
import type { CoworkArtifactData, CoworkArtifactTable, CoworkCodeArtifact } from '../../src/lib/server/cowork/code-artifact';
import { coworkArtifactActivity, coworkArtifactCampaigns, coworkArtifactContacts, coworkArtifactOpportunities, coworkArtifactPipeline } from '../../src/lib/server/cowork/artifact-data';
import type { CoworkDesignResult } from '../../src/lib/server/cowork/designer';
import { coworkWorkspaceDigest, type CoworkWorkspace } from '../../src/lib/cowork/workspace';
import type { CoworkAgenda } from '../../src/lib/cowork/agenda';
import { coworkAnalystAnswer, type CoworkAnalysisBrief, type CoworkAnalystOutput } from '../../src/lib/cowork/analyst';
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

/** The Designer for a corpus case (Plan 12, 3b): the real one (designer.ts) with the configured model, or a scripted one. */
export type CorpusDesigner = (brief: CoworkDesignBrief, meta: { caseId: string; request: string; userContext: unknown; data: CoworkArtifactData;
  previous: CoworkCodeArtifact | null }) => Promise<CoworkDesignResult>;
/** The Analyst for a corpus case (Plan 12, 4b): the real one (analyst.ts) with the configured model, or a scripted one. */
export type CorpusAnalyst = (brief: CoworkAnalysisBrief, observations: CoworkObservation[], meta: { caseId: string; request: string; userContext: unknown;
  history: Array<{ at: string; request: string; reply: string }> }) => Promise<CoworkAnalystOutput>;

/**
 * The tables of an artifact from the case's world, shaped as loadCoworkArtifactData shapes the database: the saved
 * contacts (leads.search with no words), their stages (none kept: all «Nuevos»), the campaigns and what was sent.
 */
export function corpusArtifactData(read: (action: string, input: string) => unknown, tables: CoworkArtifactTableName[]): CoworkArtifactData {
  const items = (value: unknown, key = 'items') => ((value as Record<string, unknown> | null)?.[key] || []) as Array<Record<string, unknown>>;
  const out: Record<string, CoworkArtifactTable> = {};
  for (const name of new Set(tables)) {
    if (name === 'contacts') out.contacts = coworkArtifactContacts(items(read('leads.search', '')));
    else if (name === 'pipeline') out.pipeline = coworkArtifactPipeline(items(read('leads.search', '')), []);
    else if (name === 'activity') out.activity = coworkArtifactActivity(items(read('contacted.search', '')));
    else if (name === 'campaigns') out.campaigns = coworkArtifactCampaigns(items(read('campaigns.list', ''), 'campaigns').map(campaign => ({
      definition: { name: campaign.name }, status: campaign.status, recipients: Array.from({ length: Number(campaign.recipients) || 0 }), created_at: campaign.createdAt,
    })));
    else {
      // A world with «Oportunidades» hands its items as the store lists them (artifact.opportunities).
      const found = read('artifact.opportunities', '') as Parameters<typeof coworkArtifactOpportunities>[0] | null;
      if (!Array.isArray(found?.tenders)) throw new Error('Esta cuenta no tiene «Oportunidades»: el artefacto no puede usar esa tabla.');
      out.opportunities = coworkArtifactOpportunities(found);
    }
  }
  return { tables: out, currency: 'CLP', timeZone: 'America/Santiago' };
}

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

/** As in production: the prompt carries only the parts of the turn's intents (intents.ts) with COWORK_INTENT_PROMPTS_ENABLED=true. */
export const corpusIntentPrompts = process.env.COWORK_INTENT_PROMPTS_ENABLED === 'true';
/** As in production: several people are prepared with one approval (contacts.prepare_batch), unless COWORK_PREPARE_BATCH_ENABLED=false. */
export const corpusPrepareBatch = process.env.COWORK_PREPARE_BATCH_ENABLED !== 'false';

/**
 * The instructions of one case, as the worker builds them for that turn: with the Writer, the flags the case turns on
 * (contacts.import, email.reply_thread, the LinkedIn batches…) and the parts of its intents.
 */
export function corpusCaseInstructions(entry: CorpusCase, writer: boolean, options: { codeArtifacts?: boolean; analyst?: boolean } = {}) {
  return coworkAgentInstructions({
    turnCeiling: corpusCeiling, externalSearch: true, automaticExternalSearch: false, writer, codeArtifacts: Boolean(options.codeArtifacts), analyst: Boolean(options.analyst),
    contactsImport: Boolean(entry.contactsImport), replyThread: Boolean(entry.replyThread), linkedinBatch: Boolean(entry.linkedinBatch),
    campaignRetry: Boolean(entry.campaignRetry), phoneReveal: Boolean(entry.phoneReveal), opportunities: Boolean(entry.opportunities),
    preferences: Boolean(entry.preferences),
    // Long tasks (Plan 13, 4c), as production with COWORK_TASKS_ENABLED=true.
    tasks: process.env.COWORK_TASKS_ENABLED === 'true',
    prepareBatch: corpusPrepareBatch,
    intents: corpusIntentPrompts ? coworkTurnIntents(entry.request, entry.history || []) : null,
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

/**
 * The reply as the server stages it (server/cowork/reply-thread-effect.ts), from the conversation of the case: it must be one that takes a
 * reply, the recipient is the person of that conversation, and the subject and text are written as they would be sent. The refusals are the
 * server's own sentences (coworkReplyRefusal), so the model reads the same ones.
 */
export function corpusStageReply(input: CoworkReplyThreadInput, read: (action: string, input: string) => unknown) {
  const thread = read('replies.thread', input.contactedId) as (Partial<CoworkReplyThread> & { available?: boolean }) | null;
  if (!thread?.available) throw new Error('Esa conversación no es tuya o ya no existe: solo se responde a tus envíos.');
  const refusal = coworkReplyRefusal(thread as CoworkReplyThread);
  if (refusal) throw new Error(refusal);
  const to = String(thread.email).trim().toLowerCase();
  const who = [String(thread.name || '').trim(), String(thread.company || '').trim() ? `(${String(thread.company).trim()})` : ''].filter(Boolean).join(' ') || to;
  return { label: `Responder a ${who} en su hilo`, to, subject: coworkReplySubject(input.subject), body: coworkReplyBody(input.body) };
}

/** The server's sentence when a saved contact has no profile the extension can open (server/cowork/linkedin-jobs.ts, linkedinProfileOf). */
const NO_LINKEDIN_PROFILE = 'El contacto no tiene una URL de perfil LinkedIn válida.';

/**
 * The single LinkedIn action as the server stages it: the saved contact must have a profile the extension can open, and without one the
 * server refuses with its own sentence, which the loop hands back to the model. A world that does not model the profile of its contacts
 * (no linkedin_url on them) is taken as it is: only a contact that says it has none is refused.
 */
export function corpusStageLinkedinJob(job: { leadId: string }, read: (action: string, input: string) => unknown) {
  const saved = ((read('leads.search', '') as { items?: Array<{ id: string; linkedin_url?: string | null }> } | null)?.items || []);
  const lead = saved.find(item => item.id === job.leadId);
  if (lead && 'linkedin_url' in lead && !normalizeLinkedinProfileUrl(lead.linkedin_url)) throw new Error(NO_LINKEDIN_PROFILE);
}

/**
 * The batch as the server stages it (server/cowork/linkedin-batch.ts), from the saved contacts of the case: each person must exist, the
 * guards of a single action stop whoever has no usable profile, and who goes today and who waits is planned with the same function
 * (planLinkedinBatch), so the model reads the same refusals and the checks see what the card would list.
 */
export function corpusStageLinkedinBatch(kind: CoworkLinkedinBatchKind, input: CoworkLinkedinBatchInput, read: (action: string, input: string) => unknown) {
  const wanted = coworkLinkedinBatchLeads(kind, input);
  const saved = ((read('leads.search', '') as { items?: Array<{ id: string; name?: string | null; email?: string | null; title?: string | null; company?: string | null; linkedin_url?: string | null }> } | null)?.items || []);
  const byId = new Map(saved.map(lead => [lead.id, lead]));
  if (wanted.some(person => !byId.has(person.leadId))) throw new Error('Todas las personas del lote deben ser contactos guardados de tu organización.');
  const quota = kind === 'invite' ? read('linkedin.quota', '') as { pending?: number; sent7d?: number; sent?: number; limit?: number } | null : null;
  const quotaLeft = quota ? Math.max(0, Number(quota.limit ?? 100) - Number(quota.pending ?? 0) - Number(quota.sent7d ?? quota.sent ?? 0)) : null;
  const candidates = wanted.map(({ leadId, message }) => {
    const lead = byId.get(leadId)!;
    const canonical = normalizeLinkedinProfileUrl(lead.linkedin_url);
    return { id: lead.id, name: lead.name ?? null, company: lead.company ?? null, title: lead.title ?? null, canonicalUrl: canonical || '',
      ...(message ? { message } : {}), keys: coworkBatchCompanyKeys(lead),
      blocked: canonical ? null : NO_LINKEDIN_PROFILE };
  });
  const plan = planLinkedinBatch(kind, candidates, { quotaLeft });
  if (!plan.items.length) throw new Error(`Nadie del lote puede salir hoy. ${[...new Set(plan.deferred.map(person => person.reason))].slice(0, 3).join(' · ')}`);
  return { label: coworkLinkedinBatchLabel(kind, plan.items.length), kind, items: plan.items.map(item => ({ id: item.id, name: item.name, company: item.company, ...(item.message ? { message: item.message } : {}) })),
    deferred: plan.deferred.map(person => ({ id: person.id, name: person.name, reason: person.reason })) };
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

/**
 * The account's state as the worker sends it with COWORK_WORKSPACE_ENABLED (Plan 13): built from the case's own world, so it says
 * what the reads of that world would say (the counts of app.context, the LinkedIn week, today's agenda).
 */
export function corpusWorkspace(read: (action: string, input: string) => unknown): CoworkWorkspace | null {
  const safe = (action: string) => { try { return read(action, ''); } catch { return null; } };
  const app = safe('app.context') as { counts?: { leads?: number; campaigns?: number } } | null;
  const audience = safe('audience.analyze') as { contactsWithEmail?: number } | null;
  const quota = safe('linkedin.quota') as { pending?: number; sent?: number; sent7d?: number; limit?: number } | null;
  const agenda = safe('agenda.today') as CoworkAgenda | null;
  return coworkWorkspaceDigest({
    contacts: typeof app?.counts?.leads === 'number' ? app.counts.leads : null,
    withEmail: typeof audience?.contactsWithEmail === 'number' ? audience.contactsWithEmail : null,
    campaigns: typeof app?.counts?.campaigns === 'number' ? app.counts.campaigns : null,
    linkedin: quota && typeof quota.pending === 'number' && typeof quota.limit === 'number'
      ? { pending: quota.pending, sent7d: quota.sent7d ?? quota.sent ?? 0, limit: quota.limit } : null,
    agenda: agenda && agenda.counts && Array.isArray(agenda.items) ? agenda : null,
  });
}

export async function runCorpusCase(entry: CorpusCase, decide: CorpusDecider, write?: CorpusWriter, judge?: CorpusJudge, design?: CorpusDesigner, analyze?: CorpusAnalyst): Promise<CorpusOutcome> {
  const turns = (entry.history || []).map((turn, index) => ({
    runId: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, at: turn.at, request: turn.request,
    reply: turn.reply, document: null, observations: turn.observations || [], ...(turn.actions ? { actions: turn.actions } : {}),
    ...(turn.artifacts ? { artifacts: turn.artifacts } : {}),
    ...(turn.feedback && process.env.COWORK_EVAL_VERSIONS !== 'off' ? { feedback: turn.feedback } : {}),
  }));
  const actions: string[] = [];
  const reads: Array<{ action: string; input: string }> = [];
  const recorded: CoworkObservation[] = [];
  const result: CorpusTurnResult = { actions, reads, reply: '', document: null, proposal: null, search: null, note: null, failed: null };
  let decision = 0;
  const instructions = corpusCaseInstructions(entry, Boolean(write), { codeArtifacts: Boolean(design), analyst: Boolean(analyze) });
  const baseUserContext = entry.world?.userContext === undefined ? CORPUS_USER_CONTEXT : entry.world.userContext;
  // As in production: the account's state travels with the turn only with COWORK_WORKSPACE_ENABLED=true (a case may bring its own).
  const workspace = process.env.COWORK_WORKSPACE_ENABLED === 'true' && baseUserContext && !('workspace' in baseUserContext)
    ? corpusWorkspace(entry.world?.read ?? corpusRead) : null;
  const userContext = baseUserContext && workspace ? { ...baseUserContext, workspace } : baseUserContext;
  if (workspace) result.workspace = workspace;
  let judgedAnswer: CoworkAnswer | null = null;
  try {
    const answer = await runCoworkReadLoop({
      message: entry.request, runId: '00000000-0000-4000-9000-000000000099', history: turns,
      signal: new AbortController().signal, authorize: async () => {}, ceiling: corpusCeiling, contactsImport: Boolean(entry.contactsImport), replyThread: Boolean(entry.replyThread), linkedinBatch: Boolean(entry.linkedinBatch), campaignRetry: Boolean(entry.campaignRetry), phoneReveal: Boolean(entry.phoneReveal), opportunities: Boolean(entry.opportunities),
      preferences: Boolean(entry.preferences),
      tasks: process.env.COWORK_TASKS_ENABLED === 'true',
      prepareBatch: corpusPrepareBatch,
      // Figures from what the person saved in their profile are not new when a correction uses them.
      userContext,
      // What the turn keeps of the conversation, as the worker stores it (with the conversation's name, Plan 13).
      remember: async memory => { result.memory = memory; },
      // As in production: an offered read is made first only with COWORK_OFFERED_READS_ENABLED=true.
      offeredReads: process.env.COWORK_OFFERED_READS_ENABLED === 'true',
      onCorrection: verdict => {
        if (!result.judgeInTurn) return;
        result.judgeInTurn.kept = verdict.keep;
        result.judgeInTurn.keptReason = verdict.reason;
        result.judgeInTurn.fixed = verdict.keep === 'correction';
      },
      decide: (observations, mustAnswer, rejections: CoworkRejection[] = [], turnBudget) => decide(coworkDecisionContext(instructions, {
        history: { turns, olderTurnsOmitted: false }, request: entry.request, observations, mustAnswer, turnBudget,
        executionPolicy: { mode: 'approval' }, userContext,
        ...(rejections.length ? { rejectedDecisions: rejections } : {}),
        // As the worker sends them since Plan 13; COWORK_EVAL_VERSIONS=off measures Cowork without them.
        ...(entry.previousVersions?.length && process.env.COWORK_EVAL_VERSIONS !== 'off' ? { previousVersions: entry.previousVersions } : {}),
      }, CORPUS_NOW, 'America/Santiago'), { caseId: entry.id, turn: decision++ }).then(chosen => {
        if (chosen.action === 'answer' && chosen.answer) (result.answers ||= []).push(chosen.answer.reply);
        return chosen;
      }),
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
      ...(design ? { design: async (brief: CoworkDesignBrief) => {
        // As the store does: the code of an artifact of this conversation, or a refusal the coordinator reads.
        const previous = brief.previous ? entry.artifacts?.[brief.previous] ?? null : null;
        if (brief.previous && !previous) throw new Error(`No encontré el artefacto ${brief.previous} en tus conversaciones.`);
        const data = corpusArtifactData(entry.world?.read ?? corpusRead, brief.tables);
        const started = Date.now();
        const made = await design(brief, { caseId: entry.id, request: entry.request, userContext, data, previous });
        result.artifact = { brief, title: made.output.title, html: made.html, bytes: made.bytes, attempts: made.attempts, seconds: Math.round((Date.now() - started) / 100) / 10,
          tables: Object.entries(data.tables).map(([name, table]) => ({ name, rows: table.total })) };
        return { reply: made.output.reply, document: null, blocks: null, question: null, suggestions: made.output.suggestions };
      } } : {}),
      ...(analyze ? { analyze: async (brief: CoworkAnalysisBrief, observations: CoworkObservation[]) => {
        result.analyst = { brief };
        const output = await analyze(brief, observations, { caseId: entry.id, request: entry.request, userContext,
          history: turns.map(turn => ({ at: turn.at, request: turn.request, reply: turn.reply })) });
        return coworkAnalystAnswer(output);
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
        if (proposal.linkedinJob) corpusStageLinkedinJob(proposal.linkedinJob, entry.world?.read ?? corpusRead);
        const staged = proposal.contactsImport ? corpusStageImport(proposal.contactsImport, entry.world?.read ?? corpusRead) : null;
        const reply = proposal.replyThread ? corpusStageReply(proposal.replyThread, entry.world?.read ?? corpusRead) : null;
        const batch = proposal.linkedinBatch
          ? corpusStageLinkedinBatch(proposal.kind === 'linkedin_invite_batch' ? 'invite' : 'message', proposal.linkedinBatch, entry.world?.read ?? corpusRead) : null;
        result.proposal = { kind: proposal.kind, label: staged?.label ?? reply?.label ?? batch?.label
            ?? (proposal.preference ? coworkPreferenceLabel(proposal.preference) : proposal.task ? coworkTaskPlanLabel(proposal.task) : proposal.label),
          ...(proposal.preference ? { preference: proposal.preference } : {}),
          ...(proposal.task ? { task: proposal.task } : {}),
          ...(batch ? { linkedinBatch: { kind: batch.kind, items: batch.items, deferred: batch.deferred } } : {}), targetId: proposal.targetId, ...(proposal.campaign ? { campaign: proposal.campaign } : {}),
          ...(proposal.replyThread && reply ? { replyThread: { contactedId: proposal.replyThread.contactedId, to: reply.to, subject: reply.subject, body: reply.body } } : {}),
          ...(proposal.linkedinJob?.message ? { linkedinMessage: proposal.linkedinJob.message } : {}), ...(proposal.code ? { code: proposal.code } : {}),
          ...(proposal.contactsImport ? { contactsImport: { ...proposal.contactsImport, card: staged?.card } } : {}),
          ...(proposal.profile ? { profile: proposal.profile } : {}) };
      },
    });
    // Without the loop's verdict (the correction became the Writer's emails), a different reply is the correction:
    // comparing objects would count the charts step's new copy of the same answer as one.
    if (result.judgeInTurn?.asked && result.judgeInTurn.kept === undefined) result.judgeInTurn.fixed = answer.reply !== (judgedAnswer as CoworkAnswer | null)?.reply;
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

/** The data the model saw in a corpus turn, replayed from the fixture with the same inputs. */
export function corpusObservations(entry: CorpusCase, result: CorpusTurnResult) {
  const read = entry.world?.read ?? corpusRead;
  const reads = result.reads?.length ? result.reads : result.actions.map(action => ({ action, input: '' }));
  const observed = reads.map(({ action, input }) => {
    try { return { action, input, result: read(action, input) as unknown }; } catch { return { action, input, result: null as unknown }; }
  });
  // The data of an artifact are put by the server from the account (artifact-data.ts), not read by the model: the judge sees them
  // as one more observation, so it can check the artifact's figures against them.
  const tables = (result.artifact?.tables || []).map(table => table.name as CoworkArtifactTableName);
  if (tables.length) {
    try { observed.push({ action: 'artifact.data', input: tables.join(','), result: corpusArtifactData(read, tables) }); } catch { /* the artifact stands without them */ }
  }
  return observed;
}

/** The emails of a campaign card as the person reads them in the review (CampaignReview.tsx): numbered, with the day it goes, subject and text. */
function corpusCampaignEmailsText(messages: unknown) {
  if (!Array.isArray(messages)) return messages;
  let day = 1;
  return messages.map((raw, index) => {
    const message = raw as { subject?: unknown; body?: unknown; delayDays?: unknown };
    if (index > 0) day += Number(message.delayDays) || 0;
    return `Correo ${index + 1} · día ${day}\nAsunto: ${String(message.subject ?? '')}\n\n${String(message.body ?? '')}`;
  }).join('\n\n---\n\n');
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
      ...(campaign ? { detail: { nombre: campaign.name, objetivo: campaign.objective, destinatarios: campaign.emails, correos: corpusCampaignEmailsText(campaign.messages) } }
        : result.proposal.linkedinMessage ? { detail: result.proposal.linkedinMessage }
        // The code card shows the files it runs on and the code itself.
        : result.proposal.code ? { detail: { archivos: result.proposal.code.inputFiles, codigo: result.proposal.code.code } }
        // The preference card shows the sentence it will keep and for whom.
        : result.proposal.preference ? { detail: { recordar: result.proposal.preference.text, para: result.proposal.preference.scope === 'organization' ? 'todo el equipo' : 'solo la persona' } }
        // The import card shows who comes in, who stays out and the columns (older reports: only the file).
        : result.proposal.contactsImport ? { detail: result.proposal.contactsImport.card ?? { archivo: result.proposal.contactsImport.file } }
        // The batch card lists who goes (with the text of each message), who waits and why.
        : result.proposal.linkedinBatch ? { detail: { personas: result.proposal.linkedinBatch.items.map(item => [item.name, item.company, item.message].filter(Boolean).join(' · ')),
          esperan: result.proposal.linkedinBatch.deferred.map(person => `${person.name || 'Sin nombre'}: ${person.reason}`) } }
        // The reply card shows to whom it goes, the subject and the exact text.
        : result.proposal.replyThread ? { detail: { para: result.proposal.replyThread.to, asunto: result.proposal.replyThread.subject, respuesta: result.proposal.replyThread.body } }
        // The profile card shows the fields it saves.
        : result.proposal.profile ? { detail: result.proposal.profile } : {}) } : null,
    search: result.search,
    document: result.document,
    ...(result.artifact ? { artifact: { title: result.artifact.title, tables: result.artifact.tables, text: result.artifact.render?.text ?? null,
      errors: result.artifact.render?.errors ?? [] } } : {}),
    failed: result.failed,
  };
}
