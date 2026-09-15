import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const body = z.object({ approve: z.boolean() }).strict().parse(await req.json());
    const { data, error } = await getSupabaseAdminClient().rpc('cowork_resolve_note', {
      p_run_id: id, p_user_id: auth.user.id, p_organization_id: auth.organizationId, p_approve: body.approve,
    });
    if (error?.code === '40001') return NextResponse.json({ error: 'La nota cambió desde la propuesta. Descarta este cambio y solicita una nueva revisión.' }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ resolved: data === true }, { status: data === true ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo resolver la propuesta.' }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}
