import { tenderFromLicitacion, type Tender } from '@/lib/commercial-opportunities/tenders';

/**
 * Mercado Público API v1 (licitaciones): the open tenders of the day in one request, and the detail of the ones whose name
 * may fit (buyer, amount, region and items). Free with MERCADO_PUBLICO_TICKET, 10,000 requests a day. This API takes the
 * ticket in the query string: the URL is never logged nor put in a message, and neither is the API's own message, which
 * may repeat the ticket.
 */
export const MERCADO_PUBLICO_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';

type Dependencies = { fetch: typeof fetch; ticket: string | undefined };

/**
 * HTTP 429 with code 10500 («existen peticiones simultáneas»): another request with the same ticket is still running.
 * It is not the daily quota, and asking again a few seconds later works.
 */
export class MercadoPublicoBusyError extends Error {
  readonly busy = true;
  constructor() { super('Mercado Público siguió ocupado con otra consulta del mismo ticket (código 10500).'); }
}
export const isMercadoPublicoBusy = (error: unknown) => error instanceof MercadoPublicoBusyError;

async function call(params: Record<string, string>, dependencies: Dependencies) {
  if (!dependencies.ticket) throw new Error('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).');
  const response = await dependencies.fetch(`${MERCADO_PUBLICO_BASE}?${new URLSearchParams({ ...params, ticket: dependencies.ticket })}`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => null) as { Listado?: unknown[]; Codigo?: number | string; Mensaje?: string } | null;
  const code = Number(body?.Codigo);
  if (code === 10500) throw new MercadoPublicoBusyError();
  if (response.status === 429) {
    if (/cuota|l[ií]mite|diari|exced/i.test(String(body?.Mensaje || ''))) throw new Error('Mercado Público: se acabó la cuota diaria del ticket.');
    throw new MercadoPublicoBusyError();
  }
  // An unknown ticket comes back as HTTP 203 with code 203 «Ticket no válido».
  if (response.status === 401 || response.status === 403 || code === 203) throw new Error('Mercado Público rechazó el ticket.');
  if (!response.ok) throw new Error(`Mercado Público respondió ${response.status}.`);
  // The API answers 200 with a code and a message when the query is wrong.
  if (!Array.isArray(body?.Listado)) throw new Error(body?.Codigo ? 'Mercado Público rechazó la consulta (revisa el ticket).' : 'Mercado Público respondió sin listado.');
  return body.Listado.flatMap(item => {
    const tender = item && typeof item === 'object' ? tenderFromLicitacion(item as Record<string, unknown>) : null;
    return tender ? [tender] : [];
  });
}

/** The tenders open today, with name and deadline only. */
export function listOpenLicitaciones(dependencies: Dependencies = { fetch: globalThis.fetch, ticket: process.env.MERCADO_PUBLICO_TICKET }) {
  return call({ estado: 'activas' }, dependencies);
}

/** The full tender: buyer, amount, region and items. */
export async function getLicitacion(code: string, dependencies: Dependencies = { fetch: globalThis.fetch, ticket: process.env.MERCADO_PUBLICO_TICKET }): Promise<Tender | null> {
  return (await call({ codigo: code.slice(0, 60) }, dependencies))[0] ?? null;
}
