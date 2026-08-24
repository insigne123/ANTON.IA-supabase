export type ProfileFormValues = {
  name: string;
  role: string;
  companyName: string;
  sector: string;
  website: string;
  description: string;
  services: string;
  valueProposition: string;
};

export const PROFILE_SUGGESTION_FIELDS = [
  'sector',
  'website',
  'description',
  'services',
  'valueProposition',
] as const;

export type ProfileSuggestionField = (typeof PROFILE_SUGGESTION_FIELDS)[number];

export type CompanyProfileSuggestion = Record<ProfileSuggestionField, string>;

export type ProfileSuggestionSelection = Record<ProfileSuggestionField, boolean>;

type ProfileLike = {
  full_name?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  signatures?: unknown;
};

type ProfileUpdate = {
  full_name: string;
  job_title: string;
  company_name: string;
  company_domain: string;
  signatures: Record<string, unknown>;
};

const EMPTY_PROFILE: ProfileFormValues = {
  name: '',
  role: '',
  companyName: '',
  sector: '',
  website: '',
  description: '',
  services: '',
  valueProposition: '',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
  }
  return String(value ?? '').trim();
}

export function createEmptyProfileForm(): ProfileFormValues {
  return { ...EMPTY_PROFILE };
}

export function normalizeCompanyWebsite(value?: string | null): { website: string; domain: string } {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 500 || /[\u0000-\u001f\u007f]/.test(raw)) {
    return { website: '', domain: '' };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { website: '', domain: '' };
  }

  try {
    const candidate = raw.startsWith('//')
      ? `https:${raw}`
      : /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;
    const parsed = new URL(candidate);

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) {
      return { website: '', domain: '' };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    const labels = hostname.split('.');
    const topLevelDomain = labels.at(-1) || '';
    const validHostname = hostname.length <= 253
      && labels.length >= 2
      && /[a-z]/i.test(topLevelDomain)
      && !['example', 'invalid', 'local', 'localhost', 'test'].includes(topLevelDomain)
      && labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
    const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);

    if (!validHostname || isIpv4 || hostname.includes(':')) {
      return { website: '', domain: '' };
    }

    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return {
      website: `https://${hostname}${pathname}`,
      domain: hostname,
    };
  } catch {
    return { website: '', domain: '' };
  }
}

export function mapProfileToForm(profile?: ProfileLike | null): ProfileFormValues {
  if (!profile) return createEmptyProfileForm();

  const signatures = asRecord(profile.signatures);
  const extended = asRecord(signatures.profile_extended);
  const normalizedWebsite = normalizeCompanyWebsite(profile.company_domain);

  return {
    name: asText(profile.full_name),
    role: asText(profile.job_title || extended.role),
    companyName: asText(profile.company_name),
    sector: asText(extended.sector || extended.industry),
    website: normalizedWebsite.website || asText(profile.company_domain),
    description: asText(extended.description),
    services: asText(extended.services),
    valueProposition: asText(extended.valueProposition || extended.value_proposition),
  };
}

export function buildProfileUpdate(form: ProfileFormValues, currentProfile?: ProfileLike | null): ProfileUpdate {
  const signatures = asRecord(currentProfile?.signatures);
  const extended = asRecord(signatures.profile_extended);
  const normalizedWebsite = normalizeCompanyWebsite(form.website);

  return {
    full_name: form.name.trim(),
    job_title: form.role.trim(),
    company_name: form.companyName.trim(),
    company_domain: normalizedWebsite.domain,
    signatures: {
      ...signatures,
      profile_extended: {
        ...extended,
        role: form.role.trim(),
        sector: form.sector.trim(),
        description: form.description.trim(),
        services: form.services.trim(),
        valueProposition: form.valueProposition.trim(),
      },
    },
  };
}

export function getDefaultSuggestionSelection(
  form: ProfileFormValues,
  suggestion: CompanyProfileSuggestion
): ProfileSuggestionSelection {
  return PROFILE_SUGGESTION_FIELDS.reduce((selection, field) => {
    selection[field] = !form[field].trim() && Boolean(suggestion[field].trim());
    return selection;
  }, {} as ProfileSuggestionSelection);
}

export function applyProfileSuggestion(
  form: ProfileFormValues,
  suggestion: CompanyProfileSuggestion,
  selection: ProfileSuggestionSelection
): ProfileFormValues {
  const next = { ...form };
  for (const field of PROFILE_SUGGESTION_FIELDS) {
    const value = suggestion[field].trim();
    if (selection[field] && value) next[field] = value;
  }
  return next;
}
