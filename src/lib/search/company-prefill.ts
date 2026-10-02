/**
 * «Buscar decisores» in «Oportunidades» opens Búsqueda by company with the roles to look for
 * (/search?company=…&domain=…&titles=…). Búsqueda fills the form and waits: the person reviews it and runs the search, with
 * its cost shown as always.
 */
export type CompanySearchPrefill = { companyName: string; companyDomains: string; title: string };

const clean = (value: string | null, max: number) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function companySearchPrefill(search: string): CompanySearchPrefill | null {
  const params = new URLSearchParams(search);
  const companyName = clean(params.get('company'), 120);
  const domain = clean(params.get('domain'), 253).toLowerCase();
  const companyDomains = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : '';
  if (!companyName && !companyDomains) return null;
  return { companyName, companyDomains, title: clean(params.get('titles'), 300) };
}

export function companySearchHref(input: { company: string; domain?: string | null; titles?: string[] }) {
  const params = new URLSearchParams({ company: input.company });
  if (input.domain) params.set('domain', input.domain);
  if (input.titles?.length) params.set('titles', input.titles.join(', '));
  return `/search?${params}`;
}
