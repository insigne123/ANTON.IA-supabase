import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { publicMercadoLinks } from '@/lib/server/commercial-opportunities/mercado-publico-documents';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
type Context = { params: Promise<{ id: string }> };
const MERCADO_PUBLICO = /^https:\/\/www\.mercadopublico\.cl\/Procurement\/Modules\/RFB\/DetailsAcquisition\.aspx\?/;
/** Where to get this tender's bases and annexes: its public page and the «Ver anexos» window, read from the public page. */
export async function GET(_request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const item = opportunityDb(await auth.admin.from('commercial_opportunities').select('kind,url').eq('organization_id', scope.organizationId).eq('id', id).single());
    if (item?.kind !== 'tender' || !item.url || !MERCADO_PUBLICO.test(item.url)) return opportunitiesJson({ links: null });
    return opportunitiesJson({ links: (await publicMercadoLinks(item.url)) || { ficha: item.url, attachments: null, forum: null, forms: 0, code: null } });
  } catch (error) { return opportunitiesError(error); }
}
