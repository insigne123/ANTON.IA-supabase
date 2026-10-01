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

/**
 * Third-party search results about the company, to complement its own site (read separately and safely by
 * fetchCompanyProfileSite) or to identify it when there is no site. Search only: this module never fetches a page.
 */
export async function findCompanyEvidence(
  input: { companyName: string; domain?: string; organizationId?: string },
  dependencies: CompanyEvidenceDependencies = {},
): Promise<CompanyEvidenceItem[]> {
  const companyName = String(input.companyName || '').trim();
  const organizationId = String(input.organizationId || '').trim();
  const domain = String(input.domain || '').trim().toLowerCase();
  if ((!companyName && !domain) || !organizationId) return [];

  const search = dependencies.search || (async (request) => searchSerper({
    organizationId: request.organizationId,
    kind: 'organic',
    query: request.query,
    language: request.language,
    countryCode: request.countryCode,
    limit: request.limit,
  }));

  const query = domain
    ? `site:${domain} ${companyName}`.trim()
    : `"${companyName}" empresa servicios`;
  const searchResult = await search({ organizationId, query, language: 'es', countryCode: 'cl', limit: 6 })
    .catch(() => ({ items: [] as SerperSearchItem[] }));

  const seen = new Set<string>();
  return parseSerperItems(searchResult.items).filter((item) => {
    const key = item.link.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}
