import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { CoworkBatchRefusal, readCoworkLinkedinBatchPreview, setCoworkLinkedinBatchExclusions } from '@/lib/server/cowork/linkedin-batch';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const BATCH_KINDS = new Set(['linkedin_invite_batch', 'linkedin_message_batch']);

/** The effect proposed in this work, when it is a batch of LinkedIn invitations or messages: its target pins the staged list. */
async function proposedBatch(auth: Awaited<ReturnType<typeof requireCoworkAccess>>, runId: string) {
  const state = await getCoworkRun(auth, runId);
  if (!state) return { error: NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders }) };
  const proposal = state.events.slice().reverse()
    .find((event: { kind: string }) => event.kind === 'approval.requested')?.payload as { action?: string; kind?: string; targetId?: string } | undefined;
  if (!proposal || proposal.action !== 'cowork.effect' || !BATCH_KINDS.has(String(proposal.kind))) {
    return { error: NextResponse.json({ error: 'No hay un lote propuesto en este trabajo.' }, { status: 409, headers: privateHeaders }) };
  }
  return { targetId: String(proposal.targetId || '') };
}

/** Scoped preview of the staged batch: who is in it with what each one gets, who waits for another day and why, who was taken off,
 * and once it ran what happened to each person. Never queues anything. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = z.string().uuid().parse((await context.params).id);
    const found = await proposedBatch(auth, runId);
    if (found.error) return found.error;
    const preview = await readCoworkLinkedinBatchPreview(auth, runId, found.targetId);
    if (!preview) return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    return NextResponse.json(preview, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo cargar la vista previa.' }, { status: error instanceof z.ZodError ? 400 : 503, headers: privateHeaders });
  }
}

/** The people taken off the card, recorded just before the approval. Only while the proposal awaits the decision. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = z.string().uuid().parse((await context.params).id);
    const body = z.object({ excluded: z.array(z.string().uuid()).max(50) }).strict().parse(await req.json());
    const found = await proposedBatch(auth, runId);
    if (found.error) return found.error;
    return NextResponse.json(await setCoworkLinkedinBatchExclusions(auth, runId, body.excluded), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if (error instanceof CoworkBatchRefusal) return NextResponse.json({ error: error.message }, { status: 409, headers: privateHeaders });
    return NextResponse.json({ error: 'No se pudo guardar a quién quitaste.' },
      { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers: privateHeaders });
  }
}
