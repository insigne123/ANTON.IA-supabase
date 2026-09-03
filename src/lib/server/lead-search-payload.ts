import type { LeadsSearchParams } from '@/lib/schemas/leads';

type BatchLeadSearchPayloadOptions = {
  provider: string;
  userId?: string | null;
};

export function buildBatchLeadSearchPayload(
  currentParams: LeadsSearchParams[number],
  options: BatchLeadSearchPayloadOptions,
) {
  const titles = Array.isArray(currentParams.titles)
    ? currentParams.titles
    : currentParams.titles.trim().length > 0
      ? [currentParams.titles.trim()]
      : [];

  return {
    provider: options.provider,
    user_id: options.userId || undefined,
    search_mode: 'batch' as const,
    industry_keywords: currentParams.industry_keywords,
    company_keywords: currentParams.company_keywords,
    company_location: currentParams.company_location,
    person_locations: currentParams.person_locations,
    titles,
    seniorities: currentParams.seniorities,
    include_similar_titles: currentParams.include_similar_titles,
    employee_ranges: currentParams.employee_ranges,
    max_results: currentParams.max_results,
  };
}
