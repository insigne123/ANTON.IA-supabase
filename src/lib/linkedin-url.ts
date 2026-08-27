function decodeProfilePath(url: URL) {
  try {
    return decodeURIComponent(url.pathname).replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function parseProfileUrl(input?: string | null) {
  let value = String(input || '').trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
    const pathname = decodeProfilePath(url);
    return /^\/in\/[a-z0-9][a-z0-9-]*$/i.test(
      pathname.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''),
    ) ? pathname : null;
  } catch {
    return null;
  }
}

export function normalizeLinkedinProfileUrl(input?: string | null): string {
  const pathname = parseProfileUrl(input);
  if (!pathname) return '';

  const normalizedPathname = pathname.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return `https://www.linkedin.com${normalizedPathname}`;
}

export function getLinkedinProfileDisplayName(input?: string | null): string {
  const pathname = parseProfileUrl(input);
  if (!pathname) return '';

  const slug = pathname.slice('/in/'.length).replace(/-[a-z0-9]{8}$/i, '');
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toLocaleUpperCase('es-ES')}${word.slice(1)}`)
    .join(' ');
}
