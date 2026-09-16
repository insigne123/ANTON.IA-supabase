import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { admitCoworkRun, coworkWorkerConfigured, listCoworkRuns } from '@/lib/server/cowork/runs';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json({ runs: await listCoworkRuns(auth), canSubmit: coworkWorkerConfigured(), canAutonomous: process.env.COWORK_AUTONOMY_ENABLED === 'true' }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudieron cargar los trabajos.' }, { status: 503, headers });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkWorkerConfigured()) return NextResponse.json({ error: 'El procesamiento de trabajos aún no está disponible.' }, { status: 503, headers });
    const raw = await req.text();
    if (raw.length > 100000) return NextResponse.json({ error: 'El mensaje es demasiado largo.' }, { status: 413, headers });
    const id = await admitCoworkRun(auth, JSON.parse(raw));
    return NextResponse.json({ id }, { status: 202, headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Revisa el mensaje y vuelve a intentarlo.' }, { status: 400, headers });
    if (error instanceof Error && error.message === 'COWORK_AUTONOMY_UNAVAILABLE') return NextResponse.json({ error: 'El modo autónomo no está disponible. Selecciona Con aprobaciones.' }, { status: 409, headers });
    if ((error as { code?: string })?.code === '22023') return NextResponse.json({ error: 'Esta solicitud ya corresponde a otro mensaje.' }, { status: 409, headers });
    return NextResponse.json({ error: 'No se pudo guardar el trabajo. Puedes reintentar la misma solicitud.' }, { status: 503, headers });
  }
}
