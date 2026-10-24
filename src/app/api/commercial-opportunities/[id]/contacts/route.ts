import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb, addOpportunityActivity } from '@/lib/server/commercial-opportunities/workspace-store';
import { linkObservedOpportunityContacts, opportunityContactHistory } from '@/lib/server/commercial-opportunities/workspace-contacts';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { AuthError } from '@/lib/server/auth-utils';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    if (new URL(request.url).searchParams.get('history') === 'true') return opportunitiesJson({ contacts: await opportunityContactHistory(auth.admin, scope, id) });
    const query = (new URL(request.url).searchParams.get('query') || '').replace(/[%_,().]/g, ' ').slice(0, 100).trim();
    const choices = [];
    for (const table of ['leads', 'enriched_leads'] as const) {
      const field = table === 'leads' ? 'name' : 'full_name';
      const columns = table === 'leads' ? 'id,name,company,title,source_provider,source_provider_id' : 'id,full_name,company_name,title,source_provider,source_provider_id';
      let read = auth.admin.from(table).select(columns).eq('organization_id', scope.organizationId).limit(25);
      if (query) read = read.ilike(field, `%${query}%`);
      const rows = opportunityDb(await read) || [];
      choices.push(...rows.map((r: any) => ({ id: r.id, table, name: r.name || r.full_name, company: r.company || r.company_name, title: r.title })));
    }
    return opportunitiesJson({ contacts: choices });
  } catch (error) { return opportunitiesError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const body = z.union([z.object({ providerIds: z.array(z.string().min(1).max(200)).max(100) }).strict(), z.object({ contactId: z.string().min(1).max(200), table: z.enum(['leads', 'enriched_leads']) }).strict()]).parse(await request.json());
    if ('providerIds' in body) return opportunitiesJson(await linkObservedOpportunityContacts(auth.admin, scope, id, body.providerIds));
    const row = opportunityDb(await auth.admin.from(body.table).select('id,source_provider,source_provider_id').eq('organization_id', scope.organizationId).eq('id', body.contactId).maybeSingle());
    if (!row) throw new AuthError('El contacto no pertenece a esta organización.', 404);
    opportunityDb(await auth.admin.from('opportunity_contact_links').upsert({ organization_id: scope.organizationId, opportunity_id: id, contact_id: body.contactId,
      contact_table: body.table, source_provider: row.source_provider, source_provider_id: row.source_provider_id, linked_by: scope.userId }, { onConflict: 'opportunity_id,contact_id', ignoreDuplicates: true }));
    await addOpportunityActivity(auth.admin, scope, id, 'lead_linked', 'Contacto guardado vinculado a la oportunidad', { contactId: row.id }, `${id}:lead:${row.id}`);
    return opportunitiesJson({ ok: true });
  } catch (error) { return opportunitiesError(error); }
}
