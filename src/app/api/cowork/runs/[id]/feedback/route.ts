import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkFeedbackRefused, recordCoworkFeedback } from '@/lib/server/cowork/feedback';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** 👍 / 👎 on an answer, with an optional reason and comment ({ rating: null } takes it back). */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const raw = await req.text();
    if (raw.length > 4000) return NextResponse.json({ error: 'El comentario es demasiado largo.' }, { status: 413, headers });
    const feedback = await recordCoworkFeedback(auth, id, JSON.parse(raw));
    return NextResponse.json({ feedback }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkFeedbackRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message?.startsWith('Usa hasta') ? error.issues[0].message : 'Revisa tu opinión y vuelve a intentarlo.' }, { status: 400, headers });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Revisa tu opinión y vuelve a intentarlo.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No se pudo guardar tu opinión. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
