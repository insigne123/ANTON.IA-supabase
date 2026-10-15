import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { readOpportunityDetail, assignOpportunity, addOpportunityActivity, opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { assignmentSchema, activitySchema, taskSchema, WORK_STATES } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { enqueueOpportunityResearch } from '@/lib/server/commercial-opportunities/workspace-research';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
const STATE_LABELS: Record<string, string> = { unassigned: 'sin asignar', assigned: 'asignada', working: 'en gestión', blocked: 'bloqueada', submitted: 'oferta presentada', won: 'ganada', lost: 'perdida', archived: 'archivada' };
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const auth = await requireOpportunityWorkspace(); const id = z.string().uuid().parse((await context.params).id);
    return opportunitiesJson(await readOpportunityDetail(auth.admin, opportunityScope(auth), id));
  } catch (error) { return opportunitiesError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const { action, data } = z.object({ action: z.enum(['assign', 'activity', 'task', 'state', 'research', 'chat', 'link', 'reconsider']), data: z.unknown() }).strict().parse(await request.json());
    if (action === 'assign') return opportunitiesJson({ revision: await assignOpportunity(auth.admin, scope, id, assignmentSchema.parse(data)) });
    if (action === 'activity') {
      const input = activitySchema.parse(data); await addOpportunityActivity(auth.admin, scope, id, input.kind, input.text, { dueAt: input.dueAt }); return opportunitiesJson({ ok: true });
    }
    if (action === 'research') return opportunitiesJson({ jobId: await enqueueOpportunityResearch(auth.admin, scope, id) }, 202);
    if (action === 'state') {
      const input = z.object({ state: z.enum(WORK_STATES), expectedRevision: z.number().int().nonnegative() }).strict().parse(data);
      if (['unassigned', 'assigned', 'won', 'lost', 'archived'].includes(input.state)) assertOpportunityAdmin(scope);
      const saved = opportunityDb(await auth.admin.from('opportunity_work').update({ state: input.state, revision: input.expectedRevision + 1, updated_at: new Date().toISOString() })
        .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('revision', input.expectedRevision).select('revision').maybeSingle());
      if (!saved) throw new AuthError('El estado cambió. Actualiza la oportunidad.', 409);
      await addOpportunityActivity(auth.admin, scope, id, 'state', `Estado: ${STATE_LABELS[input.state] ?? input.state}`); return opportunitiesJson(saved);
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
      await addOpportunityActivity(auth.admin, scope, id, 'task', `Tarea ${input.status}: ${input.title}`); return opportunitiesJson({ ok: true });
    }
    if (action === 'link') {
      const { contactId } = z.object({ contactId: z.string().min(1).max(200) }).strict().parse(data);
      const contact = opportunityDb(await auth.admin.from('leads').select('id').eq('organization_id', scope.organizationId).eq('id', contactId).maybeSingle());
      if (!contact) throw new AuthError('El contacto no está guardado en este workspace.', 404);
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
    return opportunitiesJson({ queued: true, requestId: input.requestId }, 202);
  } catch (error) { return opportunitiesError(error); }
}
