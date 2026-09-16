import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkResearchStatus, startCoworkResearch } from '@/lib/server/cowork/start-research';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
async function handle(req: NextRequest, context: Context, start: boolean) {
  try {
    const auth = await requireCoworkAccess();
    if (process.env.COWORK_RESEARCH_ENABLED !== 'true') return NextResponse.json({ error: 'La investigación desde Cowork no está habilitada.' }, { status: 503, headers });
    const id = z.string().uuid().parse((await context.params).id);
    const leadId = start
      ? z.object({ leadId: z.string().uuid(), confirm: z.literal(true) }).strict().parse(await req.json()).leadId
      : z.string().uuid().parse(req.nextUrl.searchParams.get('leadId'));
    const result = start ? await startCoworkResearch(auth, id, leadId) : await getCoworkResearchStatus(auth, id, leadId);
    return NextResponse.json(result, { status: start ? 202 : 200, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo consultar o iniciar la investigación. Reintentar conserva la misma solicitud.' }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers });
  }
}
export const GET = (req: NextRequest, context: Context) => handle(req, context, false);
export const POST = (req: NextRequest, context: Context) => handle(req, context, true);
