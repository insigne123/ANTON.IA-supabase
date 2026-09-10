import { NextResponse } from 'next/server';
import { requireSessionOrTrustedInternalRequest, requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function checkpoint(request: Request, write: boolean) {
  try {
    const auth = await requireSessionOrTrustedInternalRequest(request);
    if (!auth.organizationId) return reply({ error: 'ORGANIZATION_REQUIRED' }, 403);
    const db = getSupabaseAdminClient() as any;
    const scope = { organization_id: auth.organizationId, user_id: auth.user.id };
    if (!write) {
      const { data, error } = await db.from('search_workspace_checkpoints').select('revision,snapshot').match(scope).maybeSingle();
      if (error) return reply({ error: 'CHECKPOINT_UNAVAILABLE' }, 503);
      return reply({ revision: data?.revision ?? 0, snapshot: data?.snapshot ?? null, scope: `${auth.organizationId}:${auth.user.id}` });
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 4000000) return reply({ error: 'CHECKPOINT_TOO_LARGE' }, 413);
    const body = JSON.parse(text);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !body.snapshot || typeof body.snapshot !== 'object' || Array.isArray(body.snapshot)) return reply({ error: 'INVALID_CHECKPOINT' }, 400);
    // Compare-and-swap prevents an old tab overwriting a newer checkpoint.
    const values = { snapshot: body.snapshot, revision: body.revision + 1, updated_at: new Date().toISOString() };
    const result = body.revision === 0
      ? await db.from('search_workspace_checkpoints').insert({ ...scope, ...values }).select('revision').single()
      : await db.from('search_workspace_checkpoints').update(values).match(scope).eq('revision', body.revision).select('revision').maybeSingle();
    if (result.error?.code === '23505' || (!result.error && !result.data)) return reply({ error: 'CHECKPOINT_CONFLICT' }, 409);
    if (result.error) return reply({ error: 'CHECKPOINT_UNAVAILABLE' }, 503);
    return reply({ revision: result.data.revision });
  } catch (error) {
    return requestAuthErrorResponse(error) || reply({ error: 'INVALID_CHECKPOINT' }, 400);
  }
}
export const GET = (request: Request) => checkpoint(request, false);
export const PUT = (request: Request) => checkpoint(request, true);
