import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkUploadRejected, saveCoworkUploads } from '@/lib/server/cowork/upload-files';
import { COWORK_UPLOAD_BUCKET } from '@/lib/server/cowork/uploads';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Upload files into this run's folder. The message box now attaches through
 * /api/cowork/files; this route stays for existing clients. Contents are never
 * executed here: code gets them only after the owner approves a proposal that names them. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const form = await req.formData();
    const saved = await saveCoworkUploads(getSupabaseAdminClient(), `${auth.organizationId}/${auth.user.id}/${runId}`, form.getAll('files'));
    return NextResponse.json({ files: saved }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if (error instanceof CoworkUploadRejected) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    return NextResponse.json({ error: 'No se pudo subir el archivo.' }, { status: error instanceof ZodError ? 400 : 503, headers: privateHeaders });
  }
}

/** List this run's uploaded input files (names and sizes, never contents). */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const { data, error } = await getSupabaseAdminClient().storage.from(COWORK_UPLOAD_BUCKET)
      .list(`${auth.organizationId}/${auth.user.id}/${runId}`, { limit: 50 });
    if (error) return NextResponse.json({ error: 'No se pudieron listar los archivos.' }, { status: 503, headers: privateHeaders });
    return NextResponse.json({ files: (data || []).filter(file => file.name && file.name !== 'frozen').map(file => ({
      name: file.name, size: Number(file.metadata?.size || 0),
    })) }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudieron listar los archivos.' }, { status: 503, headers: privateHeaders });
  }
}
