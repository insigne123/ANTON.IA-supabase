// Contacts at every stage before the first message: saved leads («Por completar», some still without an email), enriched
// leads («Por escribir») with phones and research, and the saved searches the search page lists.
const COMPANIES = [
  ['Retail Andino', 'retailandino.cl', 'Retail', 1200], ['Logística Sur', 'logisticasur.cl', 'Logística', 340],
  ['Seguridad Austral', 'seguridadaustral.cl', 'Seguridad privada', 780], ['Farmacias Del Valle', 'farmaciasdelvalle.cl', 'Retail', 2100],
  ['Transportes Cordillera', 'transcordillera.cl', 'Logística', 260], ['Grupo Pacífico', 'grupopacifico.cl', 'Servicios', 450],
  ['Constructora Maule', 'constructoramaule.cl', 'Construcción', 610], ['Minera Norte Grande', 'mineranorte.cl', 'Minería', 3200],
];
const PEOPLE = [
  ['Andrea', 'Soto', 'Gerente de Personas'], ['Matías', 'Rojas', 'Jefe de Reclutamiento'], ['Francisca', 'Muñoz', 'Gerente de Operaciones'],
  ['Joaquín', 'Díaz', 'Director de Recursos Humanos'], ['Isidora', 'Contreras', 'Jefa de Selección'], ['Benjamín', 'Silva', 'Gerente General'],
  ['Catalina', 'Morales', 'Subgerente de Personas'], ['Tomás', 'Espinoza', 'Jefe de Seguridad'], ['Valentina', 'Araya', 'Analista de Talento'],
  ['Sebastián', 'Herrera', 'Gerente de Administración'], ['Antonia', 'Castillo', 'Coordinadora de RR. HH.'], ['Vicente', 'Fuentes', 'Gerente de Logística'],
  ['Martina', 'Valenzuela', 'Jefa de Personas'], ['Agustín', 'Pizarro', 'Gerente de Riesgos'], ['Josefa', 'Tapia', 'Business Partner de RR. HH.'],
  ['Lucas', 'Reyes', 'Jefe de Operaciones'], ['Emilia', 'Gutiérrez', 'Gerente de Cumplimiento'], ['Maximiliano', 'Carrasco', 'Director de Operaciones'],
  ['Florencia', 'Sepúlveda', 'Jefa de Reclutamiento Masivo'], ['Cristóbal', 'Núñez', 'Gerente Comercial'], ['Amanda', 'Vargas', 'Subgerente de Operaciones'],
  ['Felipe', 'Cortés', 'Jefe de Prevención de Riesgos'], ['Javiera', 'Lagos', 'Gerente de Personas y Cultura'], ['Diego', 'Bravo', 'Gerente de Finanzas'],
  ['Rocío', 'Figueroa', 'Jefa de Compensaciones'],
];
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
// People the provider returns in a search that are not saved yet (the saved ones above come back as «Guardado»).
const SEARCH_PEOPLE = [
  ['Paula', 'Henríquez', 'Gerente de Personas'], ['Ignacio', 'Molina', 'Jefe de Reclutamiento'], ['Constanza', 'Ríos', 'Subgerente de RR. HH.'],
  ['Rodrigo', 'Saavedra', 'Jefe de Selección'], ['Daniela', 'Olivares', 'Business Partner de Personas'], ['Gonzalo', 'Vera', 'Gerente de Operaciones'],
];

