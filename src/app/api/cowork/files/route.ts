import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { COWORK_ATTACHMENTS_FOLDER, CoworkUploadRejected, saveCoworkUploads } from '@/lib/server/cowork/upload-files';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Files attached from the message box, before or between turns. They wait in the
 * person's own prefix: the message names them, files.read reads them and approved
 * code copies them into its run. Contents are never read or executed here. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    const form = await req.formData();
    const saved = await saveCoworkUploads(getSupabaseAdminClient(),
      `${auth.organizationId}/${auth.user.id}/${COWORK_ATTACHMENTS_FOLDER}`, form.getAll('files'));
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
