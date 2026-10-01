import { z } from 'zod';
import { audienceRolePolicySchema } from './audience-analysis';

/** Up to 100 people or companies per search; the instructions ask for 25 when the person does not say how many. */
export const COWORK_SEARCH_MAX = 100;
/** «Empresas primero» brings this many companies, then looks for people in them in groups the provider takes in one call. */
export const COWORK_SEARCH_COMPANIES = 100;
export const COWORK_SEARCH_COMPANY_GROUP = 50;
/** «Traer más» moves through pages of the same criteria; companies first also through the people of one page (offset). */
export const COWORK_SEARCH_MAX_PAGE = 20;
export const COWORK_SEARCH_MAX_OFFSET = 199;

const terms = z.array(z.string().trim().min(1).max(100)).max(5);
export const coworkSearchCriteriaSchema = z.object({
  target: z.enum(['people', 'companies']).nullish(),
  // companies_first: the companies of the offer's industries first, then the people with those roles inside them.
  strategy: z.enum(['people', 'companies_first']).nullish(),
  rolePolicy: audienceRolePolicySchema.nullish(),
  titles: terms,
  industries: terms,
  locations: terms,
  seniorities: z.array(z.enum(['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry', 'intern'])).max(5).nullish(),
  companyLocations: terms.nullish(),
  employeeRanges: z.array(z.string().regex(/^\d{1,8}-\d{1,8}$/).refine(value => {
    const [min, max] = value.split('-').map(Number);
    return min <= max && max <= 10000000;
  }, 'Rango de empleados inválido')).max(5).nullish(),
  companyDomains: z.array(z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)).max(5).nullish(),
  limit: z.number().int().min(1).max(COWORK_SEARCH_MAX),
  page: z.number().int().min(1).max(COWORK_SEARCH_MAX_PAGE).nullish(),
  offset: z.number().int().min(0).max(COWORK_SEARCH_MAX_OFFSET).nullish(),
}).strict().superRefine((value, context) => {
  if (value.target === 'companies' && (value.titles.length || value.locations.length || value.seniorities?.length)) {
    context.addIssue({ code: 'custom', message: 'La búsqueda de empresas usa companyLocations, no filtros de personas.' });
  }
  if (value.strategy === 'companies_first' && value.target === 'companies') {
    context.addIssue({ code: 'custom', message: 'strategy companies_first busca personas: no la uses con target companies.' });
  }
  if (value.strategy === 'companies_first' && !companyFilters(value)) {
    context.addIssue({ code: 'custom', message: 'Para buscar empresas primero indica rubros (industries), tamaños, dominios o ubicación de las empresas.' });
  }
  if (value.strategy === 'companies_first' && !value.titles.length && !value.seniorities?.length) {
    context.addIssue({ code: 'custom', message: 'Para buscar personas dentro de esas empresas indica cargos (titles) o niveles (seniorities).' });
  }
  if (value.offset && coworkSearchStrategy(value) !== 'companies_first') {
    context.addIssue({ code: 'custom', message: 'offset solo sirve al buscar empresas primero; para traer más usa page.' });
  }
}).refine(value => value.titles.length + value.industries.length + value.locations.length
  + (value.seniorities?.length || 0) + (value.companyLocations?.length || 0)
  + (value.employeeRanges?.length || 0) + (value.companyDomains?.length || 0) > 0, 'Define al menos un criterio');
export type CoworkSearchCriteria = z.infer<typeof coworkSearchCriteriaSchema>;
export type CoworkSearchStrategy = 'companies' | 'people' | 'companies_first';

function companyFilters(value: Pick<CoworkSearchCriteria, 'industries' | 'companyLocations' | 'employeeRanges' | 'companyDomains'>) {
  return value.industries.length + (value.companyLocations?.length || 0) + (value.employeeRanges?.length || 0) + (value.companyDomains?.length || 0) > 0;
}

