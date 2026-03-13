// src/lib/leads-client.ts
import type {
  LeadsResponse,
  LeadsSearchParams,
  LinkedInProfileSearchRequest,
} from '@/lib/schemas/leads';

const PATH = '/api/leads/search';

type SearchPayload = LeadsSearchParams | LinkedInProfileSearchRequest;

async function postSearch(body: SearchPayload, signal?: AbortSignal): Promise<LeadsResponse> {
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
    throw new Error(json?.message || json?.error || `HTTP_${res.status}`);
  }

  if (!json || !Array.isArray(json.leads)) {
    throw new Error('BAD_RESPONSE_SHAPE');
  }

  return json as LeadsResponse;
}

export async function searchLeads(body: LeadsSearchParams, signal?: AbortSignal): Promise<LeadsResponse> {
  return postSearch(body, signal);
}

export async function searchLinkedInProfileLead(
  body: LinkedInProfileSearchRequest,
  signal?: AbortSignal,
): Promise<LeadsResponse> {
  return postSearch(body, signal);
}

export type { LeadsSearchParams, LinkedInProfileSearchRequest };
