import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ error: 'APOLLO_PROVIDER_RETIRED' }, { status: 410 });
}
