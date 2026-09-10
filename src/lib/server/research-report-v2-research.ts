import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { generateStructured } from '@/ai/openai-json';
import { extractClaimsFromSourcesV2, consolidateReportV2Claims, EXTRACT_REPORT_V2_CLAIMS_PROMPT_VERSION } from '@/ai/flows/extract-report-v2-claims';
import { buildReportV2Committee } from '@/ai/flows/build-report-v2-committee';
import { planReportV2Research, PLAN_REPORT_V2_PROMPT_VERSION } from '@/ai/flows/plan-report-v2-research';
import { resolveEntityV2, RESOLVE_ENTITY_V2_PROMPT_VERSION } from '@/ai/flows/resolve-entity';
import type { SellerProfileContextV2 } from '@/ai/flows/reason-about-report-v2-account';
import { canonicalResearchUrl, parseWebEvidenceV2, type ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';
import type { ReportV2SnapshotProjection } from '@/lib/report-v2-snapshot-adapter';
import { depthFromAllowedDepth, getResearchDepthBudget, type ResearchDepth } from '@/lib/research-depth-budgets';
import { searchSerper } from './serper-search';
import { publicCompanyCoverageWarnings, type PublicCompanyReference } from '@/lib/public-company-research-contracts';
import { mergePublicCompanyProjection } from '@/lib/public-company-research-adapter';

export const REPORT_V2_RESEARCH_VERSION = `report-v2/research/1:${RESOLVE_ENTITY_V2_PROMPT_VERSION}:${PLAN_REPORT_V2_PROMPT_VERSION}:${EXTRACT_REPORT_V2_CLAIMS_PROMPT_VERSION}`;

export async function fetchReportV2Source(input: { url: string; domain: string; signal?: AbortSignal; exactHost?: boolean }): Promise<ParsedWebEvidenceV2> {
  const { nativeResearchInternals } = await import('./native-research');
  let url = new URL(input.url);
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(input.signal ? [input.signal] : [])]);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    signal.throwIfAborted();
    if (input.exactHost && (url.protocol !== 'https:' || url.hostname.replace(/^www\./, '') !== input.domain.replace(/^www\./, ''))) throw new Error('REPORT_V2_DOMAIN_REDIRECT_REJECTED');
    if (!nativeResearchInternals.isSafeOfficialSiteUrl(url)) throw new Error('REPORT_V2_UNSAFE_URL');
    const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      lookup(url.hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => nativeResearchInternals.isPrivateIpAddress(address))) throw new Error('REPORT_V2_UNSAFE_DNS');
    const response = await new Promise<{ status: number; location?: string; html: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal, lookup: nativeResearchInternals.pinnedOfficialSiteLookup(addresses[0] as { address: string; family: 4 | 6 }),
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'ANTON.IA Research/2.0' },
      }, (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) { response.resume(); resolve({ status, location: response.headers.location, html: '' }); return; }
        if (status !== 200 || !/html|text\//i.test(response.headers['content-type'] || '')) {
          response.resume(); reject(new Error(`REPORT_V2_SOURCE_HTTP_${status}`)); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) { response.destroy(new Error('REPORT_V2_SOURCE_TOO_LARGE')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end();
    });
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error('REPORT_V2_REDIRECT_MISSING');
      url = new URL(response.location, url);
      continue;
    }
    const source = parseWebEvidenceV2({ html: response.html, url: url.toString(), targetDomain: input.domain, retrievedAt: new Date().toISOString() });
    let chars = 0;
    source.blocks = source.blocks.filter((block) => block.length >= 45).filter((block) => { chars += block.length; return chars <= 12_000; }).slice(0, 50);
    if (!source.blocks.length) throw new Error('REPORT_V2_EMPTY_SOURCE');
    return source;
  }
  throw new Error('REPORT_V2_REDIRECT_LIMIT');
}

