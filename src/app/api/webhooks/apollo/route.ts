import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({ error: 'APOLLO_PROVIDER_RETIRED' }, { status: 410 });
}
