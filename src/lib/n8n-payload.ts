// src/lib/n8n-payload.ts
import { getCompanyProfile } from '@/lib/data';
import type { EnrichedLead } from './types';

function cleanDomain(x?: string | null) {
  if (!x) return undefined;
  try {
    const u = new URL(x.startsWith('http') ? x : `https://${x}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = String(x).toLowerCase().replace(/^https?:\/\//, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

function guessNameFromDomain(domain?: string) {
  if (!domain) return undefined;
  const host = cleanDomain(domain) || '';
  const root = host.split('.')[0] || '';
  if (!root) return undefined;
  // "grupo-expro" -> "Grupo Expro"
  return root
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeDecodeComponent(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function safeDecodeUriValue(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
}

function titleizeToken(value?: string | null) {
  return String(value || '')
    .trim()
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function inferFullName(email?: string | null, linkedinUrl?: string | null) {
  const emailLocal = String(email || '').trim().split('@')[0] || '';
  const emailTokens = emailLocal.split(/[._-]+/).filter(Boolean);
  if (emailTokens.length >= 2) {
    const firstName = titleizeToken(emailTokens[0]);
    const lastName = titleizeToken(emailTokens.slice(1).join(' '));
    if (firstName && lastName) return `${firstName} ${lastName}`.trim();
  }

  const linkedin = safeDecodeUriValue(linkedinUrl);
  if (linkedin) {
    const slug = safeDecodeComponent(linkedin.replace(/\?.*$/, '').replace(/\/$/, '').split('/').pop() || '');
    const cleaned = slug.replace(/-[0-9a-f]{4,}$/i, '');
    const tokens = cleaned.split('-').filter(Boolean);
    if (tokens.length >= 2) {
      const firstName = titleizeToken(tokens[0]);
      const lastName = titleizeToken(tokens.slice(1).join(' '));
      if (firstName && lastName) return `${firstName} ${lastName}`.trim();
    }
  }

  return undefined;
}

function resolvePayloadFullName(e: EnrichedLead) {
  const raw = String(e.fullName || '').trim();
  if (raw && !/\*{2,}/.test(raw)) return raw;
  return inferFullName(e.email, e.linkedinUrl) || raw || undefined;
}

function joinLocation(city?: string | null, country?: string | null) {
  return [city, country].filter(Boolean).join(', ') || undefined;
}

/**
 * Crea el payload esperado por /api/research/n8n:
 * {
 *   companies: [{ leadRef, targetCompany:{...}, lead:{...} }],
 *   userCompanyProfile: {...}
 * }
 */
export function buildN8nPayloadFromLead(e: EnrichedLead) {
  const companyDomain = cleanDomain(e.companyDomain || undefined);
  const companyName = e.companyName || guessNameFromDomain(companyDomain);
  const normalizedLinkedinUrl = safeDecodeUriValue(e.linkedinUrl || undefined) || undefined;
  const resolvedFullName = resolvePayloadFullName(e);

  const leadRef =
    e.id ||
    e.email ||
    normalizedLinkedinUrl ||
    `${e.fullName}|${e.companyName || ''}`;

  return {
    companies: [
      {
        leadRef,
        targetCompany: {
          name: companyName || null,
          domain: companyDomain || null,
          linkedin: (e as any).companyLinkedinUrl || null,
          country: e.country || null,
          industry: e.industry || null,
          website: companyDomain ? `https://${companyDomain}` : null,
        },
        lead: {
          id: e.id,
          fullName: resolvedFullName || null,
          title: e.title,
          email: e.email,
          linkedinUrl: normalizedLinkedinUrl || null,
        },
        meta: {
          leadRef,
        },
      },
    ],
    userCompanyProfile: getCompanyProfile(),
    id: e.id || null,
    fullName: resolvedFullName || null,
    title: e.title || null,
    email: e.email || null,
    linkedinUrl: normalizedLinkedinUrl || null,
    companyName: companyName || null,
    companyDomain: companyDomain || null,
  };
}
