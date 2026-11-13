import { createHash, randomBytes } from 'node:crypto';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { publicAppOrigin, requestAppOrigin } from '@/lib/server/app-origins';
import { tokenService } from '@/lib/services/token-service';

export type Provider = 'google' | 'azure';
/** `link`: started from a «Contacto del día» email, without a session (provider-oauth-link.ts): the signed link names the person. */
export type OAuthAttempt = { state: string; verifier: string; userId: string; redirectUri: string; createdAt: number; link?: string };
const MAX_AGE = 600;
export const oauthCookie = (provider: Provider) => `provider_oauth_${provider}`;
/** The app's own address: the one Google and Microsoft know, so every consent comes back to it. */
export const oauthBase = (req: NextRequest) => new URL(process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin).origin;
/**
 * Where the person is: the public address (APP_PUBLIC_URL, src/lib/server/app-origins.ts) when the request came to it, else the
 * app's own. The session and the attempt's cookie live there, so a consent started there ends there.
 */
export const oauthHome = (req: NextRequest, base: string) => requestAppOrigin(req.headers, base);
/**
 * Marks the state of a consent started at the public address. The providers only know the app's own callback, so the answer lands
 * there first, where there is neither session nor attempt; the mark tells that callback to hand the answer on, unread, to the
 * public address. It is not what protects the attempt: the state is still compared whole with the cookie, and the code is worth
 * nothing without the verifier that cookie keeps.
 */
const PUBLIC_STATE = 'p.';

export function oauthConfig(provider: Provider) {
  const tenant = encodeURIComponent(process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common');
  return provider === 'google' ? {
    clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email profile',
    page: '/gmail',
  } : {
    clientId: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID?.trim(),
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
    authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope: 'offline_access User.Read Mail.Send Mail.Read',
    page: '/outlook',
  };
}

export function readOAuthAttempt(raw: string | undefined, state: string | null, userId: string, redirectUri: string, now = Date.now()): OAuthAttempt | null {
  try {
    const value = JSON.parse(raw || '') as OAuthAttempt;
    if (!state || value.state !== state || value.userId !== userId || value.redirectUri !== redirectUri
      || typeof value.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)
      || !Number.isFinite(value.createdAt) || now < value.createdAt || now - value.createdAt > MAX_AGE * 1000) return null;
    return value;
  } catch { return null; }
}

/**
 * The callback must return to the same host that owns the session and attempt cookies.
 * App Hosting terminates HTTPS before Next. Headers may confirm the configured host,
 * but must never supply an OAuth redirect destination.
 */
export function offCanonicalHost(req: NextRequest, base: string) {
  const canonicalHost = new URL(base).host;
  const servesCanonicalHost = [req.headers.get('host'), req.headers.get('x-forwarded-host')].includes(canonicalHost);
  return req.nextUrl.origin !== base && !servesCanonicalHost;
}

/** The way to the provider's consent, with the attempt kept in a cookie that only this server's callback reads. */
export function beginProviderOAuth(provider: Provider, base: string, userId: string, link?: string, home: string = base) {
  const config = oauthConfig(provider);
  const attempt: OAuthAttempt = {
    state: `${home === base ? '' : PUBLIC_STATE}${randomBytes(32).toString('base64url')}`,
    verifier: randomBytes(32).toString('base64url'),
    userId,
    redirectUri: `${base}/api/auth/callback/${provider}`,
    createdAt: Date.now(),
    ...(link ? { link } : {}),
  };
  const url = new URL(config.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId || '', redirect_uri: attempt.redirectUri, response_type: 'code',
    scope: config.scope, state: attempt.state,
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { response_mode: 'query' }),
  }).toString();
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(oauthCookie(provider), JSON.stringify(attempt), {
    httpOnly: true, secure: home.startsWith('https:'), sameSite: 'lax', path: '/api/auth', maxAge: MAX_AGE,
  });
  return response;
}

