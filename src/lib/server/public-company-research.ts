import { extractClaimsFromSourcesV2, consolidateReportV2Claims } from '@/ai/flows/extract-report-v2-claims';
import { generateStructured } from '@/ai/openai-json';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { canonicalResearchUrl, type ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { PUBLIC_COMPANY_TTL_MS, PublicCompanyIdentitySchema, PublicCompanyReferenceSchema, publicCompanyHost, publicCompanyExternalBlock,
  type PublicCompanyGraph, type PublicCompanyIdentity, type PublicCompanyReference } from '@/lib/public-company-research-contracts';
import { fetchReportV2Source } from './research-report-v2-research';
import { searchSerper } from './serper-search';
import { getSupabaseAdminClient } from './supabase-admin';
import { validatePublicCompanyGraph } from './public-company-research-validation';

export function sharedPublicCompanyEnabled() { return process.env.SHARED_PUBLIC_COMPANY_RESEARCH_ENABLED === 'true'; }
export type PublicCompanyMetrics = { state: 'hit' | 'miss' | 'busy'; expired: boolean; queries: number; pages: number; extractionBatches: number; elapsedMs: number; costUsd: null };
export type PublicCompanyResult = { graph: PublicCompanyGraph; reference: PublicCompanyReference; metrics: PublicCompanyMetrics };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

// This API deliberately cannot receive a lead, snapshot, seller or provider payload.
export async function collectPublicCompany(input: { identity: PublicCompanyIdentity; organizationId: string; signal?: AbortSignal }, dependencies: {
  fetchSource?: typeof fetchReportV2Source; search?: typeof searchSerper; extract?: typeof extractClaimsFromSourcesV2;
} = {}) {
  const identity = PublicCompanyIdentitySchema.parse(input.identity);
  const pages = new Map<string, ParsedWebEvidenceV2>();
  const attempted = new Set<string>();
  const signal = AbortSignal.any([AbortSignal.timeout(150_000), ...(input.signal ? [input.signal] : [])]);
  const maxPages = identity.depth === 'basic' ? 3 : identity.depth === 'deep' ? 8 : 6;
  const fetchOne = async (url: string, external = false) => {
    signal.throwIfAborted();
    const canonical = canonicalResearchUrl(url);
    const host = publicCompanyHost(canonical);
    if ((!external && host !== identity.domain) || (external && (host === identity.domain || host.endsWith(`.${identity.domain}`)))
      || attempted.has(canonical) || attempted.size >= (external ? 10 : 6) || pages.size >= (external ? maxPages : maxPages - 1)) return;
    attempted.add(canonical);
    const page = await (dependencies.fetchSource || fetchReportV2Source)({ url: canonical, domain: external ? host : identity.domain, signal, exactHost: true });
    if (publicCompanyHost(page.source.canonicalUrl) !== (external ? host : identity.domain)) throw new Error('PUBLIC_COMPANY_IDENTITY_MISMATCH');
    if (external) {
      page.source.ownDomain = false;
      // The fetcher classified this as its own host for redirect pinning, not as the target company.
      page.source.sourceType = 'other';
      page.blocks = page.blocks.filter((block) => publicCompanyExternalBlock(block, identity.domain));
      if (!page.blocks.length) return;
    }
    pages.set(page.source.id, page);
  };
  // Root failure is not a cacheable negative result and never falls back to private context.
  await fetchOne(`https://${identity.domain}/`);
  const root = [...pages.values()][0];
  const countryPath = ({ CL: 'chile', PE: 'peru', CO: 'colombia' } as Record<string, string>)[identity.country];
  const local = root.links.find((link) => {
    try { return countryPath && new URL(link.url).pathname.replace(/\/$/, '') === `/${countryPath}` && publicCompanyHost(link.url) === identity.domain; }
    catch { return false; }
  });
  if (local) await fetchOne(local.url);
  const primary = [...pages.values()].at(-1)!;
  for (const link of primary.links.filter((link) => /nosotros|about|servicios|services|solutions|soluciones/i.test(new URL(link.url).pathname)).slice(0, 3)) {
    await fetchOne(link.url).catch(() => undefined);
  }
  // Fixed company-only plan. No persona, seller, existing claims or private hints.
  const topics = identity.depth === 'basic' ? ['servicios empresa'] : ['servicios empresa', 'noticias expansion contratacion'];
  let queries = 0;
  for (const topic of topics) {
    signal.throwIfAborted();
    queries += 1;
    const result = await (dependencies.search || searchSerper)({ organizationId: input.organizationId, kind: 'organic',
      query: `site:${identity.domain} ${identity.country} ${topic}`, countryCode: identity.country.toLowerCase(), language: identity.language, limit: 4 }, { maxRetries: 0 });
    for (const item of result.items) if (item.link) await fetchOne(item.link).catch(() => undefined);
  }
  // One bounded public complement, cached with the official evidence for all leads.
  signal.throwIfAborted();
  queries += 1;
  const external = await (dependencies.search || searchSerper)({ organizationId: input.organizationId, kind: 'organic',
    // Free Serper accounts reject quoted-domain queries. Exact-domain evidence
    // and exclusion of the official host are enforced by fetchOne, not operators.
    query: `${identity.domain} ${identity.country} noticias expansion contratacion`,
    countryCode: identity.country.toLowerCase(), language: identity.language, limit: 4 }, { maxRetries: 0 });
  for (const item of external.items) if (item.link) await fetchOne(item.link, true).catch(() => undefined);
  signal.throwIfAborted();
  const sources = [...pages.values()];
  const results: Awaited<ReturnType<typeof extractClaimsFromSourcesV2>>[] = [];
  for (let offset = 0; offset < sources.length; offset += 3) {
    signal.throwIfAborted();
    results.push(await (dependencies.extract || extractClaimsFromSourcesV2)({ companyName: identity.domain,
      companyDomain: identity.domain, sources: sources.slice(offset, offset + 3), providerContext: null,
      capturedAt: new Date().toISOString() }, { generate: (options) => generateStructured({ ...options, signal }) }));
  }
  if (results.some((result) => result.failedSourceIds.length)) throw new Error('PUBLIC_COMPANY_EXTRACTION_INCOMPLETE');
  signal.throwIfAborted();
  const facts = results.flatMap((result) => result.facts);
  // A content ID is not proof of origin: bind every raw fact to the actual fetched
  // block before publishing, including facts not referenced by any claim.
  for (const fact of facts) {
    const page = pages.get(fact.sourceId);
    const block = fact.locator?.match(/^block:([1-9]\d*)$/);
    if (!page || !block || page.blocks[Number(block[1]) - 1] !== fact.text) throw new Error('PUBLIC_COMPANY_FACT_ORIGIN_INVALID');
  }
  const consolidated = consolidateReportV2Claims({ drafts: results.flatMap((result) => result.claimDrafts), facts });
  const claims = consolidated.claims.filter((claim) => !claim.dimension.startsWith('contact_')
    && !['risk', 'volume_estimate', 'competitor', 'buying_committee'].includes(claim.dimension) && claim.scope !== 'person' && claim.scope !== 'sector');
  return { graph: validatePublicCompanyGraph({ sources: sources.map((source) => source.source), facts, claims }, identity),
    queries, pages: sources.length, extractionBatches: results.length };
}

export async function loadPublicCompany(input: { identity: PublicCompanyIdentity; organizationId: string; refresh?: boolean; signal?: AbortSignal }, dependencies: {
  admin?: RpcClient; collect?: typeof collectPublicCompany; now?: () => number; metric?: (metric: PublicCompanyMetrics) => void;
} = {}): Promise<PublicCompanyResult> {
  const identity = PublicCompanyIdentitySchema.parse(input.identity);
  if (!input.organizationId.trim()) throw new Error('PUBLIC_COMPANY_ORGANIZATION_REQUIRED');
  const now = dependencies.now || Date.now;
  const started = now();
  const admin = dependencies.admin || getSupabaseAdminClient();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, { p_organization_id: input.organizationId, ...args });
    if (error) throw new Error('PUBLIC_COMPANY_STORE_UNAVAILABLE');
    return data;
  };
  input.signal?.throwIfAborted();
  const claim = await rpc('claim_public_company_research_v1', { p_identity: identity, p_refresh: input.refresh === true });
  const metrics: PublicCompanyMetrics = { state: claim.state, expired: claim.expired === true, queries: 0, pages: 0, extractionBatches: 0, elapsedMs: 0, costUsd: null };
  const emit = () => { metrics.elapsedMs = Math.max(0, now() - started); (dependencies.metric || ((value) => console.info('[public-company-research]', value)))(metrics); };
  if (claim.state === 'busy') {
    emit();
    throw Object.assign(new Error('PUBLIC_COMPANY_RESEARCH_BUSY'), { code: 'PUBLIC_COMPANY_RESEARCH_BUSY', retryable: true });
  }
  let artifact = claim.artifact;
  if (!artifact || artifact.organization_id !== input.organizationId || canonicalSha256(artifact.identity) !== canonicalSha256(identity)) throw new Error('PUBLIC_COMPANY_SCOPE_MISMATCH');
  if (claim.state === 'miss') {
    if (!artifact.lease_token || Date.parse(artifact.lease_until) <= now()) throw new Error('PUBLIC_COMPANY_LEASE_INVALID');
    const lease = { p_id: artifact.id, p_token: artifact.lease_token };
    try {
      const result = await (dependencies.collect || collectPublicCompany)({ identity, organizationId: input.organizationId, signal: input.signal });
      const graph = validatePublicCompanyGraph(result.graph, identity, now());
      const capturedAt = Math.min(...graph.sources.map((source) => Date.parse(source.retrievedAt)));
      artifact = await rpc('complete_public_company_research_v1', { ...lease, p_payload: graph,
        p_captured_at: new Date(capturedAt).toISOString(), p_expires_at: new Date(capturedAt + PUBLIC_COMPANY_TTL_MS).toISOString() });
      Object.assign(metrics, { queries: result.queries, pages: result.pages, extractionBatches: result.extractionBatches });
    } catch (error) {
      await rpc('release_public_company_research_v1', lease).catch(() => undefined);
      throw error;
    }
  } else if (claim.state !== 'hit') throw new Error('PUBLIC_COMPANY_CLAIM_INVALID');
  if (artifact.organization_id !== input.organizationId || canonicalSha256(artifact.identity) !== canonicalSha256(identity)
    || !Number.isInteger(artifact.revision) || artifact.revision < 1 || Date.parse(artifact.expires_at) <= now()
    || !Number.isFinite(Date.parse(artifact.expires_at)) || Date.parse(artifact.expires_at) > Date.parse(artifact.captured_at) + PUBLIC_COMPANY_TTL_MS) throw new Error('PUBLIC_COMPANY_ARTIFACT_INVALID');
  const graph = validatePublicCompanyGraph(artifact.payload, identity, now());
  if (Date.parse(artifact.captured_at) !== Math.min(...graph.sources.map((source) => Date.parse(source.retrievedAt)))) throw new Error('PUBLIC_COMPANY_CAPTURE_INVALID');
  emit();
  return { graph, reference: PublicCompanyReferenceSchema.parse({ artifactId: artifact.id, revision: artifact.revision, identity, expiresAt: artifact.expires_at }), metrics };
}
