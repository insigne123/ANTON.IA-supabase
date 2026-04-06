const DEFAULT_PDL_BASE_URL = 'https://api.peopledatalabs.com/v5';

export type PdlPersonRecord = {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_title_role?: string;
  linkedin_url?: string;
  location_name?: string;
  location_locality?: string;
  location_region?: string;
  location_country?: string;
  work_email?: string;
  recommended_personal_email?: string;
  mobile_phone?: string;
  work_phone?: string;
  phone_numbers?: Array<{
    number?: string;
    type?: string;
    status?: string;
  }>;
  summary?: string;
  image_url?: string;
  likelihood?: number;
  job_company_name?: string;
  job_company_website?: string;
  job_company_industry?: string;
  job_company_size?: number;
};

export type PdlCompanyRecord = {
  id?: string;
  name?: string;
  website?: string;
  linkedin_url?: string;
  industry?: string;
};

type SearchResponse<T> = {
  data: T[];
  total: number;
  scrollToken?: string;
  raw: any;
};

function getPdlApiKey() {
  return String(process.env.PDL_API_KEY || '').trim();
}

function getBaseUrl() {
  const custom = String(process.env.PDL_BASE_URL || '').trim();
  return (custom || DEFAULT_PDL_BASE_URL).replace(/\/+$/, '');
}

function getDefaultTimeoutMs() {
  const value = Number(process.env.PDL_TIMEOUT_MS || 30000);
  if (!Number.isFinite(value) || value <= 0) return 30000;
  return Math.min(value, 120000);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || getDefaultTimeoutMs());

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function pdlJsonRequest(url: string, body: Record<string, unknown>, timeoutMs?: number) {
  const apiKey = getPdlApiKey();
  if (!apiKey) throw new Error('PDL_API_KEY missing');

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    timeoutMs,
  );

  const json = await parseJsonSafe(response);
  if (response.status === 404) {
    return {
      status: 404,
      data: [],
      total: 0,
      raw: json,
    };
  }

  if (!response.ok) {
    const message =
      (json && (json.error?.message || json.error || json.message)) ||
      (await response.text().catch(() => '')) ||
      `PDL_HTTP_${response.status}`;
    throw new Error(`PDL_HTTP_${response.status}:${String(message).slice(0, 400)}`);
  }

  return json;
}

function normalizeSearchData<T>(json: any): SearchResponse<T> {
  const data = Array.isArray(json?.data)
    ? json.data
    : (Array.isArray(json) ? json : []);
  const total = Number(json?.total ?? json?.count ?? data.length) || 0;
  const scrollToken = typeof json?.scroll_token === 'string' ? json.scroll_token : undefined;

  return {
    data,
    total,
    scrollToken,
    raw: json,
  };
}

export async function searchPeopleWithPDL(params: {
  sql: string;
  size?: number;
  scrollToken?: string;
  dataInclude?: string[];
  timeoutMs?: number;
}): Promise<SearchResponse<PdlPersonRecord>> {
  const size = clamp(Number(params.size || 100), 1, 100);
  const body: Record<string, unknown> = {
    sql: params.sql,
    size,
  };

  if (params.scrollToken) body.scroll_token = params.scrollToken;
  if (params.dataInclude && params.dataInclude.length > 0) body.data_include = params.dataInclude.join(',');

  const url = `${getBaseUrl()}/person/search`;
  const json = await pdlJsonRequest(url, body, params.timeoutMs);
  return normalizeSearchData<PdlPersonRecord>(json);
}

export async function searchCompaniesWithPDL(params: {
  sql: string;
  size?: number;
  scrollToken?: string;
  dataInclude?: string[];
  timeoutMs?: number;
}): Promise<SearchResponse<PdlCompanyRecord>> {
  const size = clamp(Number(params.size || 25), 1, 100);
  const body: Record<string, unknown> = {
    sql: params.sql,
    size,
  };

  if (params.scrollToken) body.scroll_token = params.scrollToken;
  if (params.dataInclude && params.dataInclude.length > 0) body.data_include = params.dataInclude.join(',');

  const url = `${getBaseUrl()}/company/search`;
  const json = await pdlJsonRequest(url, body, params.timeoutMs);
  return normalizeSearchData<PdlCompanyRecord>(json);
}

