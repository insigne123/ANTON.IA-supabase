import { NextRequest, NextResponse } from 'next/server';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { searchCoworkThreads } from '@/lib/server/cowork/thread-search';
import { readCoworkThreadSettings } from '@/lib/server/cowork/thread-settings';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** «Buscar conversaciones» in what was asked and answered, not only in the names (COW-09). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCoworkAccess();
    const settings = await readCoworkThreadSettings(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId })
      .catch(() => ({ hiddenRootIds: [] as string[] }));
    const matches = await searchCoworkThreads(auth, request.nextUrl.searchParams.get('q') || '', { hiddenRootIds: settings.hiddenRootIds });
    return NextResponse.json({ matches }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    console.error('[cowork/threads/search]', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return NextResponse.json({ error: 'No pudimos buscar en tus conversaciones.' }, { status: 503, headers });
  }
}
