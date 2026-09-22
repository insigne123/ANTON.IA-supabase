import { z } from 'zod';
import { audienceRolePolicySchema } from './audience-analysis';

const terms = z.array(z.string().trim().min(1).max(100)).max(5);
export const coworkSearchCriteriaSchema = z.object({
  target: z.enum(['people', 'companies']).nullish(),
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
  limit: z.number().int().min(1).max(25),
}).strict().superRefine((value, context) => {
  if (value.target === 'companies' && (value.titles.length || value.locations.length || value.seniorities?.length)) {
    context.addIssue({ code: 'custom', message: 'La búsqueda de empresas usa companyLocations, no filtros de personas.' });
  }
}).refine(value => value.titles.length + value.industries.length + value.locations.length
  + (value.seniorities?.length || 0) + (value.companyLocations?.length || 0)
  + (value.employeeRanges?.length || 0) + (value.companyDomains?.length || 0) > 0, 'Define al menos un criterio');
export type CoworkSearchCriteria = z.infer<typeof coworkSearchCriteriaSchema>;

export function coworkApolloPayload(criteria: CoworkSearchCriteria, userId: string) {
  const valid = coworkSearchCriteriaSchema.parse(criteria);
  return {
    search_mode: valid.target === 'companies' ? 'organization_search' : 'batch', user_id: userId, titles: valid.titles,
    industry_keywords: valid.industries, person_locations: valid.locations,
    max_results: valid.limit, per_page: valid.limit, page: 1,
    reveal_email: false, reveal_phone: false, include_similar_titles: false,
    ...(valid.target === 'companies' ? { company_keywords: valid.industries } : {}),
    ...(valid.seniorities?.length ? { seniorities: valid.seniorities } : {}),
    ...(valid.companyLocations?.length ? { company_location: valid.companyLocations } : {}),
    ...(valid.employeeRanges?.length ? { employee_ranges: valid.employeeRanges } : {}),
    ...(valid.companyDomains?.length ? { organization_domains: valid.companyDomains } : {}),
  };
}
