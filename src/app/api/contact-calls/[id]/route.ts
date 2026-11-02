import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { ContactCallError, recordCallOutcome } from '@/lib/server/contact-calls';
import { CALL_OUTCOME_KEYS } from '@/lib/contact-calls';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
const toAuthError = (error: unknown) => (error instanceof ContactCallError ? new AuthError(error.message, error.status) : error);

const BodySchema = z.object({
  outcome: z.enum(CALL_OUTCOME_KEYS as [string, ...string[]]),
  note: z.string().max(1000).nullable().optional(),
}).strict();

/** How one of the person's own calls went (src/lib/contact-calls.ts). */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth(req);
    const id = z.string().uuid().safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esa llamada.', 404);
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Elige cómo te fue.', 400);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const result = await recordCallOutcome(getSupabaseAdminClient(), scope, id.data, { outcome: body.data.outcome as any, note: body.data.note });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}
