import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { addCoworkMemory, listCoworkMemories } from '@/lib/server/cowork/memories';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** What Cowork remembers for you and your organization. */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json({ memories: await listCoworkMemories(auth) }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No pudimos leer lo que Cowork recuerda. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}

/** «Recordar» written by hand (COW-05). */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    const result = await addCoworkMemory(auth, await request.json());
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Escribe entre 3 y 240 caracteres.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No pudimos guardar el recuerdo. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