/** The owner left a company-first search half done: 4 companies found, 2 of them searched, one person already saved. */
function searchCheckpoint(people) {
  const companies = COMPANIES.slice(0, 4).map(([name, domain, industry, size], index) => ({
    id: `org-qa-${index}`, name, primary_domain: domain, website_url: `https://www.${domain}`, industry,
    city: index % 2 ? 'Concepción' : 'Santiago', country: 'Chile', estimated_num_employees: size,
  }));
  const row = (id, name, title, organization, linkedin) => ({
    id, name, title, company: organization.name, email: null, avatar: '', location: 'Santiago, Chile', industry: organization.industry,
    companyWebsite: organization.website_url, companyLinkedin: null, linkedinUrl: linkedin, sourceProvider: 'apollo', sourceProviderId: id,
    phoneNumbers: null, primaryPhone: null, country: 'Chile', city: 'Santiago', status: 'saved',
  });
  const found = SEARCH_PEOPLE.map(([first, last, title], index) => ({ id: `apollo-new-${index}`, name: `${first} ${last}`, title, linkedin: `https://www.linkedin.com/in/${slug(first)}-${slug(last)}-qa` }));
  const saved = people[0];
  const windows = [
    [companies[0], [row('apollo-qa-0', saved.name, saved.title, companies[0], saved.linkedin), ...found.slice(0, 3).map(p => row(p.id, p.name, p.title, companies[0], p.linkedin))]],
    [companies[1], found.slice(3).map(p => row(p.id, p.name, p.title, companies[1], p.linkedin))],
  ];
  return {
    version: 1,
    filters: { searchMode: 'filters', companyKeywords: 'retail, logística', location: 'Chile', title: 'Gerente de Personas, Jefe de Reclutamiento', seniorities: [], sizeRange: '', maxResults: 25 },
    companies, companiesPage: 1, companiesTotalPages: 3, companiesTotalEntries: 57,
    selectedCompanyIds: ['org-qa-0', 'org-qa-1'], activeCompanyId: 'org-qa-0', filterStep: 'people',
    companyWindows: Object.fromEntries(windows.map(([organization, leads]) => [organization.id, {
      organization, leads, page: 1, perPage: 25, totalEntries: leads.length + 6, totalPages: 1, isLoading: false, isExpanding: false,
      hasMore: true, error: '', deliveredIds: leads.map(lead => lead.id),
    }])),
  };
}

