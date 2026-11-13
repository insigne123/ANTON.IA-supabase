import { NextRequest } from 'next/server';
import { finishProviderOAuth, oauthCookie } from '@/lib/server/provider-oauth';
import { attemptLink, finishLinkOAuth } from '@/lib/server/provider-oauth-link';

export async function GET(req: NextRequest) {
  // An attempt started from a «Contacto del día» email carries its signed link: it ends without a session.
  const link = attemptLink(req.cookies.get(oauthCookie('azure'))?.value);
  return link ? finishLinkOAuth(req, 'azure', link) : finishProviderOAuth(req, 'azure');
}
