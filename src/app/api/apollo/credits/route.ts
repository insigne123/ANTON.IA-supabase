import { NextResponse } from 'next/server';

import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  isApolloCreditBalanceStale,
  loadLatestApolloCreditBalance,
} from '@/lib/server/apollo-credit-balance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAuth();
    const balance = await loadLatestApolloCreditBalance();
    if (!balance) {
      return NextResponse.json({ error: 'APOLLO_CREDIT_BALANCE_UNAVAILABLE' }, { status: 503 });
    }

    return NextResponse.json({
      scope: 'shared',
      balance: {
        ...balance,
        stale: isApolloCreditBalanceStale(balance),
      },
      costs: {
        emailEnrichment: APOLLO_EMAIL_ENRICHMENT_CREDITS,
        phoneEnrichment: APOLLO_PHONE_ENRICHMENT_CREDITS,
      },
    }, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    if ((error as any)?.name === 'AuthError') return handleAuthError(error);
    console.error('[apollo/credits] load failed', error);
    return NextResponse.json({ error: 'APOLLO_CREDIT_BALANCE_FAILED' }, { status: 500 });
  }
}
