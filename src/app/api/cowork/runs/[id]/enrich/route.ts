import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { enrichCoworkContact } from '@/lib/server/cowork/enrich-contact';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };

/** Enrichment inline: runs the provider call synchronously (no model turn,
 * no approval queue) and returns the result. The quota, identity and
 * reconciliation guards are the same shared ones as the agent path. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const leadId = z.object({ leadId: z.string().uuid(), confirm: z.literal(true) }).strict().parse(await req.json()).leadId;
    const result = await enrichCoworkContact(auth, id, leadId);
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400, headers });
    }
    // enrichCoworkContact throws crafted user-facing messages (quota,
    // suppressed, busy, insufficient identity): surface them verbatim.
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo enriquecer.' }, { status: 503, headers });
  }
}