export async function startProviderOAuth(req: NextRequest, provider: Provider) {
  const config = oauthConfig(provider);
  const base = oauthBase(req);
  // Signed in at the public address: the consent starts here, where the session is, and comes back here through the app's callback.
  const home = oauthHome(req, base);
  const failure = (error: string) => NextResponse.redirect(new URL(`${config.page}?error=${error}`, home));
  if (home === base && offCanonicalHost(req, base)) return NextResponse.redirect(new URL(req.nextUrl.pathname, base));
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return failure('session_expired');
  if (!config.clientId || !config.clientSecret) return failure('configuration_missing');
  return beginProviderOAuth(provider, base, user.id, undefined, home);
}

/** The code for a refresh token with the permissions the app needs, or why it could not be had. Throws when the provider cannot be reached. */
export async function exchangeProviderCode(provider: Provider, attempt: OAuthAttempt, code: string): Promise<{ refreshToken: string; accessToken: string | null; idToken: string | null } | { error: string }> {
  const config = oauthConfig(provider);
  if (!config.clientId || !config.clientSecret) return { error: 'configuration_missing' };
  const result = await fetch(config.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: attempt.redirectUri, grant_type: 'authorization_code', code_verifier: attempt.verifier,
      ...(provider === 'azure' ? { scope: config.scope } : {}),
    }),
  });
  const tokens = await result.json();
  if (!result.ok) return { error: 'token_exchange_failed' };
  if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) return { error: 'no_refresh_token' };
  // Partial consent must not replace a previously usable automation credential.
  const scopes = new Set(String(tokens.scope || '').toLowerCase().split(/\s+/));
  const required = provider === 'google'
    ? ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']
    : ['mail.send', 'mail.read'];
  if (!required.every((scope) => scopes.has(scope) || scopes.has(`https://graph.microsoft.com/${scope}`))) return { error: 'missing_permissions' };
  const text = (value: unknown) => typeof value === 'string' && value ? value : null;
  return { refreshToken: tokens.refresh_token, accessToken: text(tokens.access_token), idToken: text(tokens.id_token) };
}

export async function finishProviderOAuth(req: NextRequest, provider: Provider) {
  const config = oauthConfig(provider);
  const base = oauthBase(req);
  const home = oauthHome(req, base);
  // A consent started at the public address answers here first: handed on as it came, to the address that holds its session and
  // its attempt. Only ever to the address the server was configured with, and nothing of it is read here.
  if (home === base && req.nextUrl.searchParams.get('state')?.startsWith(PUBLIC_STATE)) {
    const open = publicAppOrigin();
    if (open && open !== base) {
      const response = NextResponse.redirect(new URL(`/api/auth/callback/${provider}${req.nextUrl.search}`, open));
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
  }
  const cookieName = oauthCookie(provider);
  const finish = (params: Record<string, string>) => {
    const url = new URL(config.page, home);
    url.search = new URLSearchParams(params).toString();
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(cookieName, '', { httpOnly: true, secure: home.startsWith('https:'), sameSite: 'lax', path: '/api/auth', maxAge: 0 });
    return response;
  };
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return finish({ error: 'session_expired' });
    const attempt = readOAuthAttempt(req.cookies.get(cookieName)?.value, req.nextUrl.searchParams.get('state'), user.id, `${base}/api/auth/callback/${provider}`);
    if (!attempt) return finish({ error: 'invalid_state' });
    if (req.nextUrl.searchParams.has('error')) return finish({ error: 'consent_denied' });
    const code = req.nextUrl.searchParams.get('code');
    if (!code) return finish({ error: 'no_code' });
    const exchanged = await exchangeProviderCode(provider, attempt, code);
    if ('error' in exchanged) return finish({ error: exchanged.error });
    const saveError = await tokenService.saveToken(supabase, provider === 'google' ? 'google' : 'outlook', exchanged.refreshToken);
    return finish(saveError ? { error: 'db_save_failed' } : { connected: 'true' });
  } catch {
    return finish({ error: 'exchange_failed' });
  }
}
