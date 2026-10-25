import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkMemoryRefused, editCoworkMemory, forgetCoworkMemory } from '@/lib/server/cowork/memories';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** «Olvidar»: no turn reads this memory again. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json(await forgetCoworkMemory(auth, (await params).id), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkMemoryRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Ese recuerdo no existe.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No pudimos olvidar ese recuerdo. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}

/** «Corregir» a preference written in words (COW-05). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json(await editCoworkMemory(auth, (await params).id, await request.json()), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkMemoryRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Escribe entre 3 y 240 caracteres.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No pudimos corregir ese recuerdo. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
