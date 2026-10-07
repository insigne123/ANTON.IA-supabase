import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { COWORK_TASK_EVENTS, parseCoworkTaskTarget } from '@/lib/server/cowork/task-state';
import { coworkTaskPlanSchema } from '@/lib/cowork/task-plan';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** The plan of a long task proposed in this work (Plan 13, 4c), as its card shows it: the one its proposal pins. Never runs anything. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = z.string().uuid().parse((await context.params).id);
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const events = state.events as Array<{ kind: string; payload: unknown }>;
    const proposal = events.slice().reverse().find(event => event.kind === 'approval.requested')?.payload as { action?: string; kind?: string; targetId?: string } | undefined;
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'task_plan') {
      return NextResponse.json({ error: 'No hay un plan de tarea en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const { hash } = parseCoworkTaskTarget(String(proposal.targetId || ''));
    const staged = events.find(event => event.kind === COWORK_TASK_EVENTS.plan && (event.payload as { hash?: unknown } | null)?.hash === hash);
    const plan = coworkTaskPlanSchema.safeParse((staged?.payload as { plan?: unknown } | undefined)?.plan);
    if (!plan.success) return NextResponse.json({ error: 'El plan ya no está disponible.' }, { status: 409, headers: privateHeaders });
    return NextResponse.json({ plan: plan.data }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo cargar el plan.' }, { status: error instanceof z.ZodError ? 400 : 503, headers: privateHeaders });
  }
}
