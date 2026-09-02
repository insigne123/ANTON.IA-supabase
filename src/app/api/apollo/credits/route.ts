import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ error: 'ENDPOINT_RETIRED' }, { status: 410 });
}
