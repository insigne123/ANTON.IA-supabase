import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { readOpportunityDetail, assignOpportunity, addOpportunityActivity, opportunityDb, saveOpportunityReportMark } from '@/lib/server/commercial-opportunities/workspace-store';
import { markInputSchema } from '@/lib/commercial-opportunities/report-marks';
import { applyAutomaticMove, routeKindOf, undoAutomaticMove } from '@/lib/server/commercial-opportunities/workspace-pipeline';
import { assignmentSchema, activitySchema, isOpportunityAdmin, WORK_STATES, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { newTaskSchema, taskBatchSchema, taskDeleteSchema, taskStatusSchema, TASK_STATUSES } from '@/lib/commercial-opportunities/work-tasks';
import { noteDeleteSchema, noteEditSchema } from '@/lib/commercial-opportunities/activity-notes';
import { createOpportunityTasks, deleteOpportunityTask, saveOpportunityTask, setOpportunityTaskStatus, type TaskNotice } from '@/lib/server/commercial-opportunities/workspace-tasks';
import { addOpportunityNote, deleteOpportunityNote, editOpportunityNote } from '@/lib/server/commercial-opportunities/workspace-notes';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { enqueueOpportunityResearch } from '@/lib/server/commercial-opportunities/workspace-research';
import { answerOpportunityChatNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { enqueueOpportunityOffer, enqueueOpportunityOfferRewrite, readOpportunityOffer, reviewOpportunityOffer, saveOpportunityOfferPart, saveOpportunityOfferPrices } from '@/lib/server/commercial-opportunities/workspace-offer';
import { offerEditSchema, offerReviewSchema, offerRewriteSchema } from '@/lib/commercial-opportunities/offer-edits';
import { readOpportunityPriceStudy, readOpportunityPriceVersion, saveOpportunityPriceStudy } from '@/lib/server/commercial-opportunities/workspace-price';
import { answerFitQuestion, enqueueRequirementFit, readOpportunityFit } from '@/lib/server/commercial-opportunities/workspace-fit';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { AuthError } from '@/lib/server/auth-utils';
import { notifyNewParticipants, readParticipantIds } from '@/lib/server/commercial-opportunities/workspace-assignment-notice';
import { notifyManagers, recordDecision, replyToDecision } from '@/lib/server/commercial-opportunities/workspace-decisions';
import { notifyDecisionByEmail } from '@/lib/server/commercial-opportunities/workspace-decision-notice';
import { canSetPrices, decisionReplySchema, decisionSchema, fitProposalSchema, fitResolveSchema, memberMayMove, stateNoteSchema } from '@/lib/commercial-opportunities/member-work';
import { closeBody, closeDetailSchema, closeMotives } from '@/lib/commercial-opportunities/close-outcome';
import { proposeFitAnswer, resolveFitProposal } from '@/lib/server/commercial-opportunities/workspace-proposals';

export const dynamic = 'force-dynamic';
/** Whoever got tasks or was named in a note gets the email too, after the answer: a failure there never fails what was done. */
function emailTasks(admin: SupabaseClient, scope: WorkScope, id: string, told: TaskNotice[]) {
  for (const notice of told) after(() => notifyDecisionByEmail(admin, scope, id, { kind: 'task', text: notice.titles.slice(0, 3).join(' · ') + (notice.titles.length > 3 ? ` y ${notice.titles.length - 3} más` : ''),
    dueAt: notice.dueAt, users: [notice.user], count: notice.titles.length }).catch(() => null));
}
function emailMention(admin: SupabaseClient, scope: WorkScope, id: string, users: string[], text: string) {
  if (users.length) after(() => notifyDecisionByEmail(admin, scope, id, { kind: 'mention', text, users }).catch(() => null));
}
const STATE_LABELS: Record<string, string> = { unassigned: 'sin asignar', assigned: 'asignada', working: 'en gestión', blocked: 'bloqueada', submitted: 'oferta presentada', won: 'ganada', lost: 'perdida', archived: 'archivada' };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const auth = await requireOpportunityWorkspace(); const id = z.string().uuid().parse((await context.params).id);
    const scope = opportunityScope(auth);
    // One version of «Calcular el precio», to bring it back (OPP-23).
    const version = new URL(request.url).searchParams.get('price_version');
    if (version) return opportunitiesJson({ version: await readOpportunityPriceVersion(auth.admin, scope, id, z.string().uuid().parse(version)) });
    // The detail checks the access first; the offer draft of the same opportunity comes with it, and the price study for whoever sets the prices.
    const detail = await readOpportunityDetail(auth.admin, scope, id);
    const canPrice = canSetPrices(scope.role, scope.userId, detail.work?.responsible_id);
    const [offer, fit, priceStudy] = await Promise.all([readOpportunityOffer(auth.admin, scope, id), readOpportunityFit(auth.admin, scope.organizationId, detail.reports?.[0]?.id),
      canPrice ? readOpportunityPriceStudy(auth.admin, scope, id) : null]);
    return opportunitiesJson({ ...detail, offer: { ...offer, canPrice }, fit, priceStudy });
  } catch (error) { return opportunitiesError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const { action, data } = z.object({ action: z.enum(['assign', 'activity', 'task', 'tasks', 'task_status', 'task_delete', 'note_edit', 'note_delete', 'state', 'research', 'chat', 'link', 'reconsider', 'mark', 'offer', 'offer_prices', 'offer_part', 'offer_review', 'offer_rewrite', 'price_study', 'fit', 'fit_answer', 'fit_proposal', 'decision', 'decision_reply']), data: z.unknown() }).strict().parse(await request.json());
    if (action === 'assign') {
      const input = assignmentSchema.parse(data); const before = await readParticipantIds(auth.admin, scope, id);
      const revision = await assignOpportunity(auth.admin, scope, id, input);
      // Whoever joined the team gets the email after the answer is sent: a failure there never fails the assignment.
      after(() => notifyNewParticipants(auth.admin, scope, id, before).catch(() => null));
      return opportunitiesJson({ revision });
    }
    if (action === 'decision') {
      const input = decisionSchema.parse(data);
      await recordDecision(auth.admin, scope, id, input);
      // The administrators get it by email too, after the answer: before, a decision waited until one of them opened the page.
      after(() => notifyDecisionByEmail(auth.admin, scope, id, { kind: input.type, text: input.text, dueAt: input.dueAt }).catch(() => null));
      return opportunitiesJson({ ok: true });
    }
    if (action === 'decision_reply') {
      assertOpportunityAdmin(scope); const input = decisionReplySchema.parse(data);
      const { asker } = await replyToDecision(auth.admin, scope, id, input);
      after(() => notifyDecisionByEmail(auth.admin, scope, id, { kind: 'reply', text: input.text, asker }).catch(() => null));
      return opportunitiesJson({ ok: true });
    }
    if (action === 'activity') {
      const input = activitySchema.parse(data);
      // A note can name people with «@» (OPP-28): they hear about it on «Novedades» and by email.
      if (input.kind === 'note') { const { mentioned } = await addOpportunityNote(auth.admin, scope, id, input.text); emailMention(auth.admin, scope, id, mentioned, input.text); return opportunitiesJson({ ok: true, mentioned: mentioned.length }); }
      await addOpportunityActivity(auth.admin, scope, id, input.kind, input.text, { dueAt: input.dueAt }); return opportunitiesJson({ ok: true });
    }
    if (action === 'note_edit') {
      const input = noteEditSchema.parse(data); const { mentioned } = await editOpportunityNote(auth.admin, scope, id, input);
      emailMention(auth.admin, scope, id, mentioned, input.text); return opportunitiesJson({ ok: true, mentioned: mentioned.length });
    }
    if (action === 'note_delete') return opportunitiesJson(await deleteOpportunityNote(auth.admin, scope, id, noteDeleteSchema.parse(data).id));
    if (action === 'research') return opportunitiesJson({ jobId: await enqueueOpportunityResearch(auth.admin, scope, id) }, 202);
    if (action === 'offer') {
      const input = z.object({ requestId: z.string().uuid(), instructions: z.string().trim().max(1500).optional() }).strict().parse(data);
      return opportunitiesJson({ jobId: await enqueueOpportunityOffer(auth.admin, scope, id, input) }, 202);
    }
    if (action === 'fit_proposal') {
      // An administrator confirms (into the ficha) or drops an answer a member gave; a confirmed one reads the requirements again.
      assertOpportunityAdmin(scope);
      const accepted = await resolveFitProposal(auth.admin, scope, id, fitResolveSchema.parse(data));
      if (!accepted) return opportunitiesJson({ accepted: false });
      const key = await enqueueRequirementFit(auth.admin, scope, id);
      const done = await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'fit').catch(() => null);
      return opportunitiesJson({ accepted: true, queued: !(done?.processed === 1 && done.state === 'ready') });
    }
    if (action === 'fit' || action === 'fit_answer') {
      // An answer from an administrator goes into the company's tender profile first, then the requirements are read again with it, now.
      // An answer from anyone else is a proposal: it waits for an administrator to confirm it (workspace-proposals.ts).
      if (action === 'fit_answer') {
        const input = fitProposalSchema.parse(data);
        if (!isOpportunityAdmin(scope.role)) { await proposeFitAnswer(auth.admin, scope, id, input); return opportunitiesJson({ proposed: true }); }
        await answerFitQuestion(auth.admin, scope, id, input);
      }
      const key = await enqueueRequirementFit(auth.admin, scope, id);
      const done = await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'fit').catch(() => null);
      return opportunitiesJson({ queued: !(done?.processed === 1 && done.state === 'ready'), state: done?.state ?? 'queued' }, done?.state === 'ready' ? 200 : 202);
    }
    // The offer in the team's words (OPP-24): a part written by hand or back to the AI's, «Revisado por», and a part rewritten by the AI.
    if (action === 'offer_part') return opportunitiesJson({ edit: (await saveOpportunityOfferPart(auth.admin, scope, id, offerEditSchema.parse(data))).edit });
    if (action === 'offer_review') return opportunitiesJson({ review: (await reviewOpportunityOffer(auth.admin, scope, id, offerReviewSchema.parse(data))).review });
    if (action === 'offer_rewrite') {
      const input = offerRewriteSchema.parse(data);
      const jobId = await enqueueOpportunityOfferRewrite(auth.admin, scope, id, input);
      // One part is short: written now when it can be, by the worker otherwise; the page reads the result with the opportunity.
      const done = await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, `offer-part:${id}:${input.requestId}`, 'offer').catch(() => null);
      return opportunitiesJson({ jobId, state: done?.state ?? 'queued' }, done?.state === 'ready' ? 200 : 202);
    }
    // «Calcular el precio» saved for the team, with its versions (OPP-23); the server cleans the study.
    if (action === 'price_study') {
      const input = z.object({ study: z.record(z.unknown()).refine(study => JSON.stringify(study).length <= 120_000, 'El cálculo es demasiado largo.'), base: z.string().uuid().nullable(),
        over: z.boolean().optional(), fresh: z.boolean().optional() }).strict().parse(data);
      return opportunitiesJson({ saved: await saveOpportunityPriceStudy(auth.admin, scope, id, input) });
    }
    if (action === 'offer_prices') {
      const input = z.object({ draftId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
        prices: z.record(z.string().regex(/^\d{1,3}$/), z.union([z.number(), z.string().max(40)])) }).strict().parse(data);
      return opportunitiesJson(await saveOpportunityOfferPrices(auth.admin, scope, id, input));
    }
    if (action === 'state') {
      const input = z.object({ state: z.enum(WORK_STATES), expectedRevision: z.number().int().nonnegative(), note: z.string().trim().max(500).optional() })
        .merge(closeDetailSchema).strict().parse(data);
      if (!isOpportunityAdmin(scope.role)) {
        // A member moves the work along (managing it, blocked, presented); the stages the administrators set stay theirs, and so does
        // an opportunity they already closed.
        const current = opportunityDb(await auth.admin.from('opportunity_work').select('state').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as { state: any } | null;
        if (!memberMayMove(current?.state, input.state)) throw new AuthError(['won', 'lost', 'archived'].includes(String(current?.state)) ? 'Un administrador ya cerró esta oportunidad.' : 'Esta acción corresponde a un administrador.', 403);
        if (input.state === 'blocked' && !stateNoteSchema.safeParse(input.note).success) throw new AuthError('Cuenta qué te bloquea, para que el equipo pueda ayudarte.', 400);
      }
      const saved = opportunityDb(await auth.admin.from('opportunity_work').update({ state: input.state, revision: input.expectedRevision + 1, updated_at: new Date().toISOString() })
        .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('revision', input.expectedRevision).select('revision').maybeSingle());
      if (!saved) throw new AuthError('El estado cambió. Actualiza la oportunidad.', 409);
      const note = input.note?.replace(/\s+/g, ' ').trim();
      if (input.state === 'won' || input.state === 'lost') {
        // Closed with its reasons in chips, and for one lost who won it and for how much (OPP-30): counted in «Lo que aprendimos».
        const detail = { motives: closeMotives(input.state, input.motives), winner: input.state === 'lost' ? input.winner || undefined : undefined, amount: input.amount };
        const currency = detail.amount === undefined ? null
          : (opportunityDb(await auth.admin.from('commercial_opportunities').select('currency').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle()) as { currency: string | null } | null)?.currency;
        await addOpportunityActivity(auth.admin, scope, id, 'state', closeBody(STATE_LABELS[input.state] ?? input.state, input.state, detail, note, currency),
          { ...(note ? { note } : {}), to: input.state, ...(detail.motives.length ? { motives: detail.motives } : {}), ...(detail.winner ? { winner: detail.winner } : {}),
            ...(detail.amount !== undefined ? { amount: detail.amount } : {}) });
        return opportunitiesJson(saved);
      }
      // Back to the ones nobody works (what was put aside by mistake, or a team that was let go) reads as what it is.
      const line = input.state === 'unassigned' ? 'Reabierta: vuelve a las que nadie trabaja todavía.' : `Estado: ${STATE_LABELS[input.state] ?? input.state}`;
      await addOpportunityActivity(auth.admin, scope, id, 'state', `${line}${note ? `${line.endsWith('.') ? ' ' : '. '}${note}` : ''}`, { ...(note ? { note } : {}), to: input.state });
      // A block is news for whoever can unblock it.
      if (input.state === 'blocked') {
        await notifyManagers(auth.admin, scope, id, 'Oportunidad bloqueada', `blocked:${id}:${saved.revision}`).catch(() => null);
        after(() => notifyDecisionByEmail(auth.admin, scope, id, { kind: 'blocked', text: note || '' }).catch(() => null));
      }
      return opportunitiesJson(saved);
    }
    if (action === 'task') {
      // One task, new or edited (OPP-27); an edit that says no stage keeps the one it has.
      const input = newTaskSchema.extend({ id: z.string().uuid().optional(), status: z.enum(TASK_STATUSES).optional() }).parse(data);
      const saved = await saveOpportunityTask(auth.admin, scope, id, input); emailTasks(auth.admin, scope, id, saved.told);
      if (saved.moved && (saved.status === 'working' || saved.status === 'done')) await applyAutomaticMove(auth.admin, scope, id, { kind: 'task_started' }).catch(() => null);
      return opportunitiesJson({ ok: true, id: saved.id });
    }
    if (action === 'tasks') {
      // The plan of the report turned into tasks at once, as the preview left them (OPP-21).
      const { created, told } = await createOpportunityTasks(auth.admin, scope, id, taskBatchSchema.parse(data).tasks); emailTasks(auth.admin, scope, id, told);
      return opportunitiesJson({ ok: true, created });
    }
    if (action === 'task_status') {
      const input = taskStatusSchema.parse(data); const saved = await setOpportunityTaskStatus(auth.admin, scope, id, input);
      if (saved.moved && (saved.status === 'working' || saved.status === 'done')) await applyAutomaticMove(auth.admin, scope, id, { kind: 'task_started' }).catch(() => null);
      return opportunitiesJson({ ok: true, status: saved.status });
    }
    if (action === 'task_delete') return opportunitiesJson(await deleteOpportunityTask(auth.admin, scope, id, taskDeleteSchema.parse(data).id));
    if (action === 'mark') {
      const input = markInputSchema.parse(data);
      const saved = await saveOpportunityReportMark(auth.admin, scope, id, input);
      // Ticking an item can move the stage: into preparation, or to «Presentada» when it is the step to submit.
      if (input.done) await applyAutomaticMove(auth.admin, scope, id, { kind: 'marked_done', label: input.label, routeKind: await routeKindOf(auth.admin, scope, id, input.key) }).catch(() => null);
      // Taking a tick back («me equivoqué») also takes back the move to «Presentada» that the tick itself made.
      else if (input.done === false) await undoAutomaticMove(auth.admin, scope, id, { label: input.label, routeKind: await routeKindOf(auth.admin, scope, id, input.key) }).catch(() => null);
      return opportunitiesJson(saved);
    }
    if (action === 'link') {
      const { contactId } = z.object({ contactId: z.string().min(1).max(200) }).strict().parse(data);
      const contact = opportunityDb(await auth.admin.from('leads').select('id').eq('organization_id', scope.organizationId).eq('id', contactId).maybeSingle());
      if (!contact) throw new AuthError('El contacto no está guardado en esta organización.', 404);
      opportunityDb(await auth.admin.from('opportunity_contact_links').upsert({ organization_id: scope.organizationId, opportunity_id: id, contact_id: contactId, linked_by: scope.userId }, { onConflict: 'opportunity_id,contact_id', ignoreDuplicates: true }));
      await addOpportunityActivity(auth.admin, scope, id, 'lead_linked', 'Contacto vinculado a la oportunidad', { contactId }, `${id}:lead:${contactId}`); return opportunitiesJson({ ok: true });
    }
    if (action === 'reconsider') {
      assertOpportunityAdmin(scope); const { reason } = z.object({ reason: z.string().trim().min(3).max(2000) }).strict().parse(data);
      await addOpportunityActivity(auth.admin, scope, id, 'reconsideration', reason);
      return opportunitiesJson({ jobId: await enqueueOpportunityResearch(auth.admin, scope, id) }, 202);
    }
    const input = z.object({ question: z.string().trim().min(3).max(2000), requestId: z.string().uuid() }).strict().parse(data);
    const report = opportunityDb(await auth.admin.from('opportunity_reports').select('id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle());
    opportunityDb(await auth.admin.from('opportunity_chat_messages').upsert({ organization_id: scope.organizationId, opportunity_id: id, user_id: scope.userId,
      request_id: input.requestId, question: input.question, report_id: report?.id || null }, { onConflict: 'organization_id,user_id,request_id', ignoreDuplicates: true }));
    const key = `chat:${scope.userId}:${input.requestId}`;
    const existing = opportunityDb(await auth.admin.from('opportunity_chat_messages').select('opportunity_id').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('request_id', input.requestId).single());
    if (existing?.opportunity_id !== id) throw new AuthError('La pregunta pertenece a otra oportunidad.', 409);
    opportunityDb(await auth.admin.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, opportunity_id: id, requested_by: scope.userId,
      kind: 'chat', dedupe_key: key, payload: { requestId: input.requestId } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
    // Answered now, as a conversation; if a worker took it first (or this fails), the page keeps waiting for that answer.
    const answered = await answerOpportunityChatNow(auth.admin, scope.organizationId, key).catch(() => false);
    return opportunitiesJson({ queued: !answered, answered, requestId: input.requestId }, answered ? 200 : 202);
  } catch (error) { return opportunitiesError(error); }
}
