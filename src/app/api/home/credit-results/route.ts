import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { homeScope } from '@/lib/home/scope';
import { dayInZone, dayStartInZone } from '@/lib/admin/chile-time';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { CreditResultsError, readCreditResults } from '@/lib/server/credit-results';
import { EMPTY_OUTCOMES, monthName, monthStartOf } from '@/lib/credit-results';

export const dynamic = 'force-dynamic';

/** «Tus créditos este mes» in «Hoy» (src/lib/credit-results.ts): the person's own month, from the 1st in Chile until now. */
export async function GET(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const now = new Date();
    const today = dayInZone(now);
    const results = await readCreditResults(getSupabaseAdminClient(), {
      organizationId,
      from: dayStartInZone(monthStartOf(today)).toISOString(),
      to: now.toISOString(),
      userIds: [user.id],
      now,
    });
    const mine = results.people.find(person => person.userId === user.id);
    const { userId: _userId, ...outcomes } = mine || { userId: user.id, ...EMPTY_OUTCOMES };
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), month: monthName(today), ...outcomes },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CreditResultsError) return NextResponse.json({ error: error.message }, { status: error.status });
    return requestAuthErrorResponse(error) || handleAuthError(error);
  }
}
