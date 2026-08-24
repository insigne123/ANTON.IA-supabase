import { createHash } from 'node:crypto';

import { extractJsonFromMaybeFencedDetailed } from '@/lib/extract-json';
import {
  ResearchSnapshotV1Schema,
  isSubstantiveResearchTextV1,
  type ContractErrorV1,
  type OwnershipScopeV1,
  type ResearchClaimKindV1,
  type ResearchClaimV1,
  type ResearchEvidenceV1,
  type ResearchSnapshotV1,
  type ResearchSourceV1,
  type ResearchStatusV1,
} from '@/lib/research-contracts';

const ADAPTER_VERSION = 'legacy-research-adapter/v1';

type UnknownRecord = Record<string, unknown>;
type LegacyIdKind = 'snapshot' | 'request' | 'source' | 'evidence' | 'claim' | 'contradiction' | 'draft';

export type LegacyResearchSubjectV1 = {
  leadId?: string;
  email?: string;
  person?: {
    fullName?: string;
    title?: string;
    linkedinUrl?: string;
    city?: string;
    country?: string;
  };
  company?: {
    name?: string;
    domain?: string;
    websiteUrl?: string;
    linkedinUrl?: string;
    country?: string;
  };
};

export type LegacyResearchAdapterOptionsV1 = {
  scope: OwnershipScopeV1;
  leadRef: string;
  subject?: LegacyResearchSubjectV1;
  provider?: string;
  requestId?: string;
  idempotencyKey?: string;
  providerJobId?: string;
  language?: string;
  depth?: 'basic' | 'standard' | 'deep';
  requestedAt?: string | Date;
  snapshotId?: string;
  now?: () => string | Date;
  idFactory?: (kind: LegacyIdKind, seed: string) => string;
};

export type LegacyMessagingDraftV1 = {
  kind: 'legacy_messaging_draft';
  id: string;
  channel: 'email';
  variant?: string;
  subject?: string;
  body?: string;
  subjectLines: string[];
  talkTracks: string[];
  valuePropositions: string[];
  nextSteps: Array<{ action: string; why?: string; priority?: string }>;
};

export type LegacyResearchExtras = {
  detectedShape: 'nested_report' | 'flat_cross' | 'assistant_content' | 'array' | 'unknown';
  recoveredTruncatedJson: boolean;
  warnings: string[];
  reportId?: string;
  providerStatus?: string;
};

export type AdaptedLegacyResearchV1 = {
  snapshot: ResearchSnapshotV1;
  drafts: LegacyMessagingDraftV1[];
  legacyExtras: LegacyResearchExtras;
};

type UnwrappedLegacyPayload = {
  value: UnknownRecord;
  annotations: unknown[];
  recovered: boolean;
  detectedShape: LegacyResearchExtras['detectedShape'];
  invalid: boolean;
};

type NormalizedSource = ResearchSourceV1 & {
  legacyIds: string[];
  annotationIndex?: number;
};

