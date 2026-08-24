export type CompanyEvidenceItem = {
  title: string;
  link: string;
  snippet: string;
  source: string;
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

export async function findCompanyEvidence(input: { companyName: string; domain?: string }) {
  const apiKey = String(
    process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY || process.env.SERPAPI_KEY || ''
  ).trim();
  if (!apiKey) return [];

  const query = input.domain
    ? `site:${input.domain} ${input.companyName} empresa servicios`
    : `"${input.companyName}" empresa sector servicios propuesta de valor`;
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    hl: 'es',
    gl: 'cl',
    num: '8',
    api_key: apiKey,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return [];
    return parseCompanyEvidence(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
