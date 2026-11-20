import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import { loadCreditPrices } from '@/lib/server/credit-prices';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** What an email and a phone cost in the workspace the person has open: what the buttons that look contacts up say. */
export async function GET(request: Request) {
  try {
    const { organizationId } = await requireHomeAuth(request);
    return NextResponse.json({ prices: await loadCreditPrices(organizationId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error);
  }
}
