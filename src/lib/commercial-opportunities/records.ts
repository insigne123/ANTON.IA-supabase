import type { HiringOpportunity, JobAd, JobAdSource } from './hiring';
import { tenderUrl, type Tender, type TenderAiVerdict, type TenderSource } from './tenders';
import type { SeiaProject } from './projects';

/**
 * The rows of «empresas contratando» (plan 8, phase 3): one commercial_opportunities row per company and one
 * commercial_opportunity_signals row per ad, trimmed to the limits of the tables (supabase/migrations/20261002170000_*).
 * Data about companies only: a signal keeps the company fields of the ad, never the person who posted it.
 */
export const HIRING_WINDOW_DAYS = 30;
export const OPPORTUNITY_STATUSES = ['new', 'interested', 'dismissed', 'converted'] as const;
export type OpportunityStatus = typeof OPPORTUNITY_STATUSES[number];

const clip = (value: string | null | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};
const httpUrl = (value: string | null | undefined) => (value && /^https?:\/\//i.test(value) && value.length <= 2000 ? value : null);
const isoOrNull = (value: string | null | undefined) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);

export type HiringOpportunityData = {
  ads: number;
  adsLastWeek: number;
  roles: Array<{ role: string; ads: number }>;
  regions: Array<{ region: string; ads: number }>;
  publishers: string[];
  sources: JobAdSource[];
  size: string | null;
  industry: string | null;
  isClient: boolean;
  isContact: boolean;
  firstPostedAt: string | null;
  lastPostedAt: string | null;
  windowDays: number;
  evidence: Array<{ source: JobAdSource; title: string; location: string | null; publisher: string | null; url: string | null; postedAt: string | null }>;
};

/**
 * The row for one company that is hiring. Status, owner and first sighting are never sent, so a new sync keeps where the
 * person left it («Me interesa», «Descartar») and only refreshes the count, the score and the evidence.
 */
export function hiringOpportunityRow(item: HiringOpportunity, scope: { organizationId: string; profileId: string | null }, now: string) {
  const data: HiringOpportunityData = {
    ads: item.ads, adsLastWeek: item.adsLastWeek, roles: item.roles.slice(0, 10), regions: item.regions.slice(0, 6),
    publishers: item.publishers.slice(0, 8), sources: item.sources, size: clip(item.size, 40), industry: clip(item.industry, 120),
    isClient: item.isClient, isContact: item.isContact, firstPostedAt: item.firstPostedAt, lastPostedAt: item.lastPostedAt,
    windowDays: HIRING_WINDOW_DAYS,
    evidence: item.evidence.slice(0, 5).map(ad => ({
      source: ad.source, title: clip(ad.title, 200) || 'Aviso', location: clip(ad.location, 120), publisher: clip(ad.publisher, 60),
      url: httpUrl(ad.url), postedAt: isoOrNull(ad.postedAt),
    })),
  };
  return {
    organization_id: scope.organizationId,
    profile_id: scope.profileId,
    kind: 'hiring' as const,
    dedupe_key: item.key.slice(0, 300),
    title: clip(item.company, 500) || 'Empresa',
    company_name: clip(item.company, 300),
    company_domain: clip(item.domain, 253),
    company_linkedin_url: clip(httpUrl(item.linkedinUrl), 500),
    region: clip(item.regions[0]?.region, 120),
    published_at: isoOrNull(item.lastPostedAt),
    url: item.domain ? `https://${item.domain}` : httpUrl(item.linkedinUrl),
    score: Math.max(0, Math.min(100, Math.round(item.score))),
    reasons: item.reasons.slice(0, 10).map(reason => reason.slice(0, 300)),
    signal_count: item.ads,
    last_seen_at: now,
    updated_at: now,
    data,
  };
}
export type HiringOpportunityRow = ReturnType<typeof hiringOpportunityRow>;

