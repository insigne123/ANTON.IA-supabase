import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireCoworkAccess();
    return NextResponse.json({ available: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = handleAuthError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
