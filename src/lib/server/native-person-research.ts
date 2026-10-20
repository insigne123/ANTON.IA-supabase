import type { NativeResearchLead, NativeResearchOptions } from '@/lib/native-research-contracts';
import { firstNameOf, isMaskedName, textNamesPerson } from '@/lib/lead-name';
import { isHardRejectedResearchText } from '@/lib/research-fact-eligibility';
import { searchSerper, type SerperSearchItem } from '@/lib/server/serper-search';

const MAX_PERSON_EVIDENCE_ITEMS = 3;
const SUFFICIENT_PERSON_EVIDENCE_ITEMS = 2;

export type PublicPersonEvidenceResult = {
  query: string | null;
  provider: 'serper';
  fetchedAt: string;
  items: SerperSearchItem[];
  warnings: string[];
  metrics?: { queries: number; elapsedMs: number; costUsd: null };
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

// Legal forms that public pages leave out: «Constructora Andes SpA» is «Constructora Andes» on LinkedIn and in the press.
// Compared on normalized tokens («S.A.» is «s a»).
const LEGAL_FORMS = ['s a c', 's a s', 's p a', 's r l', 'e i r l', 's a', 'sa', 'spa', 'sac', 'sas', 'srl', 'eirl', 'ltda', 'limitada',
  'y cia', 'cia', 'inc', 'llc', 'ltd', 'gmbh', 'corp'];

/** The company name without its legal form, when it differs and is long enough not to name half the market. */
function companyBrand(value: unknown) {
  let name = normalizeIdentityText(value);
  for (let changed = true; changed;) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (name.endsWith(` ${form}`)) {
        name = name.slice(0, -form.length - 1).trim();
        changed = true;
      }
    }
  }
  return name && name !== normalizeIdentityText(value) && name.replace(/\s/g, '').length >= 4 ? name : '';
}

/**
 * «Juan Pérez» for «Juan Andrés Pérez González» or «Juan Pérez González»: first name and paternal surname, the way most
 * Chilean profiles and press notes name a person. Only for names with three or more words.
 */
function shortPersonName(value: unknown) {
  const tokens = text(value).split(' ').filter(Boolean);
  return tokens.length >= 3 ? `${tokens[0]} ${tokens[tokens.length - 2]}` : '';
}

function linkedinProfileSlug(value: unknown) {
  try {
    const url = new URL(text(value));
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/in\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]).toLowerCase() : '';
  } catch {
    return '';
  }
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
  if (isMaskedName(fullName)) {
    // The provider hid the surname («Rafael Du***n»): a search engine finds nothing with the asterisks. Search by the
    // first name, the company and the role; the identity check below still needs the visible ends of the surname.
    const first = firstNameOf(fullName);
    if (!first) return [];
    return [...new Set([
      [quoted(first), quoted(company), role ? quoted(role) : ''].filter(Boolean).join(' '),
      [quoted(first), quoted(company), 'linkedin'].join(' '),
    ])];
  }
  const brand = companyBrand(lead.companyName);
  const short = shortPersonName(fullName);
  return [...new Set([
    [quoted(fullName), quoted(company), role ? quoted(role) : ''].filter(Boolean).join(' '),
    [quoted(fullName), quoted(company)].join(' '),
    domain ? [quoted(fullName), quoted(domain)].join(' ') : '',
    // Fallbacks, only spent when the exact name found too little: the brand without its legal form, then the short name.
    brand ? [quoted(fullName), quoted(brand)].join(' ') : '',
    short ? [quoted(short), quoted(brand || company), role ? quoted(role) : ''].filter(Boolean).join(' ') : '',
  ].filter(Boolean))];
}

export function scorePublicPersonIdentityMatch(input: {
  item: SerperSearchItem;
  lead: NativeResearchLead;
}) {
  const rawStatement = `${input.item.title || ''} ${input.item.snippet || ''}`;
  if (isHardRejectedResearchText(rawStatement)) return 0;

  const fullName = normalizeIdentityText(input.lead.fullName);
  const companyName = normalizeIdentityText(input.lead.companyName);
  const companyDomain = normalizeDomain(input.lead.companyDomain || input.lead.companyWebsite);
  const role = normalizeIdentityText(input.lead.title);
  if (!fullName || (!companyName && !companyDomain)) return 0;

  const statement = normalizeIdentityText(rawStatement);
  const masked = isMaskedName(input.lead.fullName);
  // A hidden surname matches a word with the same visible ends («Durán» for «Du***n»); a complete name, its exact tokens.
  const fullNameMatches = masked
    ? textNamesPerson(rawStatement, input.lead.fullName)
    : containsExactTokenSequence(statement, fullName);
  const short = masked ? '' : normalizeIdentityText(shortPersonName(input.lead.fullName));
  const shortNameMatches = Boolean(short && containsExactTokenSequence(statement, short));
  // The person's own LinkedIn profile is the person, even when it names them shorter or shows a newer employer.
  const leadProfile = linkedinProfileSlug(input.lead.linkedinUrl);
  const ownProfile = Boolean(leadProfile && linkedinProfileSlug(input.item.link) === leadProfile);
  if (!fullNameMatches && !shortNameMatches) return 0;
  const resultDomain = normalizeDomain(input.item.link);
  const brand = companyBrand(input.lead.companyName);
  const companyNameMatches = Boolean(companyName && containsExactTokenSequence(statement, companyName))
    || Boolean(brand && containsExactTokenSequence(statement, brand));
  const companySiteMatches = Boolean(companyDomain && (resultDomain === companyDomain || resultDomain.endsWith(`.${companyDomain}`)));
  const companyDomainMatches = Boolean(companyDomain && containsExactTokenSequence(statement, companyDomain));
  const companyMatches = companyNameMatches || companySiteMatches || companyDomainMatches;
  if (!companyMatches && !ownProfile) return 0;

  const roleMatches = Boolean(role && containsExactTokenSequence(statement, role));
  // A short name is common: with the company it still needs the role or the person's own profile to be this person.
  if (!fullNameMatches && !roleMatches && !ownProfile) return 0;
  return 10 + (companyNameMatches ? 3 : 0) + (companySiteMatches ? 3 : 0) + (companyDomainMatches ? 2 : 0) + (roleMatches ? 2 : 0)
    + (ownProfile ? 4 : 0) - (fullNameMatches ? 0 : 1);
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
  const started = Date.now();
  let attemptedSearches = 0;
  const queries = buildPublicPersonSearchQueries(input.lead);
  if (queries.length === 0) {
    return {
      query: null,
      provider: 'serper',
      fetchedAt,
      items: [],
      warnings: text(input.lead.fullName) ? ['person_search_identity_incomplete'] : [],
      metrics: { queries: 0, elapsedMs: Date.now() - started, costUsd: null },
    };
  }

  const search = input.search || ((request: Parameters<typeof searchSerper>[0]) => searchSerper(request, { retryTimeouts: true }));
  const matched = new Map<string, { item: SerperSearchItem; score: number; queryIndex: number }>();
  let completedSearches = 0;
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    if (matched.size >= SUFFICIENT_PERSON_EVIDENCE_ITEMS) break;
    attemptedSearches += 1;
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
    metrics: { queries: attemptedSearches, elapsedMs: Date.now() - started, costUsd: null },
    warnings: items.length > 0
      ? []
      : completedSearches > 0 ? ['person_public_evidence_missing'] : ['person_search_unavailable'],
  };
}

export const nativePersonResearchInternals = { normalizeIdentityText, normalizeDomain, containsExactTokenSequence };
