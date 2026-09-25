import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { cancelCoworkRun, getCoworkContinuation } from '@/lib/server/cowork/runs';
import { getCoworkThread } from '@/lib/server/cowork/thread';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(_req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const id = (await context.params).id;
    const state = await getCoworkThread(auth, id);
    // A finished turn may already have a newer turn (the worker resumes after
    // an approved effect or search). The workspace follows it automatically.
    const continuation = state && !['queued', 'running', 'waiting_approval', 'waiting_workers'].includes(String(state.run.status))
      ? await getCoworkContinuation(auth, id).catch(() => null) : null;
    return NextResponse.json(state ? { ...state, continuation, canResearch: process.env.COWORK_RESEARCH_ENABLED === 'true', canCreateDraft: process.env.COWORK_NATIVE_DRAFTS_ENABLED === 'true' } : { error: 'Trabajo no encontrado.' }, { status: state ? 200 : 404, headers });
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
