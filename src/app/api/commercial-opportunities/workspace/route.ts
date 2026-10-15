import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { readWorkspaceOverview, createPrivateOpportunity, opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { criteriaSchema } from '@/lib/server/commercial-opportunities/workspace-sources';
import { companyContextSchema, privateOpportunitySchema } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { enqueueOpportunityDiscovery } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const params = new URL(request.url).searchParams;
    const options = z.object({ view: z.enum(['all','recommended','review','excluded','pending','assigned','working','blocked','submitted','won','lost','archived']), query: z.string().max(200), page: z.coerce.number().int().min(0).max(1000) })
      .parse({ view: params.get('view') || 'all', query: params.get('query') || '', page: params.get('page') || '0' });
    const overview = await readWorkspaceOverview(auth.admin, scope, options);
    // The company offer is confirmed by its admin, never borrowed from the operator's personal profile.
    return opportunitiesJson({ ...overview, suggestion: null });
  } catch (error) { return opportunitiesError(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const body = z.object({ action: z.enum(['create', 'context', 'discover', 'notification', 'criteria']), data: z.unknown() }).strict().parse(await request.json());
    if (body.action === 'notification') {
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(body.data);
      opportunityDb(await auth.admin.from('opportunity_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId));
      return opportunitiesJson({ ok: true });
    }
    assertOpportunityAdmin(scope);
    if (body.action === 'create') return opportunitiesJson({ id: await createPrivateOpportunity(auth.admin, scope, privateOpportunitySchema.parse(body.data)) }, 201);
    if (body.action === 'discover') return opportunitiesJson({ enqueued: await enqueueOpportunityDiscovery(auth.admin, scope, true) }, 202);
    if (body.action === 'criteria') {
      // What the daily search looks for, as the admin corrected it. Keeps the offer revision: no new derivation is paid.
      const input = z.object({ criteria: criteriaSchema, expectedRevision: z.number().int().positive() }).strict().parse(body.data);
      const saved = opportunityDb(await auth.admin.from('opportunity_company_context').update({ criteria: input.criteria })
        .eq('organization_id', scope.organizationId).eq('revision', input.expectedRevision).select('revision').maybeSingle());
      if (!saved) throw new AuthError('La oferta fue actualizada por otro administrador. Recarga antes de guardar.', 409);
      return opportunitiesJson({ ok: true });
    }
    const input = companyContextSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(body.data);
    const current = opportunityDb(await auth.admin.from('opportunity_company_context').select('revision').eq('organization_id', scope.organizationId).maybeSingle());
    if (Number(current?.revision || 0) !== input.expectedRevision) throw new AuthError('La oferta fue actualizada por otro administrador. Recarga antes de guardar.', 409);
    const values = { organization_id: scope.organizationId, offer: input.offer, services: input.services, territories: input.territories, exclusions: input.exclusions,
      priority: input.priority, automation: input.automation, hour: input.hour, revision: input.expectedRevision + 1, approved_by: scope.userId, approved_at: new Date().toISOString(), criteria: {} };
    if (current) {
      const saved = opportunityDb(await auth.admin.from('opportunity_company_context').update(values).eq('organization_id', scope.organizationId).eq('revision', input.expectedRevision).select('revision').maybeSingle());
      if (!saved) throw new AuthError('La oferta cambió. Recarga antes de guardar.', 409);
    } else opportunityDb(await auth.admin.from('opportunity_company_context').insert(values));
    opportunityDb(await auth.admin.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'criteria',
      dedupe_key: `criteria:${values.revision}`, payload: { revision: values.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
    return opportunitiesJson({ revision: values.revision }, 202);
  } catch (error) { return opportunitiesError(error); }
}
