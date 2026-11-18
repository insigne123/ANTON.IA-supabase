import { NextRequest, NextResponse } from 'next/server';
import { decideIdentityReview, IdentityReviewError, judgeIdentityReview } from '@/lib/server/identity-reviews';
import { AuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * A profile search Apollo answered with someone at another LinkedIn address (src/lib/server/identity-reviews.ts), for the person who
 * searched: GET says whom Apollo found and what the AI makes of it (asked once); POST { decision: 'same' | 'different' } decides it.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/**
 * The person and the workspace they have open (requireHomeAuth). The session alone names no workspace: read with it, every review
 * was asked for under the organization «null» and the screen answered «no disponible» to everyone (18 Nov 2026, four reviews of two
 * people in production, none ever read).
 */
async function owner(req: NextRequest) {
  try {
    const auth = await requireHomeAuth(req);
    return { ok: true as const, organizationId: auth.organizationId, userId: auth.user.id as string };
  } catch (error) {
    const response = requestAuthErrorResponse(error);
    if (response) return { ok: false as const, response };
    if (error instanceof AuthError) return { ok: false as const, response: NextResponse.json({ error: 'IDENTITY_REVIEW_FORBIDDEN' }, { status: error.status }) };
    throw error;
  }
}

function failure(error: unknown) {
  if (error instanceof IdentityReviewError) return NextResponse.json({ error: error.code }, { status: error.status });
  console.error('[identity-reviews] unexpected error', { name: error instanceof Error ? error.name : 'unknown' });
  return NextResponse.json({ error: 'IDENTITY_REVIEW_UNAVAILABLE' }, { status: 503 });
}

export async function GET(req: NextRequest, context: Context) {
  try {
    const who = await owner(req);
    if (!who.ok) return who.response;
    const review = await judgeIdentityReview(getSupabaseAdminClient() as any, { id: (await context.params).id, organizationId: who.organizationId, userId: who.userId });
    return NextResponse.json({ review }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest, context: Context) {
  try {
    const who = await owner(req);
    if (!who.ok) return who.response;
    const body = await req.json().catch(() => null) as { decision?: unknown } | null;
    const decision = body?.decision === 'same' || body?.decision === 'different' ? body.decision : null;
    if (!decision) return NextResponse.json({ error: 'IDENTITY_REVIEW_DECISION_REQUIRED' }, { status: 400 });
    const result = await decideIdentityReview(getSupabaseAdminClient() as any, {
      id: (await context.params).id, organizationId: who.organizationId, userId: who.userId, decision,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
