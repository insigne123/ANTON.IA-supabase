import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkPromptRefused, listCoworkPrompts, saveCoworkPrompt } from '@/lib/server/cowork/prompts';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** «Pedidos guardados» (COW-06): your own and the ones your team shared. */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json(await listCoworkPrompts(auth), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No pudimos leer tus pedidos guardados.' }, { status: 503, headers });
  }
}

/** «Guardar pedido»: the request as written, for you or for the team. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    const result = await saveCoworkPrompt(auth, await request.json());
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkPromptRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'El pedido necesita entre 3 y 4.000 caracteres.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No pudimos guardar el pedido. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
