import { after } from 'next/server';
import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { readOpportunityDetail, assignOpportunity, addOpportunityActivity, opportunityDb, saveOpportunityReportMark } from '@/lib/server/commercial-opportunities/workspace-store';
import { markInputSchema } from '@/lib/commercial-opportunities/report-marks';
import { applyAutomaticMove, routeKindOf, undoAutomaticMove } from '@/lib/server/commercial-opportunities/workspace-pipeline';
import { assignmentSchema, activitySchema, taskSchema, isOpportunityAdmin, WORK_STATES } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { enqueueOpportunityResearch } from '@/lib/server/commercial-opportunities/workspace-research';
import { answerOpportunityChatNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { enqueueOpportunityOffer, readOpportunityOffer, saveOpportunityOfferPrices } from '@/lib/server/commercial-opportunities/workspace-offer';
import { answerFitQuestion, enqueueRequirementFit, readOpportunityFit } from '@/lib/server/commercial-opportunities/workspace-fit';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { AuthError } from '@/lib/server/auth-utils';
import { notifyNewParticipants, readParticipantIds } from '@/lib/server/commercial-opportunities/workspace-assignment-notice';
import { notifyManagers, recordDecision, replyToDecision } from '@/lib/server/commercial-opportunities/workspace-decisions';
import { notifyDecisionByEmail } from '@/lib/server/commercial-opportunities/workspace-decision-notice';
import { canSetPrices, decisionReplySchema, decisionSchema, fitProposalSchema, fitResolveSchema, memberMayMove, stateNoteSchema } from '@/lib/commercial-opportunities/member-work';
import { proposeFitAnswer, resolveFitProposal } from '@/lib/server/commercial-opportunities/workspace-proposals';

export const dynamic = 'force-dynamic';
const STATE_LABELS: Record<string, string> = { unassigned: 'sin asignar', assigned: 'asignada', working: 'en gestión', blocked: 'bloqueada', submitted: 'oferta presentada', won: 'ganada', lost: 'perdida', archived: 'archivada' };
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const auth = await requireOpportunityWorkspace(); const id = z.string().uuid().parse((await context.params).id);
    const scope = opportunityScope(auth);
    // The detail checks the access first; the offer draft of the same opportunity comes with it.
    const detail = await readOpportunityDetail(auth.admin, scope, id);
    const [offer, fit] = await Promise.all([readOpportunityOffer(auth.admin, scope, id), readOpportunityFit(auth.admin, scope.organizationId, detail.reports?.[0]?.id)]);
    return opportunitiesJson({ ...detail, offer: { ...offer, canPrice: canSetPrices(scope.role, scope.userId, detail.work?.responsible_id) }, fit });
  } catch (error) { return opportunitiesError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const { action, data } = z.object({ action: z.enum(['assign', 'activity', 'task', 'state', 'research', 'chat', 'link', 'reconsider', 'mark', 'offer', 'offer_prices', 'fit', 'fit_answer', 'fit_proposal', 'decision', 'decision_reply']), data: z.unknown() }).strict().parse(await request.json());
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
      const input = activitySchema.parse(data); await addOpportunityActivity(auth.admin, scope, id, input.kind, input.text, { dueAt: input.dueAt }); return opportunitiesJson({ ok: true });
    }
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
    if (action === 'offer_prices') {
      const input = z.object({ draftId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
        prices: z.record(z.string().regex(/^\d{1,3}$/), z.union([z.number(), z.string().max(40)])) }).strict().parse(data);
      return opportunitiesJson(await saveOpportunityOfferPrices(auth.admin, scope, id, input));
    }
    if (action === 'state') {
      const input = z.object({ state: z.enum(WORK_STATES), expectedRevision: z.number().int().nonnegative(), note: z.string().trim().max(500).optional() }).strict().parse(data);
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
      await addOpportunityActivity(auth.admin, scope, id, 'state', `Estado: ${STATE_LABELS[input.state] ?? input.state}${note ? `. ${note}` : ''}`, note ? { note } : {});
      // A block is news for whoever can unblock it.
      if (input.state === 'blocked') {
        await notifyManagers(auth.admin, scope, id, 'Oportunidad bloqueada', `blocked:${id}:${saved.revision}`).catch(() => null);
        after(() => notifyDecisionByEmail(auth.admin, scope, id, { kind: 'blocked', text: note || '' }).catch(() => null));
      }
      return opportunitiesJson(saved);
    }
    if (action === 'task') {
      const input = taskSchema.extend({ id: z.string().uuid().optional() }).parse(data);
      if (input.ownerId) {
        const assigned = opportunityDb(await auth.admin.from('opportunity_participants').select('user_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('user_id', input.ownerId).maybeSingle());
        if (!assigned) throw new AuthError('El responsable debe ser participante de esta oportunidad.', 400);
      }
      const values = { title: input.title, owner_id: input.ownerId, due_at: input.dueAt, status: input.status, evidence: input.evidence, updated_at: new Date().toISOString() };
      if (input.id) opportunityDb(await auth.admin.from('opportunity_tasks').update(values).eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.id));
      else opportunityDb(await auth.admin.from('opportunity_tasks').insert({ ...values, organization_id: scope.organizationId, opportunity_id: id, created_by: scope.userId }));
      await addOpportunityActivity(auth.admin, scope, id, 'task', `Tarea ${input.status}: ${input.title}`);
      if (input.status === 'working' || input.status === 'done') await applyAutomaticMove(auth.admin, scope, id, { kind: 'task_started' }).catch(() => null);
      return opportunitiesJson({ ok: true });
    }
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
