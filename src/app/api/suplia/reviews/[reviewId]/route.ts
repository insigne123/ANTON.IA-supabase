import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireSupliaAuth } from '@/lib/server/auth-utils';
import {
  SupliaReviewInboxError,
  getSupliaReviewItem,
  updateSupliaReviewItemStatus,
} from '@/lib/server/suplia-review-inbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

function responseError(error: unknown, action: string) {
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
  console.error(`[SUPLIA/reviews] ${action} error:`, error);
  return NextResponse.json({ error: 'SUPLIA_REVIEW_REQUEST_FAILED' }, { status: 500, headers: noStore });
}

function reviewIdFrom(params: { reviewId: string }) {
  return String(params.reviewId || '').trim();
}

export async function GET(_req: NextRequest, context: { params: Promise<{ reviewId: string }> }) {
  try {
    const auth = await requireSupliaAuth();
    const reviewId = reviewIdFrom(await context.params);
    if (!reviewId) return NextResponse.json({ error: 'REVIEW_ID_REQUIRED' }, { status: 400, headers: noStore });

    const item = await getSupliaReviewItem({
      organizationId: auth.organizationId,
      reviewId,
      userId: auth.user.id,
    });
    if (!item) return NextResponse.json({ error: 'REVIEW_ITEM_NOT_FOUND' }, { status: 404, headers: noStore });
    return NextResponse.json({ item }, { headers: noStore });
  } catch (error) {
    return responseError(error, 'GET');
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ reviewId: string }> }) {
  try {
    const auth = await requireSupliaAuth();
    const reviewId = reviewIdFrom(await context.params);
    if (!reviewId) return NextResponse.json({ error: 'REVIEW_ID_REQUIRED' }, { status: 400, headers: noStore });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'REVIEW_STATUS_BODY_INVALID' }, { status: 400, headers: noStore });
    }
    const allowedKeys = new Set(['status', 'note']);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return NextResponse.json({ error: 'REVIEW_STATUS_BODY_INVALID' }, { status: 400, headers: noStore });
    }
    if (body.status !== 'dismissed' && body.status !== 'resolved') {
      return NextResponse.json({ error: 'REVIEW_STATUS_INVALID' }, { status: 400, headers: noStore });
    }
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return NextResponse.json({ error: 'REVIEW_NOTE_INVALID' }, { status: 400, headers: noStore });
    }

    const item = await updateSupliaReviewItemStatus({
      organizationId: auth.organizationId,
      userId: auth.user.id,
      reviewId,
      status: body.status,
      note: body.note,
    });
    return NextResponse.json({ item }, { headers: noStore });
  } catch (error) {
    return responseError(error, 'PATCH');
  }
}
