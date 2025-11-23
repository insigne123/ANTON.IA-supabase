import { JobOpportunity } from './types';

export function normalizeLinkedinJob(item: any): JobOpportunity {
  // No generes un UUID si item.id es 0 o '' (válidos); solo si es null/undefined
  const id = item?.id ?? crypto.randomUUID();

  return {
    id: String(id),
    title: String(item?.title ?? ''),
    companyName: String(item?.companyName ?? item?.company ?? ''),
    companyDomain: item?.companyDomain ?? item?.companyUrl ?? undefined,
    companyLinkedinUrl: item?.companyLinkedinUrl ?? undefined,
    jobUrl: item?.jobUrl ?? item?.url ?? '',
    location: item?.location ?? undefined,
    postedTime: item?.postedTime ?? item?.publishedAt ?? undefined,
  };
}

// Export for API route compatibility - stub implementation
// Export for API route compatibility - stub implementation
export function buildApolloPeopleUrl(company: any, titles: string[], locations?: string[]): string {
  // TODO: Implement proper Apollo people URL building
  return '';
}
