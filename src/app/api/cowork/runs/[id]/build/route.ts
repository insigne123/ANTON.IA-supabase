import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { createExecutorBuildProvider, coworkBuildIdentity } from '@/lib/server/cowork/build-provider';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess(), id = (await context.params).id;
    if (!await getCoworkRun(auth, id)) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers });
    if (process.env.COWORK_EXECUTOR_ASYNC_ENABLED !== 'true') return NextResponse.json({ enabled: false }, { headers });
    const job = await createExecutorBuildProvider(process.env.COWORK_EXECUTOR_URL || '', process.env.COWORK_EXECUTOR_SECRET || '').inspect(coworkBuildIdentity(id));
    // Source bytes and supervisor credentials are never sent through status polling.
    return NextResponse.json({ enabled: true, job: job ? { id: job.id, generation: job.generation, status: job.status,
      files: job.result?.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) ?? [] } : null }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo consultar el trabajo; conservamos su identidad.' }, { status: 503, headers });
  }
}
