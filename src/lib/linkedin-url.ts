function decodeProfilePath(url: URL) {
  try {
    return decodeURIComponent(url.pathname).normalize('NFC').replace(/\/+$/, '');
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
    return /^\/in\/[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

export function normalizeLinkedinProfileUrl(input?: string | null): string {
  const pathname = parseProfileUrl(input);
  if (!pathname) return '';

  const url = new URL('https://www.linkedin.com');
  url.pathname = pathname;
  return url.toString();
}

const SLUG_ROLE_STOPWORDS = new Set([
  'it', 'hr', 'rh', 'ceo', 'cto', 'cfo', 'coo', 'vp', 'svp', 'evp',
  'recruiter', 'recruiters', 'recruiting', 'recruitment', 'talent', 'talents',
  'hiring', 'hired', 'jobs', 'job', 'careers', 'career', 'empleos', 'empleo',
  'tech', 'sales', 'marketing', 'engineer', 'engineering', 'developer', 'dev',
  'consultant', 'consulting', 'consultor', 'consultora', 'coach', 'mentor',
  'speaker', 'author', 'founder', 'cofounder', 'official', 'real', 'the',
  'de', 'la', 'el', 'los', 'las', 'and', 'y', 'e',
]);

function slugNameTokens(input?: string | null): string[] {
  const pathname = parseProfileUrl(input);
  if (!pathname) return [];
  const slug = pathname.slice('/in/'.length).replace(/-[a-z0-9]{8}$/i, '');
  return slug.split('-').map((word) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())
    .filter((word) => word.length >= 2 && !SLUG_ROLE_STOPWORDS.has(word));
}

function personNameTokens(name?: string | null): string[] {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^a-z0-9]+/i).filter((word) => word.length >= 2);
}

/** Conservative cross-check: a personal slug carrying two or more name-like
 * tokens that share nothing with a multi-token returned name means the
 * provider matched another person (or stale data). Single-token slugs and
 * partial overlaps never conflict, so renamed people keep working. */
export function linkedinSlugConflictsWithName(profileUrl?: string | null, personName?: string | null): boolean {
  const slugTokens = slugNameTokens(profileUrl);
  const nameTokens = personNameTokens(personName);
  if (slugTokens.length < 2 || nameTokens.length < 2) return false;
  return !nameTokens.some((token) => slugTokens.includes(token));
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
