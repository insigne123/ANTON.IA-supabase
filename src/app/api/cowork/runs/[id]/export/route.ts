import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { buildCoworkLeadCsv } from '@/lib/cowork/lead-export';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const state = await getCoworkRun(auth, (await context.params).id);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404 });
    const csv = buildCoworkLeadCsv(state.events.filter((event: { kind: string }) => event.kind === 'tool.completed').map((event: { payload: unknown }) => event.payload));
    if (!csv) return NextResponse.json({ error: 'Este trabajo no tiene contactos para exportar.' }, { status: 404 });
    return new Response(csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cowork-contactos.csv"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo exportar el resultado.' }, { status: error instanceof ZodError ? 400 : 503 });
  }
}
