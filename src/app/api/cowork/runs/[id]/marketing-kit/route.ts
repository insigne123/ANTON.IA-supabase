import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { buildCoworkMarketingReport } from '@/lib/server/cowork/marketing-deliverables';
import { CoworkExportError } from '@/lib/server/cowork/file-exports';
import JSZip from 'jszip';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess(), runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers });
    const kit = await buildCoworkMarketingReport(state.events, { runId, userId: auth.user.id, organizationId: auth.organizationId });
    const zip = new JSZip();
    for (const file of kit.files) zip.file(file.filename, file.bytes);
    zip.file('manifest.json', JSON.stringify(kit.manifest, null, 2));
    return new Response(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), { headers: { ...headers,
      'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="cowork-informe-y-datos.zip"' } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: error instanceof CoworkExportError ? error.message : 'No se pudo preparar el informe y sus datos.' },
      { status: error instanceof CoworkExportError ? error.status : 503, headers });
  }
}
