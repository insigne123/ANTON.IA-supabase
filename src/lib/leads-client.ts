// src/lib/leads-client.ts
import type {
  CompanyFilterSearchRequest,
  CompanyNameSearchRequest,
  CompanyPeopleSearchRequest,
  CompanyPeopleSearchResponse,
  CompanySearchOrganization,
  CompanySearchResponse,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
  Lead,
} from '@/lib/schemas/leads';
import { CompanySearchOrganizationSchema } from '@/lib/schemas/leads';
import { hasUsableLinkedInProfileData } from '@/lib/linkedin-profile-result';
import { linkedinProfilesMatch, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import {readCachedAuthScope} from '@/lib/auth-scope-cache';
import {
  ProfileSearchProblemError, profileProblemFromHttp, profileProblemFromProviderCode, profileUrlProblem,
} from '@/lib/search/profile-search-outcome';

const PATH = '/api/leads/search';
const PROFILE_STATUS_PATH = '/api/leads/profile-status';
const PROFILE_ENRICHMENT_PATH = '/api/opportunities/enrich-apollo';
const ORGANIZATION_ENRICHMENT_PATH = '/api/organizations/enrich-apollo';

export class ApolloOrganizationEnrichmentClientError extends Error {
  constructor(message: string, readonly preserveOperation: boolean) {
    super(message);
  }
}

type SearchPayload = LeadsSearchParams | LinkedInProfileSearchRequest | CompanyNameSearchRequest;
const searchHeaders=()=>{const scope=readCachedAuthScope();return {'Content-Type':'application/json',...(scope?.organizationId?{'x-organization-id':scope.organizationId}:{})};};

function extractSearchErrorMessage(json: any, status: number): string {
  if (status === 401) return 'Tu sesión necesita renovarse. Vuelve a iniciar sesión y repite la búsqueda.';
  if (status === 403) return 'No pudimos confirmar tu acceso a este equipo. Vuelve a entrar; si se repite, consulta a quien administra tu cuenta.';
  if (status === 429 && json?.error === 'ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE') {
    return String(json?.message || 'Esta cuenta no tiene créditos disponibles para búsquedas ni enriquecimiento.');
  }
  if (status === 429 && json?.error === 'DAILY_SEARCH_QUOTA_EXCEEDED') {
    const count = Number(json?.count);
    const limit = Number(json?.limit);
    if (Number.isFinite(count) && Number.isFinite(limit)) {
      return `Alcanzaste el límite diario de búsquedas (${count}/${limit}). Vuelve a intentarlo después del reinicio.`;
    }
    return 'Alcanzaste el límite diario de búsquedas. Vuelve a intentarlo después del reinicio.';
  }

  const raw = String(json?.message || json?.error || `HTTP_${status}`);

  if (json?.error === 'PROFILE_SEARCH_BACKEND_MISMATCH') {
    return 'El backend devolvio multiples resultados para una busqueda de perfil unico.';
  }

  const innerMatch = raw.match(/SERVICE_HTTP_\d+:(\{[\s\S]*\})$/);
  if (innerMatch?.[1]) {
    try {
      const inner = JSON.parse(innerMatch[1]);
      const innerText = String(inner?.details?.error || inner?.message || inner?.error || '');
      if (innerText.toLowerCase().includes('webhook_url') && innerText.toLowerCase().includes('reveal_phone_number')) {
        return 'El proveedor requiere un webhook publico HTTPS para revelar telefono. Desactiva "Revelar telefono" o espera el ajuste del backend.';
      }
      if (innerText) return innerText;
    } catch {
      // ignore and fall back to raw text
    }
  }

  return raw;
}

async function postSearch(body: SearchPayload, signal?: AbortSignal): Promise<LeadSearchResponse> {
  const res = await authenticatedApiFetch(PATH, {
    method: 'POST',
    headers: searchHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // ignore json parse failures and rely on status below
  }

  if (!res.ok) {
    throw new Error(extractSearchErrorMessage(json, res.status));
  }

  if (!json || !Array.isArray(json.leads)) {
    throw new Error('BAD_RESPONSE_SHAPE');
  }

  return json as LeadSearchResponse;
}

export async function searchLeads(body: LeadsSearchParams, signal?: AbortSignal): Promise<LeadSearchResponse> {
  return postSearch(body, signal);
}

export async function searchCompanies(
  body: CompanyFilterSearchRequest,
  signal?: AbortSignal,
): Promise<CompanySearchResponse> {
  const res = await authenticatedApiFetch(PATH, {
    method: 'POST',
    headers: searchHeaders(),
    body: JSON.stringify({ ...body, search_mode: 'companies' }),
    cache: 'no-store',
    signal,
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractSearchErrorMessage(json, res.status));
  }
  return {
    count: Number(json?.count ?? (Array.isArray(json?.organizations) ? json.organizations.length : 0)) || 0,
    organizations: Array.isArray(json?.organizations) ? json.organizations : [],
    search_mode: 'companies',
    page: json?.page,
    per_page: json?.per_page,
    total_entries: json?.total_entries,
    total_pages: json?.total_pages,
    organization_search_credits: json?.organization_search_credits,
  };
}

export async function searchCompanyPeople(
  body: CompanyPeopleSearchRequest,
  signal?: AbortSignal,
): Promise<CompanyPeopleSearchResponse> {
  const result = await postSearch({ ...body, search_mode: 'company_people' } as any, signal);
  const raw = result as any;
  return {
    ...result,
    organization_id: String(raw.organization_id || (body as any).organization_id || (body as any).organizationId || ''),
    page: raw.page,
    per_page: raw.per_page,
    total_entries: raw.total_entries,
    total_pages: raw.total_pages,
  };
}

function toProfileLead(enriched: any, linkedinUrl: string): Lead {
  return {
    id: String(enriched.id || `profile-search:${linkedinUrl}`),
    name: enriched.fullName,
    first_name: enriched.firstName,
    last_name: enriched.lastName,
    email: enriched.email,
    email_status: enriched.emailStatus,
    linkedin_url: enriched.linkedinUrl || linkedinUrl,
    title: enriched.title,
    headline: enriched.headline,
    org_name: enriched.companyName,
    organization_name: enriched.companyName,
    organization_domain: enriched.companyDomain,
    industry: enriched.industry,
    organization_industry: enriched.industry,
    city: enriched.city,
    state: enriched.state,
    country: enriched.country,
    primary_phone: enriched.primaryPhone,
    phone_numbers: enriched.phoneNumbers,
    seniority: enriched.seniority,
    departments: enriched.departments,
    photo_url: enriched.photoUrl,
    enrichment_status: enriched.enrichmentStatus,
    source_provider: 'apollo',
    source_provider_id: enriched.sourceProviderId,
    apollo_id: enriched.sourceProviderId,
  };
}

export async function searchLinkedInProfileLead(
  body: LinkedInProfileSearchRequest,
  signal?: AbortSignal,
): Promise<LeadSearchResponse> {
  const linkedinUrl = normalizeLinkedinProfileUrl(
    body.linkedin_url || body.linkedin_profile_url || body.linkedinUrl,
  );
  if (!linkedinUrl) throw new ProfileSearchProblemError(profileUrlProblem(body.linkedin_url || body.linkedin_profile_url || body.linkedinUrl) || 'invalid_url', 'La URL de LinkedIn no es válida.');
  const revealEmail = body.reveal_email ?? body.revealEmail ?? false;
  const revealPhone = body.reveal_phone ?? body.revealPhone ?? false;
  const requestProfile = (reveal: { revealEmail: boolean; revealPhone: boolean }) => enrichLinkedInProfileLead({
    lead: {
      id: `profile-search:${linkedinUrl}`,
      linkedin_url: linkedinUrl,
    },
    revealEmail: reveal.revealEmail,
    revealPhone: reveal.revealPhone,
    operationId: `profile-match:${crypto.randomUUID()}`,
    linkedinUrl,
  }, signal);
  const result = await requestProfile({ revealEmail, revealPhone });
  let enriched = result.enriched?.[0] as any;
  if (enriched?.errorCode === 'APOLLO_PERSON_IDENTITY_MISMATCH') {
    throw new ProfileSearchProblemError('identity_mismatch', 'No pudimos confirmar que el perfil devuelto corresponda a la URL solicitada. No mostraremos datos de otra persona.');
  }
  if (enriched?.linkedinUrl && !linkedinProfilesMatch(enriched.linkedinUrl, linkedinUrl)) {
    throw new ProfileSearchProblemError('identity_mismatch', 'El proveedor devolvió un perfil distinto al solicitado. No mostraremos datos de otra persona.');
  }
  if (!enriched) throw new ProfileSearchProblemError('not_found');
  let lead: Lead = toProfileLead(enriched, linkedinUrl);
  // A profile is only pending while the provider still owns the outcome:
  // queued phone enrichment or a pending enrichment status. The top-level
  // `queued` flag alone is not enough, because the API also sets it on
  // terminal phone failures when phone reveal was requested.
  let pendingProfile = result.phone_enrichment?.status === 'queued'
    || String(enriched.enrichmentStatus || '').trim().toLowerCase().startsWith('pending')
    || result.providerState === 'unknown' || result.providerState === 'processing';
  const providerProblem = profileProblemFromProviderCode(enriched.errorCode);
  if (providerProblem === 'credits_exhausted') {
    throw new ProfileSearchProblemError('credits_exhausted', 'La cuenta de Apollo no tiene créditos disponibles. Recarga créditos o espera al próximo ciclo de facturación.');
  }
  // The provider did not answer: asking again without contact data would only fail again and end in a false «no data».
  if (providerProblem === 'provider_unavailable' && !hasUsableLinkedInProfileData(lead)) {
    throw new ProfileSearchProblemError('provider_unavailable');
  }
  if (!hasUsableLinkedInProfileData(lead) && !pendingProfile) {
    if (enriched.enrichmentStatus === 'not_found' || providerProblem === 'not_found') {
      throw new ProfileSearchProblemError('not_found');
    }
    if (revealEmail || revealPhone) {
      // Reintento automático solo con datos profesionales (matchOnly en el
      // servidor): si Apollo tiene la identidad pero no el contacto, al menos
      // se muestra el perfil en vez de un error genérico.
      try {
        const retry = await requestProfile({ revealEmail: false, revealPhone: false });
        const fallback = retry.enriched?.[0] as any;
        if (fallback && !fallback.errorCode
          && (!fallback.linkedinUrl || linkedinProfilesMatch(fallback.linkedinUrl, linkedinUrl))) {
          const fallbackLead = toProfileLead(fallback, linkedinUrl);
          if (hasUsableLinkedInProfileData(fallbackLead)) {
            return {
              count: 1,
              leads_count: 1,
              leads: [fallbackLead],
              search_mode: 'linkedin_profile',
              enrichment_requested: false,
              profile_tracking_ids: [fallbackLead.id],
              profile_pending: false,
              phone_enrichment: retry.phone_enrichment,
              provider_warnings: ['APOLLO_PROFESSIONAL_ONLY'],
            } as LeadSearchResponse;
          }
        }
      } catch {
        // El reintento no debe ocultar el diagnóstico original.
      }
    }
    throw new ProfileSearchProblemError('no_usable_data', 'APOLLO_PROFILE_NO_USABLE_DATA');
  }
  return {
    count: hasUsableLinkedInProfileData(lead) ? 1 : 0,
    leads_count: hasUsableLinkedInProfileData(lead) ? 1 : 0,
    leads: hasUsableLinkedInProfileData(lead) ? [lead] : [],
    search_mode: 'linkedin_profile',
    enrichment_requested: revealEmail || revealPhone,
    profile_tracking_ids: [lead.id],
    profile_pending: pendingProfile,
    phone_enrichment: result.phone_enrichment,
  } as LeadSearchResponse;
}

export async function enrichLinkedInProfileLead(input: {
  lead: Lead;
  revealEmail: boolean;
  revealPhone: boolean;
  operationId: string;
  linkedinUrl: string;
}, signal?: AbortSignal): Promise<{
  queued: boolean;
  operationId: string;
  operationStatus?: string;
  providerState?: string;
  enriched?: Array<{ id: string }>;
  phone_enrichment?: LeadSearchResponse['phone_enrichment'];
}> {
  const res = await authenticatedApiFetch(PROFILE_ENRICHMENT_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.operationId,
    },
    body: JSON.stringify({
      operationId: input.operationId,
      provider: 'apollo',
      tableName: 'people_search_leads',
      revealEmail: input.revealEmail,
      revealPhone: input.revealPhone,
      leads: [{
        fullName: input.lead.name,
        linkedinUrl: input.linkedinUrl,
        companyName: input.lead.org_name || input.lead.organization_name,
        companyDomain: input.lead.organization?.website_url
          || input.lead.organization_website
          || input.lead.organization_domain,
        title: input.lead.title,
        clientRef: input.lead.id,
        sourceProviderId: input.lead.source_provider_id,
      }],
    }),
    cache: 'no-store',
    signal,
  });

  const json = await res.json().catch(() => null);
  const providerOutcomeUnknown = json?.error === 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN';
  const recoverablePending = (providerOutcomeUnknown || [
    'ENRICHMENT_OPERATION_PROCESSING',
    'APOLLO_ENRICHMENT_TARGET_BUSY',
  ].includes(String(json?.error || '')))
    && Array.isArray(json?.enriched)
    && Boolean(json.enriched[0]?.id);
  if (!res.ok && !recoverablePending) {
    const problem = profileProblemFromHttp(res.status, json?.code || json?.error);
    if (res.status === 429) {
      throw new ProfileSearchProblemError(problem, 'Alcanzaste el límite diario de enriquecimientos. El perfil seguirá disponible sin datos de contacto.');
    }
    throw new ProfileSearchProblemError(problem, 'No pudimos iniciar la búsqueda de datos de contacto. Inténtalo nuevamente.');
  }
  if ((!json?.queued && json?.operationStatus !== 'completed' && !recoverablePending)
    || !Array.isArray(json?.enriched) || !json.enriched[0]?.id) {
    throw new ProfileSearchProblemError('provider_unavailable', 'No pudimos confirmar la búsqueda de datos de contacto. Inténtalo nuevamente.');
  }

  return {
    ...json,
    queued: Boolean(json.queued || json.operationStatus === 'completed' || recoverablePending),
  };
}

