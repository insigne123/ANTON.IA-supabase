import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import {
  ResearchSnapshotV1Schema,
  type ContractErrorV1,
  type ResearchClaimV1,
  type ResearchEvidenceV1,
  type ResearchSnapshotV1,
  type ResearchSourceV1,
} from '@/lib/research-contracts';
import {
  isGenericResearchText,
  isQualifiedResearchFactEvidence,
  isRelevantResearchSignal,
  isSameResearchCompanyDomain,
  mentionsResearchCompany,
} from '@/lib/research-fact-eligibility';
import {
  NativeResearchLeadSchema,
  NativeResearchOptionsSchema,
  NativeResearchStatusSchema,
  type NativeResearchLead,
  type NativeResearchLeadStatus,
  type NativeResearchOptions,
  type NativeResearchResult,
  type NativeResearchStatus,
} from '@/lib/native-research-contracts';
import { canonicalJson } from '@/lib/messaging-contracts';
import { assessResearchQuality } from '@/lib/native-research-quality';
import {
  completeLeadResearchRequestClaim,
  consumeLeadResearchRequestQuota,
  deterministicLeadResearchSnapshotId,
  failLeadResearchRequestClaim,
  markLeadResearchRequestProviderSubmitting,
  parseLeadResearchRequestClaim,
  releaseLeadResearchRequestClaim,
  type LeadResearchRequestClaim,
} from '@/lib/server/lead-research-jobs';
import {
  COMPANY_RESEARCH_ARTIFACT_TTL_MS,
  COMPANY_RESEARCH_INSUFFICIENT_TTL_MS,
  buildCompanyResearchArtifactIdentity,
  claimCompanyResearchArtifact,
  completeCompanyResearchArtifact,
  releaseCompanyResearchArtifactClaim,
} from '@/lib/server/company-research-artifacts';
import { getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  researchBrand,
  researchBrandMentions,
  researchSerpCompanyNews,
  researchSerpJobsSignals,
  researchWhois,
} from '@/lib/server/suplia-research-tools';

const NATIVE_PROVIDER = 'native-research-v1';
const ACTIVE_STATUSES = ['queued', 'running', 'in_progress', 'pending', 'processing'];
const OFFICIAL_SITE_MAX_RESPONSE_BYTES = 120_000;
const MAX_OFFICIAL_SITE_PAGES = 3;
const MAX_DEEP_OFFICIAL_SITE_PAGES = 5;
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
]);

export function isNativeResearchEnabled() {
  const configured = String(process.env.NATIVE_RESEARCH_ENABLED || '').trim();
  return configured ? configured.toLowerCase() !== 'false' : process.env.NODE_ENV !== 'production';
}

function assertNativeResearchEnabled() {
  if (!isNativeResearchEnabled()) throw new Error('NATIVE_RESEARCH_DISABLED');
}

type NativeResearchAccess = {
  organizationId: string;
  organizationIds?: string[];
  userId: string;
};

function readableOrganizationIds(access: NativeResearchAccess) {
  return [...new Set([access.organizationId, ...(access.organizationIds || [])].map(text).filter(Boolean))];
}

function applyReadableOrganizationScope(query: any, access: NativeResearchAccess) {
  const organizationIds = readableOrganizationIds(access);
  return organizationIds.length === 1
    ? query.eq('organization_id', organizationIds[0])
    : query.in('organization_id', organizationIds);
}

type NativeResearchJob = {
  id: string;
  organizationId: string;
  userId: string;
  scopeKey: string;
  providerReportId: string;
  requestIdempotencyKey: string;
  leadRef: string;
  leadId: string | null;
  email: string | null;
  companyName: string | null;
  companyDomain: string | null;
  status: NativeResearchStatus;
  requestClaimState: string | null;
  requestPayload: Record<string, any>;
  resultPayload: Record<string, any> | null;
  researchSnapshotId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type OfficialSitePage = {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
};

type OfficialSiteResult = OfficialSitePage & {
  pages?: OfficialSitePage[];
};

type ResolvedPublicAddress = {
  address: string;
  family: 4 | 6;
};

type OfficialSiteResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

type CompanySignals = {
  domain: string;
  official: OfficialSiteResult | null;
  whois: Record<string, any> | null;
  brand: Record<string, any> | null;
  fetchedAt: string;
};

type CompanySignalsCollection = {
  signals: CompanySignals;
  cacheHit: boolean;
  expiresAt: string | null;
  warnings: string[];
  artifactId: string | null;
  cacheIdentity: string | null;
  busy: boolean;
};

type NativeResearchPipelineOutput = {
  snapshot: ResearchSnapshotV1;
  result: NativeResearchResult;
};

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function hash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function deriveNativeResearchLeadRef(lead: Pick<NativeResearchLead, 'id' | 'email' | 'linkedinUrl' | 'fullName' | 'companyDomain' | 'companyName'>) {
  const candidate = text(lead.id || lead.email || lead.linkedinUrl || `${lead.fullName || 'lead'}:${lead.companyDomain || lead.companyName || 'company'}`);
  if (!candidate) throw new Error('NATIVE_RESEARCH_LEAD_REF_REQUIRED');
  return candidate.length <= 500 ? candidate : `native:${hash({ leadRef: candidate }).slice(0, 48)}`;
}

function isTerminalNativeResearchStatus(value: unknown): value is NativeResearchStatus {
  return ['completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(text(value).toLowerCase());
}

function id(prefix: string, value: unknown) {
  return `${prefix}:${hash(value).slice(0, 24)}`;
}

function normalizeDomain(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();
  }
}

function companyResearchDomain(lead: Pick<NativeResearchLead, 'companyDomain' | 'companyWebsite' | 'email'>) {
  const explicit = normalizeDomain(lead.companyDomain || lead.companyWebsite);
  if (explicit) return explicit;
  const emailDomain = normalizeDomain(lead.email?.split('@')[1]);
  return PERSONAL_EMAIL_DOMAINS.has(emailDomain) ? '' : emailDomain;
}

function isSafePublicDomain(domain: string) {
  if (!domain || domain.length > 253 || domain.includes('..')) return false;
  if (isIP(domain) !== 0) return false;
  if (!/^[a-z0-9.-]+$/i.test(domain) || !domain.includes('.')) return false;
  if (
    domain === 'localhost'
    || domain.endsWith('.local')
    || domain.endsWith('.internal')
    || domain === 'metadata.google.internal'
    || /^127\./.test(domain)
    || /^10\./.test(domain)
    || /^192\.168\./.test(domain)
    || /^169\.254\./.test(domain)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(domain)
  ) return false;
  return true;
}

function ipv6Words(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0];
  const sides = normalized.split('::');
  if (sides.length > 2) return null;

  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
  const lastSide = right.length > 0 ? right : left;
  const last = lastSide[lastSide.length - 1];
  if (last && isIP(last) === 4) {
    const octets = last.split('.').map(Number);
    lastSide.splice(lastSide.length - 1, 1,
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16));
  }

  const explicitLength = left.length + right.length;
  if ((sides.length === 1 && explicitLength !== 8) || explicitLength > 8) return null;
  const words = [
    ...left,
    ...Array(Math.max(0, 8 - explicitLength)).fill('0'),
    ...right,
  ];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
}

function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map(Number);
    const [first, second] = parts;
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254)
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 192 && second === 0)
      || (first === 198 && second >= 18 && second <= 19)
      || (first === 198 && second === 51)
      || (first === 203 && second === 0)
      || first === 0
      || first >= 224;
  }
  if (version !== 6) return true;
  const words = ipv6Words(normalized);
  if (!words) return true;

  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const ipv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const nat64 = words[0] === 0x64 && words[1] === 0xff9b;
  return ipv4Mapped
    || ipv4Compatible
    || nat64
    || normalized === '::'
    || normalized === '::1'
    || (words[0] & 0xfe00) === 0xfc00
    || (words[0] & 0xffc0) === 0xfe80
    || (words[0] & 0xff00) === 0xff00
    || (words[0] === 0x2001 && words[1] === 0x0db8);
}

async function resolvePublicAddress(domain: string): Promise<ResolvedPublicAddress | null> {
  try {
    const addresses = await lookup(domain, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address))) return null;
    const selected = addresses[0];
    const family = isIP(selected.address);
    return family === 4 || family === 6
      ? { address: selected.address, family }
      : null;
  } catch {
    return null;
  }
}

function validHttpUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function safeSourceUrl(value: unknown, fallbackDomain: string) {
  const direct = validHttpUrl(value);
  if (direct) return direct;
  return fallbackDomain ? `https://${fallbackDomain}` : '';
}

