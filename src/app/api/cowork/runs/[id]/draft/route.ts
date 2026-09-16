import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkDraftStatus, requestCoworkDraft } from '@/lib/server/cowork/draft-from-research';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const snapshotId = z.string().uuid().parse(req.nextUrl.searchParams.get('snapshotId'));
    return NextResponse.json(await getCoworkDraftStatus(auth, id, snapshotId), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo consultar el borrador.' }, {
      status: error instanceof z.ZodError ? 400 : 503, headers,
    });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    if (process.env.COWORK_NATIVE_DRAFTS_ENABLED !== 'true') {
      return NextResponse.json({ error: 'La creación de borradores aún no está habilitada.' }, { status: 503, headers });
    }
    const id = z.string().uuid().parse((await context.params).id);
    const result = await requestCoworkDraft(auth, id, await req.json());
    return NextResponse.json({ queued: true, ...result }, { status: 202, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof Error && error.message === 'COWORK_DRAFTS_DISABLED') {
      return NextResponse.json({ error: 'La creación de borradores aún no está habilitada.' }, { status: 503, headers });
    }
    return NextResponse.json({ error: 'No se pudo solicitar el borrador. Reintentar usa la misma solicitud.' }, {
      status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers,
    });
  }
}
