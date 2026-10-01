import { commaItems, joinComma, joinLines, lineItems } from '@/lib/profile/profile-lists';

export type ProfileFormValues = {
  name: string;
  role: string;
  companyName: string;
  sector: string;
  website: string;
  description: string;
  services: string;
  valueProposition: string;
  proofPoints: string;
  /** Problems the offer solves, one per line. */
  painPoints: string;
  /** Why choose this company, one per line. */
  differentiators: string;
  /** Clients the person may name, separated by commas. */
  referenceClients: string;
  /** Ideal customer: roles, industries, company size and places to prospect. */
  targetRoles: string;
  targetIndustries: string;
  targetCompanySize: string;
  targetLocations: string;
};

export const PROFILE_SUGGESTION_FIELDS = [
  'companyName',
  'sector',
  'website',
  'description',
  'services',
  'valueProposition',
  'painPoints',
  'differentiators',
  'proofPoints',
  'referenceClients',
  'targetRoles',
  'targetIndustries',
  'targetCompanySize',
  'targetLocations',
] as const;

export type ProfileSuggestionField = (typeof PROFILE_SUGGESTION_FIELDS)[number];

export type CompanyProfileSuggestion = Partial<Record<ProfileSuggestionField, string>>;

export type ProfileSuggestionSelection = Partial<Record<ProfileSuggestionField, boolean>>;

/** Company sizes, as «Buscar prospectos» filters them (src/lib/data.ts). */
export const PROFILE_COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'] as const;

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
  proofPoints: '',
  painPoints: '',
  differentiators: '',
  referenceClients: '',
  targetRoles: '',
  targetIndustries: '',
  targetCompanySize: '',
  targetLocations: '',
};

/** Fields added after the first profile: written only when they have content or already existed, so a profile that never
 * used them round-trips byte for byte (Cowork compares the stored JSON to name what changed). */
const LINE_LIST_FIELDS = ['painPoints', 'differentiators'] as const;
const COMMA_LIST_FIELDS = ['referenceClients', 'targetRoles', 'targetIndustries', 'targetLocations'] as const;

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

function asMultilineText(value: unknown): string {
  if (!Array.isArray(value)) return asText(value);
  return value.map((item) => asText(item)).filter(Boolean).join('\n');
}

function multilineItems(value: string): string[] {
  return value.split(/\r?\n/g).map((item) => item.trim()).filter(Boolean);
}

function companySize(value: unknown) {
  const size = asText(value);
  return (PROFILE_COMPANY_SIZES as readonly string[]).includes(size) ? size : '';
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

/** Free mailboxes say nothing about the company; any other address domain is a good first guess for its website. */
const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.cl', 'outlook.com', 'outlook.es', 'outlook.cl', 'live.com',
  'live.cl', 'msn.com', 'yahoo.com', 'yahoo.es', 'yahoo.cl', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'zoho.com', 'yandex.com', 'mail.com', 'vtr.net', 'entelchile.net', 'terra.cl',
]);

/** The company website suggested by a work email (ana@grupoexpro.com → grupoexpro.com), or '' for personal mailboxes. */
export function websiteFromWorkEmail(email?: string | null) {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] || '';
  if (!domain || PERSONAL_MAIL_DOMAINS.has(domain)) return '';
  return normalizeCompanyWebsite(domain).domain;
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
    proofPoints: asMultilineText(extended.proofPoints || extended.proof_points),
    painPoints: joinLines(lineItems(extended.painPoints)),
    differentiators: joinLines(lineItems(extended.differentiators)),
    referenceClients: joinComma(commaItems(extended.referenceClients)),
    targetRoles: joinComma(commaItems(extended.targetRoles)),
    targetIndustries: joinComma(commaItems(extended.targetIndustries)),
    targetCompanySize: companySize(extended.targetCompanySize),
    targetLocations: joinComma(commaItems(extended.targetLocations)),
  };
}

