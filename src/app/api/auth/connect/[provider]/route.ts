import { NextRequest, NextResponse } from 'next/server';
import { startProviderOAuth } from '@/lib/server/provider-oauth';
import { startLinkOAuth } from '@/lib/server/provider-oauth-link';

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== 'google' && provider !== 'azure') return NextResponse.json({ error: 'Invalid provider' }, { status: 404 });
  // From a «Contacto del día» email: the signed link names the person, no session needed (provider-oauth-link.ts).
  const link = req.nextUrl.searchParams.get('enlace');
  return link ? startLinkOAuth(req, provider, link) : startProviderOAuth(req, provider);
}
