import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkPromptRefused, deleteCoworkPrompt } from '@/lib/server/cowork/prompts';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** Deletes a saved request: its author's, or a shared one an owner or admin removes. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json(await deleteCoworkPrompt(auth, (await params).id), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkPromptRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Ese pedido no existe.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No pudimos borrar el pedido. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
