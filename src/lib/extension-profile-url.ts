import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

export function canonicalExtensionProfileUrl(value: string) {
  const normalized = normalizeLinkedinProfileUrl(value);
  if (!normalized) return '';
  const url = new URL(normalized);
  url.pathname = decodeURIComponent(url.pathname).toLowerCase();
  return url.href;
}
