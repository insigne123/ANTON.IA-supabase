import { NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDebugApiEnabled() {
  return process.env.NODE_ENV !== 'production' || String(process.env.DEBUG_API_ENABLED || '').trim() === 'true';
}

export async function GET() {
  if (!isDebugApiEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    await requireAuth();
  } catch (error) {
    return handleAuthError(error);
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'APIFY_TOKEN missing' }, { status: 500 });

  const r = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ ok: false, status: r.status, body: j }, { status: r.status });

  return NextResponse.json({
    ok: true,
    info: {
      username: j?.data?.username,
      userId: j?.data?.id,
      email: j?.data?.email,
    },
  });
}