/** One ad as evidence of its company. `seen_at` moves forward each time a source brings it again. */
export function hiringSignalRow(ad: JobAd, scope: { organizationId: string; opportunityId: string }, now: string) {
  return {
    organization_id: scope.organizationId,
    opportunity_id: scope.opportunityId,
    source: ad.source,
    external_id: ad.externalId.slice(0, 300),
    title: clip(ad.title, 500) || 'Aviso',
    location: clip(ad.location, 200),
    publisher: clip(ad.publisher, 120),
    url: httpUrl(ad.url),
    posted_at: isoOrNull(ad.postedAt),
    seen_at: now,
    data: {
      company: clip(ad.company, 300), companyDomain: clip(ad.companyDomain, 253), companyLinkedinUrl: clip(httpUrl(ad.companyLinkedinUrl), 500),
      companySize: clip(ad.companySize, 40), companyIndustry: clip(ad.companyIndustry, 120), region: clip(ad.region, 60),
    },
  };
}
export type HiringSignalRow = ReturnType<typeof hiringSignalRow>;

const SOURCES = new Set<JobAdSource>(['jsearch', 'linkedin', 'jooble']);
/** A stored signal back as an ad, so the companies are regrouped with every ad of the window and not only today's. */
export function jobAdFromSignal(row: {
  source: string; external_id: string; title: string; location: string | null; publisher: string | null; url: string | null;
  posted_at: string | null; seen_at: string | null; data: Record<string, unknown> | null;
}): JobAd | null {
  if (!SOURCES.has(row.source as JobAdSource)) return null;
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const field = (key: string) => (typeof data[key] === 'string' && data[key] ? String(data[key]) : null);
  return {
    source: row.source as JobAdSource, externalId: row.external_id, title: row.title, company: field('company') || '',
    companyDomain: field('companyDomain'), companyLinkedinUrl: field('companyLinkedinUrl'), companySize: field('companySize'),
    companyIndustry: field('companyIndustry'), location: row.location, region: field('region'), publisher: row.publisher, url: row.url,
    // An ad without a date counts from the last time a source brought it, never as published today forever.
    postedAt: row.posted_at || row.seen_at,
  };
}

export type TenderOpportunityData = {
  source: TenderSource; code: string; buyerUnit: string | null; status: string | null; keywords: string[];
  description: string | null; items: Array<{ code: string | null; name: string }>;
  /** Plan 15: what the model said when it read the tender against the offer; absent when only the words found it. */
  ai?: TenderAiVerdict;
};
const kindOf = (source: TenderSource) => (source === 'mercado_publico' ? 'tender' as const : 'compra_agil' as const);

/** The row of a tender or a Compra Ágil quote that fits the offer. As with companies, status and owner are never sent. */
export function tenderOpportunityRow(tender: Tender, match: { score: number; reasons: string[]; keywords: string[]; ai?: TenderAiVerdict | null },
  scope: { organizationId: string; profileId: string | null }, now: string) {
  const data: TenderOpportunityData = {
    source: tender.source, code: tender.code, buyerUnit: clip(tender.buyerUnit, 300), status: tender.status, keywords: match.keywords.slice(0, 10),
    description: clip(tender.description, 1500), items: tender.items.slice(0, 10).map(item => ({ code: item.code, name: item.name.slice(0, 200) })),
    ...(match.ai ? { ai: { fit: match.ai.fit, reason: match.ai.reason.slice(0, 200), profileKey: match.ai.profileKey.slice(0, 16) } } : {}),
  };
  return {
    organization_id: scope.organizationId, profile_id: scope.profileId, kind: kindOf(tender.source), dedupe_key: tender.code.slice(0, 300),
    title: clip(tender.name, 500) || tender.code, buyer_name: clip(tender.buyer, 300), region: clip(tender.region, 120),
    amount: tender.amount, currency: clip(tender.currency, 8), deadline_at: isoOrNull(tender.closesAt), published_at: isoOrNull(tender.publishedAt),
    url: tenderUrl(tender), score: Math.max(0, Math.min(100, Math.round(match.score))), reasons: match.reasons.slice(0, 10).map(reason => reason.slice(0, 300)),
    signal_count: 1, last_seen_at: now, updated_at: now, data,
  };
}
export type TenderOpportunityRow = ReturnType<typeof tenderOpportunityRow>;

