// src/lib/leads-client.ts
import type {
  CompanyNameSearchRequest,
  CompanySearchOrganization,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
} from '@/lib/schemas/leads';

const PATH = '/api/leads/search';
const PROFILE_STATUS_PATH = '/api/leads/profile-status';

type SearchPayload = LeadsSearchParams | LinkedInProfileSearchRequest | CompanyNameSearchRequest;

function extractSearchErrorMessage(json: any, status: number): string {
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
        return 'Apollo requiere webhook_url para revelar telefono. Desactiva "Revelar telefono" o espera el ajuste del backend.';
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

export type {
  CompanyNameSearchRequest,
  CompanySearchOrganization,
  LeadSearchResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
};
