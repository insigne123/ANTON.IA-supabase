import { NextResponse } from 'next/server';

import { handleAuthError, requireSupliaAuth } from '@/lib/server/auth-utils';
import {
  SupliaReviewInboxError,
  listSupliaReviewItems,
} from '@/lib/server/suplia-review-inbox';

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
  console.error('[SUPLIA/reviews] GET error:', error);
  return NextResponse.json({ error: 'SUPLIA_REVIEW_LIST_FAILED' }, { status: 500, headers: noStore });
}

export async function GET() {
  try {
    const auth = await requireSupliaAuth();
    const items = await listSupliaReviewItems({ organizationId: auth.organizationId, userId: auth.user.id });
    return NextResponse.json({ items }, { headers: noStore });
  } catch (error) {
    return responseError(error);
  }
}
