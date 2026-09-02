// src/lib/leads-client.ts
import type {
  CompanyNameSearchRequest,
  CompanySearchOrganization,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
  Lead,
} from '@/lib/schemas/leads';
import { CompanySearchOrganizationSchema } from '@/lib/schemas/leads';
import { hasUsableLinkedInProfileData } from '@/lib/linkedin-profile-result';

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

function extractSearchErrorMessage(json: any, status: number): string {
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
  const res = await fetch(PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function searchLinkedInProfileLead(
  body: LinkedInProfileSearchRequest,
  signal?: AbortSignal,
): Promise<LeadSearchResponse> {
  const linkedinUrl = String(body.linkedin_url || body.linkedin_profile_url || body.linkedinUrl || '').trim();
  const revealEmail = body.reveal_email ?? body.revealEmail ?? false;
  const revealPhone = body.reveal_phone ?? body.revealPhone ?? false;
  const operationId = `profile-match:${crypto.randomUUID()}`;
  const result = await enrichLinkedInProfileLead({
    lead: {
      id: `profile-search:${linkedinUrl}`,
      linkedin_url: linkedinUrl,
    },
    revealEmail,
    revealPhone,
    operationId,
    linkedinUrl,
  }, signal);
  const enriched = result.enriched?.[0] as any;
  if (!enriched) {
    return { count: 0, leads_count: 0, leads: [], search_mode: 'linkedin_profile' } as LeadSearchResponse;
  }
  const lead: Lead = {
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
  if (enriched.errorCode === 'APOLLO_CREDITS_EXHAUSTED') {
    throw new Error('La cuenta de Apollo no tiene créditos disponibles. Recarga créditos o espera al próximo ciclo de facturación.');
  }
  if (!hasUsableLinkedInProfileData(lead)) {
    if (enriched.enrichmentStatus === 'not_found') {
      return { count: 0, leads_count: 0, leads: [], search_mode: 'linkedin_profile' } as LeadSearchResponse;
    }
    throw new Error('No pudimos consultar este perfil en Apollo. Inténtalo nuevamente.');
  }
  return {
    count: 1,
    leads_count: 1,
    leads: [lead],
    search_mode: 'linkedin_profile',
    enrichment_requested: revealEmail || revealPhone,
    profile_tracking_ids: [lead.id],
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
  enriched?: Array<{ id: string }>;
}> {
  const res = await fetch(PROFILE_ENRICHMENT_PATH, {
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
  const providerOutcomeUnknown = json?.error === 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN'
    && Array.isArray(json?.enriched)
    && Boolean(json.enriched[0]?.id);
  if (!res.ok && !providerOutcomeUnknown) {
    if (res.status === 429) {
      throw new Error('Alcanzaste el límite diario de enriquecimientos. El perfil seguirá disponible sin datos de contacto.');
    }
    throw new Error('No pudimos iniciar la búsqueda de datos de contacto. Inténtalo nuevamente.');
  }
  if ((!json?.queued && json?.operationStatus !== 'completed' && !providerOutcomeUnknown)
    || !Array.isArray(json?.enriched) || !json.enriched[0]?.id) {
    throw new Error('No pudimos confirmar la búsqueda de datos de contacto. Inténtalo nuevamente.');
  }

  return { ...json, queued: Boolean(json.queued || json.operationStatus === 'completed') };
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
  const response = await fetch(ORGANIZATION_ENRICHMENT_PATH, {
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

  const res = await fetch(PROFILE_STATUS_PATH, {
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
  CompanyNameSearchRequest,
  CompanySearchOrganization,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
};
