import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireSupliaAuth } from '@/lib/server/auth-utils';
import { SupliaReviewInboxError, approveSupliaReviewEmail } from '@/lib/server/suplia-review-inbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

function responseError(error: unknown) {
  if ((error as any)?.name === 'AuthError') {
    const response = handleAuthError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (error instanceof SupliaReviewInboxError) {
    return NextResponse.json({
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    }, { status: error.status, headers: noStore });
  }
  console.error('[SUPLIA/reviews] approve error:', error);
  return NextResponse.json({ error: 'SUPLIA_REVIEW_APPROVE_FAILED' }, { status: 500, headers: noStore });
}

export async function POST(req: NextRequest, context: { params: Promise<{ reviewId: string }> }) {
  try {
    const auth = await requireSupliaAuth();
    const { reviewId: rawReviewId } = await context.params;
    const reviewId = String(rawReviewId || '').trim();
    if (!reviewId) return NextResponse.json({ error: 'REVIEW_ID_REQUIRED' }, { status: 400, headers: noStore });

    const body = await req.json().catch(() => null);
    const versionId = typeof body?.versionId === 'string' ? body.versionId.trim() : '';
    if (!versionId) return NextResponse.json({ error: 'REVIEW_DRAFT_VERSION_REQUIRED' }, { status: 400, headers: noStore });

    const draft = await approveSupliaReviewEmail({
      organizationId: auth.organizationId,
      userId: auth.user.id,
      reviewId,
      versionId,
    });
    return NextResponse.json({ ok: true, draft }, { headers: noStore });
  } catch (error) {
    return responseError(error);
  }
}
