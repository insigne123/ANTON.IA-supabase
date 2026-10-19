import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { TouchError } from '@/lib/server/touches';
import { attachCallRecording } from '@/lib/server/touch-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

/** A call's recording (up to 25 MB): transcribed, summarized for the CRM and discarded; only the text stays. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const id = z.string().uuid().parse((await context.params).id);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new AuthError('Adjunta la grabación de la llamada.', 400);
    const duration = Number(form?.get('duration') || 0);
    const result = await attachCallRecording(getSupabaseAdminClient(), { organizationId: auth.organizationId, userId: auth.user.id }, id,
      { bytes: await file.arrayBuffer(), name: file.name, type: file.type, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleAuthError(error instanceof TouchError ? new AuthError(error.message, error.status) : error);
  }
}
