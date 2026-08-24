import type { NativeResearchLead, NativeResearchOptions } from '@/lib/native-research-contracts';
import { searchSerper, type SerperSearchItem } from '@/lib/server/serper-search';

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

export function isStrictPublicPersonIdentityMatch(input: {
  item: SerperSearchItem;
  lead: NativeResearchLead;
}) {
  const fullName = normalizeIdentityText(input.lead.fullName);
  const companyName = normalizeIdentityText(input.lead.companyName);
  const companyDomain = normalizeDomain(input.lead.companyDomain || input.lead.companyWebsite);
  const role = normalizeIdentityText(input.lead.title);
  if (!fullName || (!companyName && !companyDomain)) return false;

  const statement = normalizeIdentityText(`${input.item.title || ''} ${input.item.snippet || ''}`);
  if (!containsExactTokenSequence(statement, fullName)) return false;
  const resultDomain = normalizeDomain(input.item.link);
  const companyMatches = Boolean(
    (companyName && containsExactTokenSequence(statement, companyName))
    || (companyDomain && (resultDomain === companyDomain || resultDomain.endsWith(`.${companyDomain}`)))
    || (companyDomain && containsExactTokenSequence(statement, normalizeIdentityText(companyDomain))),
  );
  if (!companyMatches) return false;
  return !role || containsExactTokenSequence(statement, role);
}

export async function collectPublicPersonEvidence(input: {
  organizationId: string;
  lead: NativeResearchLead;
  options: NativeResearchOptions;
}): Promise<PublicPersonEvidenceResult> {
  const fetchedAt = new Date().toISOString();
  const query = buildPublicPersonSearchQuery(input.lead);
  if (!query) {
    return {
      query: null,
      provider: 'serper',
      fetchedAt,
      items: [],
      warnings: text(input.lead.fullName) ? ['person_search_identity_incomplete'] : [],
    };
  }

  try {
    const result = await searchSerper({
      organizationId: input.organizationId,
      kind: 'organic',
      query,
      language: input.options.language,
      countryCode: input.lead.country || 'cl',
      location: [input.lead.city, input.lead.country].filter(Boolean).join(', '),
      limit: input.options.depth === 'deep' ? 8 : 5,
    });
    const items = result.items
      .filter((item) => isStrictPublicPersonIdentityMatch({ item, lead: input.lead }))
      .slice(0, 3);
    return {
      query: result.query,
      provider: 'serper',
      fetchedAt,
      items,
      warnings: items.length > 0 ? [] : ['person_public_evidence_missing'],
    };
  } catch {
    return {
      query,
      provider: 'serper',
      fetchedAt,
      items: [],
      warnings: ['person_search_unavailable'],
    };
  }
}

export const nativePersonResearchInternals = { normalizeIdentityText, normalizeDomain, containsExactTokenSequence };
