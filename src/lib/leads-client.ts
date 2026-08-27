// src/lib/leads-client.ts
import type {
  CompanyNameSearchRequest,
  CompanySearchOrganization,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
  Lead,
} from '@/lib/schemas/leads';

const PATH = '/api/leads/search';
const PROFILE_STATUS_PATH = '/api/leads/profile-status';
const PROFILE_ENRICHMENT_PATH = '/api/opportunities/enrich-apollo';

type SearchPayload = LeadsSearchParams | LinkedInProfileSearchRequest | CompanyNameSearchRequest;

function extractSearchErrorMessage(json: any, status: number): string {
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
  return postSearch(body, signal);
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
      provider: 'fullenrich',
      tableName: 'people_search_leads',
      revealEmail: input.revealEmail,
      revealPhone: input.revealPhone,
      leads: [{
        fullName: input.lead.name,
        linkedinUrl: input.linkedinUrl,
        companyName: input.lead.org_name || input.lead.organization_name,
        companyDomain: input.lead.organization?.website_url,
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
  if ((!json?.queued && !providerOutcomeUnknown) || !Array.isArray(json?.enriched) || !json.enriched[0]?.id) {
    throw new Error('No pudimos confirmar la búsqueda de datos de contacto. Inténtalo nuevamente.');
  }

  return { ...json, queued: true };
}

export async function searchCompanyNameLeads(
  body: CompanyNameSearchRequest,
  signal?: AbortSignal,
): Promise<LeadSearchResponse> {
  return postSearch(body, signal);
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
