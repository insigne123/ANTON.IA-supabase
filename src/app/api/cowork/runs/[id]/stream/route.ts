import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkRunCursor } from '@/lib/server/cowork/runs';
import { coworkStreamFrames } from '@/lib/server/cowork/run-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

/**
 * Live doorbell for one run: a server-sent event each time its status or its
 * latest event changes, so the page refreshes right away instead of on its
 * next poll. It carries no content; the page reads the run through GET
 * /api/cowork/runs/[id] as always, and falls back to polling if this fails.
 */
export async function GET(req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const id = (await context.params).id;
    const first = await getCoworkRunCursor(auth, id);
    if (!first) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers });
    // The request's cookies are gone once the response starts streaming: later
    // reads use the same verified session through its token, still under RLS.
    const { data: { session } } = await auth.supabase.auth.getSession();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!session?.access_token || !url || !anonKey) throw new AuthError('Unauthorized', 401);
    const reader = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const scoped = { ...auth, supabase: reader };
    const frames = coworkStreamFrames({ first, read: () => getCoworkRunCursor(scoped, id), signal: req.signal });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await frames.next().catch(() => ({ done: true as const, value: undefined }));
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
      async cancel() { await frames.return(undefined); },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform keeps compression from buffering the frames.
        'Cache-Control': 'private, no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo seguir el trabajo.' }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
