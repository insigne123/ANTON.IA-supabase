import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const ARTIFACT_BUCKET = 'cowork-artifacts';
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv; charset=utf-8', json: 'application/json', md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', svg: 'image/svg+xml', pdf: 'application/pdf',
};

/** Download an execution artifact. The file must have been recorded in an
 * artifact.created event of this run; anything else 404s. Bytes stream
 * server-side: no public URLs, no expiring links. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const name = String(req.nextUrl.searchParams.get('name') || '').trim();
    if (!name || name.length > 120 || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      return NextResponse.json({ error: 'Nombre inválido.' }, { status: 400, headers: privateHeaders });
    }
    const recorded = state.events.some((event: { kind: string; payload: unknown }) => event.kind === 'artifact.created'
      && ((event.payload as { name?: string } | null)?.name === name));
    if (!recorded) return NextResponse.json({ error: 'Archivo no encontrado en este trabajo.' }, { status: 404, headers: privateHeaders });
    const client = getSupabaseAdminClient();
    const { data, error } = await client.storage.from(ARTIFACT_BUCKET)
      .download(`${auth.organizationId}/${auth.user.id}/${runId}/${name}`);
    if (error || !data) return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 503, headers: privateHeaders });
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Archivo inválido.' }, { status: 422, headers: privateHeaders });
    }
    const dot = name.lastIndexOf('.');
    const mime = (dot > 0 && MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || 'application/octet-stream';
    return new Response(bytes, { headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo descargar el archivo.' }, { status: 503, headers: privateHeaders });
  }
}
