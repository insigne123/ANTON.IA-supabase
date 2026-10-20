import { NextResponse } from 'next/server';
import { generateStructured } from '@/ai/openai-json';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, pullDrop } from '@/lib/server/lead-drops';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Today's «Contacto del día» of the signed-in person, in the selected workspace, made now when «Hoy» offers it
 * (src/lib/server/lead-drops.ts, pullDrop): on Tuesdays, Wednesdays and Fridays, whether or not they get it by email, and
 * any day for the first one. Answers { id, status, reason }: «pending» while another request writes it, and why when «empty».
 */
export async function POST(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const generate = (options: Parameters<Parameters<typeof pullDrop>[2]['generate']>[0]) =>
      generateStructured({ ...options, allowDefaultModelFallback: false, maxAttempts: 1 });
    const drop = await pullDrop(getSupabaseAdminClient(), { organizationId, userId: user.id }, { now: new Date(), generate });
    return NextResponse.json(drop, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
  }
}
