import { buildProfileUpdate, createEmptyProfileForm, mapProfileToForm, PROFILE_COMPANY_SIZES, type ProfileFormValues } from '@/lib/profile/profile-mappings';
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

type ProfileRow = Parameters<typeof mapProfileToForm>[0] & Record<string, unknown>;

/** Where «Perfil» keeps which of the company's products and services the person sells (profile_extended.companyServices). */
export function companyServicesPicked(profile: { signatures?: unknown } | null | undefined): string[] {
  const signatures = profile?.signatures && typeof profile.signatures === 'object' ? profile.signatures as Record<string, unknown> : {};
  const extended = signatures.profile_extended && typeof signatures.profile_extended === 'object' ? signatures.profile_extended as Record<string, unknown> : {};
  return Array.isArray(extended.companyServices)
    ? extended.companyServices.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, 50)
    : [];
}

/**
 * The company's products and services this person sells: the lines of the profile they picked, or all of them when they picked
 * none or none of their picks is still there (the admins renamed them).
 */
export function companyServicesFor(fields: Pick<CompanyProfileFields, 'services'>, picked: string[]) {
  const all = companyProfileServices(fields);
  const chosen = all.filter(line => picked.includes(line));
  return chosen.length ? chosen : all;
}

/**
 * A profile row as everything that reads one expects it, with the company part taken from the company profile: the name and
 * the role stay the person's; what the company is, sells and to whom comes from the profile the admins keep, field by field
 * (a field the profile leaves empty keeps the person's); the products are the ones the person sells. Without a company profile
 * with an offer, the row as it was.
 */
export function withCompanyProfile<T extends ProfileRow | null | undefined>(profile: T, company: CompanyProfileFields | null | undefined): T {
  if (!company || !companyProfileHasOffer(company)) return profile;
  const form = withCompanyFields(mapProfileToForm(profile ?? null), company, companyServicesPicked(profile ?? null));
  return { ...(profile ?? {}), ...buildProfileUpdate(form, profile ?? null) } as T;
}

/** The same on «Perfil»'s form: what the AI reads for this person, with the products they picked. */
export function withCompanyFields(form: ProfileFormValues, company: CompanyProfileFields, picked: string[]): ProfileFormValues {
  const next = { ...form };
  for (const field of COMPANY_PROFILE_FIELDS) if (company[field]) next[field] = company[field];
  if (company.services) next.services = companyServicesFor(company, picked).join('\n');
  return next;
}

/**
 * «Usar» on what someone in the team wrote: it fills the fields the profile leaves empty and adds the products and services
 * it does not list yet. What the admin already wrote stays. `added` counts the fields that changed.
 */
export function mergeCompanySuggestion(values: CompanyProfileFields, suggestion: Partial<CompanyProfileFields>) {
  const next = { ...values };
  let added = 0;
  for (const field of COMPANY_PROFILE_FIELDS) {
    const offered = String(suggestion[field] ?? '').trim();
    if (!offered) continue;
    if (field === 'services' && next.services.trim()) {
      const listed = new Set(lineItems(next.services).map(line => line.toLowerCase()));
      const missing = lineItems(offered).filter(line => !listed.has(line.toLowerCase()));
      if (missing.length) { next.services = [next.services.trim(), ...missing].join('\n'); added++; }
      continue;
    }
    if (!next[field].trim()) { next[field] = offered; added++; }
  }
  return { values: companyProfileFields(next), added };
}
