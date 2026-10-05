import type { LeadSearchResponse } from '@/lib/schemas/leads';

/**
 * The browser side of the Leads Finder test (Plan 11, PR 6c): whether this person has it, a search with the filters of
 * «Buscar prospectos», and «Enriquecer» for the people it found. The server answers in the same shapes as Apollo, so the
 * screens reuse what they already do; its messages are already written for people and are shown as they come.
 */
export class LeadsFinderClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'LeadsFinderClientError';
  }
}

export type LeadsFinderSearchParams = {
  titles: string[];
  seniorities: string[];
  person_locations: string[];
  company_location: string[];
  industry_keywords: string[];
  company_keywords: string[];
  employee_ranges: string[];
  max_results: number;
};

export type LeadsFinderSearchResponse = LeadSearchResponse & { provider?: string; not_applied?: string[]; already_saved?: number };

const MESSAGES: Record<string, string> = {
  DAILY_SEARCH_QUOTA_EXCEEDED: 'Alcanzaste el límite diario de búsquedas. Vuelve a intentarlo después del reinicio.',
  DAILY_ENRICH_QUOTA_EXCEEDED: 'Llegaste al límite de enriquecimientos de hoy. Vuelve a intentarlo después del reinicio.',
  NOT_FOUND: 'Leads Finder no está disponible para tu cuenta.',
  SAVED_LEADS_LOOKUP_FAILED: 'No pudimos revisar a quiénes ya guardaste. Prueba de nuevo en unos segundos.',
  ENRICHMENT_REQUEST_FAILED: 'No pudimos terminar el enriquecimiento. Prueba de nuevo en unos segundos.',
};

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, any>;
  } catch {
    return {} as Record<string, any>;
  }
}

function failure(json: Record<string, any>, status: number) {
  const code = String(json?.error || `HTTP_${status}`);
  const message = typeof json?.message === 'string' && json.message.trim() ? json.message : MESSAGES[code]
    || 'Leads Finder no respondió. Prueba de nuevo en unos minutos; si se repite, usa Apollo.';
  return new LeadsFinderClientError(message, code, status);
}

export async function getLeadsFinderAvailability(signal?: AbortSignal) {
  try {
    const response = await fetch('/api/leads/leads-finder/status', { cache: 'no-store', signal });
    if (!response.ok) return false;
    return (await readJson(response)).available === true;
  } catch {
    return false;
  }
}

export async function searchWithLeadsFinder(params: LeadsFinderSearchParams, signal?: AbortSignal): Promise<LeadsFinderSearchResponse> {
  const response = await fetch('/api/leads/leads-finder/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store', signal,
  });
  const json = await readJson(response);
  if (!response.ok) throw failure(json, response.status);
  if (!Array.isArray(json.leads)) throw new LeadsFinderClientError('Leads Finder respondió algo inesperado. Prueba de nuevo.', 'BAD_RESPONSE_SHAPE', 502);
  return json as LeadsFinderSearchResponse;
}

export type LeadsFinderEnrichResult = {
  enriched: Array<Record<string, any>>;
  expired: Array<{ sourceProviderId: string; clientRef?: string }>;
  usage?: { consumed?: number; count?: number; limit?: number };
};

/** Reveals people found with Leads Finder; `clientRef` is the saved contact, so the answer is matched back to it. */
export async function enrichWithLeadsFinder(input: {
  leads: Array<{ sourceProviderId: string; clientRef: string }>;
  revealEmail: boolean;
  revealPhone: boolean;
  operationId: string;
}): Promise<LeadsFinderEnrichResult> {
  const response = await fetch('/api/leads/leads-finder/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.operationId },
    body: JSON.stringify({ leads: input.leads, revealEmail: input.revealEmail, revealPhone: input.revealPhone }),
    cache: 'no-store',
  });
  const json = await readJson(response);
  // Everything expired: nothing was charged, and every person is reported so the screen can say it.
  if (response.status === 410) {
    return { enriched: [], expired: Array.isArray(json.expired) ? json.expired : input.leads.map(lead => ({ ...lead })), usage: undefined };
  }
  if (!response.ok) throw failure(json, response.status);
  return {
    enriched: Array.isArray(json.enriched) ? json.enriched : [],
    expired: Array.isArray(json.expired) ? json.expired : [],
    usage: json.usage,
  };
}
