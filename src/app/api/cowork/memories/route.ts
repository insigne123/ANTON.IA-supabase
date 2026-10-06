import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { listCoworkMemories } from '@/lib/server/cowork/memories';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** What Cowork remembers for you and your organization. */
export async function GET() {
  try {
    const auth = await requireCoworkAccess();
    return NextResponse.json({ memories: await listCoworkMemories(auth) }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No pudimos leer lo que Cowork recuerda. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
