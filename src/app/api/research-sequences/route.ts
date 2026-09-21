import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { getNativeSnapshot } from '@/lib/server/native-research';
import { ResearchSequenceRequestSchema } from '@/lib/research-sequence-contracts';
import { enqueueResearchSequence, processResearchSequenceQueue, readResearchSequence, researchSequenceView, retryResearchSequence } from '@/lib/server/research-sequence-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function wake(id: string) {
  // Latency optimization only. The scheduled worker owns recovery if this
  // request ends or the process is killed before after() can run.
  after(async () => {
    try { await processResearchSequenceQueue({ jobId: id }); }
    catch (error) { console.error('[research-sequences] wake failed', { jobId: id }); }
  });
}

function failure(error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return handleAuthError(error);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  if (error instanceof Error && error.message === 'CAMPAIGNS_V2_DISABLED') return NextResponse.json({ error: 'La preparación de secuencias no está habilitada para esta organización.' }, { status: 409 });
  console.error('[research-sequences] request failed', error);
  return NextResponse.json({ error: 'No pudimos cargar o guardar la preparación. Inténtalo nuevamente.' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const request = ResearchSequenceRequestSchema.parse(await req.json());
    const snapshot = await getNativeSnapshot({ snapshotId: request.researchSnapshotId, access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id } });
    if (!snapshot) return NextResponse.json({ error: 'Investigación no encontrada.' }, { status: 404 });
    const id = await enqueueResearchSequence({ organizationId: snapshot.organization_id, userId: auth.user.id }, request);
    wake(id);
    return NextResponse.json({ id, url: `/contact/sequence?jobId=${encodeURIComponent(id)}` }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get('jobId'));
    const job = await readResearchSequence(id, auth.user.id, auth.organizationIds);
    if (!job) return NextResponse.json({ error: 'Preparación no encontrada.' }, { status: 404 });
    const view = await researchSequenceView(job);
    if (['queued', 'retry_scheduled', 'running'].includes(job.status)) wake(id);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(await req.json());
    const job = await readResearchSequence(jobId, auth.user.id, auth.organizationIds);
    if (!job) return NextResponse.json({ error: 'Preparación no encontrada.' }, { status: 404 });
    await retryResearchSequence(job);
    wake(jobId);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
