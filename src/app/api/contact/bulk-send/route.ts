import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json({ error: 'Endpoint temporarily disabled due to build issues' }, { status: 503 });
}
