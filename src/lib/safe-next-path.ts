/**
 * Where to send someone after signing in, from a `next` value anyone can write into a link: only a path of this app.
 * «//evil.com», «/\evil.com», «https://…», «javascript:…» and anything with control characters fall back to `fallback`,
 * so a link to the login page cannot hand the session off to another site (open redirect).
 */
export function safeNextPath(value: string | null | undefined, fallback = '/') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048) return fallback;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return fallback; }
  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
    if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;
  }
  try {
    const url = new URL(raw, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
