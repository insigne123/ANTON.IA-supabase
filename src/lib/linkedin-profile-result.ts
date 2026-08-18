import type { Lead } from '@/lib/schemas/leads';

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasUsableLinkedInProfileData(lead?: Partial<Lead> | null) {
  if (!lead) return false;

  const email = String(lead.email || '').trim();
  const hasEmail = Boolean(email) && email !== 'email_not_unlocked@domain.com';
  const hasPhone = hasText(lead.primary_phone) || (Array.isArray(lead.phone_numbers) && lead.phone_numbers.some((phone) =>
    hasText(phone?.sanitized_number) || hasText(phone?.number) || hasText(phone?.raw_number)
  ));

  return Boolean(
    hasText(lead.name) ||
    hasText(lead.first_name) ||
    hasText(lead.last_name) ||
    hasText(lead.title) ||
    hasText(lead.organization_name) ||
    hasText(lead.org_name) ||
    hasText(lead.organization?.name) ||
    hasEmail ||
    hasPhone
  );
}

export function partitionLinkedInProfileLeads(leads: Lead[]) {
  const profileLeads: Lead[] = [];
  const trackingIds: string[] = [];

  for (const lead of leads) {
    if (hasUsableLinkedInProfileData(lead)) {
      profileLeads.push(lead);
    } else if (hasText(lead.id)) {
      trackingIds.push(lead.id.trim());
    }
  }

  return { profileLeads, trackingIds };
}
