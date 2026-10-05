import { NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { crmDealValuesEnabled } from '@/lib/server/crm-deal-values';

export const dynamic = 'force-dynamic';

/**
 * Whether the pipeline shows and saves the value of each deal (Plan 11, PR 4c). Off until the maintainer applies the
 * migration that adds the columns and sets CRM_DEAL_VALUES_ENABLED=true: with it off, the app never asks for them.
 */
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ enabled: crmDealValuesEnabled() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}
