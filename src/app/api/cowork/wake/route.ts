import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { coworkWorkerConfigured } from '@/lib/server/cowork/runs';
import { processCoworkQueue } from '@/lib/server/cowork/worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const headers = { 'Cache-Control': 'private, no-store' };
let inflight: Promise<number> | null = null;
/** The hosting front closes a request with a 502 at 30 s: answer before that and let the step finish on its own. */
const WAKE_ANSWER_MS = 25_000;

/**
 * Latency optimization only. While the owner has the workspace open, it asks
 * the worker to take the next queued step now (a new message, an approved
 * effect, the continuation that follows it) instead of waiting for the
 * minute scheduler. Claims are atomic (FOR UPDATE SKIP LOCKED plus leases), so
 * running next to the scheduler is safe, and the scheduler still owns
 * recovery. The request stays open while it works so the platform keeps CPU
 * allocated. Set COWORK_INLINE_WAKE=false to rely on the scheduler alone.
 */
async function drain() {
  const started = Date.now();
  let processed = 0;
  for (let step = 0; step < 3 && Date.now() - started < 60_000; step++) {
    const result = await processCoworkQueue();
    if (!result.processed) break;
    processed += result.processed;
  }
  return processed;
}

export async function POST() {
  try {
    await requireCoworkAccess();
    if (process.env.COWORK_INLINE_WAKE === 'false' || !coworkWorkerConfigured()) {
      return NextResponse.json({ woken: false }, { status: 202, headers });
    }
    if (inflight) return NextResponse.json({ woken: false, busy: true }, { status: 202, headers });
    // A failure after the answer has nobody to reach: it is swallowed here and the scheduler still owns recovery.
    const running = drain().catch(() => 0).finally(() => { inflight = null; });
    inflight = running;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const processed = await Promise.race([running, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), WAKE_ANSWER_MS); })])
      .finally(() => clearTimeout(timer));
    // A long step keeps running (the page keeps polling, so the instance keeps working); the next wake finds it busy.
    if (processed === null) return NextResponse.json({ woken: true, working: true }, { status: 202, headers });
    return NextResponse.json({ woken: true, processed }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    // The scheduler will pick the work up; the client keeps polling.
    return NextResponse.json({ woken: false }, { status: 202, headers });
  }
}
