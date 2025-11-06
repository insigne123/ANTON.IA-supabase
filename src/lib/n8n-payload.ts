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

  const leadRef =
    e.id ||
    e.email ||
    e.linkedinUrl ||
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
          fullName: e.fullName,
          title: e.title,
          email: e.email,
          linkedinUrl: e.linkedinUrl,
        },
      },
    ],
    userCompanyProfile: getCompanyProfile(),
  };
}
