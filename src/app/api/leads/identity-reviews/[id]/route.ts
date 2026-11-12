import { NextRequest, NextResponse } from 'next/server';
import { decideIdentityReview, IdentityReviewError, judgeIdentityReview } from '@/lib/server/identity-reviews';
import { requestAuthErrorResponse, requireSessionRequestAuth } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * A profile search Apollo answered with someone at another LinkedIn address (src/lib/server/identity-reviews.ts), for the person who
 * searched: GET says whom Apollo found and what the AI makes of it (asked once); POST { decision: 'same' | 'different' } decides it.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function owner(req: NextRequest) {
  try {
    const ctx = await requireSessionRequestAuth(req);
    return { ok: true as const, organizationId: ctx.organizationId as string, userId: ctx.user.id as string };
  } catch (error) {
    const response = requestAuthErrorResponse(error);
    if (response) return { ok: false as const, response };
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
