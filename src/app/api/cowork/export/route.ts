import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { buildCoworkBlockFile, COWORK_EXPORT_BODY_LIMIT, coworkBlockExportRequest } from '@/lib/server/cowork/block-export';
import { CoworkExportError } from '@/lib/server/cowork/file-exports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** The body as text, without reading past the limit (a request may declare no length). */
async function bodyText(req: NextRequest) {
  if (Number(req.headers.get('content-length') || 0) > COWORK_EXPORT_BODY_LIMIT) throw new CoworkExportError('El contenido es demasiado grande para descargarlo.', 413);
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.length;
    if (size > COWORK_EXPORT_BODY_LIMIT) { await reader.cancel(); throw new CoworkExportError('El contenido es demasiado grande para descargarlo.', 413); }
    chunks.push(part.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * A card as a file: the page sends the card as the person sees it (an edited email is the edited
 * one) and gets a spreadsheet, a Word or a PDF back. Nothing is read from the database or stored;
 * it only turns what the person already has into a file, so it needs access to Cowork and no more.
 */
export async function POST(req: NextRequest) {
  try {
    await requireCoworkAccess();
    const { format, block } = coworkBlockExportRequest(await bodyText(req));
    const file = await buildCoworkBlockFile(block, format);
    return new Response(file.bytes, { headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      ...privateHeaders,
    } });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if (error instanceof CoworkExportError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    return NextResponse.json({ error: 'No se pudo crear el archivo.' }, { status: 503, headers: privateHeaders });
  }
}
