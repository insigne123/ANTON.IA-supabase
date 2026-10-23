import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { coworkSchedulesEnabled, runCoworkScheduleNow } from '@/lib/server/cowork/schedules';
import { coworkScheduleErrorResponse, coworkScheduleHeaders as headers, coworkSchedulesOffResponse } from '@/lib/server/cowork/schedules-http';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** «Ejecutar ahora»: starts the conversation of one of the person's tasks right away, without moving its schedule. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkSchedulesEnabled()) return coworkSchedulesOffResponse();
    const { runId } = await runCoworkScheduleNow(getSupabaseAdminClient() as never, { userId: auth.user.id, organizationId: auth.organizationId }, (await params).id);
    return NextResponse.json({ runId }, { status: 202, headers });
  } catch (error) {
    return coworkScheduleErrorResponse(error);
  }
}
