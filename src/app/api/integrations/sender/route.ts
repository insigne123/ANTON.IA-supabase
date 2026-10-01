import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { resolveMailSender } from '@/lib/server/mail-sender';

export const dynamic = 'force-dynamic';

/** The real sender of the signed-in person for one provider (src/lib/server/mail-sender.ts). */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const raw = req.nextUrl.searchParams.get('provider');
    const provider = raw === 'outlook' ? 'outlook' : raw === 'google' || raw === 'gmail' ? 'google' : null;
    if (!provider) return NextResponse.json({ error: 'provider must be google or outlook' }, { status: 400 });
    return NextResponse.json(await resolveMailSender(user.id, provider), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleAuthError(error);
  }
}
