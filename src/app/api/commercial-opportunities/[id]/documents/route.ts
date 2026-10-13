import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { saveOpportunityDocument } from '@/lib/server/commercial-opportunities/workspace-documents';
import { addOpportunityActivity, opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { OPPORTUNITY_BUCKET } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const form = await request.formData(); const file = form.get('file');
    if (!file || typeof file === 'string' || file.size > 20 * 1024 * 1024) throw new AuthError('Adjunta un documento de hasta 20 MB.', 400);
    const documentId = await saveOpportunityDocument(auth.admin, scope, id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), sourceKind: 'upload' });
    await addOpportunityActivity(auth.admin, scope, id, 'document', `Documento incorporado: ${file.name.slice(0, 300)}`, { documentId }, `${id}:document:${documentId}`);
    return opportunitiesJson({ id: documentId }, 201);
  } catch (error) { return opportunitiesError(error); }
}
export async function GET(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const documentId = z.string().uuid().parse(new URL(request.url).searchParams.get('document'));
    const doc = opportunityDb(await auth.admin.from('opportunity_documents').select('storage_path,name,mime').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', documentId).maybeSingle());
    if (!doc?.storage_path) throw new AuthError('No encontramos el archivo.', 404);
    const file = opportunityDb(await auth.admin.storage.from(OPPORTUNITY_BUCKET).download(doc.storage_path));
    if (!file) throw new AuthError('No se pudo descargar el archivo.', 503);
    return new Response(await file.arrayBuffer(), { headers: { 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return opportunitiesError(error); }
}
