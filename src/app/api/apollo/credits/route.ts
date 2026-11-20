import { NextResponse } from 'next/server';

import { DEFAULT_CREDIT_PRICES } from '@/lib/credit-prices';
import { loadCreditPrices } from '@/lib/server/credit-prices';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  isApolloCreditBalanceStale,
  loadLatestApolloCreditBalance,
} from '@/lib/server/apollo-credit-balance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAuth();
    // What each lookup costs is the organization's (credit-prices.ts); if it cannot be read, the default.
    const prices = await loadCreditPrices(auth.organizationId).catch(() => DEFAULT_CREDIT_PRICES);
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
        emailEnrichment: prices.email,
        phoneEnrichment: prices.phone,
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