export function buildProfileUpdate(form: ProfileFormValues, currentProfile?: ProfileLike | null): ProfileUpdate {
  const signatures = asRecord(currentProfile?.signatures);
  const extended = asRecord(signatures.profile_extended);
  const normalizedWebsite = normalizeCompanyWebsite(form.website);
  const added: Record<string, unknown> = {};
  const keep = (key: string, value: unknown, empty: boolean) => {
    if (!empty || key in extended) added[key] = value;
  };
  for (const field of LINE_LIST_FIELDS) {
    const items = lineItems(form[field] ?? '');
    keep(field, items, items.length === 0);
  }
  for (const field of COMMA_LIST_FIELDS) {
    const items = commaItems(form[field] ?? '');
    keep(field, items, items.length === 0);
  }
  const size = companySize(form.targetCompanySize);
  keep('targetCompanySize', size, !size);

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
        proofPoints: multilineItems(form.proofPoints),
        ...added,
      },
    },
  };
}

export function getDefaultSuggestionSelection(
  form: ProfileFormValues,
  suggestion: CompanyProfileSuggestion
): ProfileSuggestionSelection {
  return PROFILE_SUGGESTION_FIELDS.reduce((selection, field) => {
    selection[field] = !String(form[field] ?? '').trim() && Boolean(String(suggestion[field] ?? '').trim());
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
    const value = String(suggestion[field] ?? '').trim();
    if (selection[field] && value) next[field] = value;
  }
  return next;
}

export type ProfileCheck = {
  id: 'identity' | 'company' | 'description' | 'services' | 'valueProposition' | 'painPoints' | 'differentiators'
    | 'proofPoints' | 'targetRoles' | 'targetIndustries';
  label: string;
  /** What the person gains, in one line: the reason to fill it. */
  why: string;
  done: boolean;
  /** Field to focus when the person asks to complete it. */
  field: keyof ProfileFormValues;
};

const filled = (value: string) => value.trim().length > 0;

/** Ten checks, in the order that most changes what the AI writes and searches. Drafting needs services or a value proposition. */
export function profileCompleteness(form: ProfileFormValues) {
  const checks: ProfileCheck[] = [
    { id: 'services', label: 'Productos y servicios', field: 'services', done: filled(form.services),
      why: 'Sin esto ni propuesta de valor, la IA no puede redactar correos.' },
    { id: 'valueProposition', label: 'Propuesta de valor', field: 'valueProposition', done: filled(form.valueProposition),
      why: 'Es el motivo para responderte: qué resultado consigue tu cliente.' },
    { id: 'targetRoles', label: 'Cargos que buscas', field: 'targetRoles', done: filled(form.targetRoles),
      why: '«Buscar prospectos» arma tu búsqueda con estos cargos.' },
    { id: 'targetIndustries', label: 'Industrias de tus clientes', field: 'targetIndustries', done: filled(form.targetIndustries),
      why: 'Acota la búsqueda a empresas donde tu oferta encaja.' },
    { id: 'painPoints', label: 'Problemas que resuelves', field: 'painPoints', done: filled(form.painPoints),
      why: 'La IA conecta lo que investiga de cada empresa con un problema real.' },
    { id: 'differentiators', label: 'Por qué elegirte', field: 'differentiators', done: filled(form.differentiators),
      why: 'Distingue tu correo de los de la competencia.' },
    { id: 'proofPoints', label: 'Pruebas y resultados', field: 'proofPoints', done: filled(form.proofPoints) || filled(form.referenceClients),
      why: 'Un dato o un cliente conocido hace creíble el seguimiento.' },
    { id: 'company', label: 'Empresa y sitio web', field: 'companyName', done: filled(form.companyName) && filled(form.website),
      why: 'La IA sabe a quién representas y puede leer tu sitio.' },
    { id: 'description', label: 'Descripción de la empresa', field: 'description', done: filled(form.description),
      why: 'Contexto para presentarte en una línea.' },
    { id: 'identity', label: 'Tu nombre y cargo', field: 'name', done: filled(form.name) && filled(form.role),
      why: 'Firman tus correos y mensajes.' },
  ];
  const done = checks.filter((check) => check.done).length;
  return {
    checks,
    done,
    total: checks.length,
    percent: Math.round((done / checks.length) * 100),
    // Same bar as the server (hasUsableDraftSellerOfferV2): a real service name or a value proposition sentence.
    canDraft: form.services.trim().length >= 3 || form.valueProposition.trim().length >= 12,
    missing: checks.filter((check) => !check.done),
  };
}
