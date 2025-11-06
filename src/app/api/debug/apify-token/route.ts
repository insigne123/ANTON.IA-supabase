import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'APIFY_TOKEN missing' }, { status: 500 });

  const r = await fetch(`https://api.apify.com/v2/me?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
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
