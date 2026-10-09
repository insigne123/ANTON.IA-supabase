import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { coworkPublishedFiles } from '@/lib/cowork/published-files';
import { createHash } from 'node:crypto';
import { buildCoworkStaticPreview, CoworkPreviewError } from '@/lib/server/cowork/static-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const ARTIFACT_BUCKET = 'cowork-artifacts';
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv; charset=utf-8', json: 'application/json', md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', mjs: 'application/javascript; charset=utf-8',
  png: 'image/png', svg: 'image/svg+xml', pdf: 'application/pdf',
};

// Inline view is only offered for renderable, non-executable surfaces. HTML
// renders inside a sandboxed frame (see ArtifactPreview): opaque origin, no
// network, inline scripts/styles only, so a generated dashboard cannot reach
// the app, its cookies or the network.
const VIEWABLE = new Set(['html', 'png', 'svg']);
// Local submit handlers need allow-forms; form-action:none still prevents every network form submission.
const SANDBOX_CSP = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob: data:; base-uri 'none'; form-action 'none'";

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
    const recorded = coworkPublishedFiles(state.events).find(file => file.name === name)
      || state.events.find((event: { kind: string; payload: Record<string, unknown> }) => event.kind === 'artifact.created' && event.payload?.kind === 'code' && event.payload?.name === name)?.payload;
    if (!recorded) return NextResponse.json({ error: 'Archivo no encontrado en este trabajo.' }, { status: 404, headers: privateHeaders });
    const client = getSupabaseAdminClient();
    const { data, error } = await client.storage.from(ARTIFACT_BUCKET)
      .download(`${auth.organizationId}/${auth.user.id}/${runId}/${name}`);
    if (error || !data) return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 503, headers: privateHeaders });
    const bytes = Buffer.from(await data.arrayBuffer());
    if (recorded.sha256 && createHash('sha256').update(bytes).digest('hex') !== recorded.sha256) {
      return NextResponse.json({ error: 'El archivo no coincide con la versión publicada.' }, { status: 409, headers: privateHeaders });
    }
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Archivo inválido.' }, { status: 422, headers: privateHeaders });
    }
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    const mime = (dot > 0 && MIME_BY_EXTENSION[ext]) || 'application/octet-stream';
    if (req.nextUrl.searchParams.get('view') === '1' && VIEWABLE.has(ext)) {
      let rendered = bytes;
      let assembled = false;
      if (ext === 'html' && recorded.sha256) {
        const completedBuild = state.events.find(event => event.kind === 'effect.completed' && event.payload?.kind === 'code_execute'
          && coworkPublishedFiles([event]).some(file => file.name === name && file.sha256 === recorded.sha256));
        if (completedBuild) {
          const preview = await buildCoworkStaticPreview(bytes, coworkPublishedFiles([completedBuild]), async file => {
            const stored = await client.storage.from(ARTIFACT_BUCKET).download(`${auth.organizationId}/${auth.user.id}/${runId}/${file.name}`);
            if (stored.error || !stored.data) throw new CoworkPreviewError(`No se pudo recuperar ${file.name}.`, 503);
            return Buffer.from(await stored.data.arrayBuffer());
          });
          rendered = preview.bytes; assembled = true;
        }
      }
      return new Response(rendered, { headers: {
        'Content-Type': mime,
        'Content-Security-Policy': ext === 'html' ? SANDBOX_CSP : "sandbox; default-src 'none'; img-src data: blob:;",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(assembled ? { 'X-ANTON-Preview': 'assembled-not-verified' } : {}),
      } });
    }
    return new Response(bytes, { headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof CoworkPreviewError) return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo descargar el archivo.' }, { status: 503, headers: privateHeaders });
  }
}