export async function searchCompanyNameLeads(
  body: CompanyNameSearchRequest,
  signal?: AbortSignal,
): Promise<LeadSearchResponse> {
  return postSearch(body, signal);
}

export async function enrichApolloOrganization(input: {
  domain: string;
  operationId: string;
}, signal?: AbortSignal): Promise<CompanySearchOrganization | null> {
  const response = await authenticatedApiFetch(ORGANIZATION_ENRICHMENT_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.operationId,
    },
    body: JSON.stringify({ domain: input.domain, operationId: input.operationId }),
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const unknown = payload?.error === 'APOLLO_ORGANIZATION_OUTCOME_UNKNOWN';
    throw new ApolloOrganizationEnrichmentClientError(
      unknown
        ? 'No pudimos confirmar el resultado. Puedes consultar la misma operación nuevamente sin repetir el cargo.'
        : response.status === 429
          ? 'Alcanzaste el límite diario de enriquecimientos.'
          : 'No pudimos enriquecer esta empresa.',
      unknown,
    );
  }
  if (payload?.status === 'no_data') return null;
  return CompanySearchOrganizationSchema.parse(payload?.organization);
}

export async function getLinkedInProfileStatuses(
  ids: string[],
  signal?: AbortSignal,
): Promise<Array<{
  id: string;
  name?: string | null;
  title?: string | null;
  organization_name?: string | null;
  org_name?: string | null;
  industry?: string | null;
  organization_industry?: string | null;
  photo_url?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: string | null;
  primary_phone?: string | null;
  phone_numbers?: any[] | null;
  enrichment_status?: string | null;
  updated_at?: string | null;
}>> {
  const normalizedIds = ids.map((value) => String(value || '').trim()).filter(Boolean);
  if (normalizedIds.length === 0) return [];

  const res = await authenticatedApiFetch(PROFILE_STATUS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: normalizedIds }),
    cache: 'no-store',
    signal,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(json?.message || json?.error || `HTTP_${res.status}`));
  }

  return Array.isArray(json?.items) ? json.items : [];
}

export async function getLinkedInProfileLead(
  recordId: string,
  signal?: AbortSignal,
): Promise<Lead | null> {
  const normalizedId = String(recordId || '').trim();
  if (!normalizedId) return null;

  const res = await fetch(`${PATH}?record_id=${encodeURIComponent(normalizedId)}`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(json?.message || json?.error || `HTTP_${res.status}`));
  }

  if (json?.lead) return json.lead;
  if (json && typeof json === 'object' && String((json as any)?.id || '').trim()) {
    return json as any;
  }
  return null;
}

export type {
  CompanyFilterSearchRequest,
  CompanyNameSearchRequest,
  CompanyPeopleSearchRequest,
  CompanyPeopleSearchResponse,
  CompanySearchOrganization,
  CompanySearchResponse,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
};