function isSafeOfficialSiteUrl(url: URL) {
  const domain = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && !url.username
    && !url.password
    && !url.port
    && isSafePublicDomain(domain);
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function boundedOfficialSiteChunk(chunk: Buffer, bufferedBytes: number) {
  const remaining = Math.max(0, OFFICIAL_SITE_MAX_RESPONSE_BYTES - bufferedBytes);
  return remaining > 0 ? chunk.subarray(0, remaining) : null;
}

function pinnedOfficialSiteLookup(address: ResolvedPublicAddress) {
  return (_hostname: string, options: any, callback: (...args: any[]) => void) => {
    if (options && typeof options === 'object' && options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function requestOfficialSite(url: URL, address: ResolvedPublicAddress, signal: AbortSignal): Promise<OfficialSiteResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'ANTON.IA Native Research/1.0',
      },
      lookup: pinnedOfficialSiteLookup(address),
      signal,
    }, (response) => {
      const status = response.statusCode || 0;
      const headers = response.headers;
      const contentType = headerValue(headers, 'content-type') || '';
      if ((status >= 300 && status < 400) || (!contentType.includes('html') && !contentType.includes('text/'))) {
        response.resume();
        resolve({ status, headers, body: '' });
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      const complete = () => {
        if (settled) return;
        settled = true;
        resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') });
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const accepted = boundedOfficialSiteChunk(buffer, totalBytes);
        if (accepted) {
          chunks.push(accepted);
          totalBytes += accepted.length;
        }
        if (totalBytes >= OFFICIAL_SITE_MAX_RESPONSE_BYTES) {
          complete();
          response.destroy();
        }
      });
      response.once('error', fail);
      response.once('end', complete);
    });
    request.once('error', reject);
    request.end();
  });
}

function officialPageFromHtml(url: URL, html: string): OfficialSitePage {
  const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '')) || null;
  const description = text(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1],
  ) || null;
  const readable = text(
    html
      .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, ' ')
      .replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, ' ')
      .replace(/<noscript\b[\s\S]*?(?:<\/noscript>|$)/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, 4_000);

  return { url: url.toString(), title, description, text: readable };
}

function usefulOfficialPageContent(page: OfficialSitePage) {
  const candidates = [
    { value: page.description, locator: 'meta_description' as const },
    { value: page.text, locator: 'page_text' as const },
  ];
  for (const candidate of candidates) {
    const statement = conciseSourceStatement(candidate.value);
    if (statement.length >= 60 && !isGenericResearchText(statement)) {
      return { statement, locator: candidate.locator };
    }
  }
  return null;
}

function isUsefulOfficialPage(page: OfficialSitePage) {
  return Boolean(usefulOfficialPageContent(page));
}

function candidateOfficialPageUrls(html: string, baseUrl: URL, domain: string, country?: string | null, maxPages = MAX_OFFICIAL_SITE_PAGES) {
  const countryKey = text(country).toLowerCase();
  const candidates = new Map<string, number>();
  const countryPath = countryKey
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (countryPath) {
    const countryUrl = new URL(`/${countryPath}/`, baseUrl);
    if (
      countryUrl.toString() !== baseUrl.toString()
      && isSafeOfficialSiteUrl(countryUrl)
      && isSameResearchCompanyDomain(countryUrl.toString(), domain)
    ) {
      candidates.set(countryUrl.toString(), 12);
    }
  }
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    try {
      const url = new URL(match[1], baseUrl);
      if (!isSafeOfficialSiteUrl(url) || !isSameResearchCompanyDomain(url.toString(), domain)) continue;
      if (url.hash || url.pathname === '/' || url.toString() === baseUrl.toString()) continue;

      const label = text(match[2].replace(/<[^>]+>/g, ' ')).toLowerCase();
      const path = url.pathname.toLowerCase();
      const target = `${path} ${label}`;
      let score = 0;
      if (/(?:nosotros|quienes|empresa|about|company|servicios|services|solutions|portfolio|reclutamiento|seleccion|talento)/.test(target)) score += 6;
      if (countryKey && target.includes(countryKey)) score += 5;
      if (/(?:^|\/)(?:cl|chile)(?:\/|$)/.test(path)) score += 4;
      if (path.split('/').filter(Boolean).length <= 3) score += 1;
      if (score > 0) candidates.set(url.toString(), Math.max(candidates.get(url.toString()) || 0, score));
    } catch {
      // Ignore malformed links from public HTML.
    }
  }

  return Array.from(candidates.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(0, maxPages - 1))
    .map(([url]) => url);
}

async function fetchOfficialPage(input: {
  url: URL;
  domain: string;
  signal: AbortSignal;
}): Promise<{ page: OfficialSitePage | null; html: string; warning?: string }> {
  let currentUrl = input.url;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!isSafeOfficialSiteUrl(currentUrl) || !isSameResearchCompanyDomain(currentUrl.toString(), input.domain)) {
      return { page: null, html: '', warning: 'official_site_redirect_rejected' };
    }
    const resolved = await resolvePublicAddress(currentUrl.hostname);
    if (!resolved) return { page: null, html: '', warning: 'official_site_dns_rejected' };
    const response = await requestOfficialSite(currentUrl, resolved, input.signal);

    if (response.status >= 300 && response.status < 400) {
      const location = headerValue(response.headers, 'location');
      if (!location) return { page: null, html: '', warning: 'official_site_redirect_missing' };
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      return { page: null, html: '', warning: `official_site_http_${response.status}` };
    }
    const contentType = headerValue(response.headers, 'content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text/')) {
      return { page: null, html: '', warning: 'official_site_not_html' };
    }

    return { page: officialPageFromHtml(currentUrl, response.body), html: response.body };
  }
  return { page: null, html: '', warning: 'official_site_redirect_limit' };
}

