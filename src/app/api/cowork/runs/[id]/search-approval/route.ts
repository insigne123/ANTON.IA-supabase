import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { resolveCoworkSearch } from '@/lib/server/cowork/external-search';
import { CoworkSearchEditRefused, editCoworkSearchProposal } from '@/lib/server/cowork/search-edit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const input = z.object({ approve: z.boolean() }).strict().parse(await req.json());
    const resolved = await resolveCoworkSearch(auth, id, input.approve);
    return NextResponse.json({ resolved, ...(!resolved ? { error: 'La búsqueda ya está resuelta o cancelada. Actualiza el trabajo.' } : {}) }, { status: resolved ? 200 : 409, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo confirmar la búsqueda. Consulta el estado del trabajo antes de intentarlo de nuevo.' }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

/** «Editar criterios» (COW-29): changes the search that waits for approval; the approval then runs what the card shows. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    return NextResponse.json(await editCoworkSearchProposal(auth, id, await req.json()), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkSearchEditRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Revisa los criterios: alguno no es válido.' }, { status: 400, headers });
    return NextResponse.json({ error: 'No se pudo guardar el cambio de la búsqueda. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
