import { createHash } from 'node:crypto';

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

import {
  EntityResolutionV2Schema,
  SourceV2Schema,
  type EntityResolutionV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';

const NOISE_PATTERN = /[<>]|wp-content|elementor|hummingbird|\/assets\/|\.css(?:\W|$)|\.js(?:\W|$)/i;
const COUNTRY_PATHS: Record<string, string[]> = {
  CL: ['cl', 'chile'],
  PE: ['pe', 'peru'],
  CO: ['co', 'colombia'],
};

export type ParsedNumericTextV2 = {
  raw: string;
  value: number;
  unit: string | null;
  context: string;
};

export type ParsedWebEvidenceV2 = {
  source: SourceV2;
  metaDescription: string | null;
  text: string;
  blocks: string[];
  headings: string[];
  tables: Array<{ headers: string[]; rows: string[][] }>;
  links: Array<{ text: string; url: string }>;
  jsonLd: unknown[];
  numbers: ParsedNumericTextV2[];
};

export type ExistingProviderContactV2 = {
  fullName?: string | null;
  title?: string | null;
  normalizedTitle?: string | null;
  company?: string | null;
  country?: string | null;
  department?: string | null;
  seniorityFromProvider?: string | null;
  linkedin?: string | null;
  tenureMonths?: number | null;
  companyTenureMonths?: number | null;
};

function normalizedText(value: unknown) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateAtWord(value: string, max: number) {
  const text = normalizedText(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

export function isCleanEvidenceText(value: unknown) {
  const text = normalizedText(value);
  if (!text || /^https?:/i.test(text) || NOISE_PATTERN.test(text)) return false;
  const comparable = text.replace(/\s/g, '');
  if (!comparable) return false;
  const alphabetic = (comparable.match(/\p{L}/gu) || []).length;
  return alphabetic / comparable.length >= 0.6;
}

export function canonicalResearchUrl(value: string, baseUrl?: string) {
  const url = new URL(value, baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('REPORT_V2_UNSAFE_URL');
  url.hash = '';
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  });
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

function parseInstant(value: unknown) {
  const candidate = normalizedText(value);
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function metaContent(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute('content');
    if (normalizedText(value)) return normalizedText(value);
  }
  return null;
}

function countryFromUrl(url: string) {
  const parsed = new URL(url);
  const hostParts = parsed.hostname.toLowerCase().split('.');
  if (hostParts[0] === 'cl' || hostParts[0] === 'pe' || hostParts[0] === 'co') return hostParts[0].toUpperCase();
  const pathParts = parsed.pathname.toLowerCase().split('/').filter(Boolean);
  for (const [country, aliases] of Object.entries(COUNTRY_PATHS)) {
    if (aliases.some((alias) => pathParts.includes(alias))) return country;
  }
  return 'GLOBAL';
}

function classifySource(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (/linkedin\.com$/.test(host)) return 'social' as const;
  if (/theorg\.com$/.test(host)) return 'organization' as const;
  if (/registro|registry|regulador|gob\.|\.gov/.test(`${host}${path}`)) return 'registry' as const;
  if (/revista|noticia|news|diario|press|journal/.test(`${host}${path}`)) return 'press' as const;
  if (/industry|industria|asociacion|association/.test(`${host}${path}`)) return 'industry' as const;
  return 'other' as const;
}

function ownDomain(url: string, targetDomain?: string | null) {
  if (!targetDomain) return false;
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const target = String(targetDomain).trim().toLowerCase().replace(/^www\./, '');
  return hostname === target || hostname.endsWith(`.${target}`);
}

function jsonLdValues(document: Document) {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((element) => {
    try {
      const parsed = JSON.parse(element.textContent || 'null');
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function jsonLdDates(values: unknown[], key: 'datePublished' | 'dateModified') {
  const pending = [...values];
  while (pending.length > 0) {
    const value = pending.shift();
    if (Array.isArray(value)) {
      pending.push(...value);
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const found = parseInstant(record[key]);
      if (found) return found;
      pending.push(...Object.values(record));
    }
  }
  return null;
}

function parseTables(document: Document) {
  return [...document.querySelectorAll('table')].slice(0, 20).flatMap((table) => {
    const rows = [...table.querySelectorAll('tr')].slice(0, 100).map((row) => [...row.querySelectorAll('th,td')]
      .map((cell) => truncateAtWord(cell.textContent || '', 500))
      .filter(isCleanEvidenceText));
    if (rows.length === 0) return [];
    const headers = [...table.querySelectorAll('thead th')].map((cell) => truncateAtWord(cell.textContent || '', 300));
    return [{ headers, rows }];
  });
}

function numericText(blocks: string[]) {
  const output: ParsedNumericTextV2[] = [];
  const numberPattern = /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?/g;
  blocks.forEach((block) => {
    for (const match of block.matchAll(numberPattern)) {
      const raw = match[0];
      const normalized = /[.,]\d{3}(?:\D|$)/.test(raw)
        ? raw.replace(/[.,]/g, '')
        : raw.replace(',', '.');
      const value = Number(normalized);
      if (!Number.isFinite(value)) continue;
      const after = block.slice((match.index || 0) + raw.length).trimStart();
      const unit = normalizedText(after.match(/^([%\p{L}][%\p{L}\s-]{0,40})/u)?.[1] || '').split(/\s+(?:y|con|en|de|del|para)\s+/i)[0] || null;
      output.push({ raw, value, unit: unit ? truncateAtWord(unit, 40) : null, context: truncateAtWord(block, 500) });
    }
  });
  return output.slice(0, 200);
}

export function parseWebEvidenceV2(input: {
  html: string;
  url: string;
  targetDomain?: string | null;
  retrievedAt: string;
  jurisdiction?: 'CL' | 'PE' | 'CO' | 'GLOBAL' | null;
}): ParsedWebEvidenceV2 {
  const canonicalUrl = canonicalResearchUrl(input.url);
  const dom = new JSDOM(input.html, { url: canonicalUrl, contentType: 'text/html' });
  const { document } = dom.window;
  const jsonLd = jsonLdValues(document);
  const title = normalizedText(
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || document.title
      || new URL(canonicalUrl).hostname,
  );
  const metaDescription = metaContent(document, ['meta[name="description"]', 'meta[property="og:description"]']);
  const publishedAt = metaContent(document, ['meta[property="article:published_time"]', 'meta[name="date"]'])
    || jsonLdDates(jsonLd, 'datePublished');
  const modifiedAt = metaContent(document, ['meta[property="article:modified_time"]', 'meta[name="last-modified"]'])
    || jsonLdDates(jsonLd, 'dateModified');
  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .map((item) => truncateAtWord(item.textContent || '', 500))
    .filter(isCleanEvidenceText)
    .slice(0, 100);
  const tables = parseTables(document);
  const links = [...document.querySelectorAll('a[href]')].flatMap((item) => {
    try {
      const url = canonicalResearchUrl(item.getAttribute('href') || '', canonicalUrl);
      const text = truncateAtWord(item.textContent || '', 300);
      return isCleanEvidenceText(text) ? [{ text, url }] : [];
    } catch {
      return [];
    }
  }).slice(0, 200);
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const rawBlocks = String(article?.textContent || document.body?.textContent || '')
    .split(/(?:\r?\n){1,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u);
  const blocks = [...new Set(rawBlocks
    .map((block) => truncateAtWord(block, 2_000))
    .filter(isCleanEvidenceText))]
    .slice(0, 300);
  const fullText = truncateAtWord(blocks.join('\n'), 50_000);
  const inferredJurisdiction = input.jurisdiction ?? countryFromUrl(canonicalUrl);
  const source: SourceV2 = SourceV2Schema.parse({
    id: buildStableReportV2Id('src', canonicalUrl),
    url: canonicalUrl,
    canonicalUrl,
    title: title || new URL(canonicalUrl).hostname,
    sourceType: ownDomain(canonicalUrl, input.targetDomain) ? 'corporate' : classifySource(canonicalUrl),
    jurisdiction: inferredJurisdiction,
    publishedAt: parseInstant(publishedAt),
    modifiedAt: parseInstant(modifiedAt),
    retrievedAt: new Date(input.retrievedAt).toISOString(),
    ownDomain: ownDomain(canonicalUrl, input.targetDomain),
    contentHash: createHash('sha256').update(fullText).digest('hex'),
  });
  return {
    source,
    metaDescription,
    text: fullText,
    blocks,
    headings,
    tables,
    links,
    jsonLd,
    numbers: numericText(blocks),
  };
}

function normalizeCountry(value: unknown) {
  const country = normalizedText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^(?:pe|peru)$/.test(country)) return 'PE' as const;
  if (/^(?:cl|chile)$/.test(country)) return 'CL' as const;
  if (/^(?:co|colombia)$/.test(country)) return 'CO' as const;
  return 'OTHER' as const;
}

function seniorityFromTitle(title: string) {
  const normalized = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:coordinador(?:a)?|coordinator)\b/.test(normalized)) return 'coordinator' as const;
  if (/\b(?:chief|ceo|cfo|coo|cto|c-level|president)\b/.test(normalized)) return 'c_suite' as const;
  if (/\b(?:vice president|vp)\b/.test(normalized)) return 'vp' as const;
  if (/\b(?:director|directora)\b/.test(normalized)) return 'director' as const;
  if (/\bhead\b|\bjefe\b/.test(normalized)) return 'head' as const;
  if (/\b(?:manager|gerente)\b/.test(normalized)) return 'manager' as const;
  if (/\b(?:analyst|analista|specialist|especialista|assistant|asistente)\b/.test(normalized)) return 'ic' as const;
  return 'unknown' as const;
}

function pathScopes(sources: ParsedWebEvidenceV2[]) {
  const candidates = sources.flatMap((source) => [source.source.canonicalUrl, ...source.links.map((link) => link.url)]);
  const paths: Record<string, string> = {};
  candidates.forEach((candidate) => {
    const parsed = new URL(candidate);
    const parts = parsed.pathname.toLowerCase().split('/').filter(Boolean);
    Object.entries(COUNTRY_PATHS).forEach(([country, aliases]) => {
      const alias = aliases.find((item) => parts.includes(item));
      if (alias && !paths[country]) paths[country] = `/${alias}/`;
      if (aliases.includes(parsed.hostname.split('.')[0]) && !paths[country]) paths[country] = `${parsed.hostname.split('.')[0]}.`;
    });
  });
  return paths;
}

export function resolveEntityFromExistingContextV2(input: {
  contact: ExistingProviderContactV2;
  domain: string;
  sources: ParsedWebEvidenceV2[];
}): EntityResolutionV2 {
  const importedTitle = normalizedText(input.contact.title || input.contact.normalizedTitle);
  const titleForSeniority = normalizedText(input.contact.normalizedTitle || input.contact.title);
  const linkedInCountry = (() => {
    try {
      const subdomain = new URL(String(input.contact.linkedin || '')).hostname.split('.')[0].toUpperCase();
      return ['CL', 'PE', 'CO'].includes(subdomain) ? subdomain as 'CL' | 'PE' | 'CO' : null;
    } catch {
      return null;
    }
  })();
  const contactCountry = linkedInCountry || normalizeCountry(input.contact.country);
  const countryScopedPaths = pathScopes(input.sources);
  const countryMentions = input.sources.flatMap((source) => {
    const searchable = `${source.text} ${source.links.map((link) => link.url).join(' ')}`
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return Object.entries(COUNTRY_PATHS).flatMap(([country, aliases]) => aliases.some((alias) => searchable.includes(alias)) ? [country] : []);
  });
  const operatingCountries = [...new Set([...Object.keys(countryScopedPaths), ...countryMentions])];
  const excludedPaths = Object.entries(countryScopedPaths)
    .filter(([country]) => country !== contactCountry)
    .map(([, path]) => path);
  const domain = String(input.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const ambiguities = contactCountry === 'OTHER' ? ['contact_country_unresolved'] : [];
  if (!importedTitle) ambiguities.push('contact_title_missing');

  return EntityResolutionV2Schema.parse({
    companyName: normalizedText(input.contact.company) || domain,
    companyDomain: domain,
    contactCountry,
    operatingCountries,
    countryScopedPaths,
    excludedPaths,
    contact: {
      fullName: normalizedText(input.contact.fullName) || 'Unknown contact',
      title: importedTitle || 'Unknown title',
      seniority: seniorityFromTitle(titleForSeniority),
      department: normalizedText(input.contact.department) || 'Unknown',
      tenureMonths: Number.isInteger(input.contact.tenureMonths) && Number(input.contact.tenureMonths) >= 0 ? Number(input.contact.tenureMonths) : null,
      companyTenureMonths: Number.isInteger(input.contact.companyTenureMonths) && Number(input.contact.companyTenureMonths) >= 0 ? Number(input.contact.companyTenureMonths) : null,
      linkedinUrl: normalizedText(input.contact.linkedin) || null,
    },
    ambiguities,
  });
}
