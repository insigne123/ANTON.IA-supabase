import { NextRequest, NextResponse } from 'next/server';
import { dropLinkBase, dropLinkHref } from '@/lib/server/lead-drop-link';
import { resolveDropLink } from '@/lib/server/lead-drop-mail';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { beginProviderOAuth, exchangeProviderCode, oauthBase, oauthConfig, oauthCookie, offCanonicalHost, readOAuthAttempt, type Provider } from '@/lib/server/provider-oauth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { tokenService } from '@/lib/services/token-service';

/**
 * Gmail or Outlook connected from a «Contacto del día» email, without signing in (13 Nov 2026, docs/contacto-del-dia.md): the first
 * time a person approves a campaign from their inbox they have no mailbox connected, and sending them to «Conexiones» would be
 * sending them to learn the app. The signed link of the email names the person (lead-drop-link.ts); it is checked when the consent
 * starts and again when it comes back, so the cookie alone never says for whom the mailbox is. Only a person with no mailbox at all
 * connects one this way: a link never replaces a mailbox that already sends.
 *
 * The mailbox must be the account's own: its address has to be the email the person signs in with. Whoever consents at Google or
 * Microsoft is whoever holds the browser, not necessarily whoever the link names: a link passed on («conecta tu correo aquí») would
 * otherwise tie a stranger's mailbox to the account that sent it. The sign-in email is the one address the account has proved; the
 * address its emails go to (profiles.email) is the person's to change, so it proves nothing. Another mailbox is connected from the app.
 */

/** The link an attempt was started with, read from its cookie before anything is trusted. */
export function attemptLink(raw: string | undefined): string | null {
  try {
    const link = (JSON.parse(raw || '') as { link?: unknown }).link;
    return typeof link === 'string' && link ? link : null;
  } catch { return null; }
}

const hasMailbox = async (userId: string) => {
  const mailbox = await readMailSenderPreference(getSupabaseAdminClient(), userId);
  return mailbox.connected.google || mailbox.connected.outlook;
};
/** The addresses of the mailbox that just consented, in lower case: Google says it in the id token, Microsoft in the profile. */
async function mailboxAddresses(provider: Provider, tokens: { accessToken: string | null; idToken: string | null }): Promise<string[]> {
  const clean = (values: unknown[]) => [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(value => value.includes('@')))];
  if (provider === 'google') {
    try {
      // Straight from Google's token endpoint over TLS: read, not verified again.
      const claims = JSON.parse(Buffer.from(String(tokens.idToken || '').split('.')[1] || '', 'base64url').toString('utf8')) as { email?: unknown; email_verified?: unknown };
      return claims.email_verified === false ? [] : clean([claims.email]);
    } catch { return []; }
  }
  if (!tokens.accessToken) return [];
  const response = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return [];
  const me = await response.json().catch(() => null) as { mail?: unknown; userPrincipalName?: unknown } | null;
  return clean([me?.mail, me?.userPrincipalName]);
}
/** The email the person signs in with: the one address the account has proved. */
async function signInEmail(userId: string): Promise<string | null> {
  const found = await getSupabaseAdminClient().auth.admin.getUserById(userId);
  const email = String(found.data?.user?.email || '').trim().toLowerCase();
  return !found.error && email ? email : null;
}
/**
 * Back to the contacts, saying how it went: «conectado», «cancelado», «otro» (not the account's own mailbox) or «error». The consent
 * runs on the app's own address, the one Google and Microsoft know; the person goes back to the address their email opened.
 */
const back = (base: string, token: string, state: 'conectado' | 'cancelado' | 'otro' | 'error') => {
  const response = NextResponse.redirect(new URL(`${dropLinkHref(token)}?correo=${state}`, dropLinkBase(base)));
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export async function startLinkOAuth(req: NextRequest, provider: Provider, token: string) {
  const base = oauthBase(req);
  if (offCanonicalHost(req, base)) return NextResponse.redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, base));
  const link = await resolveDropLink(getSupabaseAdminClient(), token).catch(() => null);
  // Not a link of ours, or expired: its page says so.
  if (!link) return NextResponse.redirect(new URL(dropLinkHref(encodeURIComponent(token.slice(0, 64))), dropLinkBase(base)));
  const config = oauthConfig(provider);
  if (!config.clientId || !config.clientSecret) return back(base, token, 'error');
  if (await hasMailbox(link.scope.userId)) return back(base, token, 'conectado');
  return beginProviderOAuth(provider, base, link.scope.userId, token);
}

export async function finishLinkOAuth(req: NextRequest, provider: Provider, token: string) {
  const base = oauthBase(req);
  const cookieName = oauthCookie(provider);
  const finish = (state: Parameters<typeof back>[2]) => {
    const response = back(base, token, state);
    response.cookies.set(cookieName, '', { httpOnly: true, secure: base.startsWith('https:'), sameSite: 'lax', path: '/api/auth', maxAge: 0 });
    return response;
  };
  try {
    const link = await resolveDropLink(getSupabaseAdminClient(), token).catch(() => null);
    if (!link) return finish('error');
    const attempt = readOAuthAttempt(req.cookies.get(cookieName)?.value, req.nextUrl.searchParams.get('state'), link.scope.userId, `${base}/api/auth/callback/${provider}`);
    if (!attempt) return finish('error');
    if (req.nextUrl.searchParams.has('error')) return finish('cancelado');
    const code = req.nextUrl.searchParams.get('code');
    if (!code) return finish('error');
    const exchanged = await exchangeProviderCode(provider, attempt, code);
    if ('error' in exchanged) return finish('error');
    // Connected meanwhile from the app: that mailbox stays, this consent is dropped.
    if (await hasMailbox(link.scope.userId)) return finish('conectado');
    // The account's own mailbox only (see the top of this file): anyone else's consent is dropped, and nothing is kept.
    const own = await signInEmail(link.scope.userId);
    if (!own || !(await mailboxAddresses(provider, exchanged)).includes(own)) return finish('otro');
    const saveError = await tokenService.saveTokenFor(link.scope.userId, provider === 'google' ? 'google' : 'outlook', exchanged.refreshToken);
    return finish(saveError ? 'error' : 'conectado');
  } catch {
    return finish('error');
  }
}
