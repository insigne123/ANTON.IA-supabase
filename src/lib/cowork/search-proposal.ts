import { z } from 'zod';

const terms = z.array(z.string().trim().min(1).max(100)).max(5);
export const coworkSearchCriteriaSchema = z.object({
  titles: terms,
  industries: terms,
  locations: terms,
  limit: z.number().int().min(1).max(25),
}).strict().refine(value => value.titles.length + value.industries.length + value.locations.length > 0, 'Define al menos un criterio');
export type CoworkSearchCriteria = z.infer<typeof coworkSearchCriteriaSchema>;

export function coworkApolloPayload(criteria: CoworkSearchCriteria, userId: string) {
  const valid = coworkSearchCriteriaSchema.parse(criteria);
  return {
    search_mode: 'batch', user_id: userId, titles: valid.titles,
    industry_keywords: valid.industries, person_locations: valid.locations,
    max_results: valid.limit, per_page: valid.limit, page: 1,
    reveal_email: false, reveal_phone: false, include_similar_titles: false,
  };
}
