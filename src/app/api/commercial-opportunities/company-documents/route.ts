import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { addCompanyDocument, deleteCompanyDocument, downloadCompanyDocument, listCompanyDocuments, updateCompanyDocument } from '@/lib/server/commercial-opportunities/workspace-company-documents';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** «Documentos de la empresa»: the list, or one file (?document=id) for anyone of the workspace. */
export async function GET(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const id = new URL(request.url).searchParams.get('document');
    if (!id) return opportunitiesJson(await listCompanyDocuments(auth.admin, scope.organizationId));
    const file = await downloadCompanyDocument(auth.admin, scope, z.string().uuid().parse(id));
    return new Response(file.bytes, { headers: { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return opportunitiesError(error); }
}

/** A new file (multipart: file, kind, label, expiresAt), or JSON to change its expiry or delete it. Admins only. */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData(); const file = form.get('file');
      if (!file || typeof file === 'string') throw new AuthError('Adjunta el documento.', 400);
      if (file.size > 20 * 1024 * 1024) throw new AuthError('Adjunta un documento de hasta 20 MB.', 400);
      return opportunitiesJson(await addCompanyDocument(auth.admin, scope, { kind: form.get('kind'), label: form.get('label'), expiresAt: form.get('expiresAt'),
        file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } }), 201);
    }
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('update'), id: z.string().uuid(), kind: z.string(), label: z.string(), expiresAt: z.string().nullable() }).strict(),
      z.object({ action: z.literal('delete'), id: z.string().uuid() }).strict(),
    ]).parse(await request.json());
    if (body.action === 'delete') { await deleteCompanyDocument(auth.admin, scope, body.id); return opportunitiesJson({ deleted: true }); }
    return opportunitiesJson(await updateCompanyDocument(auth.admin, scope, body.id, body));
  } catch (error) { return opportunitiesError(error); }
}
