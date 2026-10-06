import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { buildCoworkFile, coworkExportFormat, CoworkExportError } from '@/lib/server/cowork/file-exports';
import { ZodError } from 'zod';
import { CoworkContactListRefused, loadCoworkFullContactList } from '@/lib/server/cowork/contact-list';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const format = coworkExportFormat.parse(req.nextUrl.searchParams.get('format') || 'csv');
    const id = (await context.params).id;
    // With ?read=<sequence>, the whole list «Ver todos» brought to the panel (Plan 13); without it, what the turn read.
    const read = req.nextUrl.searchParams.get('read');
    let events;
    if (read) {
      const list = await loadCoworkFullContactList(auth, id, Number(read));
      events = [{ sequence: Number(read), kind: 'tool.completed', payload: list as unknown as Record<string, unknown>, created_at: new Date().toISOString() }];
    } else {
      const state = await getCoworkRun(auth, id);
      if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
      events = state.events;
    }
    const file = await buildCoworkFile(events, format);
    return new Response(file.bytes, { headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if (error instanceof CoworkContactListRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    if (error instanceof CoworkExportError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.json({ error: 'No se pudo exportar el resultado.' }, { status: error instanceof ZodError ? 400 : 503, headers: privateHeaders });
  }
}
