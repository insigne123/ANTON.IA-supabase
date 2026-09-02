import { normalizeDomain } from '@/lib/domain';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type JsonRecord = Record<string, unknown>;

export type ApolloOrganizationContext = {
  id: string;
  name: string;
  primary_domain: string;
  website_url?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  city?: string;
  state?: string;
  country?: string;
  short_description?: string;
  keywords?: string[];
  founded_year?: number;
  annual_revenue?: number;
  total_funding?: number;
};

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= maxLength ? normalized : '';
}

function positiveInteger(value: unknown, max: number) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 && normalized <= max ? normalized : undefined;
}

function nonnegativeNumber(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= Number.MAX_SAFE_INTEGER
    ? normalized
    : undefined;
}

function httpUrl(value: unknown, linkedinCompany = false) {
  try {
    const url = new URL(text(value, 2_048));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (linkedinCompany && (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !/^\/company\//i.test(url.pathname))) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeApolloOrganizationContext(
  payload: unknown,
  requestedDomain: string,
): ApolloOrganizationContext | null {
  const root = object(payload);
  if (root.provider !== 'apollo' || root.status !== 'completed') return null;
  const organization = object(root.organization);
  const domain = normalizeDomain(requestedDomain);
  const id = text(organization.id, 255);
  const name = text(organization.name, 300);
  if (!domain || !id || !name) return null;

  const websiteUrl = httpUrl(organization.website_url);
  const linkedinUrl = httpUrl(organization.linkedin_url, true);
  const keywords = (Array.isArray(organization.keywords) ? organization.keywords : [])
    .map((keyword) => text(keyword, 160))
    .filter(Boolean)
    .slice(0, 100);
  const context: ApolloOrganizationContext = {
    id,
    name,
    primary_domain: domain,
  };
  const industry = text(organization.industry, 2_000);
  const city = text(organization.city, 300);
  const state = text(organization.state, 300);
  const country = text(organization.country, 300);
  const description = text(organization.short_description, 2_000);
  const employeeCount = positiveInteger(organization.estimated_num_employees, 10_000_000);
  const foundedYear = positiveInteger(organization.founded_year, 3_000);
  const annualRevenue = nonnegativeNumber(organization.annual_revenue);
  const totalFunding = nonnegativeNumber(organization.total_funding);
  if (websiteUrl) context.website_url = websiteUrl;
  if (linkedinUrl) context.linkedin_url = linkedinUrl;
  if (industry) context.industry = industry;
  if (employeeCount) context.estimated_num_employees = employeeCount;
  if (city) context.city = city;
  if (state) context.state = state;
  if (country) context.country = country;
  if (description) context.short_description = description;
  if (keywords.length) context.keywords = keywords;
  if (foundedYear) context.founded_year = foundedYear;
  if (annualRevenue != null) context.annual_revenue = annualRevenue;
  if (totalFunding != null) context.total_funding = totalFunding;
  return context;
}

function cacheTtlDays(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_ORGANIZATION_CONTEXT_TTL_DAYS);
  return Number.isFinite(configured) ? Math.max(1, Math.min(90, Math.trunc(configured))) : 30;
}

export async function getFreshApolloOrganizationContext(input: {
  organizationId: string;
  userId: string;
  domain: string;
  environment?: Record<string, string | undefined>;
}, admin: any = getSupabaseAdminClient()) {
  const domain = normalizeDomain(input.domain);
  if (!domain) return null;
  const cutoff = new Date(Date.now() - cacheTtlDays(input.environment || process.env) * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('apollo_organization_contexts')
    .select('organization_context,observed_at')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('normalized_domain', domain)
    .gte('observed_at', cutoff)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const organization = sanitizeApolloOrganizationContext({
    provider: 'apollo',
    status: 'completed',
    organization: data.organization_context,
  }, domain);
  return organization ? { organization, observedAt: String(data.observed_at || '') || null } : null;
}

export async function persistApolloOrganizationContext(input: {
  organizationId: string;
  userId: string;
  operationId: string;
  claimToken: string;
  organization: ApolloOrganizationContext;
  observedAt: string;
  responsePayload: Record<string, unknown>;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('complete_apollo_organization_enrichment_v1', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_operation_id: input.operationId,
    p_claim_token: input.claimToken,
    p_normalized_domain: input.organization.primary_domain,
    p_apollo_organization_id: input.organization.id,
    p_organization_context: input.organization,
    p_observed_at: input.observedAt,
    p_response_payload: input.responsePayload,
  });
  if (error) throw error;
  if (data !== true) throw new Error('APOLLO_ORGANIZATION_CONTEXT_CLAIM_LOST');
}
