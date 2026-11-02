import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { ContactCallError, readLastCalls, startContactCall } from '@/lib/server/contact-calls';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const toAuthError = (error: unknown) => (error instanceof ContactCallError ? new AuthError(error.message, error.status) : error);

const LeadIds = z.string().max(20_000).transform(value => value.split(',').map(id => id.trim()).filter(Boolean)).pipe(z.array(z.string().max(120)).max(500));

/** «Llamar» y «WhatsApp» (src/lib/contact-calls.ts): `?leads=a,b` reads the last call of each saved contact, for «Por escribir». */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const leads = LeadIds.safeParse(req.nextUrl.searchParams.get('leads') || '');
    if (!leads.success) throw new AuthError('Solicitud no válida.', 400);
    const last = await readLastCalls(getSupabaseAdminClient(), auth.organizationId, leads.data);
    return NextResponse.json({ last: Object.fromEntries(last) }, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}

const StartSchema = z.object({
  id: z.string().uuid(),
  channel: z.enum(['call', 'whatsapp']),
  leadId: z.string().trim().max(120).nullable().optional(),
  providerPersonId: z.string().trim().max(120).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
}).strict();

/** A call or WhatsApp the person just started from ANTON.IA. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const body = StartSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    return NextResponse.json(await startContactCall(getSupabaseAdminClient(), scope, body.data), { status: 201, headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}
