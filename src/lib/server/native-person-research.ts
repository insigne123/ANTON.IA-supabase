import type { NativeResearchLead, NativeResearchOptions } from '@/lib/native-research-contracts';
import { searchSerper, type SerperSearchItem } from '@/lib/server/serper-search';

const MAX_PERSON_EVIDENCE_ITEMS = 3;
const SUFFICIENT_PERSON_EVIDENCE_ITEMS = 2;

export type PublicPersonEvidenceResult = {
  query: string | null;
  provider: 'serper';
  fetchedAt: string;
  items: SerperSearchItem[];
  warnings: string[];
};

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIdentityText(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeDomain(value: unknown) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }
}

function quoted(value: unknown) {
  return `"${text(value).replace(/"/g, '').slice(0, 180)}"`;
}

function containsExactTokenSequence(value: string, expected: string) {
  const valueTokens = normalizeIdentityText(value).split(' ').filter(Boolean);
  const expectedTokens = normalizeIdentityText(expected).split(' ').filter(Boolean);
  if (expectedTokens.length === 0 || expectedTokens.length > valueTokens.length) return false;
  return valueTokens.some((_, index) =>
    expectedTokens.every((token, offset) => valueTokens[index + offset] === token),
  );
}

export function buildPublicPersonSearchQuery(lead: NativeResearchLead) {
  const fullName = text(lead.fullName);
  const company = text(lead.companyName) || normalizeDomain(lead.companyDomain || lead.companyWebsite);
  if (!fullName || !company) return '';
  const role = text(lead.title);
  return [quoted(fullName), quoted(company), role ? quoted(role) : ''].filter(Boolean).join(' ');
}

export function buildPublicPersonSearchQueries(lead: NativeResearchLead) {
  const fullName = text(lead.fullName);
  const company = text(lead.companyName) || normalizeDomain(lead.companyDomain || lead.companyWebsite);
  if (!fullName || !company) return [];
  const role = text(lead.title);
  const domain = normalizeDomain(lead.companyDomain || lead.companyWebsite);
  return [...new Set([
    [quoted(fullName), quoted(company), role ? quoted(role) : ''].filter(Boolean).join(' '),
    [quoted(fullName), quoted(company)].join(' '),
    domain ? [quoted(fullName), quoted(domain)].join(' ') : '',
  ].filter(Boolean))];
}

export function scorePublicPersonIdentityMatch(input: {
  item: SerperSearchItem;
  lead: NativeResearchLead;
}) {
  const fullName = normalizeIdentityText(input.lead.fullName);
  const companyName = normalizeIdentityText(input.lead.companyName);
  const companyDomain = normalizeDomain(input.lead.companyDomain || input.lead.companyWebsite);
  const role = normalizeIdentityText(input.lead.title);
  if (!fullName || (!companyName && !companyDomain)) return 0;

  const statement = normalizeIdentityText(`${input.item.title || ''} ${input.item.snippet || ''}`);
  if (!containsExactTokenSequence(statement, fullName)) return 0;
  const resultDomain = normalizeDomain(input.item.link);
  const companyNameMatches = Boolean(companyName && containsExactTokenSequence(statement, companyName));
  const companySiteMatches = Boolean(companyDomain && (resultDomain === companyDomain || resultDomain.endsWith(`.${companyDomain}`)));
  const companyDomainMatches = Boolean(companyDomain && containsExactTokenSequence(statement, companyDomain));
  if (!companyNameMatches && !companySiteMatches && !companyDomainMatches) return 0;

  const roleMatches = Boolean(role && containsExactTokenSequence(statement, role));
  return 10 + (companyNameMatches ? 3 : 0) + (companySiteMatches ? 3 : 0) + (companyDomainMatches ? 2 : 0) + (roleMatches ? 2 : 0);
}

export function isStrictPublicPersonIdentityMatch(input: {
  item: SerperSearchItem;
  lead: NativeResearchLead;
}) {
  return scorePublicPersonIdentityMatch(input) > 0;
}

function publicPersonItemKey(item: SerperSearchItem) {
  try {
    const url = new URL(text(item.link));
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return normalizeIdentityText(`${item.title || ''} ${item.snippet || ''}`);
  }
}

export async function collectPublicPersonEvidence(input: {
  organizationId: string;
  lead: NativeResearchLead;
  options: NativeResearchOptions;
  search?: typeof searchSerper;
}): Promise<PublicPersonEvidenceResult> {
  const fetchedAt = new Date().toISOString();
  const queries = buildPublicPersonSearchQueries(input.lead);
  if (queries.length === 0) {
    return {
      query: null,
      provider: 'serper',
      fetchedAt,
      items: [],
      warnings: text(input.lead.fullName) ? ['person_search_identity_incomplete'] : [],
    };
  }

  const search = input.search || searchSerper;
  const matched = new Map<string, { item: SerperSearchItem; score: number; queryIndex: number }>();
  let completedSearches = 0;
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    if (matched.size >= SUFFICIENT_PERSON_EVIDENCE_ITEMS) break;
    try {
      const result = await search({
        organizationId: input.organizationId,
        kind: 'organic',
        query: queries[queryIndex],
        language: input.options.language,
        countryCode: input.lead.country || 'cl',
        location: [input.lead.city, input.lead.country].filter(Boolean).join(', '),
        limit: input.options.depth === 'deep' ? 8 : 5,
      });
      completedSearches += 1;
      for (const item of result.items) {
        const score = scorePublicPersonIdentityMatch({ item, lead: input.lead });
        const key = publicPersonItemKey(item);
        if (score === 0 || !key) continue;
        const existing = matched.get(key);
        if (!existing || score > existing.score) matched.set(key, { item, score, queryIndex });
      }
    } catch {
      // A narrower query can fail while a later identity-safe fallback still succeeds.
    }
  }

  const items = Array.from(matched.values())
    .sort((left, right) => (
      right.score - left.score
      || left.queryIndex - right.queryIndex
      || (left.item.position ?? Number.MAX_SAFE_INTEGER) - (right.item.position ?? Number.MAX_SAFE_INTEGER)
      || publicPersonItemKey(left.item).localeCompare(publicPersonItemKey(right.item))
    ))
    .slice(0, MAX_PERSON_EVIDENCE_ITEMS)
    .map(({ item }) => item);
  return {
    query: queries[0],
    provider: 'serper',
    fetchedAt,
    items,
    warnings: items.length > 0
      ? []
      : completedSearches > 0 ? ['person_public_evidence_missing'] : ['person_search_unavailable'],
  };
}

export const nativePersonResearchInternals = { normalizeIdentityText, normalizeDomain, containsExactTokenSequence };
