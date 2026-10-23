import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { coworkSchedulesEnabled, deleteCoworkSchedule, updateCoworkSchedule } from '@/lib/server/cowork/schedules';
import { coworkScheduleErrorResponse, coworkScheduleHeaders as headers, coworkSchedulesOffResponse } from '@/lib/server/cowork/schedules-http';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Pauses, resumes, renames or re-times one of the person's tasks. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkSchedulesEnabled()) return coworkSchedulesOffResponse();
    const task = await updateCoworkSchedule(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }, (await params).id, await request.json().catch(() => null));
    return NextResponse.json({ task }, { headers });
  } catch (error) {
    return coworkScheduleErrorResponse(error);
  }
}

/** Deletes one of the person's tasks. The conversations it already started stay where they are. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    if (!coworkSchedulesEnabled()) return coworkSchedulesOffResponse();
    await deleteCoworkSchedule(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }, (await params).id);
    return NextResponse.json({ deleted: true }, { headers });
  } catch (error) {
    return coworkScheduleErrorResponse(error);
  }
}
