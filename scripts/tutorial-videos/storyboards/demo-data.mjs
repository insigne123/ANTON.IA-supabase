// Demo answers for the calls the videos make that the bench blocks (search, enrichment, sending, AI). Made-up companies
// and people, with the same shapes the app's server returns; nothing here is real.
export const DEMO_COMPANIES = [
  ['Norte Sur Transportes', 'nortesur.cl', 'logistics & supply chain', 420], ['Andes Food', 'andesfood.cl', 'food & beverages', 950],
  ['Retail Pacífico', 'retailpacifico.cl', 'retail', 1800], ['Seguridad Central', 'seguridadcentral.cl', 'security & investigations', 650],
].map(([name, domain, industry, size], index) => ({
  id: `demo-org-${index}`, name, primary_domain: domain, website_url: `https://www.${domain}`, industry, city: index % 2 ? 'Concepción' : 'Santiago',
  country: 'Chile', estimated_num_employees: size,
}));

const PEOPLE = ['Carolina Ibáñez', 'Pablo Quiroga', 'Marcela Toro', 'Rodrigo Fuentes', 'Daniela Paz', 'Tomás Lira', 'Fernanda Rey', 'Ignacio Vidal'];
const TITLES = ['Gerente de Personas', 'Jefe de Reclutamiento', 'Subgerente de RR. HH.', 'Jefa de Selección'];

/** A person the provider found, with the last name hidden as the app shows it before enriching. */
export function demoPerson(company, index) {
  const [first, last] = PEOPLE[(index + Number(company.id.slice(-1)) * 3) % PEOPLE.length].split(' ');
  const masked = `${last.slice(0, 2)}***${last.slice(-1)}`;
  const id = `demo-${company.id}-${index}`;
  return {
    id, name: `${first} ${masked}`, first_name: first, last_name: masked, has_email: true, title: TITLES[index % TITLES.length],
    city: company.city, country: 'Chile', seniority: 'manager', departments: [], source_provider: 'apollo', source_provider_id: id,
    organization_id: company.id, organization_name: company.name, organization_domain: company.primary_domain,
    organization: { id: company.id, name: company.name, domain: company.primary_domain, industry: company.industry, website_url: company.website_url },
  };
}

/** «Buscar prospectos»: companies first, then up to four people in each one. */
export const searchMocks = [{
  url: '**/api/leads/search', method: 'POST',
  respond: body => {
    if (body?.search_mode === 'companies') {
      return { organizations: DEMO_COMPANIES, count: DEMO_COMPANIES.length, page: 1, per_page: 25, total_entries: 57, total_pages: 3 };
    }
    const company = DEMO_COMPANIES.find(item => item.id === (body?.organization_id || body?.organizationId)) || DEMO_COMPANIES[0];
    const leads = Array.from({ length: 4 }, (_, index) => demoPerson(company, index));
    return { leads, count: leads.length, leads_count: leads.length, organization_id: company.id, page: 1, per_page: 25, total_entries: leads.length, total_pages: 1 };
  },
}, { url: '**/api/leads/search/checkpoint', method: 'PUT', respond: { ok: true } }];