async function fetchOfficialSite(input: {
  domain: string;
  country?: string | null;
  maxPages?: number;
}): Promise<{ value: OfficialSiteResult | null; warning?: string }> {
  if (!isSafePublicDomain(input.domain)) return { value: null, warning: 'official_site_domain_rejected' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const first = await fetchOfficialPage({
      url: new URL(`https://${input.domain}`),
      domain: input.domain,
      signal: controller.signal,
    });
    if (!first.page) return { value: null, warning: first.warning };

    const maxPages = Math.max(1, Math.min(MAX_DEEP_OFFICIAL_SITE_PAGES, Math.floor(input.maxPages || MAX_OFFICIAL_SITE_PAGES)));
    const candidateUrls = candidateOfficialPageUrls(first.html, new URL(first.page.url), input.domain, input.country, maxPages);
    const followUps = await Promise.all(candidateUrls.map(async (candidate) => {
      try {
        return await fetchOfficialPage({ url: new URL(candidate), domain: input.domain, signal: controller.signal });
      } catch {
        return { page: null, html: '', warning: 'official_site_fetch_failed' };
      }
    }));
    const pages = [first.page, ...followUps.flatMap((result) => result.page ? [result.page] : [])];
    const usablePages = pages.filter(isUsefulOfficialPage);
    const primary = usablePages
      .sort((left, right) => (
        Number(Boolean(right.description)) - Number(Boolean(left.description))
        || right.text.length - left.text.length
      ))[0];
    if (!primary) return { value: null, warning: 'official_site_content_generic' };

    return { value: { ...primary, pages: usablePages } };
  } catch (error: any) {
    return {
      value: null,
      warning: error?.name === 'AbortError' ? 'official_site_timeout' : 'official_site_fetch_failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function nullableObject(value: unknown): Record<string, any> | null {
  const normalized = object(value);
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function emptyCompanySignals(domain: string): CompanySignals {
  return {
    domain,
    official: null,
    whois: null,
    brand: null,
    fetchedAt: new Date().toISOString(),
  };
}

function companySignalsFromArtifactPayload(payload: unknown, expectedDomain: string): CompanySignals | null {
  const value = object(object(payload).companySignals);
  const fetchedAt = text(value.fetchedAt);
  const domain = normalizeDomain(value.domain);
  if (!fetchedAt || (expectedDomain && domain !== expectedDomain)) return null;
  return {
    domain: domain || expectedDomain,
    official: nullableObject(value.official) as OfficialSiteResult | null,
    whois: nullableObject(value.whois),
    brand: nullableObject(value.brand),
    fetchedAt,
  };
}

function hasCompanySignals(signals: CompanySignals) {
  const official = signals.official && isUsefulOfficialPage(signals.official);
  const brandDescription = text(signals.brand?.description);
  return Boolean(official || (brandDescription && !isGenericResearchText(brandDescription)));
}

async function collectCompanySignals(input: {
  organizationId: string;
  lead: NativeResearchLead;
  options: NativeResearchOptions;
}): Promise<CompanySignalsCollection> {
  const domain = companyResearchDomain(input.lead);
  const warnings: string[] = [];
  if (!domain && !text(input.lead.companyName)) {
    warnings.push('company_identity_missing');
    return {
      signals: emptyCompanySignals(domain),
      cacheHit: false,
      expiresAt: null,
      warnings,
      artifactId: null,
      cacheIdentity: null,
      busy: false,
    };
  }

  const identity = buildCompanyResearchArtifactIdentity({
    organizationId: input.organizationId,
    companyDomain: domain,
    companyName: input.lead.companyName,
    countryCode: input.lead.country,
    researchDepth: input.options.depth,
    researchLanguage: input.options.language,
    provider: NATIVE_PROVIDER,
  });
  let claim = await claimCompanyResearchArtifact({
    identity,
    forceRefresh: input.options.refresh,
    leaseSeconds: 300,
  });

  if (claim.state === 'cached') {
    const cached = companySignalsFromArtifactPayload(claim.artifact.payload, domain);
    if (cached) {
      return {
        signals: cached,
        cacheHit: true,
        expiresAt: claim.artifact.expiresAt,
        warnings,
        artifactId: claim.artifact.id,
        cacheIdentity: identity.cacheIdentity,
        busy: false,
      };
    }
    warnings.push('company_artifact_payload_invalid');
    claim = await claimCompanyResearchArtifact({ identity, forceRefresh: true, leaseSeconds: 300 });
  }

  if (claim.state === 'busy') {
    return {
      signals: emptyCompanySignals(domain),
      cacheHit: false,
      expiresAt: null,
      warnings: [...warnings, 'company_research_in_progress'],
      artifactId: claim.artifact.id,
      cacheIdentity: identity.cacheIdentity,
      busy: true,
    };
  }
  if (claim.state !== 'claimed' || !claim.claimToken) {
    throw new Error('COMPANY_RESEARCH_ARTIFACT_CLAIM_UNAVAILABLE');
  }

  try {
    const official = await fetchOfficialSite({
      domain,
      country: input.lead.country,
      maxPages: input.options.depth === 'deep' ? MAX_DEEP_OFFICIAL_SITE_PAGES : input.options.depth === 'basic' ? 1 : MAX_OFFICIAL_SITE_PAGES,
    });
    if (official.warning) warnings.push(official.warning);

    const auth = {
      user: { id: input.lead.id || 'native-research' },
      organizationId: input.organizationId,
      supabase: getSupabaseAdminClient(),
    } as any;
    const context = { auth, conversationId: 'native-research' } as any;
    const providerInput = {
      domain,
      company: input.lead.companyName || domain,
      companyName: input.lead.companyName || domain,
      language: input.options.language,
      countryCode: input.lead.country || 'cl',
      cache: !input.options.refresh,
    };

    const [whois, brand] = await Promise.all([
      domain ? researchWhois(providerInput, context).catch(() => {
        warnings.push('whois_unavailable');
        return null;
      }) : Promise.resolve(null),
      domain && process.env.BRANDDEV_API_KEY
        ? researchBrand(providerInput, context).catch(() => {
          warnings.push('brand_unavailable');
          return null;
        })
        : Promise.resolve(null),
    ]);

    const signals: CompanySignals = {
      domain,
      official: official.value,
      whois: nullableObject(whois),
      brand: nullableObject(brand),
      fetchedAt: new Date().toISOString(),
    };
    const status = hasCompanySignals(signals) ? 'completed' : 'insufficient_data';
    const artifact = await completeCompanyResearchArtifact({
      artifact: claim.artifact,
      identity,
      claimToken: claim.claimToken,
      status,
      payload: {
        schemaVersion: 'native-company-signals/v1',
        companySignals: signals,
      },
      expiresAt: new Date(Date.now() + (status === 'completed'
        ? COMPANY_RESEARCH_ARTIFACT_TTL_MS
        : COMPANY_RESEARCH_INSUFFICIENT_TTL_MS)).toISOString(),
      errorMetadata: { warnings },
    });
    return {
      signals,
      cacheHit: false,
      expiresAt: artifact.expiresAt,
      warnings,
      artifactId: artifact.id,
      cacheIdentity: identity.cacheIdentity,
      busy: false,
    };
  } catch (error: any) {
    try {
      await releaseCompanyResearchArtifactClaim({
        artifact: claim.artifact,
        identity,
        claimToken: claim.claimToken,
        errorCode: 'native_company_research_failed',
        errorMessage: text(error?.message) || 'Native company research failed.',
        errorMetadata: { stage: 'company_signals' },
      });
    } catch (releaseError) {
      console.error('[native-research] company artifact release failed:', releaseError);
    }
    throw error;
  }
}

async function collectSearchSignals(input: {
  organizationId: string;
  lead: NativeResearchLead;
  options: NativeResearchOptions;
}) {
  const domain = companyResearchDomain(input.lead);
  const context = {
    auth: {
      user: { id: input.lead.id || 'native-research' },
      organizationId: input.organizationId,
      supabase: getSupabaseAdminClient(),
    },
    conversationId: 'native-research',
  } as any;
  const providerInput = {
    domain,
    company: input.lead.companyName || domain,
    companyName: input.lead.companyName || domain,
    location: [input.lead.city, input.lead.country].filter(Boolean).join(', '),
    language: input.options.language,
    countryCode: input.lead.country || 'cl',
    cache: !input.options.refresh,
  };
  const warnings: string[] = [];
  const [news, jobs, mentions] = await Promise.all([
    domain || input.lead.companyName
      ? researchSerpCompanyNews(providerInput, context).catch((error: any) => {
        warnings.push('company_news_unavailable');
        return null;
      })
      : Promise.resolve(null),
    domain || input.lead.companyName
      ? researchSerpJobsSignals(providerInput, context).catch((error: any) => {
        warnings.push('hiring_signals_unavailable');
        return null;
      })
      : Promise.resolve(null),
    input.options.depth === 'deep' && (domain || input.lead.companyName)
      ? researchBrandMentions(providerInput, context).catch(() => {
        warnings.push('company_mentions_unavailable');
        return null;
      })
      : Promise.resolve(null),
  ]);
  return { news: object(news), jobs: object(jobs), mentions: object(mentions), warnings };
}

function createError(input: {
  code: ContractErrorV1['code'];
  stage: ContractErrorV1['stage'];
  message: string;
  retryable: boolean;
  provider?: string;
}): ContractErrorV1 {
  return {
    code: input.code,
    stage: input.stage,
    severity: 'warning',
    retryable: input.retryable,
    message: input.message,
    provider: input.provider || NATIVE_PROVIDER,
    observedAt: new Date().toISOString(),
  };
}

function isoDateOrNull(value: unknown) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isoAfterDate(value: string, days: number) {
  const timestamp = Date.parse(value);
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + days * 24 * 60 * 60 * 1_000).toISOString();
}

function conciseSourceStatement(value: unknown, maxLength = 720) {
  const normalized = text(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.!?-]+$/, '')}…`;
}

function officialClaimKind(page: OfficialSitePage): ResearchClaimV1['kind'] {
  return /(?:servicios|services|solutions|portfolio|reclutamiento|seleccion|talento)/i.test(page.url)
    ? 'company_service'
    : 'company_overview';
}

function isRelevantSearchResult(input: {
  title: string;
  snippet: string;
  link: string;
  companyName?: string | null;
  companyDomain?: string | null;
}) {
  const statement = `${input.title} ${input.snippet}`.trim();
  if (!statement || isGenericResearchText(statement)) return false;
  return isSameResearchCompanyDomain(input.link, input.companyDomain)
    || mentionsResearchCompany(statement, input);
}

function buildSnapshot(input: {
  jobId: string;
  reportId: string;
  requestIdempotencyKey: string;
  access: NativeResearchAccess;
  lead: NativeResearchLead;
  options: NativeResearchOptions;
  company: CompanySignals;
  news: Record<string, any>;
  jobs: Record<string, any>;
  mentions: Record<string, any>;
  warnings: string[];
}): NativeResearchPipelineOutput {
  const now = new Date().toISOString();
  const domain = companyResearchDomain(input.lead);
  const leadRef = text(input.lead.id || input.lead.email || input.lead.linkedinUrl || `${input.lead.fullName || 'lead'}:${domain || 'company'}`);
  const sources: ResearchSourceV1[] = [];
  const evidence: ResearchEvidenceV1[] = [];
  const claims: ResearchClaimV1[] = [];
  const addSource = (source: {
    url: string;
    type: ResearchSourceV1['type'];
    title?: string | null;
    publisher?: string | null;
    provider: string;
    reliability?: number;
    retrievedAt?: string | null;
    publishedAt?: string | null;
  }) => {
    const url = validHttpUrl(source.url);
    if (!url) return null;
    const existing = sources.find((item) => item.url === url);
    if (existing) return existing;
    const created: ResearchSourceV1 = {
      id: id('source', url),
      type: source.type,
      url,
      canonicalUrl: url,
      ...(text(source.title) ? { title: text(source.title) } : {}),
      ...(text(source.publisher) ? { publisher: text(source.publisher) } : {}),
      provider: source.provider,
      ...(isoDateOrNull(source.publishedAt) ? { publishedAt: isoDateOrNull(source.publishedAt)! } : {}),
      retrievedAt: isoDateOrNull(source.retrievedAt) || now,
      reliability: Math.max(0, Math.min(1, source.reliability ?? 0.7)),
    };
    sources.push(created);
    return created;
  };
  const addEvidence = (value: {
    statement: string;
    source: ResearchSourceV1 | null;
    kind?: ResearchEvidenceV1['kind'];
    subjectScope?: ResearchEvidenceV1['subjectScope'];
    confidence?: number;
    locator?: ResearchEvidenceV1['locator'];
    extractedAt?: string | null;
    observedAt?: string | null;
    extractionMethod?: ResearchEvidenceV1['extraction']['method'];
  }) => {
    if (!value.source || !text(value.statement)) return null;
    const created: ResearchEvidenceV1 = {
      id: id('evidence', `${value.source.id}:${value.statement}`),
      subjectScope: value.subjectScope || 'company',
      kind: value.kind || 'observation',
      path: 'native_research',
      statement: text(value.statement),
      sourceId: value.source.id,
      ...(value.locator ? { locator: value.locator } : {}),
      ...(isoDateOrNull(value.observedAt) ? { observedAt: isoDateOrNull(value.observedAt)! } : {}),
      extractedAt: isoDateOrNull(value.extractedAt) || now,
      confidence: Math.max(0, Math.min(1, value.confidence ?? 0.7)),
      extraction: { method: value.extractionMethod || 'provider', provider: NATIVE_PROVIDER, version: 'native-research/v2' },
    };
    evidence.push(created);
    return created;
  };
  const addClaim = (value: {
    kind: ResearchClaimV1['kind'];
    statement: string;
    supportingEvidenceIds: string[];
    classification?: ResearchClaimV1['classification'];
    confidence?: number;
    validityDays?: number;
    asOf?: string | null;
    derivation?: ResearchClaimV1['derivation'];
  }) => {
    const supporting = value.supportingEvidenceIds.filter((evidenceId) => evidence.some((item) => item.id === evidenceId));
    if (!text(value.statement) || supporting.length === 0) return null;
    const asOf = isoDateOrNull(value.asOf) || now;
    const created: ResearchClaimV1 = {
      id: id('claim', `${value.kind}:${value.statement}`),
      kind: value.kind,
      subjectScope: value.kind.startsWith('lead_') ? 'person' : 'company',
      classification: value.classification || 'fact',
      statement: text(value.statement),
      supportingEvidenceIds: supporting,
      contradictingEvidenceIds: [],
      confidence: Math.max(0, Math.min(1, value.confidence ?? 0.7)),
      freshness: {
        asOf,
        validUntil: isoAfterDate(asOf, value.validityDays ?? (value.classification === 'hypothesis' ? 14 : 30)),
        policyVersion: 'research-freshness/v1',
      },
      derivation: value.derivation || { method: 'rule', promptVersion: 'native-research/v2' },
    };
    claims.push(created);
    return created;
  };

  const companyName = text(input.lead.companyName) || domain;
  const companyFetchedAt = isoDateOrNull(input.company.fetchedAt) || now;
  const officialPages = input.company.official?.pages?.length
    ? input.company.official.pages
    : input.company.official ? [input.company.official] : [];
  const companyUrl = safeSourceUrl(officialPages[0]?.url, domain);
  const companyFactEvidence: ResearchEvidenceV1[] = [];

  for (const page of officialPages) {
    const content = usefulOfficialPageContent(page);
    if (!content) continue;
    const { statement, locator } = content;
    const source = addSource({
      url: page.url,
      type: 'official_site',
      title: page.title || companyName,
      provider: 'official-site',
      reliability: 0.9,
      retrievedAt: companyFetchedAt,
    });
    const itemEvidence = addEvidence({
      statement,
      source,
      kind: 'fact',
      confidence: 0.86,
      locator: { kind: 'page_section', value: locator },
      extractedAt: companyFetchedAt,
      extractionMethod: 'rule',
    });
    if (!itemEvidence || !source || !isQualifiedResearchFactEvidence({
      evidence: itemEvidence,
      source,
      companyName,
      companyDomain: domain,
    })) continue;

    companyFactEvidence.push(itemEvidence);
    addClaim({
      kind: officialClaimKind(page),
      statement,
      supportingEvidenceIds: [itemEvidence.id],
      confidence: itemEvidence.confidence,
      asOf: companyFetchedAt,
    });
  }

  const brandDescription = conciseSourceStatement(input.company.brand?.description);
  if (brandDescription && !isGenericResearchText(brandDescription)) {
    const source = addSource({
      url: `https://brand.dev/retrieve/${encodeURIComponent(domain)}`,
      type: 'other',
      title: 'Perfil de marca',
      provider: 'brand.dev',
      reliability: 0.72,
      retrievedAt: companyFetchedAt,
    });
    const itemEvidence = addEvidence({
      statement: `${companyName}: ${brandDescription}`,
      source,
      kind: 'fact',
      confidence: 0.72,
      locator: { kind: 'provider_annotation', value: 'brand_description' },
      extractedAt: companyFetchedAt,
      extractionMethod: 'provider',
    });
    if (itemEvidence && source && isQualifiedResearchFactEvidence({
      evidence: itemEvidence,
      source,
      companyName,
      companyDomain: domain,
    })) {
      companyFactEvidence.push(itemEvidence);
      addClaim({
        kind: 'company_industry',
        statement: itemEvidence.statement,
        supportingEvidenceIds: [itemEvidence.id],
        confidence: itemEvidence.confidence,
        asOf: companyFetchedAt,
      });
    }
  }

  const whoisCreated = text(input.company.whois?.created || input.company.whois?.creationDate);
  if (whoisCreated) {
    const source = addSource({
      url: `https://mcp.domaindetails.com/lookup/${encodeURIComponent(domain)}`,
      type: 'registry',
      title: 'Registro de dominio',
      provider: 'domaindetails',
      reliability: 0.68,
      retrievedAt: companyFetchedAt,
    });
    addEvidence({
      statement: `El dominio ${domain} registra actividad desde ${whoisCreated}.`,
      source,
      kind: 'observation',
      confidence: 0.68,
      locator: { kind: 'provider_annotation', value: 'domain_creation_date' },
      extractedAt: companyFetchedAt,
    });
  }

  const searchEvidence: Array<{ evidence: ResearchEvidenceV1; source: ResearchSourceV1; kind: 'news' | 'jobs' | 'mentions' }> = [];
  for (const kind of ['news', 'jobs', 'mentions'] as const) {
    const payload = kind === 'news' ? input.news : kind === 'jobs' ? input.jobs : input.mentions;
    const fetchedAt = isoDateOrNull(payload.fetchedAt) || now;
    const items = array(payload.items || payload.results || payload.organic_results).slice(0, 5);
    for (const item of items) {
      const link = validHttpUrl(item?.link || item?.url);
      const title = text(item?.title || item?.name);
      const snippet = text(item?.snippet || item?.description || item?.summary);
      if (!link || !isRelevantSearchResult({ title, snippet, link, companyName, companyDomain: domain })) continue;
      const source = addSource({
        url: link,
        type: kind === 'news' ? 'news' : kind === 'jobs' ? 'jobs' : 'other',
        title: title || 'Señal externa',
        publisher: text(item?.source),
        provider: text(payload.provider) || 'serper',
        reliability: 0.64,
        retrievedAt: fetchedAt,
        publishedAt: item?.date,
      });
      const itemEvidence = addEvidence({
        statement: conciseSourceStatement(`${title || 'Señal externa'}${snippet ? `: ${snippet}` : ''}`),
        source,
        kind: 'event',
        confidence: 0.64,
        locator: { kind: 'search_snippet', value: 'organic_result' },
        extractedAt: fetchedAt,
        observedAt: source?.publishedAt || fetchedAt,
      });
      if (itemEvidence && source && isRelevantResearchSignal({
        evidence: itemEvidence,
        source,
        companyName,
        companyDomain: domain,
      })) {
        searchEvidence.push({ evidence: itemEvidence, source, kind });
      }
    }
  }

  const visibleSignals = searchEvidence.slice(0, 3);
  for (const signal of visibleSignals) {
    const asOf = signal.source.publishedAt || signal.source.retrievedAt;
    const signalSummary = conciseSourceStatement(signal.evidence.statement, 280);
    addClaim({
      kind: signal.kind === 'jobs' ? 'hiring_signal' : signal.kind === 'news' ? 'news_signal' : 'site_signal',
      statement: signalSummary,
      supportingEvidenceIds: [signal.evidence.id],
      classification: 'fact',
      confidence: signal.evidence.confidence,
      validityDays: signal.source.publishedAt ? 14 : 7,
      asOf,
    });
  }
  const primarySignal = visibleSignals[0];
  if (primarySignal) {
    const asOf = primarySignal.source.publishedAt || primarySignal.source.retrievedAt;
    const signalSummary = conciseSourceStatement(primarySignal.evidence.statement, 280);
    if (companyFactEvidence.length > 0) {
      addClaim({
        kind: 'opportunity_hypothesis',
        statement: `Podría ser útil explorar si la señal “${signalSummary}” cambia alguna prioridad actual de ${companyName}, sin asumir una necesidad antes de confirmarla.`,
        supportingEvidenceIds: [primarySignal.evidence.id],
        classification: 'hypothesis',
        confidence: 0.61,
        validityDays: primarySignal.source.publishedAt ? 14 : 7,
        asOf,
      });
    }
  }

  const qualifiedSignals = searchEvidence.filter(({ evidence: itemEvidence, source }) => isRelevantResearchSignal({
    evidence: itemEvidence,
    source,
    companyName,
    companyDomain: domain,
  }));
  const profileFields = [
    input.lead.title,
    input.lead.headline,
    input.lead.seniority,
    ...(input.lead.departments || []),
    input.lead.city,
    input.lead.country,
  ].filter((value) => Boolean(text(value)));
  const reportWarnings = [...new Set(input.warnings)];
  if (companyFactEvidence.length === 0) reportWarnings.push('company_context_missing');
  if (profileFields.length === 0) reportWarnings.push('person_context_missing');

  const hasUsefulClaim = claims.length > 0;
  const status: NativeResearchStatus = companyFactEvidence.length > 0 && reportWarnings.length === 0
    ? 'completed'
    : hasUsefulClaim ? 'partial' : 'insufficient_data';
  const lifecycleErrors = reportWarnings.map((warning) => createError({
    code: warning.includes('http') ? 'provider_http_error' : warning.includes('timeout') ? 'provider_timeout' : 'insufficient_evidence',
    stage: warning.includes('official') ? 'fetch' : 'validate',
    message: warning.replace(/_/g, ' '),
    retryable: true,
  }));
  if (status === 'insufficient_data') lifecycleErrors.push(createError({ code: 'insufficient_evidence', stage: 'validate', message: 'No se obtuvo contexto público suficiente para explicar esta empresa.', retryable: true }));

  const qualifiedEvidence = [...companyFactEvidence, ...qualifiedSignals.map((item) => item.evidence)];
  const companyCoverage = Math.min(1, companyFactEvidence.length / 2);
  const personCoverage = Math.min(1, profileFields.length / 3);
  const recentSignalCount = qualifiedSignals.filter((item) => Boolean(item.source.publishedAt)).length;
  const recentCoverage = Math.min(1, recentSignalCount / 2);
  const overallConfidence = Math.max(0, Math.min(1, 0.2 + companyCoverage * 0.55 + personCoverage * 0.1 + recentCoverage * 0.15));
  const verifiedSourceCount = new Set(qualifiedEvidence.map((item) => item.sourceId)).size;
  const companyFactSourceCount = new Set(companyFactEvidence.map((item) => item.sourceId)).size;
  const researchQuality = assessResearchQuality({
    status,
    companyIdentityPresent: Boolean(domain || input.lead.companyName),
    emailPresent: Boolean(input.lead.email),
    leadRolePresent: Boolean(input.lead.title),
    evidenceCount: qualifiedEvidence.length,
    verifiedSourceCount,
    companyFactCount: companyFactEvidence.length,
    companyFactSourceCount,
    recentSignalCount,
    overallConfidence,
  });
  const snapshotId = deterministicLeadResearchSnapshotId({ providerReportId: input.reportId, scopeKey: input.access.organizationId, userId: input.access.userId });
  const snapshot: ResearchSnapshotV1 = ResearchSnapshotV1Schema.parse({
    kind: 'research_snapshot',
    schemaVersion: 'research-snapshot/v1',
    id: snapshotId,
    revision: 1,
    scope: { kind: 'organization', organizationId: input.access.organizationId, ownerUserId: input.access.userId },
    subject: {
      leadRef,
      ...(input.lead.id ? { leadId: input.lead.id } : {}),
      ...(input.lead.email ? { email: input.lead.email } : {}),
      person: {
        ...(input.lead.fullName ? { fullName: input.lead.fullName } : {}),
        ...(input.lead.title ? { title: input.lead.title } : {}),
        ...(input.lead.linkedinUrl ? { linkedinUrl: input.lead.linkedinUrl } : {}),
        ...(input.lead.city ? { city: input.lead.city } : {}),
        ...(input.lead.country ? { country: input.lead.country } : {}),
      },
      company: {
        ...(input.lead.companyName ? { name: input.lead.companyName } : {}),
        ...(domain ? { domain } : {}),
        ...(companyUrl ? { websiteUrl: companyUrl } : {}),
        ...(input.lead.companyLinkedinUrl ? { linkedinUrl: input.lead.companyLinkedinUrl } : {}),
        ...(input.lead.country ? { country: input.lead.country } : {}),
      },
    },
    request: {
      requestId: input.jobId,
      idempotencyKey: input.requestIdempotencyKey,
      inputFingerprint: `sha256:${hash({ lead: input.lead, options: input.options })}`,
      provider: NATIVE_PROVIDER,
      providerJobId: input.reportId,
      language: input.options.language,
      depth: input.options.depth,
      requestedAt: now,
    },
    lifecycle: {
      status,
      queuedAt: now,
      startedAt: now,
      completedAt: now,
      errors: lifecycleErrors,
    },
    sources,
    evidence,
    claims,
    contradictions: [],
    quality: {
      assessmentVersion: 'research-quality/v1',
      coverage: { company: companyCoverage, person: personCoverage, recentSignals: recentCoverage },
      overallConfidence,
    },
    createdAt: now,
    updatedAt: now,
  });

  const score = researchQuality.score;
  const priority: NativeResearchResult['priority'] = score >= 72 ? 'high' : score >= 48 ? 'medium' : 'low';
  const angle = claims.find((claim) => claim.kind === 'opportunity_hypothesis')?.statement || '';
  const result: NativeResearchResult = {
    status,
    reportId: input.reportId,
    researchSnapshotId: snapshotId,
    lead: input.lead,
    score,
    priority,
    evidence: evidence.map((item) => ({
      id: item.id,
      statement: item.statement,
      sourceId: item.sourceId,
      sourceUrl: sources.find((source) => source.id === item.sourceId)?.url || '',
      kind: item.kind === 'event' ? 'signal' : item.kind === 'fact' ? 'fact' : 'hypothesis',
    })),
    sources: sources.map((source) => ({ id: source.id, title: source.title || source.url, url: source.url, type: source.type, provider: source.provider })),
    angle,
    ordenEnvio: priority === 'high' ? 1 : priority === 'medium' ? 2 : 3,
    esperaSugeridaDias: priority === 'high' ? 2 : priority === 'medium' ? 4 : 7,
    promptPack: {
      context: [input.lead.fullName, input.lead.title, input.lead.companyName, domain].filter(Boolean).join(' | '),
      claims: claims.map((claim) => claim.statement).slice(0, 8),
      doNotClaim: ['No afirmar una necesidad que no esté respaldada por evidencia.', 'No convertir una hipótesis en un hecho.', 'No mencionar fuentes internas ni herramientas de investigación.'],
    },
    companyResearchCache: {
      hit: false,
      domain: domain || null,
      expiresAt: null,
      artifactId: null,
      cacheIdentity: null,
    },
    quality: researchQuality,
    draftEligibility: researchQuality.draftEligibility,
    warnings: reportWarnings,
  };
  return { snapshot, result };
}

