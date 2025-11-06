// src/lib/leads-client.ts
import type { LeadsResponse, LeadsSearchParams } from '@/lib/schemas/leads';

const PATH = '/api/leads/search';

export async function searchLeads(
  body: LeadsSearchParams,
  signal?: AbortSignal
): Promise<LeadsResponse> {
  const res = await fetch(PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(json?.error || `HTTP_${res.status}`);
  }
  // Debe ser { count, leads }
  if (!json || !Array.isArray(json.leads)) {
    throw new Error('BAD_RESPONSE_SHAPE');
  }
  return json as LeadsResponse;
}

export type { LeadsSearchParams };