export default function leads(ctx) {
  const people = PEOPLE.map(([first, last, title], index) => {
    const [company, domain, industry, size] = COMPANIES[index % COMPANIES.length];
    return { first, last, name: `${first} ${last}`, title, company, domain, industry, size, email: `${slug(first)}.${slug(last)}@${domain}`, linkedin: `https://www.linkedin.com/in/${slug(first)}-${slug(last)}-qa` };
  });

  // «Por completar»: 25 saved leads, the last 8 without an email yet (one with a failed lookup).
  const savedLeads = people.map((person, index) => ({
    id: ctx.uid(1000 + index), user_id: index % 4 === 3 ? ctx.MEMBER : ctx.OWNER, organization_id: ctx.ORG,
    name: person.name, title: person.title, company: person.company, email: index < 17 ? person.email : null,
    avatar: null, status: 'saved', email_enrichment: index === 24 ? { status: 'not_found', attemptedAt: ctx.daysAgo(1) } : null,
    industry: person.industry, company_website: `https://${person.domain}`, company_linkedin: `https://www.linkedin.com/company/${person.domain.split('.')[0]}`,
    linkedin_url: person.linkedin, location: 'Santiago, Chile', country: 'Chile', city: index % 3 === 0 ? 'Santiago' : index % 3 === 1 ? 'Concepción' : 'Valparaíso',
    created_at: ctx.hoursAgo(3 + index * 5), apollo_id: `apollo-qa-${index}`, last_enriched_at: null, last_contacted_at: null,
    last_enrichment_attempt_at: index === 24 ? ctx.daysAgo(1) : null, enrichment_error: index === 24 ? 'No se encontró un correo verificado.' : null,
    score: 92 - index * 3, score_tier: index < 6 ? 'A' : index < 15 ? 'B' : 'C', score_reason: index < 6 ? 'Cargo y rubro calzan con tu cliente ideal.' : null,
    source_provider: 'apollo', source_provider_id: `apollo-qa-${index}`,
  }));

  // «Por escribir»: 20 enriched leads; the first 6 already have research, 4 have a phone.
  const enriched = people.slice(0, 20).map((person, index) => ({
    id: ctx.uid(2000 + index), user_id: index % 5 === 4 ? ctx.MEMBER : ctx.OWNER, organization_id: ctx.ORG,
    full_name: person.name, email: person.email, company_name: person.company, title: person.title, linkedin_url: person.linkedin,
    data: {
      companyDomain: person.domain, companyWebsite: `https://${person.domain}`, industry: person.industry, country: 'Chile', city: 'Santiago',
      descriptionSnippet: `${person.company} opera en ${person.industry.toLowerCase()} con cerca de ${person.size} personas.`,
      ...(index < 6 ? { research: { status: 'completed', summary: `${person.company} está contratando para ${index % 2 ? 'nuevas tiendas' : 'su centro de distribución'}.`, completedAt: ctx.daysAgo(index + 1) } } : {}),
    },
    created_at: ctx.hoursAgo(6 + index * 7), updated_at: ctx.hoursAgo(2 + index), state: 'Región Metropolitana', country: 'Chile', city: 'Santiago',
    headline: `${person.title} en ${person.company}`, photo_url: null, seniority: index % 3 === 0 ? 'director' : 'manager', departments: ['human_resources'],
    email_status: index % 7 === 6 ? 'guessed' : 'verified', organization_domain: person.domain, organization_industry: person.industry, organization_size: person.size,
    phone_numbers: index < 4 ? [{ raw_number: `+56 9 ${5100 + index} ${2200 + index * 7}`, type: 'mobile' }] : [], primary_phone: index < 4 ? `+56 9 ${5100 + index} ${2200 + index * 7}` : null,
    enrichment_status: 'completed', source_provider: 'apollo', source_provider_id: `apollo-qa-${index}`,
  }));

  const research = enriched.slice(0, 6).map((lead, index) => ({
    id: ctx.uid(2500 + index), scope_key: `${ctx.ORG}:${lead.id}`, organization_id: ctx.ORG, user_id: ctx.OWNER, provider_report_id: `report-${index}`,
    lead_ref: lead.id, lead_id: lead.id, email: lead.email, company_name: lead.company_name, company_domain: lead.organization_domain, provider: 'native',
    status: 'completed', request_payload: {}, result_payload: { summary: lead.data.research.summary }, error_code: null, error_message: null, attempt_count: 1, max_attempts: 3,
    scheduled_for: lead.created_at, started_at: lead.created_at, completed_at: lead.data.research.completedAt, created_at: lead.created_at, updated_at: lead.data.research.completedAt,
  }));

  return {
    tables: {
      leads: savedLeads,
      enriched_leads: enriched,
      lead_research_jobs: research,
      saved_searches: [
        { id: ctx.uid(3001), organization_id: ctx.ORG, user_id: ctx.OWNER, name: 'Gerentes de Personas en retail', criteria: { titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Chile'] }, is_shared: true, created_at: ctx.daysAgo(12), updated_at: ctx.daysAgo(3) },
        { id: ctx.uid(3002), organization_id: ctx.ORG, user_id: ctx.OWNER, name: 'Logística 200-500', criteria: { industries: ['Logística'], sizes: ['201-500'] }, is_shared: false, created_at: ctx.daysAgo(30), updated_at: ctx.daysAgo(30) },
      ],
      excluded_domains: [{ id: ctx.uid(3101), organization_id: ctx.ORG, user_id: ctx.OWNER, domain: 'competidor.cl', created_at: ctx.daysAgo(40) }],
      // Only the owner has one: the member and the empty organization open «Buscar prospectos» from the start.
      search_workspace_checkpoints: [{ organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 3, snapshot: searchCheckpoint(people), updated_at: ctx.hoursAgo(2) }],
    },
  };
}
