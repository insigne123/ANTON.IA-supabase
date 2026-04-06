export function normalizeLinkedinProfileUrl(input?: string | null): string {
  let value = String(input || '').trim();
  if (!value) return '';

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (!/linkedin\.com$/i.test(host)) return '';

    const pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname || pathname === '/') return '';

    return `https://www.linkedin.com${pathname}`;
  } catch {
    return '';
  }
}
