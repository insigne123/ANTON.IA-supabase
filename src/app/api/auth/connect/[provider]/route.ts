import { NextRequest, NextResponse } from 'next/server';
import { startProviderOAuth } from '@/lib/server/provider-oauth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== 'google' && provider !== 'azure') return NextResponse.json({ error: 'Invalid provider' }, { status: 404 });
  return startProviderOAuth(req, provider);
}