export type StoredTenderRow = {
  dedupe_key: string; title: string; buyer_name: string | null; region: string | null; amount: number | string | null; currency: string | null;
  deadline_at: string | null; published_at: string | null; data: Partial<TenderOpportunityData> | null;
};
/** A Mercado Público tender as it was saved with its detail, so the next search reuses it instead of asking again. */
export function tenderFromStoredRow(row: StoredTenderRow): Tender {
  const data = row.data || {};
  const amount = row.amount === null || row.amount === undefined ? null : Number(row.amount);
  return {
    source: 'mercado_publico', code: data.code || row.dedupe_key, name: row.title, description: data.description ?? null,
    buyer: row.buyer_name, buyerUnit: data.buyerUnit ?? null, region: row.region, amount: Number.isFinite(amount) ? amount : null,
    currency: row.currency, publishedAt: row.published_at, closesAt: row.deadline_at, status: data.status ?? null,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

/** The tender as its own evidence: source, code, buyer and dates, without the official who published it. */
export function tenderSignalRow(tender: Tender, scope: { organizationId: string; opportunityId: string }, now: string) {
  return {
    organization_id: scope.organizationId, opportunity_id: scope.opportunityId, source: tender.source, external_id: tender.code.slice(0, 300),
    title: clip(tender.name, 500) || tender.code, location: clip(tender.region, 200), publisher: clip(tender.buyer, 120), url: tenderUrl(tender),
    posted_at: isoOrNull(tender.publishedAt), seen_at: now,
    data: { buyerUnit: clip(tender.buyerUnit, 300), amount: tender.amount, currency: clip(tender.currency, 8), closesAt: isoOrNull(tender.closesAt) },
  };
}
export type TenderSignalRow = ReturnType<typeof tenderSignalRow>;

export type ProjectOpportunityData = {
  owner: string | null; presentation: 'DIA' | 'EIA' | null; typology: string | null; sector: string | null; state: string | null;
  communes: string | null; presentedAt: string | null; qualifiedAt: string | null; investmentMusd: number | null;
};
/** A SEIA project: its owner is the company to reach. Status and owner of the row are never sent, as with the rest. */
export function projectOpportunityRow(project: SeiaProject, match: { score: number; reasons: string[]; sector: string | null },
  scope: { organizationId: string; profileId: string | null }, now: string) {
  const data: ProjectOpportunityData = {
    owner: clip(project.owner, 300), presentation: project.presentation, typology: clip(project.typology, 300), sector: match.sector,
    state: clip(project.state, 60), communes: clip(project.communes, 200), presentedAt: project.presentedAt, qualifiedAt: project.qualifiedAt,
    investmentMusd: project.investmentMusd,
  };
  return {
    organization_id: scope.organizationId, profile_id: scope.profileId, kind: 'project' as const, dedupe_key: project.id.slice(0, 300),
    title: clip(project.name, 500) || project.id, company_name: clip(project.owner, 300), region: clip(project.region, 120),
    amount: project.investmentMusd === null ? null : Math.round(project.investmentMusd * 1_000_000), currency: 'USD',
    published_at: project.presentedAt ? `${project.presentedAt}T12:00:00.000Z` : null, url: httpUrl(project.url),
    score: Math.max(0, Math.min(100, Math.round(match.score))), reasons: match.reasons.slice(0, 10).map(reason => reason.slice(0, 300)),
    signal_count: 1, last_seen_at: now, updated_at: now, data,
  };
}
export type ProjectOpportunityRow = ReturnType<typeof projectOpportunityRow>;

export function projectSignalRow(project: SeiaProject, scope: { organizationId: string; opportunityId: string }, now: string) {
  return {
    organization_id: scope.organizationId, opportunity_id: scope.opportunityId, source: 'seia' as const, external_id: project.id.slice(0, 300),
    title: clip(project.name, 500) || project.id, location: clip([project.communes, project.region].filter(Boolean).join(', '), 200),
    publisher: 'SEIA', url: httpUrl(project.url), posted_at: project.presentedAt ? `${project.presentedAt}T12:00:00.000Z` : null, seen_at: now,
    data: { owner: clip(project.owner, 300), state: clip(project.state, 60), investmentMusd: project.investmentMusd, presentation: project.presentation },
  };
}
export type ProjectSignalRow = ReturnType<typeof projectSignalRow>;