function mapJob(row: any): NativeResearchJob | null {
  const idValue = text(row?.id);
  const organizationId = text(row?.organization_id);
  const userId = text(row?.user_id);
  const reportId = text(row?.provider_report_id);
  if (!idValue || !organizationId || !userId || !reportId) return null;
  return {
    id: idValue,
    organizationId,
    userId,
    scopeKey: text(row?.scope_key),
    providerReportId: reportId,
    requestIdempotencyKey: text(row?.request_idempotency_key),
    leadRef: text(row?.lead_ref),
    leadId: text(row?.lead_id) || null,
    email: text(row?.email).toLowerCase() || null,
    companyName: text(row?.company_name) || null,
    companyDomain: text(row?.company_domain).toLowerCase() || null,
    status: (text(row?.status).toLowerCase() || 'queued') as NativeResearchStatus,
    requestClaimState: text(row?.request_claim_state) || null,
    requestPayload: object(row?.request_payload),
    resultPayload: row?.result_payload == null ? null : object(row.result_payload),
    researchSnapshotId: text(row?.research_snapshot_id) || null,
    errorCode: text(row?.error_code) || null,
    errorMessage: text(row?.error_message) || null,
  };
}

async function claimNativeResearchRequest(input: NativeResearchAccess & {
  scopeKey: string;
  leadRef: string;
  leadId?: string | null;
  email?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  requestIdempotencyKey: string;
  requestPayload: Record<string, any>;
  staleAfterSeconds?: number;
}): Promise<LeadResearchRequestClaim | null> {
  const { data, error } = await getSupabaseAdminClient().rpc('claim_native_lead_research_request_v1', {
    p_scope_key: text(input.scopeKey),
    p_organization_id: text(input.organizationId) || null,
    p_user_id: text(input.userId),
    p_request_idempotency_key: text(input.requestIdempotencyKey),
    p_lead_ref: text(input.leadRef),
    p_lead_id: text(input.leadId) || null,
    p_email: text(input.email).toLowerCase() || null,
    p_company_name: text(input.companyName) || null,
    p_company_domain: text(input.companyDomain).toLowerCase() || null,
    p_request_payload: object(input.requestPayload),
    p_stale_after_seconds: Math.max(60, Math.trunc(Number(input.staleAfterSeconds) || 300)),
  });
  if (error) throw error;
  if (object(data).suppressed === true) return null;
  return parseLeadResearchRequestClaim(data);
}

