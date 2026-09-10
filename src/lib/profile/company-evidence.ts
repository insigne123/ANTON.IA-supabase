import { searchSerper, type SerperSearchItem } from '@/lib/server/serper-search';

export type CompanyEvidenceItem = {
  title: string;
  link: string;
  snippet: string;
  source: string;
  official?: boolean;
};

export type CompanyEvidenceDependencies = {
  search?: (input: {
    organizationId: string;
    query: string;
    language: string;
    countryCode: string;
    limit: number;
  }) => Promise<{ items: SerperSearchItem[] }>;
  fetchHtml?: (url: string, timeoutMs: number) => Promise<string>;
};

export function parseCompanyEvidence(payload: unknown): CompanyEvidenceItem[] {
  const rows = Array.isArray((payload as any)?.organic_results) ? (payload as any).organic_results : [];

  return rows
    .map((row: any) => ({
      title: String(row?.title || '').trim(),
      link: String(row?.link || '').trim(),
      snippet: String(row?.snippet || '').trim(),
      source: String(row?.source || row?.displayed_link || '').trim(),
    }))
    .filter((row: CompanyEvidenceItem) => row.title && row.link && row.snippet)
    .slice(0, 6);
}

function parseSerperItems(items: SerperSearchItem[]): CompanyEvidenceItem[] {
  return (items || [])
    .map((item) => ({
      title: String(item?.title || '').trim(),
      link: String(item?.link || '').trim(),
      snippet: String(item?.snippet || '').trim(),
      source: String(item?.source || '').trim(),
    }))
    .filter((row: CompanyEvidenceItem) => row.title && row.link && row.snippet)
    .slice(0, 6);
}

function extractVisibleText(html: string, maxLength = 1800): { title: string; description: string; text: string } {
  const source = String(html || '').slice(0, 120_000);
  const title = (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const description = (
    source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
    || source.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1]
    || ''
  ).replace(/\s+/g, ' ').trim().slice(0, 300);
  const text = source
    .replace(/<script[\s\S]*?(?:<\/script>|$)/gi, ' ')
    .replace(/<style[\s\S]*?(?:<\/style>|$)/gi, ' ')
    .replace(/<noscript[\s\S]*?(?:<\/noscript>|$)/gi, ' ')
    .replace(/<(nav|header|footer|form|svg|iframe)[\s\S]*?(?:<\/(nav|header|footer|form|svg|iframe)>|$)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return { title, description, text };
}

async function defaultFetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; ANTONIA/1.0)' },
      cache: 'no-store',
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`OFFICIAL_SITE_HTTP_${response.status}`);
    const contentType = String(response.headers.get('content-type') || '');
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) throw new Error('OFFICIAL_SITE_NOT_HTML');
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOfficialEvidence(
  domain: string,
  fetchHtml: (url: string, timeoutMs: number) => Promise<string>,
): Promise<CompanyEvidenceItem | null> {
  try {
    const url = `https://${domain}/`;
    const parsed = extractVisibleText(await fetchHtml(url, 8000));
    const snippet = [parsed.description, parsed.text].filter(Boolean).join(' ').slice(0, 900).trim();
    if (!parsed.title && !snippet) return null;
    return {
      title: parsed.title || domain,
      link: url,
      snippet: snippet || parsed.title,
      source: domain,
      official: true,
    };
  } catch {
    return null;
  }
}

export async function findCompanyEvidence(
  input: { companyName: string; domain?: string; organizationId?: string },
  dependencies: CompanyEvidenceDependencies = {},
): Promise<CompanyEvidenceItem[]> {
  const companyName = String(input.companyName || '').trim();
  const organizationId = String(input.organizationId || '').trim();
  const domain = String(input.domain || '').trim().toLowerCase();
  if (!companyName || !organizationId) return [];

  const search = dependencies.search || (async (request) => searchSerper({
    organizationId: request.organizationId,
    kind: 'organic',
    query: request.query,
    language: request.language,
    countryCode: request.countryCode,
    limit: request.limit,
  }));
  const fetchHtml = dependencies.fetchHtml || defaultFetchHtml;

  const query = domain
    ? `site:${domain} ${companyName}`
    : `"${companyName}" empresa servicios`;
  const [searchResult, official] = await Promise.all([
    search({ organizationId, query, language: 'es', countryCode: 'cl', limit: 6 }).catch(() => ({ items: [] as SerperSearchItem[] })),
    domain ? fetchOfficialEvidence(domain, fetchHtml) : Promise.resolve(null),
  ]);

  const evidence = [...(official ? [official] : []), ...parseSerperItems(searchResult.items)];
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = item.link.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 7);
}
