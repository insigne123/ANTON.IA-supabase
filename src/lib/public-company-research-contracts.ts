import { z } from 'zod';
import { FactClaimV2Schema, FactV2Schema, SourceV2Schema } from './report-v2-contracts';

export const PUBLIC_COMPANY_VERSION = 'public-company/2:report-v2/p3-claims/4';
export const PUBLIC_COMPANY_TTL_MS = 86_400_000;
const APOLLO_ORGANIZATION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,254}$/i;
export const PublicCompanyIdentitySchema = z.object({
  apolloOrganizationId: z.string().trim().min(3).max(255).regex(APOLLO_ORGANIZATION_ID_PATTERN),
  domain: z.string().max(253).regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[a-z]{2,3}(-[a-z]{2})?$/),
  depth: z.enum(['basic', 'standard', 'deep']),
  version: z.literal(PUBLIC_COMPANY_VERSION),
}).strict();
export type PublicCompanyIdentity = z.infer<typeof PublicCompanyIdentitySchema>;
export const PublicCompanyReferenceSchema = z.object({
  artifactId: z.string().uuid(), revision: z.number().int().positive(),
  identity: PublicCompanyIdentitySchema, expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type PublicCompanyReference = z.infer<typeof PublicCompanyReferenceSchema>;

export const PublicCompanyGraphSchema = z.object({
  sources: z.array(SourceV2Schema).min(1).max(10),
  facts: z.array(FactV2Schema).min(1).max(500),
  claims: z.array(FactClaimV2Schema).max(500),
}).strict();
export type PublicCompanyGraph = z.infer<typeof PublicCompanyGraphSchema>;

// Require the exact domain in the evidence, not a search snippet or a similar name.
export function publicCompanyExternalBlock(text: string, domain: string) {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9.@-])(?:www\\.)?${escaped}(?=$|[^a-z0-9.-])`, 'i').test(text);
}

export const PUBLIC_COMPANY_COVERAGE_LIMITATION = 'La cobertura no incluye WHOIS, brand.dev, Similarweb ni filiales con otro dominio. El dominio no verifica la identidad legal de cada empresa del grupo.';
export const PUBLIC_COMPANY_EXTERNAL_MISSING = 'No se obtuvo evidencia externa verificable; la cobertura se limita al sitio oficial.';
export function publicCompanyCoverageWarnings(graph: PublicCompanyGraph) {
  return [PUBLIC_COMPANY_COVERAGE_LIMITATION,
    ...(!graph.sources.some((source) => !source.ownDomain)
      ? [PUBLIC_COMPANY_EXTERNAL_MISSING] : [])];
}

export function publicCompanyHost(url: string) {
  const value = new URL(url);
  if (value.protocol !== 'https:' || value.username || value.password || value.port) throw new Error('PUBLIC_COMPANY_URL_INVALID');
  return value.hostname.toLowerCase().replace(/^www\./, '');
}

// Apollo's stable organization id disambiguates companies that share a domain or name.
// Collection still verifies a successful exact-host HTTPS fetch before publication.
export function publicCompanyCandidate(input: {
  companyDomain?: string | null; companyWebsite?: string | null;
  apolloOrganizationId?: string | null;
  country?: string | null; language: string; depth: PublicCompanyIdentity['depth'];
}): PublicCompanyIdentity | null {
  try {
    if (!input.companyDomain || !input.companyWebsite || !input.apolloOrganizationId) return null;
    const apolloOrganizationId = input.apolloOrganizationId.trim();
    if (!APOLLO_ORGANIZATION_ID_PATTERN.test(apolloOrganizationId)) return null;
    const domain = input.companyDomain.toLowerCase().replace(/^www\./, '');
    const website = new URL(input.companyWebsite);
    if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password || website.port
      || website.hostname.toLowerCase().replace(/^www\./, '') !== domain) return null;
    if (/^(?:gmail|outlook|hotmail|yahoo|linkedin|facebook)\./.test(domain)) return null;
    const countries: Record<string, string> = { chile: 'CL', peru: 'PE', colombia: 'CO' };
    const country = (input.country || '').trim().toLowerCase();
    return PublicCompanyIdentitySchema.parse({ apolloOrganizationId, domain, country: countries[country] || country.toUpperCase(),
      language: input.language.toLowerCase(), depth: input.depth, version: PUBLIC_COMPANY_VERSION });
  } catch { return null; }
}
