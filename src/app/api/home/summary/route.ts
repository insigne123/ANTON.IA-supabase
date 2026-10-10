import { NextResponse } from 'next/server';

import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import {requireHomeAuth} from '@/lib/server/home-auth';
import {requestAuthErrorResponse} from '@/lib/server/request-auth';
import { loadHomeSummary } from '@/lib/server/home-summary';

export const dynamic = 'force-dynamic';

/** The numbers of «Hoy» (src/lib/server/home-summary.ts), read with the signed-in person's client. */
export async function GET(request:Request) {
  try {
    const { supabase, organizationId, user } = await requireHomeAuth(request);
    const summary = await loadHomeSummary(supabase, { organizationId, userId: user.id });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const authResponse=requestAuthErrorResponse(error);if(authResponse)return authResponse;
    if (error instanceof AuthError) return handleAuthError(error);
    console.error('[home-summary] Failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No pudimos calcular el resumen.' }, { status: 503 });
  }
}
