import { createHash, randomBytes } from 'node:crypto';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { tokenService } from '@/lib/services/token-service';

type Provider = 'google' | 'azure';
type OAuthAttempt = { state: string; verifier: string; userId: string; redirectUri: string; createdAt: number };
const MAX_AGE = 600;

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

export async function startProviderOAuth(req: NextRequest, provider: Provider) {
  const config = oauthConfig(provider);
  const base = new URL(process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin).origin;
  const failure = (error: string) => NextResponse.redirect(new URL(`${config.page}?error=${error}`, base));
  // The callback must return to the same host that owns the session and attempt cookies.
  // App Hosting terminates HTTPS before Next. Headers may confirm the configured host,
  // but must never supply an OAuth redirect destination.
  const canonicalHost = new URL(base).host;
  const servesCanonicalHost = [req.headers.get('host'), req.headers.get('x-forwarded-host')].includes(canonicalHost);
  if (req.nextUrl.origin !== base && !servesCanonicalHost) return NextResponse.redirect(new URL(req.nextUrl.pathname, base));
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return failure('session_expired');
  if (!config.clientId || !config.clientSecret) return failure('configuration_missing');

  const attempt: OAuthAttempt = {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    userId: user.id,
    redirectUri: `${base}/api/auth/callback/${provider}`,
    createdAt: Date.now(),
  };
  const url = new URL(config.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: attempt.redirectUri, response_type: 'code',
    scope: config.scope, state: attempt.state,
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { response_mode: 'query' }),
  }).toString();
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(`provider_oauth_${provider}`, JSON.stringify(attempt), {
    httpOnly: true, secure: base.startsWith('https:'), sameSite: 'lax', path: '/api/auth', maxAge: MAX_AGE,
  });
  return response;
}

export async function finishProviderOAuth(req: NextRequest, provider: Provider) {
  const config = oauthConfig(provider);
  const base = new URL(process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin).origin;
  const cookieName = `provider_oauth_${provider}`;
  const finish = (params: Record<string, string>) => {
    const url = new URL(config.page, base);
    url.search = new URLSearchParams(params).toString();
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(cookieName, '', { httpOnly: true, secure: base.startsWith('https:'), sameSite: 'lax', path: '/api/auth', maxAge: 0 });
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
    if (!config.clientId || !config.clientSecret) return finish({ error: 'configuration_missing' });
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
    if (!result.ok) return finish({ error: 'token_exchange_failed' });
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) return finish({ error: 'no_refresh_token' });
    // Partial consent must not replace a previously usable automation credential.
    const scopes = new Set(String(tokens.scope || '').toLowerCase().split(/\s+/));
    const required = provider === 'google'
      ? ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']
      : ['mail.send', 'mail.read'];
    if (!required.every((scope) => scopes.has(scope) || scopes.has(`https://graph.microsoft.com/${scope}`))) {
      return finish({ error: 'missing_permissions' });
    }
    const saveError = await tokenService.saveToken(supabase, provider === 'google' ? 'google' : 'outlook', tokens.refresh_token);
    return finish(saveError ? { error: 'db_save_failed' } : { connected: 'true' });
  } catch {
    return finish({ error: 'exchange_failed' });
  }
}
