// Sessions for the audit personas: an unsigned JWT (the stand-in never checks signatures) and the auth cookie the app's
// middleware and Supabase clients read. The refresh token names the persona, so a refresh returns the same user.
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function mintAccessToken(user, { now = Date.now(), ttlSeconds = 24 * 3600 } = {}) {
  const iat = Math.floor(now / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat, exp: iat + ttlSeconds, session_id: `audit-${user.id}` })}.audit`;
}

export function sessionFor(user, options) {
  const accessToken = mintAccessToken(user, options);
  return { access_token: accessToken, token_type: 'bearer', expires_in: 24 * 3600, expires_at: Math.floor(Date.now() / 1000) + 24 * 3600, refresh_token: `audit-refresh:${user.id}`, user };
}

/** The cookie `@supabase/auth-helpers-nextjs` stores for a project at 127.0.0.1 (project ref «127»). */
export function authCookie(user, { appUrl }) {
  const session = sessionFor(user);
  return {
    name: 'sb-127-auth-token',
    value: encodeURIComponent(JSON.stringify([session.access_token, session.refresh_token, null, null, null])),
    url: appUrl, httpOnly: false, sameSite: 'Lax',
  };
}
