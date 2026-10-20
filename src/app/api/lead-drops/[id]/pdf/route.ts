import { z } from 'zod';
import { NextResponse } from 'next/server';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { dropHref } from '@/lib/lead-drops';
import { LeadDropsError, dropPdf, readDrop } from '@/lib/server/lead-drops';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The drop as the PDF of the email: why each contact fits, the brief research and the first email. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const id = z.string().uuid().safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esos contactos.', 404);
    const admin = getSupabaseAdminClient();
    const drop = await readDrop(admin, { organizationId, userId: user.id }, id.data);
    const profile: any = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const origin = new URL(request.url).origin;
    const pdf = await dropPdf(drop.items, { name: String(profile.data?.full_name || '').trim().split(/\s+/)[0] || '', date: drop.drop_date, link: `${origin}${dropHref(drop.id)}` });
    return new NextResponse(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="contactos-de-la-semana-${drop.drop_date}.pdf"`, 'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
  }
}
