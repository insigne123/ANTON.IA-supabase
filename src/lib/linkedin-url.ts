export function normalizeLinkedinProfileUrl(input?: string | null): string {
  let value = String(input || '').trim();
  if (!value) return '';

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return '';

    const pathname = url.pathname.replace(/\/+$/, '');
    // Direct outreach is only supported for public person profile URLs.
    if (!/^\/in\/[a-z0-9][a-z0-9-]*$/i.test(pathname)) return '';

    return `https://www.linkedin.com${pathname}`;
  } catch {
    return '';
  }
}