/**
 * How the search runs. People with industries go companies first unless the proposal asks otherwise: in a single people
 * search the industry, exact titles and place all narrow the same query, and the 1 Oct test brought 2 people out of 25.
 */
export function coworkSearchStrategy(criteria: {
  target?: 'people' | 'companies' | null; strategy?: 'people' | 'companies_first' | null;
  industries: string[]; titles: string[]; seniorities?: string[] | null;
}): CoworkSearchStrategy {
  if (criteria.target === 'companies') return 'companies';
  if (criteria.strategy) return criteria.strategy;
  return criteria.industries.length && (criteria.titles.length || criteria.seniorities?.length) ? 'companies_first' : 'people';
}

/** One provider call: people (one query) or companies. Similar titles stay on: the ranking puts the closest roles first. */
export function coworkApolloPayload(criteria: CoworkSearchCriteria, userId: string) {
  const valid = coworkSearchCriteriaSchema.parse(criteria);
  return {
    search_mode: valid.target === 'companies' ? 'organization_search' : 'batch', user_id: userId, titles: valid.titles,
    industry_keywords: valid.industries, person_locations: valid.locations,
    max_results: valid.limit, per_page: valid.limit, page: valid.page || 1,
    reveal_email: false, reveal_phone: false, include_similar_titles: true,
    ...(valid.target === 'companies' ? { company_keywords: valid.industries } : {}),
    ...(valid.seniorities?.length ? { seniorities: valid.seniorities } : {}),
    ...(valid.companyLocations?.length ? { company_location: valid.companyLocations } : {}),
    ...(valid.employeeRanges?.length ? { employee_ranges: valid.employeeRanges } : {}),
    ...(valid.companyDomains?.length ? { organization_domains: valid.companyDomains } : {}),
  };
}

/** The country of a person's place («Antofagasta, Chile» → «Chile»): companies are found by country, people by their place. */
function country(place: string) {
  return place.split(',').map(part => part.trim()).filter(Boolean).pop() || place.trim();
}

/**
 * «Empresas primero», step 1: the companies of those industries and sizes, in the company places asked for or else in the
 * country of the person's place (a mine run from Santiago still has its people in Antofagasta).
 */
export function coworkCompanyStepPayload(criteria: CoworkSearchCriteria, userId: string) {
  const valid = coworkSearchCriteriaSchema.parse(criteria);
  const places = valid.companyLocations?.length ? valid.companyLocations
    : [...new Map(valid.locations.map(country).filter(Boolean).map(place => [place.toLocaleLowerCase('es'), place])).values()];
  return {
    search_mode: 'organization_search', user_id: userId, reveal_email: false, reveal_phone: false,
    company_keywords: valid.industries, company_location: places,
    per_page: COWORK_SEARCH_COMPANIES, page: valid.page || 1,
    ...(valid.employeeRanges?.length ? { employee_ranges: valid.employeeRanges } : {}),
    ...(valid.companyDomains?.length ? { organization_domains: valid.companyDomains } : {}),
  };
}

/** «Empresas primero», step 2: the people with those roles inside a group of the companies found (similar titles on). */
export function coworkPeopleStepPayload(criteria: CoworkSearchCriteria, userId: string, organizationIds: string[]) {
  const valid = coworkSearchCriteriaSchema.parse(criteria);
  const ids = [...new Set(organizationIds.map(id => id.trim()).filter(Boolean))];
  if (!ids.length || ids.length > COWORK_SEARCH_COMPANY_GROUP) throw new Error('Cowork people step needs 1 to 50 companies');
  return {
    search_mode: 'batch', user_id: userId, reveal_email: false, reveal_phone: false,
    organization_ids: ids, titles: valid.titles, person_locations: valid.locations, include_similar_titles: true,
    max_results: COWORK_SEARCH_MAX, per_page: COWORK_SEARCH_MAX, page: 1,
    ...(valid.seniorities?.length ? { seniorities: valid.seniorities } : {}),
  };
}
