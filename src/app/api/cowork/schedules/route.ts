import { NextRequest, NextResponse } from 'next/server';
import { COWORK_SCHEDULE_LIMITS } from '@/lib/cowork/schedules';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { createCoworkSchedule, coworkSchedulesEnabled, listCoworkSchedules } from '@/lib/server/cowork/schedules';
import { coworkScheduleErrorResponse, coworkScheduleHeaders as headers, coworkSchedulesOffResponse } from '@/lib/server/cowork/schedules-http';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const limits = { active: COWORK_SCHEDULE_LIMITS.active };

/** The person's scheduled tasks, read with their own session. `enabled: false` while the feature is off or its table is not there yet. */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkSchedulesEnabled()) return NextResponse.json({ enabled: false, tasks: [], limits }, { headers });
    const { available, tasks } = await listCoworkSchedules(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId });
    return NextResponse.json({ enabled: available, tasks, limits }, { headers });
  } catch (error) {
    return coworkScheduleErrorResponse(error);
  }
}

/** Schedules a task. Everything in the body is checked on the server; the owner is always the signed-in person. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkSchedulesEnabled()) return coworkSchedulesOffResponse();
    const task = await createCoworkSchedule(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }, await request.json().catch(() => null));
    return NextResponse.json({ task }, { status: 201, headers });
  } catch (error) {
    return coworkScheduleErrorResponse(error);
  }
}
