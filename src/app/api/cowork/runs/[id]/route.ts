import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { cancelCoworkRun, getCoworkRun } from '@/lib/server/cowork/runs';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(_req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const state = await getCoworkRun(auth, (await context.params).id);
    return NextResponse.json(state || { error: 'Trabajo no encontrado.' }, { status: state ? 200 : 404, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo consultar el trabajo.' }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const cancelled = await cancelCoworkRun(auth, (await context.params).id);
    return NextResponse.json({ cancelled }, { status: cancelled ? 200 : 409, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo cancelar el trabajo.' }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
