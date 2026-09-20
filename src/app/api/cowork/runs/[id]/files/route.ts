import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const UPLOAD_BUCKET = 'cowork-uploads';
const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx']);

function sanitizeName(raw: string) {
  const name = String(raw || '').trim();
  if (!name || name.length > 120 || name !== String(raw || '').trim() || name.includes('/') || name.includes('\\') || name.includes('\0') || name.startsWith('.')) {
    throw new Error(`Nombre de archivo inválido: ${name.slice(0, 40)}`);
  }
  const dot = name.lastIndexOf('.');
  if (dot < 1 || !ALLOWED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) {
    throw new Error(`Extensión no permitida (csv, json, md, txt, xlsx): ${name.slice(0, 40)}`);
  }
  return name;
}

/** Upload input files for code execution, scoped to this run. Contents are
 * never executed here; they travel to the isolated executor only after the
 * owner approves a code proposal that names them. */export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const form = await req.formData();
    const entries = form.getAll('files');
    if (entries.length === 0) return NextResponse.json({ error: 'Adjunta al menos un archivo.' }, { status: 400, headers: privateHeaders });
    if (entries.length > MAX_FILES) return NextResponse.json({ error: `Máximo ${MAX_FILES} archivos por subida.` }, { status: 400, headers: privateHeaders });
    const client = getSupabaseAdminClient();
    const saved: Array<{ name: string; size: number }> = [];
    for (const entry of entries) {
      if (!(entry instanceof File)) return NextResponse.json({ error: 'Archivo inválido.' }, { status: 400, headers: privateHeaders });
      const name = sanitizeName(entry.name);
      const bytes = Buffer.from(await entry.arrayBuffer());
      if (bytes.length === 0) return NextResponse.json({ error: `El archivo ${name} está vacío.` }, { status: 400, headers: privateHeaders });
      if (bytes.length > MAX_FILE_BYTES) return NextResponse.json({ error: `El archivo ${name} supera 20 MB.` }, { status: 400, headers: privateHeaders });
      const path = `${auth.organizationId}/${auth.user.id}/${runId}/${name.toLowerCase()}`;
      const uploaded = await client.storage.from(UPLOAD_BUCKET).upload(path, bytes, { upsert: true, contentType: entry.type || 'application/octet-stream' });
      if (uploaded.error) return NextResponse.json({ error: 'No se pudo guardar el archivo.' }, { status: 503, headers: privateHeaders });
      saved.push({ name: name.toLowerCase(), size: bytes.length });
    }
    return NextResponse.json({ files: saved }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if ((error instanceof Error && error.message.startsWith('Nombre de archivo'))
      || (error instanceof Error && error.message.startsWith('Extensión'))) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: privateHeaders });
    }
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
    const { data, error } = await getSupabaseAdminClient().storage.from(UPLOAD_BUCKET)
      .list(`${auth.organizationId}/${auth.user.id}/${runId}`, { limit: 50 });
    if (error) return NextResponse.json({ error: 'No se pudieron listar los archivos.' }, { status: 503, headers: privateHeaders });
    return NextResponse.json({ files: (data || []).filter(file => file.name).map(file => ({
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