export async function gatherReportV2Research(input: {
  projection: ReportV2SnapshotProjection;
  sellerProfile: SellerProfileContextV2;
  organizationId: string;
  language: string;
  generatedAt?: string;
  depth?: ResearchDepth;
  signal?: AbortSignal;
  publicCompanyResearch?: PublicCompanyReference;
}, dependencies: {
  plan?: typeof planReportV2Research;
  search?: typeof searchSerper;
  fetchSource?: typeof fetchReportV2Source;
  extract?: typeof extractClaimsFromSourcesV2;
  resolve?: typeof resolveEntityV2;
  generate?: typeof generateStructured;
  loadPublicCompany?: typeof import('./public-company-research').loadPublicCompany;
} = {}) {
  const started = Date.now();
  if (input.publicCompanyResearch) {
    if (input.publicCompanyResearch.identity.domain !== input.projection.entity.companyDomain.replace(/^www\./, '')
      || input.projection.entity.contactCountry !== 'OTHER' && input.publicCompanyResearch.identity.country !== input.projection.entity.contactCountry
      || input.publicCompanyResearch.identity.language !== input.language.toLowerCase()) throw new Error('PUBLIC_COMPANY_MERGE_INVALID');
    const { loadPublicCompany } = await import('./public-company-research');
    const company = await (dependencies.loadPublicCompany || loadPublicCompany)({ identity: input.publicCompanyResearch.identity, organizationId: input.organizationId, signal: input.signal });
    return { ...mergePublicCompanyProjection(input.projection, company.graph, company.reference),
      researchWarnings: publicCompanyCoverageWarnings(company.graph), researchMetrics: { queries: company.metrics.queries, pages: company.metrics.pages, elapsedMs: Date.now() - started },
      publicCompanyResearch: company.reference };
  }
  const signal = AbortSignal.any([AbortSignal.timeout(150_000), ...(input.signal ? [input.signal] : [])]);
  const depth = input.depth || depthFromAllowedDepth(input.projection.qualification.allowedDepth);
  const depthBudget = getResearchDepthBudget(depth);
  const generate: typeof generateStructured = (options) => (dependencies.generate || generateStructured)({ ...options, signal });
  const warnings: string[] = [];
  let entity = input.projection.entity;
  const domain = entity.companyDomain;
  const fetched = new Map<string, ParsedWebEvidenceV2>();
  const attempted = new Set<string>();
  const fetchOne = async (url: string) => {
    if (attempted.size >= depthBudget.maxPages || fetched.size >= depthBudget.maxPages || signal.aborted) return;
    let key: string;
    try { key = canonicalResearchUrl(url); } catch { return; }
    if (attempted.has(key)) return;
    attempted.add(key);
    try {
      const source = await (dependencies.fetchSource || fetchReportV2Source)({ url, domain, signal });
      fetched.set(source.source.id, source);
    } catch { warnings.push('source_unavailable'); }
  };
  await fetchOne(`https://${domain}/`);
  const root = [...fetched.values()][0];
  const countryPath = { PE: 'peru', CL: 'chile', CO: 'colombia', OTHER: '' }[entity.contactCountry];
  const ownDomain = (value: string) => {
    const host = new URL(value).hostname.replace(/^www\./, '');
    const target = domain.replace(/^www\./, '');
    return host === target || host.endsWith(`.${target}`);
  };
  const local = root?.links.find((link) => countryPath && new URL(link.url).pathname.match(new RegExp(`^/${countryPath}/?$`)) && ownDomain(link.url));
  if (local) await fetchOne(local.url);
  const primary = [...fetched.values()].at(-1);
  const preferred = primary?.links.filter((link) => {
    const url = new URL(link.url);
    return ownDomain(link.url)
      && /quienes-somos|nosotros|about|servicios|services|solutions|soluciones|portfolio/i.test(url.pathname)
      && (!local || url.pathname.includes(`/${countryPath}/`));
  }).slice(0, 2) || [];
  await Promise.all(preferred.map((link) => fetchOne(link.url)));
  try {
    const resolved = await (dependencies.resolve || resolveEntityV2)({
      contact: { ...entity.contact, company: entity.companyName, country: entity.contactCountry, linkedin: entity.contact.linkedinUrl },
      domain, sources: [...fetched.values()],
    }, { generate });
    // A model may refine context, but cannot switch the researched identity to another domain.
    entity = { ...resolved, companyDomain: domain, contact: { ...resolved.contact, fullName: entity.contact.fullName, title: entity.contact.title } };
  } catch { warnings.push('identity_model_unavailable'); }
  const plan = await (dependencies.plan || planReportV2Research)({
    entity,
    sellerProfile: input.sellerProfile,
    existingClaimsSummary: input.projection.claims.slice(0, 15),
    targetTitles: input.projection.qualification.redirectTo.map((role) => role.title),
    depth,
    maxQueries: depthBudget.maxQueries,
  }, { generate });
  const searches = [];
  for (let offset = 0; offset < Math.min(plan.queries.length, depthBudget.maxQueries); offset += 3) {
    if (signal.aborted) break;
    searches.push(...await Promise.all(plan.queries.slice(offset, Math.min(offset + 3, depthBudget.maxQueries)).map(async (query) => {
      const after = query.recencyDays ? ` after:${new Date(Date.now() - query.recencyDays * 86_400_000).toISOString().slice(0, 10)}` : '';
      try {
        return await (dependencies.search || searchSerper)({ organizationId: input.organizationId, kind: 'organic', query: `${query.query}${after}`, language: input.language, countryCode: entity.contactCountry === 'OTHER' ? 'cl' : entity.contactCountry.toLowerCase(), limit: 4 }, { maxRetries: 0 });
      } catch { warnings.push('search_unavailable'); return null; }
    })));
  }
  const candidates: string[] = [];
  for (let rank = 0; rank < 4; rank += 1) {
    for (const search of searches) {
      const url = search?.items[rank]?.link;
      if (!url || /\.(?:pdf|docx?|xlsx?)(?:\?|$)/i.test(url)) continue;
      try {
        if (/(?:^|\.)(?:facebook|instagram|tiktok|youtube)\.com$/i.test(new URL(url).hostname)) continue;
        candidates.push(url);
      } catch { /* Ignore malformed search URLs. */ }
    }
  }
  for (let offset = 0; offset < candidates.length && attempted.size < depthBudget.maxPages && fetched.size < depthBudget.maxPages;) {
    const batchSize = Math.min(3, depthBudget.maxPages - fetched.size);
    await Promise.all(candidates.slice(offset, offset + batchSize).map(fetchOne));
    offset += batchSize;
  }
  const sources = [...fetched.values()].slice(0, depthBudget.maxPages);
  if (!sources.length) return { ...input.projection, entity, researchWarnings: [...warnings, 'web_context_unavailable'], researchMetrics: { queries: searches.length, pages: 0, elapsedMs: Date.now() - started } };
  const results: Awaited<ReturnType<typeof extractClaimsFromSourcesV2>>[] = [];
  for (let offset = 0; offset < sources.length && !signal.aborted; offset += 3) {
    results.push(await (dependencies.extract || extractClaimsFromSourcesV2)({ companyName: entity.companyName, companyDomain: domain, sources: sources.slice(offset, offset + 3), providerContext: entity.contact, capturedAt: input.generatedAt || new Date().toISOString() }, { generate }));
  }
  const facts = results.flatMap((result) => result.facts);
  const consolidated = consolidateReportV2Claims({ drafts: results.flatMap((result) => result.claimDrafts), facts });
  if (results.some((result) => result.failedSourceIds.length)) warnings.push('some_claims_unavailable');
  if (consolidated.conflicts.length) warnings.push('conflicting_source_figures');
  const projection: ReportV2SnapshotProjection = consolidated.claims.length ? {
    ...input.projection, entity, sources: sources.map((source) => source.source), facts,
    claims: consolidated.claims, shortIdMap: consolidated.shortIdMap,
    committee: buildReportV2Committee({ entity, qualification: input.projection.qualification, claims: consolidated.claims }),
  } : { ...input.projection, entity };
  return {
    ...projection,
    researchWarnings: warnings,
    researchMetrics: { queries: searches.length, pages: sources.length, elapsedMs: Date.now() - started },
  };
}