export async function enrichPersonWithPDL(params: {
  linkedinUrl?: string;
  email?: string;
  fullName?: string;
  companyName?: string;
  companyDomain?: string;
  location?: string;
  minLikelihood?: number;
  dataInclude?: string[];
  timeoutMs?: number;
}): Promise<{ matched: boolean; status: number; person: PdlPersonRecord | null; raw: any }> {
  const apiKey = getPdlApiKey();
  if (!apiKey) throw new Error('PDL_API_KEY missing');

  const body: Record<string, unknown> = {};

  const linkedinUrl = String(params.linkedinUrl || '').trim();
  const email = String(params.email || '').trim();
  const fullName = String(params.fullName || '').trim();
  const companyName = String(params.companyName || '').trim();
  const companyDomain = String(params.companyDomain || '').trim();
  const location = String(params.location || '').trim();

  if (linkedinUrl) body.profile = linkedinUrl;
  if (email) body.email = email;
  if (fullName) body.name = fullName;
  if (companyDomain) body.company = companyDomain;
  else if (companyName) body.company = companyName;
  if (companyName) body.company_name = companyName;
  if (companyDomain) body.company_domain = companyDomain;
  if (location) body.location = location;

  const minLikelihood = Number(params.minLikelihood ?? process.env.PDL_ENRICH_MIN_LIKELIHOOD ?? 2);
  if (Number.isFinite(minLikelihood)) body.min_likelihood = minLikelihood;

  if (params.dataInclude && params.dataInclude.length > 0) {
    body.data_include = params.dataInclude.join(',');
  }

  if (Object.keys(body).length === 0) {
    return { matched: false, status: 400, person: null, raw: { error: 'missing_enrich_identifiers' } };
  }

  const url = `${getBaseUrl()}/person/enrich`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    params.timeoutMs,
  );

  const json = await parseJsonSafe(response);
  if (response.status === 404) {
    return { matched: false, status: 404, person: null, raw: json };
  }

  if (!response.ok) {
    const message =
      (json && (json.error?.message || json.error || json.message)) ||
      (await response.text().catch(() => '')) ||
      `PDL_HTTP_${response.status}`;
    throw new Error(`PDL_HTTP_${response.status}:${String(message).slice(0, 400)}`);
  }

  const person = (json?.data || json) as PdlPersonRecord | null;
  return {
    matched: !!person,
    status: response.status,
    person: person || null,
    raw: json,
  };
}

export function cleanDomain(urlLike?: string | null): string | null {
  const raw = String(urlLike || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.+$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

export function pickPdlEmail(person: PdlPersonRecord): string | undefined {
  const work = String(person.work_email || '').trim();
  const personal = String(person.recommended_personal_email || '').trim();
  if (work) return work;
  if (personal) return personal;
  return undefined;
}

export function pickPdlPhones(person: PdlPersonRecord): { primaryPhone: string | null; phoneNumbers: any[] } {
  const out: any[] = [];

  const pushPhone = (raw: string | undefined, type: string) => {
    const normalized = String(raw || '').trim();
    if (!normalized) return;
    out.push({
      raw_number: normalized,
      sanitized_number: normalized,
      type,
      position: 'current',
      status: 'unknown',
    });
  };

  pushPhone(person.mobile_phone, 'mobile');
  pushPhone(person.work_phone, 'work');

  if (Array.isArray(person.phone_numbers)) {
    for (const p of person.phone_numbers) {
      const normalized = String(p?.number || '').trim();
      if (!normalized) continue;
      out.push({
        raw_number: normalized,
        sanitized_number: normalized,
        type: String(p?.type || 'other'),
        position: 'current',
        status: String(p?.status || 'unknown'),
      });
    }
  }

  const unique = new Map<string, any>();
  for (const item of out) {
    const key = String(item.sanitized_number || '').trim();
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, item);
  }

  const phoneNumbers = Array.from(unique.values());
  const primaryPhone = phoneNumbers.length > 0 ? String(phoneNumbers[0].sanitized_number) : null;
  return { primaryPhone, phoneNumbers };
}
