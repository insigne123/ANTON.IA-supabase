import type { HiringOpportunity, JobAd, JobAdSource } from './hiring';

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