async function isNativeResearchSuppressed(input: Pick<NativeResearchJob, 'email' | 'organizationId' | 'userId'>) {
  if (!input.email) return false;
  return isEmailSuppressedForScope(input.email, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
}

async function cancelNativeResearchClaim(input: NativeResearchAccess & {
  scopeKey: string;
  jobId: string;
  claimToken: string;
}) {
  const { data, error } = await getSupabaseAdminClient().rpc('cancel_native_lead_research_request_claim_v1', {
    p_job_id: input.jobId,
    p_scope_key: input.scopeKey,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_claim_token: input.claimToken,
  });
  if (error) throw error;
  return data === true;
}

async function settleSuppressedNativeResearchJobWithoutClaim(input: NativeResearchAccess & {
  scopeKey: string;
  jobId: string;
  email: string | null;
}) {
  const { data, error } = await getSupabaseAdminClient().rpc('settle_suppressed_native_lead_research_job_v1', {
    p_job_id: input.jobId,
    p_scope_key: input.scopeKey,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_email: input.email,
  });
  if (error) throw error;
  return data === true;
}

async function patchNativeIdentity(input: { jobId: string; reportId: string; requestPayload: Record<string, any> }) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('lead_research_jobs')
    .update({
      provider: NATIVE_PROVIDER,
      provider_report_id: input.reportId,
      request_payload: { ...input.requestPayload, native: true, provider: NATIVE_PROVIDER },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.jobId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('NATIVE_RESEARCH_PRIVACY_SUPPRESSED');
}

type NativeResearchEnqueueInput = {
  access: NativeResearchAccess;
  lead: NativeResearchLead;
  options?: Partial<NativeResearchOptions>;
  requestIdempotencyKey: string;
  runId?: string | null;
};

type HeldNativeResearchJob = {
  jobId: string;
  reportId: string;
  status: NativeResearchStatus;
  reused: boolean;
  claimToken: string | null;
};

async function enqueueNativeResearchInternal(input: NativeResearchEnqueueInput, holdClaim: boolean): Promise<HeldNativeResearchJob> {
  assertNativeResearchEnabled();
  const lead = NativeResearchLeadSchema.parse(input.lead);
  const options = NativeResearchOptionsSchema.parse(input.options || {});
  const leadRef = deriveNativeResearchLeadRef(lead);
  const requestPayload = {
    lead,
    options,
    ...(input.runId ? { run_id: input.runId } : {}),
  };
  const claim = await claimNativeResearchRequest({
    userId: input.access.userId,
    organizationId: input.access.organizationId,
    scopeKey: input.access.organizationId,
    leadRef,
    leadId: lead.id,
    email: lead.email,
    companyName: lead.companyName,
    companyDomain: companyResearchDomain(lead),
    requestIdempotencyKey: input.requestIdempotencyKey,
    requestPayload,
  });
  if (!claim) throw new Error('NATIVE_RESEARCH_PRIVACY_SUPPRESSED');
  const reportId = claim.job.providerReportId || `native:${claim.job.id}`;
  const needsIdentityPatch = claim.created || claim.recovered || !claim.job.providerReportId;
  if (needsIdentityPatch) {
    await patchNativeIdentity({ jobId: claim.job.id, reportId, requestPayload });
  }

  const releasableClaim = claim.claimed && Boolean(claim.claimToken) && claim.job.requestClaimState === 'pre_provider';
  if (releasableClaim && !holdClaim) {
    try {
      await releaseLeadResearchRequestClaim({
        userId: input.access.userId,
        organizationId: input.access.organizationId,
        scopeKey: input.access.organizationId,
        jobId: claim.job.id,
        claimToken: claim.claimToken!,
        errorCode: '',
        errorMessage: '',
      });
    } catch (error) {
      console.warn('[native-research] initial claim release failed; worker recovery will retry:', error);
    }
  }

  return {
    jobId: claim.job.id,
    reportId,
    status: isTerminalNativeResearchStatus(claim.job.status) ? claim.job.status : 'queued',
    reused: !claim.created,
    claimToken: holdClaim && releasableClaim ? claim.claimToken : null,
  };
}

export async function enqueueNativeResearch(input: NativeResearchEnqueueInput) {
  const queued = await enqueueNativeResearchInternal(input, false);
  const { claimToken: _claimToken, ...result } = queued;
  return result;
}

export async function enqueueHeldNativeResearch(input: NativeResearchEnqueueInput) {
  return enqueueNativeResearchInternal(input, true);
}

export async function releaseHeldNativeResearchClaim(input: NativeResearchAccess & {
  jobId: string;
  claimToken: string;
}) {
  return releaseLeadResearchRequestClaim({
    userId: input.userId,
    organizationId: input.organizationId,
    scopeKey: input.organizationId,
    jobId: input.jobId,
    claimToken: input.claimToken,
    errorCode: '',
    errorMessage: '',
  });
}

export async function abortHeldNativeResearchClaim(input: NativeResearchAccess & {
  jobId: string;
  claimToken: string;
}) {
  const { data, error } = await getSupabaseAdminClient().rpc('abort_native_lead_research_request_claim_v1', {
    p_job_id: input.jobId,
    p_scope_key: input.organizationId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_claim_token: input.claimToken,
    p_error_code: 'native_research_run_setup_failed',
    p_error_message: 'The native research run could not be initialized safely.',
  });
  if (error) throw error;
  return data === true;
}

export async function findNativeResearchJob(input: { reportId: string; access: NativeResearchAccess }) {
  const admin = getSupabaseAdminClient();
  const query = admin
    .from('lead_research_jobs')
    .select('*')
    .eq('provider', NATIVE_PROVIDER)
    .eq('provider_report_id', input.reportId)
    .eq('user_id', input.access.userId);
  const { data, error } = await applyReadableOrganizationScope(query, input.access).maybeSingle();
  if (error) throw error;
  return mapJob(data);
}

export async function listNativeResearchRun(input: { runId: string; access: NativeResearchAccess }) {
  const admin = getSupabaseAdminClient();
  const runQuery = admin
    .from('research_runs')
    .select('*')
    .eq('id', input.runId)
    .eq('user_id', input.access.userId);
  const { data: run, error: runError } = await applyReadableOrganizationScope(runQuery, input.access).maybeSingle();
  if (runError) throw runError;
  if (!run) return null;
  const runOrganizationId = text(run.organization_id);
  const { data: items, error: itemsError } = await admin
    .from('research_run_items')
    .select('id,job_id,lead_ref,position,status,error_code,error_message,updated_at')
    .eq('run_id', input.runId)
    .eq('organization_id', runOrganizationId)
    .eq('user_id', input.access.userId)
    .order('position', { ascending: true });
  if (itemsError) throw itemsError;
  const jobIds = (items || []).map((item: any) => item.job_id).filter(Boolean);
  const { data: jobs, error: jobsError } = jobIds.length
    ? await admin
      .from('lead_research_jobs')
      .select('id,provider_report_id,status,result_payload,research_snapshot_id,error_code,error_message,organization_id,user_id')
      .in('id', jobIds)
      .eq('organization_id', runOrganizationId)
      .eq('user_id', input.access.userId)
    : { data: [], error: null };
  if (jobsError) throw jobsError;
  const byJobId = new Map((jobs || []).map((job: any) => [job.id, job]));
  return {
    ...run,
    items: (items || []).map((item: any) => ({ ...item, job: byJobId.get(item.job_id) || null })),
  };
}

function resultFromStoredPayload(value: unknown): NativeResearchResult | null {
  const payload = object(value);
  const status = NativeResearchStatusSchema.safeParse(text(payload.status).toLowerCase());
  if (!status.success || !text(payload.reportId) || !Array.isArray(payload.evidence) || !Array.isArray(payload.sources)) {
    return null;
  }

  return payload as NativeResearchResult;
}

export async function listNativeResearchLeadStatuses(input: {
  leadIds: string[];
  access: NativeResearchAccess;
}): Promise<NativeResearchLeadStatus[]> {
  const leadIds = [...new Set(input.leadIds.map(text).filter(Boolean))].slice(0, 200);
  if (leadIds.length === 0) return [];

  const query = getSupabaseAdminClient()
    .from('lead_research_jobs')
    .select('lead_id,status,provider_report_id,research_snapshot_id,result_payload,error_code,updated_at')
    .eq('provider', NATIVE_PROVIDER)
    .eq('user_id', input.access.userId)
    .in('lead_id', leadIds)
    .order('updated_at', { ascending: false })
    .limit(Math.min(1_000, leadIds.length * 5));
  const { data, error } = await applyReadableOrganizationScope(query, input.access);
  if (error) throw error;

  const latestByLeadId = new Map<string, NativeResearchLeadStatus>();
  for (const row of data || []) {
    const leadId = text((row as any).lead_id);
    const status = NativeResearchStatusSchema.safeParse(text((row as any).status).toLowerCase());
    if (!leadId || !status.success || latestByLeadId.has(leadId)) continue;

    const payload = object((row as any).result_payload);
    latestByLeadId.set(leadId, {
      leadId,
      status: status.data,
      reportId: text((row as any).provider_report_id),
      researchSnapshotId: text((row as any).research_snapshot_id) || text(payload.researchSnapshotId) || null,
      result: resultFromStoredPayload(payload),
      errorCode: text((row as any).error_code) || null,
      updatedAt: text((row as any).updated_at) || null,
    });
  }

  return Array.from(latestByLeadId.values());
}

async function persistNativeSnapshot(input: {
  job: NativeResearchJob;
  output: NativeResearchPipelineOutput;
}) {
  const admin = getSupabaseAdminClient();
  const serialized = canonicalJson(input.output.snapshot);
  const contentHash = hash(input.output.snapshot);
  const { error: insertError } = await admin.from('research_snapshots').upsert({
    id: input.output.snapshot.id,
    scope_key: input.job.organizationId,
    organization_id: input.job.organizationId,
    user_id: input.job.userId,
    lead_ref: input.output.snapshot.subject.leadRef,
    source: NATIVE_PROVIDER,
    schema_version: 1,
    payload: input.output.snapshot,
    content_hash: contentHash,
    captured_at: input.output.snapshot.createdAt,
    created_at: input.output.snapshot.createdAt,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: owned, error: ownedError } = await admin
    .from('research_snapshots')
    .select('id,content_hash')
    .eq('id', input.output.snapshot.id)
    .eq('organization_id', input.job.organizationId)
    .eq('user_id', input.job.userId)
    .maybeSingle();
  if (ownedError) throw ownedError;
  if (!owned || owned.content_hash !== contentHash) throw new Error('NATIVE_RESEARCH_SNAPSHOT_CONFLICT');

  const resultPayload = {
    ...input.output.result,
    snapshot: input.output.snapshot,
    serialized_size: serialized.length,
    provider_status: input.output.snapshot.lifecycle.status,
    research_snapshot_id: input.output.snapshot.id,
  };
  const { error: jobError } = await admin
    .from('lead_research_jobs')
    .update({
      status: input.output.snapshot.lifecycle.status,
      result_payload: resultPayload,
      research_snapshot_id: input.output.snapshot.id,
      error_code: null,
      error_message: null,
      completed_at: input.output.snapshot.lifecycle.completedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.job.id)
    .eq('organization_id', input.job.organizationId)
    .eq('user_id', input.job.userId)
    .is('research_snapshot_id', null);
  if (jobError) throw jobError;
  return input.output.snapshot.id;
}

export async function settleNativeResearchRunItems(input: {
  jobId: string;
  organizationId: string;
  userId: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.rpc('settle_native_research_run_items_v1', {
    p_job_id: input.jobId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_status: input.status,
    p_error_code: input.errorCode || null,
    p_error_message: input.errorMessage || null,
  });
  if (error) throw error;
}

async function updateRunItem(input: { job: NativeResearchJob; status: string; errorCode?: string | null; errorMessage?: string | null }) {
  return settleNativeResearchRunItems({
    jobId: input.job.id,
    organizationId: input.job.organizationId,
    userId: input.job.userId,
    status: input.status,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  });
}

async function settleSuppressedNativeResearchJob(input: {
  job: NativeResearchJob;
  access: NativeResearchAccess & { scopeKey: string };
  claimToken?: string;
}) {
  const cancelled = input.claimToken
    ? await cancelNativeResearchClaim({
      ...input.access,
      jobId: input.job.id,
      claimToken: input.claimToken,
    })
    : await settleSuppressedNativeResearchJobWithoutClaim({
      ...input.access,
      jobId: input.job.id,
      email: input.job.email,
    });
  if (cancelled) {
    await updateRunItem({
      job: input.job,
      status: 'failed',
      errorCode: 'privacy_suppressed',
      errorMessage: 'Research was cancelled because the recipient is suppressed.',
    });
  }
  return cancelled;
}

async function processJob(job: NativeResearchJob) {
  const access = { organizationId: job.organizationId, userId: job.userId, scopeKey: job.scopeKey };
  const claim = await claimNativeResearchRequest({
    userId: job.userId,
    organizationId: job.organizationId,
    scopeKey: job.scopeKey,
    leadRef: job.leadRef,
    leadId: job.leadId,
    email: job.email,
    companyName: job.companyName,
    companyDomain: job.companyDomain,
    requestIdempotencyKey: job.requestIdempotencyKey,
    requestPayload: job.requestPayload,
    staleAfterSeconds: 180,
  });
  if (!claim) {
    await settleSuppressedNativeResearchJob({ job, access });
    return false;
  }
  if (!claim.claimed || !claim.claimToken) {
    if (claim.job.requestClaimState === 'provider_unknown' || claim.job.requestClaimState === 'provider_failed') {
      await updateRunItem({
        job,
        status: claim.job.status,
        errorCode: claim.job.errorCode,
        errorMessage: claim.job.errorMessage,
      });
    }
    return false;
  }

  const owned = { ...access, jobId: job.id, claimToken: claim.claimToken };
  if (await isNativeResearchSuppressed(job)) {
    await settleSuppressedNativeResearchJob({ job, access, claimToken: claim.claimToken });
    return false;
  }
  const recoveringTerminalResult = claim.job.requestClaimState === 'terminal_pending';
  try {
    if (recoveringTerminalResult) {
      const durableSnapshot = ResearchSnapshotV1Schema.parse(object(claim.job.resultPayload?.snapshot));
      const durableResult = { ...object(claim.job.resultPayload) };
      delete durableResult.snapshot;
      const recoveredJob: NativeResearchJob = {
        ...job,
        providerReportId: claim.job.providerReportId || job.providerReportId,
        status: claim.job.status as NativeResearchStatus,
        requestClaimState: claim.job.requestClaimState,
        requestPayload: claim.job.requestPayload,
        resultPayload: claim.job.resultPayload,
        researchSnapshotId: claim.job.researchSnapshotId,
        errorCode: claim.job.errorCode,
        errorMessage: claim.job.errorMessage,
      };
      const snapshotId = await persistNativeSnapshot({
        job: recoveredJob,
        output: { snapshot: durableSnapshot, result: durableResult as NativeResearchResult },
      });
      await completeLeadResearchRequestClaim({
        ...owned,
        providerReportId: recoveredJob.providerReportId,
        status: durableSnapshot.lifecycle.status,
        leadRef: recoveredJob.leadRef,
        leadId: recoveredJob.leadId,
        email: recoveredJob.email,
        companyName: recoveredJob.companyName,
        companyDomain: recoveredJob.companyDomain,
        requestPayload: recoveredJob.requestPayload,
        phase: 'release',
      });
      await updateRunItem({ job: recoveredJob, status: durableSnapshot.lifecycle.status });
      console.info('[native-research] recovered terminal result', { jobId: job.id, snapshotId });
      return true;
    }

    const limits = await getEffectiveDailyQuotaLimits({ userId: job.userId, organizationId: job.organizationId });
    const quota = await consumeLeadResearchRequestQuota({ ...owned, limit: limits.research });
    if (!quota.allowed) {
      await releaseLeadResearchRequestClaim({ ...owned, errorCode: 'daily_research_quota_exceeded', errorMessage: 'Daily research quota exceeded.' });
      await updateRunItem({ job, status: 'failed', errorCode: 'daily_research_quota_exceeded', errorMessage: 'Daily research quota exceeded.' });
      return false;
    }
    if (await isNativeResearchSuppressed(job)) {
      await settleSuppressedNativeResearchJob({ job, access, claimToken: claim.claimToken });
      return false;
    }
    await markLeadResearchRequestProviderSubmitting(owned);
    if (await isNativeResearchSuppressed(job)) {
      await settleSuppressedNativeResearchJob({ job, access, claimToken: claim.claimToken });
      return false;
    }
    const lead = NativeResearchLeadSchema.parse({
      id: job.leadId,
      fullName: object(job.requestPayload.lead).fullName,
      email: job.email,
      title: object(job.requestPayload.lead).title,
      headline: object(job.requestPayload.lead).headline,
      seniority: object(job.requestPayload.lead).seniority,
      departments: object(job.requestPayload.lead).departments,
      linkedinUrl: object(job.requestPayload.lead).linkedinUrl,
      companyName: job.companyName,
      companyDomain: job.companyDomain,
      companyWebsite: object(job.requestPayload.lead).companyWebsite,
      companyLinkedinUrl: object(job.requestPayload.lead).companyLinkedinUrl,
      organizationIndustry: object(job.requestPayload.lead).organizationIndustry,
      organizationSize: object(job.requestPayload.lead).organizationSize,
      city: object(job.requestPayload.lead).city,
      country: object(job.requestPayload.lead).country,
    });
    const options = NativeResearchOptionsSchema.parse(object(job.requestPayload.options));
    const company = await collectCompanySignals({ organizationId: job.organizationId, lead, options });
    if (company.busy) {
      await releaseLeadResearchRequestClaim({
        ...owned,
        errorCode: 'company_research_in_progress',
        errorMessage: 'A matching company research artifact is already being generated.',
      });
      await updateRunItem({
        job,
        status: 'queued',
        errorCode: 'company_research_in_progress',
        errorMessage: 'A matching company research artifact is already being generated.',
      });
      return false;
    }
    const search = await collectSearchSignals({ organizationId: job.organizationId, lead, options });
    if (await isNativeResearchSuppressed(job)) {
      await settleSuppressedNativeResearchJob({ job, access, claimToken: claim.claimToken });
      return false;
    }
    const output = buildSnapshot({
      jobId: job.id,
      reportId: job.providerReportId,
      requestIdempotencyKey: job.requestIdempotencyKey,
      access,
      lead,
      options,
      company: company.signals,
      news: search.news,
      jobs: search.jobs,
      mentions: search.mentions,
      warnings: [...company.warnings, ...search.warnings],
    });
    output.result.companyResearchCache = {
      hit: company.cacheHit,
      domain: company.signals.domain || null,
      expiresAt: company.expiresAt,
      artifactId: company.artifactId,
      cacheIdentity: company.cacheIdentity,
    };
    await completeLeadResearchRequestClaim({
      ...owned,
      providerReportId: job.providerReportId,
      status: output.snapshot.lifecycle.status,
      leadRef: job.leadRef,
      leadId: job.leadId,
      email: job.email,
      companyName: job.companyName,
      companyDomain: job.companyDomain,
      requestPayload: job.requestPayload,
      resultPayload: { ...output.result, snapshot: output.snapshot } as any,
      phase: 'store_terminal',
    });
    const snapshotId = await persistNativeSnapshot({ job, output });
    await completeLeadResearchRequestClaim({
      ...owned,
      providerReportId: job.providerReportId,
      status: output.snapshot.lifecycle.status,
      leadRef: job.leadRef,
      leadId: job.leadId,
      email: job.email,
      companyName: job.companyName,
      companyDomain: job.companyDomain,
      requestPayload: job.requestPayload,
      phase: 'release',
    });
    await updateRunItem({ job, status: output.snapshot.lifecycle.status });
    console.info('[native-research] completed', { jobId: job.id, snapshotId, status: output.snapshot.lifecycle.status });
    return true;
  } catch (error: any) {
    const message = text(error?.message) || 'Native research failed.';
    try {
      if (!recoveringTerminalResult) {
        await failLeadResearchRequestClaim({ ...owned, errorCode: 'native_research_failed', errorMessage: message, resultPayload: { provider_status: 'failed' } });
      }
    } catch (persistError) {
      console.error('[native-research] failed to persist job error:', persistError);
    }
    await updateRunItem({ job, status: 'failed', errorCode: 'native_research_failed', errorMessage: message });
    console.error('[native-research] job failed:', { jobId: job.id, error: message });
    return false;
  }
}

export async function processNativeResearchQueue(input: {
  limit?: number;
  organizationId?: string;
  userId?: string;
} = {}) {
  if (!isNativeResearchEnabled()) {
    return { claimed: 0, completed: 0, failed: 0 };
  }
  const admin = getSupabaseAdminClient();
  const limit = Math.max(1, Math.min(25, Math.trunc(Number(input.limit) || 5)));
  const now = new Date();
  const dueAt = now.toISOString();
  const staleAt = new Date(now.getTime() - 180_000).toISOString();
  const scopedQueue = (query: any) => {
    if (input.organizationId) query = query.eq('organization_id', input.organizationId);
    if (input.userId) query = query.eq('user_id', input.userId);
    return query;
  };
  const readyQuery = scopedQueue(
    admin
      .from('lead_research_jobs')
      .select('*')
      .eq('provider', NATIVE_PROVIDER)
      .in('status', ['queued', 'running', 'completed', 'partial', 'insufficient_data'])
      .in('request_claim_state', ['retryable', 'terminal_pending'])
      .lte('scheduled_for', dueAt)
      .order('scheduled_for', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit),
  );
  const stalePreProviderQuery = scopedQueue(
    admin
      .from('lead_research_jobs')
      .select('*')
      .eq('provider', NATIVE_PROVIDER)
      .eq('status', 'queued')
      .eq('request_claim_state', 'pre_provider')
      .lte('scheduled_for', dueAt)
      .lt('request_claimed_at', staleAt)
      .order('request_claimed_at', { ascending: true })
      .limit(limit),
  );
  const staleSubmittingQuery = scopedQueue(
    admin
      .from('lead_research_jobs')
      .select('*')
      .eq('provider', NATIVE_PROVIDER)
      .eq('status', 'running')
      .eq('request_claim_state', 'provider_submitting')
      .lte('scheduled_for', dueAt)
      .lt('request_claimed_at', staleAt)
      .order('request_claimed_at', { ascending: true })
      .limit(limit),
  );
  const [
    { data: ready, error: readyError },
    { data: stalePreProvider, error: stalePreProviderError },
    { data: staleSubmitting, error: staleSubmittingError },
  ] = await Promise.all([
    readyQuery,
    stalePreProviderQuery,
    staleSubmittingQuery,
  ]);
  if (readyError) throw readyError;
  if (stalePreProviderError) throw stalePreProviderError;
  if (staleSubmittingError) throw staleSubmittingError;
  const seen = new Set<string>();
  const jobs = [...(staleSubmitting || []), ...(stalePreProvider || []), ...(ready || [])]
    .map(mapJob)
    .filter((job): job is NativeResearchJob => Boolean(job))
    .filter((job) => !seen.has(job.id) && Boolean(seen.add(job.id)))
    .slice(0, limit);
  let completed = 0;
  for (const job of jobs) {
    if (await processJob(job)) completed += 1;
  }
  return { claimed: jobs.length, completed, failed: jobs.length - completed };
}

export async function getNativeSnapshot(input: { snapshotId: string; access: NativeResearchAccess }) {
  const admin = getSupabaseAdminClient();
  const query = admin
    .from('research_snapshots')
    .select('id,organization_id,payload,content_hash,captured_at')
    .eq('id', input.snapshotId)
    .eq('user_id', input.access.userId);
  const { data, error } = await applyReadableOrganizationScope(query, input.access).maybeSingle();
  if (error) throw error;
  return data || null;
}

export function nativeResearchJobToResult(job: NativeResearchJob) {
  return {
    jobId: job.id,
    reportId: job.providerReportId,
    status: job.status,
    researchSnapshotId: job.researchSnapshotId,
    result: job.resultPayload,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  };
}

export const nativeResearchInternals = {
  boundedOfficialSiteChunk,
  candidateOfficialPageUrls,
  fetchOfficialSite,
  isPrivateIpAddress,
  isRelevantSearchResult,
  isSafeOfficialSiteUrl,
  officialPageFromHtml,
  pinnedOfficialSiteLookup,
  usefulOfficialPageContent,
};

export type { NativeResearchAccess, NativeResearchJob, NativeResearchPipelineOutput };
