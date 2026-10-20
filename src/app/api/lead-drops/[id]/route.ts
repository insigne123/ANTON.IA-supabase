import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, readDrop, saveDropLeads } from '@/lib/server/lead-drops';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const failure = (error: unknown) => requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
const Id = z.string().uuid();

/** «Contactos de la semana» (src/lib/lead-drops.ts) of the signed-in person: never the email or the phone before they save them. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esos contactos.', 404);
    const admin = getSupabaseAdminClient();
    const drop = await readDrop(admin, { organizationId, userId: user.id }, id.data);
    if (!drop.opened_at) await admin.from('lead_drops').update({ opened_at: new Date().toISOString() }).eq('id', drop.id);
    return NextResponse.json({ id: drop.id, date: drop.drop_date, criteria: drop.criteria, items: drop.items }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const BodySchema = z.object({ action: z.literal('save'), leadIds: z.array(z.string().regex(/^lf_[0-9a-f]{24}$/)).max(10).optional() }).strict();

/** Saves contacts of the drop in «Por escribir», with their email, without credits. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esos contactos.', 404);
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const result = await saveDropLeads(getSupabaseAdminClient(), { organizationId, userId: user.id }, id.data, body.data.leadIds);
    return NextResponse.json({ saved: result.saved.length, expired: result.expired.length, items: result.items }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