type ClaimCandidate = {
  kind: ResearchClaimKindV1;
  subjectScope: 'company' | 'person';
  classification: 'fact' | 'hypothesis';
  statement: string;
  path: string;
  sourceRefs: string[];
  sourceUrl?: string;
  observedAt?: string;
  confidence: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = nonEmpty(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!isRecord(item)) return '';
      return firstString(item.statement, item.detail, item.title, item.text, item.action) || '';
    }).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function firstRecord(...values: unknown[]): UnknownRecord {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function defaultIdFactory(kind: LegacyIdKind, seed: string): string {
  return `${kind}_${sha256(seed).slice(7, 27)}`;
}

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function requireNow(options: LegacyResearchAdapterOptionsV1): string {
  const value = options.now ? options.now() : new Date();
  const normalized = isoDate(value);
  if (!normalized) throw new TypeError('Legacy research adapter now() must return a valid date');
  return normalized;
}

function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function validHttpUrl(value: unknown): string | undefined {
  const raw = nonEmpty(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  url.searchParams.sort();
  return url.toString();
}

function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const text = value.map((part) => {
    if (typeof part === 'string') return part;
    if (!isRecord(part)) return '';
    if (typeof part.text === 'string') return part.text;
    const text = asRecord(part.text);
    return typeof text.value === 'string' ? text.value : '';
  }).join('');
  return nonEmpty(text);
}

function parseContent(value: unknown): { value: unknown; recovered: boolean } | null {
  if (isRecord(value)) return { value, recovered: false };
  const text = contentText(value);
  const extracted = text ? extractJsonFromMaybeFencedDetailed(text) : null;
  return extracted || (Array.isArray(value) ? { value, recovered: false } : null);
}

function findEnvelope(payload: unknown): UnknownRecord | undefined {
  const candidates = [
    ...asArray(payload),
    ...asArray(asRecord(payload).choices),
  ];
  if (isRecord(payload)) candidates.unshift(payload);
  return candidates.find((candidate) => {
    const record = asRecord(candidate);
    const message = asRecord(record.message);
    return contentText(message.content) !== undefined || contentText(record.content) !== undefined;
  }) as UnknownRecord | undefined;
}

function unwrapLegacyPayload(payload: unknown): UnwrappedLegacyPayload {
  const originalWasArray = Array.isArray(payload);
  const envelope = findEnvelope(payload);
  if (envelope) {
    const message = asRecord(envelope.message);
    const extracted = parseContent(message.content ?? envelope.content);
    const parsed = extracted?.value;
    const parsedRecord = Array.isArray(parsed)
      ? asRecord(parsed.find(isRecord))
      : asRecord(parsed);
    if (Object.keys(parsedRecord).length > 0) {
      const nested = asRecord(parsedRecord.report);
      return {
        value: Object.keys(nested).length > 0 ? { ...parsedRecord, ...nested } : parsedRecord,
        annotations: asArray(message.annotations ?? envelope.annotations),
        recovered: Boolean(extracted?.recovered),
        detectedShape: 'assistant_content',
        invalid: false,
      };
    }
    return {
      value: {},
      annotations: asArray(message.annotations ?? envelope.annotations),
      recovered: Boolean(extracted?.recovered),
      detectedShape: 'assistant_content',
      invalid: true,
    };
  }

  if (typeof payload === 'string') {
    const extracted = parseContent(payload);
    if (extracted) {
      const parsed = Array.isArray(extracted.value)
        ? asRecord(extracted.value.find(isRecord))
        : asRecord(extracted.value);
      const nested = asRecord(parsed.report);
      return {
        value: Object.keys(nested).length > 0 ? { ...parsed, ...nested } : parsed,
        annotations: [],
        recovered: extracted.recovered,
        detectedShape: Object.keys(nested).length > 0 ? 'nested_report' : 'flat_cross',
        invalid: Object.keys(parsed).length === 0,
      };
    }
  }

  let record = isRecord(payload)
    ? payload
    : asRecord(asArray(payload).find(isRecord));
  if (isRecord(record.json)) record = record.json;
  const nested = asRecord(record.report);
  if (Object.keys(nested).length > 0) {
    return {
      value: { ...record, ...nested },
      annotations: asArray(record.annotations),
      recovered: false,
      detectedShape: 'nested_report',
      invalid: false,
    };
  }
  return {
    value: record,
    annotations: asArray(record.annotations),
    recovered: false,
    detectedShape: originalWasArray ? 'array' : Object.keys(record).length > 0 ? 'flat_cross' : 'unknown',
    invalid: Object.keys(record).length === 0,
  };
}

function sourceType(source: UnknownRecord, urlValue: string): ResearchSourceV1['type'] {
  const requested = firstString(source.type, source.kind)?.toLowerCase();
  const known = new Set<ResearchSourceV1['type']>([
    'official_site', 'linkedin', 'news', 'jobs', 'technology', 'search_result', 'registry', 'other',
  ]);
  if (requested && known.has(requested as ResearchSourceV1['type'])) return requested as ResearchSourceV1['type'];
  if (requested === 'site' || requested === 'website') return 'official_site';
  if (requested === 'tech') return 'technology';
  if (requested === 'hiring' || requested === 'job') return 'jobs';
  const url = new URL(urlValue);
  if (url.hostname.includes('linkedin.com')) return 'linkedin';
  if (/\/(jobs?|careers?|empleos?)(\/|$)/i.test(url.pathname)) return 'jobs';
  return 'other';
}

function sourceReliability(source: UnknownRecord, type: ResearchSourceV1['type']): number {
  const value = Number(source.reliability ?? source.confidence);
  if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  if (type === 'official_site' || type === 'registry') return 0.9;
  if (type === 'news' || type === 'linkedin') return 0.75;
  return 0.65;
}

function annotationCitation(annotation: unknown): UnknownRecord {
  const record = asRecord(annotation);
  return firstRecord(record.url_citation, record.urlCitation, record.citation);
}

function collectSourceInputs(value: UnknownRecord, annotations: unknown[]): UnknownRecord[] {
  const existingCompat = asRecord(value.existing_compat);
  const cross = firstRecord(existingCompat.cross, value.cross);
  const websiteSummary = asRecord(value.website_summary);
  const company = firstRecord(value.company, cross.company);
  const direct = [
    ...asArray(value.sources),
    ...asArray(cross.sources),
    ...asArray(websiteSummary.sources),
  ].map((source) => typeof source === 'string' ? { url: source } : asRecord(source));

  asArray(value.signals).forEach((signal) => {
    const record = asRecord(signal);
    if (record.url) direct.push({
      ...record,
      type: record.type,
      publishedAt: record.published_at ?? record.publishedAt ?? record.when,
    });
  });

  const companyWebsite = firstString(company.website, company.website_url, value.website);
  if (companyWebsite) direct.push({
    url: companyWebsite,
    title: firstString(company.name, value.company_name),
    type: 'official_site',
  });

  annotations.forEach((annotation, index) => {
    const citation = annotationCitation(annotation);
    if (citation.url) direct.push({
      ...citation,
      annotationIndex: index,
      type: citation.type || 'search_result',
    });
  });

  return direct;
}

function buildSources(
  value: UnknownRecord,
  annotations: unknown[],
  provider: string,
  now: string,
  idFactory: NonNullable<LegacyResearchAdapterOptionsV1['idFactory']>,
  warnings: string[],
): NormalizedSource[] {
  const byCanonicalUrl = new Map<string, NormalizedSource>();
  collectSourceInputs(value, annotations).forEach((source, index) => {
    const rawUrl = firstString(source.url, source.link);
    const url = validHttpUrl(rawUrl);
    if (!url) {
      if (rawUrl) warnings.push(`Ignored invalid source URL at sources[${index}].`);
      return;
    }
    const canonical = canonicalUrl(url);
    const legacyId = firstString(source.id, source.source_id);
    const existing = byCanonicalUrl.get(canonical);
    if (existing) {
      if (legacyId && !existing.legacyIds.includes(legacyId)) existing.legacyIds.push(legacyId);
      if (!existing.title) existing.title = firstString(source.title, source.name);
      if (!existing.publisher) existing.publisher = firstString(source.publisher, source.domain);
      if (!existing.publishedAt) existing.publishedAt = isoDate(source.publishedAt ?? source.published_at ?? source.date ?? source.when);
      if (existing.provider === provider) existing.provider = firstString(source.provider) || existing.provider;
      return;
    }
    const type = sourceType(source, url);
    const rawPublishedAt = source.publishedAt ?? source.published_at ?? source.date ?? source.when;
    const publishedAt = isoDate(rawPublishedAt);
    if (rawPublishedAt && !publishedAt) warnings.push(`Ignored invalid publication date for ${url}.`);
    const rawRetrievedAt = source.retrievedAt ?? source.retrieved_at;
    const retrievedAt = isoDate(rawRetrievedAt) || now;
    if (rawRetrievedAt && !isoDate(rawRetrievedAt)) warnings.push(`Ignored invalid retrieval date for ${url}.`);
    const contentHash = typeof source.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(source.contentHash)
      ? source.contentHash as `sha256:${string}`
      : undefined;
    byCanonicalUrl.set(canonical, {
      id: idFactory('source', canonical),
      type,
      url,
      canonicalUrl: canonical,
      title: firstString(source.title, source.name),
      publisher: firstString(source.publisher, source.domain),
      provider: firstString(source.provider) || provider,
      publishedAt,
      retrievedAt,
      contentHash,
      reliability: sourceReliability(source, type),
      legacyIds: legacyId ? [legacyId] : [],
      annotationIndex: typeof source.annotationIndex === 'number' ? source.annotationIndex : undefined,
    });
  });
  return [...byCanonicalUrl.values()];
}

function candidateItems(value: unknown): Array<{ statement: string; sourceRefs: string[]; sourceUrl?: string; observedAt?: string }> {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map((item) => {
    if (typeof item === 'string') return { statement: item.trim(), sourceRefs: [] };
    if (typeof item === 'number' && Number.isFinite(item)) return { statement: String(item), sourceRefs: [] };
    const record = asRecord(item);
    const sourceRefs = [
      ...stringArray(record.source_ids ?? record.sourceIds),
      ...stringArray(record.source_id ?? record.sourceId),
    ];
    return {
      statement: firstString(record.statement, record.detail, record.title, record.text, record.value) || '',
      sourceRefs,
      sourceUrl: firstString(record.url, record.source_url, record.sourceUrl),
      observedAt: isoDate(record.observed_at ?? record.observedAt ?? record.published_at ?? record.when),
    };
  }).filter((item) => item.statement);
}

function confidenceValue(map: UnknownRecord, keys: string[], fallback: number, warnings: string[]): number {
  for (const key of keys) {
    if (!(key in map)) continue;
    const value = Number(map[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
    warnings.push(`Ignored invalid confidence for ${key}.`);
    return fallback;
  }
  return fallback;
}

function buildClaimCandidates(value: UnknownRecord, warnings: string[]): ClaimCandidate[] {
  const existingCompat = asRecord(value.existing_compat);
  const cross = firstRecord(existingCompat.cross, value.cross, value);
  const company = firstRecord(value.company, cross.company);
  const website = asRecord(value.website_summary);
  const companyContext = asRecord(value.company_context);
  const directLeadContext = firstRecord(value.leadContext, value.lead_context, cross.leadContext, cross.lead_context);
  const confidence = firstRecord(value.confidence, cross.confidence);
  const websiteSourceRefs = stringArray(website.source_ids ?? website.sourceIds);
  const candidates: ClaimCandidate[] = [];

  const add = (
    kind: ResearchClaimKindV1,
    subjectScope: 'company' | 'person',
    classification: 'fact' | 'hypothesis',
    path: string,
    items: ReturnType<typeof candidateItems>,
    confidenceKeys: string[],
    fallback: number,
    inheritedSourceRefs: string[] = [],
  ) => {
    items.forEach((item) => candidates.push({
      kind,
      subjectScope,
      classification,
      statement: item.statement,
      path,
      sourceRefs: item.sourceRefs.length > 0 ? item.sourceRefs : inheritedSourceRefs,
      sourceUrl: item.sourceUrl,
      observedAt: item.observedAt,
      confidence: confidenceValue(confidence, confidenceKeys, fallback, warnings),
    }));
  };

  const companyName = firstString(company.name, value.company_name);
  const companyDomain = firstString(company.domain, company.primary_domain);
  if (companyName || companyDomain) {
    add(
      'company_identity',
      'company',
      'fact',
      '$.company',
      [{ statement: [companyName, companyDomain].filter(Boolean).join(' - '), sourceRefs: [] }],
      ['company', 'identity'],
      0.85,
      websiteSourceRefs,
    );
  }
  add('company_industry', 'company', 'fact', '$.company.industry', candidateItems(company.industry), ['industry'], 0.75, websiteSourceRefs);
  add('company_size', 'company', 'fact', '$.company.size', candidateItems(company.size), ['size'], 0.7, websiteSourceRefs);
  add(
    'company_overview',
    'company',
    'fact',
    website.overview ? '$.website_summary.overview' : companyContext.overview ? '$.company_context.overview' : '$.overview',
    candidateItems(website.overview ?? companyContext.overview ?? cross.overview ?? value.overview),
    ['overview'],
    0.72,
    websiteSourceRefs,
  );
  add('company_service', 'company', 'fact', '$.website_summary.services', candidateItems(website.services), ['services'], 0.7, websiteSourceRefs);
  add('company_priority', 'company', 'hypothesis', '$.company_context.likely_priorities', candidateItems(companyContext.likely_priorities), ['priorities'], 0.55);

  add('pain_hypothesis', 'company', 'hypothesis', '$.pains', candidateItems(cross.pains ?? companyContext.pain_hypotheses), ['pains'], 0.55);
  add('opportunity_hypothesis', 'company', 'hypothesis', '$.opportunities', candidateItems(cross.opportunities ?? companyContext.opportunity_hypotheses), ['opportunities'], 0.55);
  add('risk_hypothesis', 'company', 'hypothesis', '$.risks', candidateItems(cross.risks ?? companyContext.risks), ['risks'], 0.55);
  add('use_case_hypothesis', 'company', 'hypothesis', '$.useCases', candidateItems(cross.useCases ?? cross.use_cases), ['useCases', 'use_cases'], 0.55);

  add('lead_profile', 'person', 'fact', '$.lead_context.profile_summary', candidateItems(directLeadContext.profileSummary ?? directLeadContext.profile_summary ?? directLeadContext.role_summary), ['leadContext', 'lead_profile'], 0.7);
  add('lead_recent_activity', 'person', 'fact', '$.lead_context.recent_activity_summary', candidateItems(directLeadContext.recentActivitySummary ?? directLeadContext.recent_activity_summary), ['recentActivity', 'recent_activity'], 0.68);
  add('lead_communication_style', 'person', 'hypothesis', '$.lead_context.communication_style', candidateItems(directLeadContext.communicationStyle ?? directLeadContext.communication_style), ['communicationStyle', 'communication_style'], 0.55);

  asArray(value.signals).forEach((signal, index) => {
    const record = asRecord(signal);
    const type = firstString(record.type)?.toLowerCase();
    const kind: ResearchClaimKindV1 = type === 'news'
      ? 'news_signal'
      : type === 'hiring'
        ? 'hiring_signal'
        : type === 'tech' || type === 'technology'
          ? 'technology_signal'
          : 'site_signal';
    add(
      kind,
      'company',
      'fact',
      `$.signals[${index}]`,
      candidateItems({
        statement: firstString(record.title, record.statement, record.text),
        source_ids: record.source_ids ?? record.sourceIds,
        url: record.url,
        observed_at: record.published_at ?? record.publishedAt ?? record.when,
      }),
      ['signals'],
      0.7,
    );
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}|${candidate.subjectScope}|${candidate.statement.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chooseSources(candidate: ClaimCandidate, sources: NormalizedSource[]): NormalizedSource[] {
  const explicit = sources.filter((source) =>
    candidate.sourceRefs.some((reference) => reference === source.id || source.legacyIds.includes(reference)),
  );
  if (explicit.length > 0) return explicit;
  const sourceUrl = validHttpUrl(candidate.sourceUrl);
  if (sourceUrl) {
    const canonical = canonicalUrl(sourceUrl);
    const match = sources.find((source) => source.canonicalUrl === canonical);
    if (match) return [match];
  }
  return [];
}

function freshnessDays(kind: ResearchClaimKindV1): number {
  if (kind === 'company_identity') return 90;
  if (kind.startsWith('lead_')) return kind === 'lead_recent_activity' ? 7 : 14;
  if (kind.endsWith('_signal')) return 7;
  return 30;
}

function buildEvidenceAndClaims(
  candidates: ClaimCandidate[],
  sources: NormalizedSource[],
  provider: string,
  now: string,
  idFactory: NonNullable<LegacyResearchAdapterOptionsV1['idFactory']>,
): { evidence: ResearchEvidenceV1[]; claims: ResearchClaimV1[] } {
  const evidence: ResearchEvidenceV1[] = [];
  const claims = candidates.map((candidate) => {
    const supportingEvidenceIds = chooseSources(candidate, sources).map((source) => {
      const id = idFactory('evidence', `${source.id}|${candidate.path}|${candidate.statement}`);
      evidence.push({
        id,
        subjectScope: candidate.subjectScope,
        kind: candidate.kind.endsWith('_signal') ? 'event' : candidate.classification === 'fact' ? 'fact' : 'observation',
        path: candidate.path,
        statement: candidate.statement,
        sourceId: source.id,
        locator: source.annotationIndex === undefined
          ? { kind: 'json_path', value: candidate.path }
          : { kind: 'provider_annotation', value: String(source.annotationIndex) },
        observedAt: candidate.observedAt,
        extractedAt: now,
        confidence: Math.min(candidate.confidence, source.reliability),
        extraction: {
          method: 'provider',
          provider,
          version: ADAPTER_VERSION,
        },
      });
      return id;
    });
    const asOf = candidate.observedAt || now;
    return {
      id: idFactory('claim', `${candidate.kind}|${candidate.subjectScope}|${candidate.statement}`),
      kind: candidate.kind,
      subjectScope: candidate.subjectScope,
      classification: candidate.classification,
      statement: candidate.statement,
      supportingEvidenceIds,
      contradictingEvidenceIds: [],
      confidence: candidate.confidence,
      freshness: {
        asOf,
        validUntil: addDays(asOf, freshnessDays(candidate.kind)),
        policyVersion: 'research-freshness/v1' as const,
      },
      derivation: {
        method: candidate.classification === 'fact' ? 'direct' as const : 'model' as const,
      },
    };
  });
  return { evidence, claims };
}

function normalizeSubject(
  value: UnknownRecord,
  options: LegacyResearchAdapterOptionsV1,
  warnings: string[],
): ResearchSnapshotV1['subject'] {
  const existingCompat = asRecord(value.existing_compat);
  const cross = firstRecord(existingCompat.cross, value.cross);
  const company = firstRecord(value.company, cross.company);
  const lead = firstRecord(value.lead, value.person);
  const contextPerson = options.subject?.person || {};
  const contextCompany = options.subject?.company || {};
  const emailValue = firstString(options.subject?.email, lead.email);
  const email = emailValue && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue) ? emailValue : undefined;
  if (emailValue && !email) warnings.push('Ignored invalid subject email.');

  const personLinkedinValue = firstString(contextPerson.linkedinUrl, lead.linkedinUrl, lead.linkedin_url);
  const companyWebsiteValue = firstString(contextCompany.websiteUrl, company.website, company.website_url);
  const companyLinkedinValue = firstString(contextCompany.linkedinUrl, company.linkedin, company.linkedin_url);
  const personLinkedinUrl = validHttpUrl(personLinkedinValue);
  const websiteUrl = validHttpUrl(companyWebsiteValue);
  const companyLinkedinUrl = validHttpUrl(companyLinkedinValue);
  if (personLinkedinValue && !personLinkedinUrl) warnings.push('Ignored invalid person LinkedIn URL.');
  if (companyWebsiteValue && !websiteUrl) warnings.push('Ignored invalid company website URL.');
  if (companyLinkedinValue && !companyLinkedinUrl) warnings.push('Ignored invalid company LinkedIn URL.');

  return {
    leadRef: options.leadRef,
    leadId: firstString(options.subject?.leadId, lead.id),
    email,
    person: {
      fullName: firstString(contextPerson.fullName, lead.fullName, lead.full_name, lead.name),
      title: firstString(contextPerson.title, lead.title, lead.job_title),
      linkedinUrl: personLinkedinUrl,
      city: firstString(contextPerson.city, lead.city),
      country: firstString(contextPerson.country, lead.country),
    },
    company: {
      name: firstString(contextCompany.name, company.name, value.company_name),
      domain: firstString(contextCompany.domain, company.domain, company.primary_domain),
      websiteUrl,
      linkedinUrl: companyLinkedinUrl,
      country: firstString(contextCompany.country, company.country),
    },
  };
}

function nextSteps(value: unknown): LegacyMessagingDraftV1['nextSteps'] {
  return asArray(value).map((item) => {
    if (typeof item === 'string') return { action: item.trim() };
    const record = asRecord(item);
    return {
      action: firstString(record.action, record.title) || '',
      why: firstString(record.why, record.reason),
      priority: firstString(record.priority),
    };
  }).filter((item) => item.action);
}

function buildDrafts(
  value: UnknownRecord,
  idFactory: NonNullable<LegacyResearchAdapterOptionsV1['idFactory']>,
): LegacyMessagingDraftV1[] {
  const existingCompat = asRecord(value.existing_compat);
  const cross = firstRecord(existingCompat.cross, value.cross, value);
  const outreach = asRecord(value.outreach_pack);
  const buyerIntelligence = asRecord(value.buyer_intelligence);
  const shared = {
    subjectLines: stringArray(cross.subjectLines ?? cross.subject_lines ?? outreach.subject_lines),
    talkTracks: stringArray(cross.talkTracks ?? cross.talk_tracks ?? outreach.talk_tracks),
    valuePropositions: stringArray(cross.valueProps ?? cross.value_props ?? buyerIntelligence.fit_reasons),
    nextSteps: nextSteps(cross.nextSteps ?? cross.next_steps ?? value.next_steps),
  };
  const directEmail = firstRecord(cross.emailDraft, cross.email_draft);
  const emailDrafts = asRecord(outreach.email_drafts);
  const drafts: LegacyMessagingDraftV1[] = [];

  const addDraft = (email: UnknownRecord, variant?: string) => {
    const subject = firstString(email.subject);
    const body = firstString(email.body, email.textBody, email.text_body);
    if (!subject && !body && shared.subjectLines.length === 0 && shared.talkTracks.length === 0 && shared.valuePropositions.length === 0 && shared.nextSteps.length === 0) return;
    const seed = canonicalJson({ variant, subject, body, ...shared });
    drafts.push({
      kind: 'legacy_messaging_draft',
      id: idFactory('draft', seed),
      channel: 'email',
      variant,
      subject,
      body,
      ...shared,
    });
  };

  if (Object.keys(directEmail).length > 0) addDraft(directEmail);
  Object.keys(emailDrafts).sort().forEach((variant) => addDraft(asRecord(emailDrafts[variant]), variant));
  if (drafts.length === 0) addDraft({});
  return drafts;
}

function mapStatus(value: unknown): ResearchStatusV1 | undefined {
  const status = nonEmpty(value)?.toLowerCase();
  if (!status) return undefined;
  if (status === 'success' || status === 'ready' || status === 'complete') return 'completed';
  if (status === 'error') return 'failed';
  const statuses = new Set<ResearchStatusV1>(['queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled']);
  return statuses.has(status as ResearchStatusV1) ? status as ResearchStatusV1 : undefined;
}

function hasLegacyFailureMarker(value: UnknownRecord): boolean {
  const markers = [
    value.source,
    value.failure_marker,
    value.overview,
    asRecord(value.company_context).overview,
    asRecord(value.website_summary).overview,
    asRecord(value.cross).overview,
    ...asArray(value.warnings),
    ...asArray(value.provider_warnings),
  ];
  return markers.some((marker) => {
    const normalized = String(marker || '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');
    return normalized.includes('fallback')
      || normalized.includes('http_error')
      || normalized.includes('invalid_response')
      || normalized.startsWith('error_parsing.')
      || normalized.startsWith('no_se_pudo_completar_la_investigacion_automatica');
  });
}

function buildErrors(
  value: UnknownRecord,
  warnings: string[],
  recovered: boolean,
  invalid: boolean,
  provider: string,
  now: string,
): ContractErrorV1[] {
  const errors: ContractErrorV1[] = [];
  if (recovered) {
    errors.push({
      code: 'truncated_response',
      stage: 'parse',
      severity: 'warning',
      retryable: true,
      message: 'The provider response was truncated; only complete recoverable research was retained.',
      provider,
      observedAt: now,
    });
  }
  if (invalid) {
    errors.push({
      code: 'invalid_response',
      stage: 'parse',
      severity: 'blocking',
      retryable: true,
      message: 'The provider response did not contain a usable research object.',
      provider,
      observedAt: now,
    });
  }
  stringArray(value.warnings).forEach((message) => errors.push({
    code: 'insufficient_evidence',
    stage: 'normalize',
    severity: 'warning',
    retryable: false,
    message,
    provider,
    observedAt: now,
  }));
  warnings.forEach((message) => errors.push({
    code: 'validation_failed',
    stage: 'normalize',
    severity: 'warning',
    retryable: false,
    message,
    provider,
    observedAt: now,
  }));
  return errors;
}

function contradictionSummary(value: unknown): string | undefined {
  if (typeof value === 'string') return nonEmpty(value);
  const record = asRecord(value);
  return firstString(record.summary, record.detail, record.statement, record.reason);
}

function qualityFor(claims: ResearchClaimV1[]): ResearchSnapshotV1['quality'] {
  const coverage = (scope: 'company' | 'person', recentOnly = false) => {
    const scoped = claims.filter((claim) => claim.subjectScope === scope && (!recentOnly || claim.kind.endsWith('_signal') || claim.kind === 'lead_recent_activity'));
    if (scoped.length === 0) return 0;
    return scoped.filter((claim) => claim.supportingEvidenceIds.length > 0).length / scoped.length;
  };
  const usable = claims.filter((claim) => claim.supportingEvidenceIds.length > 0);
  return {
    assessmentVersion: 'research-quality/v1',
    coverage: {
      company: coverage('company'),
      person: coverage('person'),
      recentSignals: Math.max(coverage('company', true), coverage('person', true)),
    },
    overallConfidence: usable.length === 0
      ? 0
      : usable.reduce((total, claim) => total + claim.confidence, 0) / usable.length,
  };
}

export function adaptLegacyResearchPayloadV1(
  payload: unknown,
  options: LegacyResearchAdapterOptionsV1,
): AdaptedLegacyResearchV1 {
  const idFactory = options.idFactory || defaultIdFactory;
  const now = requireNow(options);
  const unwrapped = unwrapLegacyPayload(payload);
  const value = unwrapped.value;
  const warnings: string[] = [];
  const provider = firstString(options.provider, value.provider) || 'legacy';
  const subject = normalizeSubject(value, options, warnings);
  const sources = buildSources(value, unwrapped.annotations, provider, now, idFactory, warnings);
  const candidates = buildClaimCandidates(value, warnings);
  const { evidence, claims } = buildEvidenceAndClaims(candidates, sources, provider, now, idFactory);
  const hasUsableClaim = claims.some((claim) =>
    claim.kind !== 'company_identity'
    && isSubstantiveResearchTextV1(claim.statement)
    && claim.supportingEvidenceIds.length > 0,
  );
  const errors = buildErrors(value, warnings, unwrapped.recovered, unwrapped.invalid, provider, now);
  const requestedStatus = mapStatus(value.status);
  let status: ResearchStatusV1 = requestedStatus || (hasUsableClaim ? 'completed' : 'insufficient_data');
  if (unwrapped.invalid) status = 'failed';
  if (hasLegacyFailureMarker(value)) status = 'failed';
  if (unwrapped.recovered) status = hasUsableClaim ? 'partial' : 'insufficient_data';
  if ((status === 'completed' || status === 'partial') && !hasUsableClaim) status = 'insufficient_data';
  if (status === 'partial' && !errors.some((error) => error.severity === 'warning')) {
    errors.push({
      code: 'insufficient_evidence',
      stage: 'normalize',
      severity: 'warning',
      retryable: false,
      message: 'The legacy provider marked this research as partial.',
      provider,
      observedAt: now,
    });
  }

  const requestedAt = isoDate(options.requestedAt) || isoDate(value.requested_at) || now;
  const providerJobId = firstString(options.providerJobId, value.provider_job_id, value.job_id);
  const language = firstString(options.language, value.language) || 'es';
  const depth = options.depth || (['basic', 'standard', 'deep'].includes(String(value.depth)) ? value.depth as 'basic' | 'standard' | 'deep' : 'standard');
  const fingerprintInput = {
    scope: options.scope,
    subject: {
      leadRef: subject.leadRef,
      email: subject.email?.toLowerCase(),
      person: subject.person.fullName?.toLowerCase(),
      companyDomain: subject.company.domain?.toLowerCase(),
    },
    provider,
    language,
    depth,
    adapterVersion: ADAPTER_VERSION,
  };
  const inputFingerprint = sha256(canonicalJson(fingerprintInput));
  const requestId = options.requestId || idFactory('request', `${inputFingerprint}|request`);
  const idempotencyKey = options.idempotencyKey || inputFingerprint;
  const reportId = firstString(value.report_id, value.id);
  const snapshotId = options.snapshotId || reportId || idFactory('snapshot', inputFingerprint);
  const terminal = status === 'completed' || status === 'partial' || status === 'insufficient_data' || status === 'failed' || status === 'cancelled';
  const generatedAt = isoDate(value.generated_at ?? value.generatedAt ?? value.completed_at) || now;

  const snapshot = ResearchSnapshotV1Schema.parse({
    kind: 'research_snapshot',
    schemaVersion: 'research-snapshot/v1',
    id: snapshotId,
    revision: 1,
    scope: options.scope,
    subject,
    request: {
      requestId,
      idempotencyKey,
      inputFingerprint,
      provider,
      providerJobId,
      language,
      depth,
      requestedAt,
    },
    lifecycle: {
      status,
      queuedAt: isoDate(value.queued_at),
      startedAt: isoDate(value.started_at),
      completedAt: terminal ? generatedAt : undefined,
      errors,
    },
    sources: sources.map(({ legacyIds: _legacyIds, annotationIndex: _annotationIndex, ...source }) => source),
    evidence,
    claims,
    contradictions: asArray(value.contradictions).map((contradiction, index) => ({
      id: idFactory('contradiction', `${index}|${contradictionSummary(contradiction) || 'legacy contradiction'}`),
      claimIds: [],
      evidenceIds: [],
      summary: contradictionSummary(contradiction) || 'Legacy provider reported a contradiction.',
      status: 'unresolved' as const,
    })),
    quality: qualityFor(claims),
    createdAt: generatedAt,
    updatedAt: generatedAt,
  });

  return {
    snapshot,
    drafts: buildDrafts(value, idFactory),
    legacyExtras: {
      detectedShape: unwrapped.detectedShape,
      recoveredTruncatedJson: unwrapped.recovered,
      warnings: [...stringArray(value.warnings), ...warnings],
      reportId,
      providerStatus: nonEmpty(value.status),
    },
  };
}
