import { createEmptyProfileForm, mapProfileToForm, PROFILE_COMPANY_SIZES, type ProfileFormValues } from '@/lib/profile/profile-mappings';
import { lineItems } from '@/lib/profile/profile-lists';

/**
 * «Ficha de la empresa» (APP-06): what the company sells, said once for everyone. It holds the fields «Perfil» calls «Tu
 * empresa», «Tu oferta» and «Tu cliente ideal», with the same names, so whoever reads a profile can read the company's
 * instead; the person keeps their name and role (and their tone, in «Firmas y estilo»). Owners and admins edit it; saving
 * it is reviewing it, and after COMPANY_PROFILE_REVIEW_DAYS it asks to be looked at again.
 */
export const COMPANY_PROFILE_FIELDS = [
  'companyName', 'website', 'sector', 'description',
  'services', 'valueProposition', 'painPoints', 'differentiators', 'proofPoints', 'referenceClients',
  'targetRoles', 'targetIndustries', 'targetCompanySize', 'targetLocations',
] as const satisfies ReadonlyArray<keyof ProfileFormValues>;
export type CompanyProfileField = typeof COMPANY_PROFILE_FIELDS[number];
export type CompanyProfileFields = Pick<ProfileFormValues, CompanyProfileField>;

export type CompanyProfile = {
  fields: CompanyProfileFields;
  revision: number;
  reviewedAt: string | null;
  /** Who saved it last, by name when it can be read. */
  reviewedBy: string | null;
};

/** A field longer than this is not a profile: it is cut where a person would never write. */
export const COMPANY_PROFILE_FIELD_MAX = 4000;
export const COMPANY_PROFILE_REVIEW_DAYS = 90;

/** What «Perfil» said about the company, from a stored row or a request: every field a trimmed string, the size one of the known ones. */
export function companyProfileFields(value: unknown): CompanyProfileFields {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const empty = createEmptyProfileForm();
  const fields = Object.fromEntries(COMPANY_PROFILE_FIELDS.map(field => {
    const raw = source[field];
    const text = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim().slice(0, COMPANY_PROFILE_FIELD_MAX) : empty[field];
    return [field, text];
  })) as CompanyProfileFields;
  if (!(PROFILE_COMPANY_SIZES as readonly string[]).includes(fields.targetCompanySize)) fields.targetCompanySize = '';
  return fields;
}

/** The company part of a person's own «Perfil», as the profile row stores it. */
export function companyFieldsFromProfile(profile: Parameters<typeof mapProfileToForm>[0]): CompanyProfileFields {
  return companyProfileFields(mapProfileToForm(profile));
}

/** Whether there is an offer to sell from: what it sells, the result it gets or what the company does. */
export function companyProfileHasOffer(fields: CompanyProfileFields) {
  return Boolean(fields.services.trim() || fields.valueProposition.trim() || fields.description.trim());
}

/** The products and services, one per line as «Perfil» writes them. */
export function companyProfileServices(fields: Pick<CompanyProfileFields, 'services'>) {
  return lineItems(fields.services);
}

/** When it was last reviewed and whether it is time to look at it again. */
export function companyProfileReview(reviewedAt: string | null, now = new Date()) {
  const at = reviewedAt ? Date.parse(reviewedAt) : NaN;
  if (!Number.isFinite(at)) return { daysAgo: null, due: true };
  const daysAgo = Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
  return { daysAgo, due: daysAgo >= COMPANY_PROFILE_REVIEW_DAYS };
}
