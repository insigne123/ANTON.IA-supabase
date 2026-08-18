export const SAVED_SEARCH_CRITERIA_VERSION = 2;

export type LeadSearchMode = 'filters' | 'linkedin_profile' | 'company_name';

export interface LeadSearchFilters {
  searchMode: LeadSearchMode;
  industry: string;
  location: string;
  title: string;
  sizeRange: string;
  seniorities: string[];
  companyName: string;
  companyDomains: string;
  maxResults: number;
  linkedinUrl: string;
  revealEmail: boolean;
  revealPhone: boolean;
}

export interface SavedSearchCriteriaEnvelope {
  version: typeof SAVED_SEARCH_CRITERIA_VERSION;
  filters: LeadSearchFilters;
}

export const DEFAULT_LEAD_SEARCH_FILTERS: LeadSearchFilters = {
  searchMode: 'filters',
  industry: '',
  location: '',
  title: '',
  sizeRange: '',
  seniorities: [],
  companyName: '',
  companyDomains: '',
  maxResults: 25,
  linkedinUrl: '',
  revealEmail: true,
  revealPhone: false,
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(source: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function asString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function asStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : asString(value).split(',');
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of values) {
    const entry = String(item ?? '').trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
  }

  return normalized;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return fallback;
}

function asResultLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAD_SEARCH_FILTERS.maxResults;
  return Math.min(500, Math.max(1, Math.round(parsed)));
}

function normalizeMode(value: unknown, source: UnknownRecord): LeadSearchMode {
  const mode = asString(value).toLowerCase().replace(/[\s-]+/g, '_');

  if (['linkedin_profile', 'linkedin', 'profile', 'profile_url'].includes(mode)) return 'linkedin_profile';
  if (['company_name', 'company', 'organization', 'account'].includes(mode)) return 'company_name';
  if (['filters', 'filter', 'industry', 'advanced'].includes(mode)) return 'filters';

  if (asString(firstDefined(source, ['linkedinUrl', 'linkedin_url']))) return 'linkedin_profile';
  if (asString(firstDefined(source, ['companyName', 'company_name', 'companyDomains', 'company_domains', 'organization_domains']))) {
    return 'company_name';
  }
  return DEFAULT_LEAD_SEARCH_FILTERS.searchMode;
}

function unwrapCriteria(criteria: unknown): UnknownRecord {
  if (!isRecord(criteria)) return {};
  if (isRecord(criteria.filters)) return criteria.filters;
  if (isRecord(criteria.criteria)) return criteria.criteria;
  return criteria;
}

/**
 * Accepts current, legacy, and future envelope-shaped criteria. Unknown fields
 * are intentionally ignored so a saved search can still be opened safely.
 */
export function normalizeSavedSearchCriteria(criteria: unknown): LeadSearchFilters {
  const source = unwrapCriteria(criteria);

  return {
    searchMode: normalizeMode(firstDefined(source, ['searchMode', 'search_mode', 'mode']), source),
    industry: asString(firstDefined(source, ['industry', 'industryKeyword', 'industry_keywords'])),
    location: asString(firstDefined(source, ['location', 'companyLocation', 'company_location', 'locations'])),
    title: asString(firstDefined(source, ['title', 'titles', 'jobTitle', 'job_title'])),
    sizeRange: asString(firstDefined(source, ['sizeRange', 'size_range', 'employeeRange', 'employee_ranges'])),
    seniorities: asStringArray(firstDefined(source, ['seniorities', 'managementLevels', 'management_levels'])),
    companyName: asString(firstDefined(source, ['companyName', 'company_name', 'organizationName', 'organization_name'])),
    companyDomains: asString(firstDefined(source, ['companyDomains', 'company_domains', 'organizationDomains', 'organization_domains'])),
    maxResults: asResultLimit(firstDefined(source, ['maxResults', 'max_results', 'limit'])),
    linkedinUrl: asString(firstDefined(source, ['linkedinUrl', 'linkedin_url', 'profileUrl', 'profile_url'])),
    revealEmail: asBoolean(firstDefined(source, ['revealEmail', 'reveal_email']), DEFAULT_LEAD_SEARCH_FILTERS.revealEmail),
    revealPhone: asBoolean(firstDefined(source, ['revealPhone', 'reveal_phone']), DEFAULT_LEAD_SEARCH_FILTERS.revealPhone),
  };
}

export function serializeSavedSearchCriteria(criteria: unknown): SavedSearchCriteriaEnvelope {
  return {
    version: SAVED_SEARCH_CRITERIA_VERSION,
    filters: normalizeSavedSearchCriteria(criteria),
  };
}

export function normalizeSavedSearchName(name: unknown): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

export function savedSearchNamesMatch(left: unknown, right: unknown): boolean {
  return normalizeSavedSearchName(left).localeCompare(normalizeSavedSearchName(right), undefined, {
    sensitivity: 'base',
  }) === 0;
}
