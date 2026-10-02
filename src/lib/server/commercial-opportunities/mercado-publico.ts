import { tenderFromLicitacion, type Tender } from '@/lib/commercial-opportunities/tenders';

/**
 * Mercado Público API v1 (licitaciones): the open tenders of the day in one request, and the detail of the ones whose name
 * may fit (buyer, amount, region and items). Free with MERCADO_PUBLICO_TICKET, 10,000 requests a day. This API takes the
 * ticket in the query string: the URL is never logged nor put in a message.
 */
export const MERCADO_PUBLICO_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';

type Dependencies = { fetch: typeof fetch; ticket: string | undefined };

async function call(params: Record<string, string>, dependencies: Dependencies) {
  if (!dependencies.ticket) throw new Error('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).');
  const response = await dependencies.fetch(`${MERCADO_PUBLICO_BASE}?${new URLSearchParams({ ...params, ticket: dependencies.ticket })}`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Mercado Público rechazó el ticket.');
  if (response.status === 429) throw new Error('Mercado Público: se acabó la cuota diaria del ticket.');
  if (!response.ok) throw new Error(`Mercado Público respondió ${response.status}.`);
  const body = await response.json() as { Listado?: unknown[]; Codigo?: number; Mensaje?: string };
  // The API answers 200 with a code and a message when the ticket is wrong.
  if (!Array.isArray(body.Listado)) throw new Error(body.Codigo ? 'Mercado Público rechazó la consulta (revisa el ticket).' : 'Mercado Público respondió sin listado.');
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
export async function getLicitacion(code: string, dependencies: Dependencies = { fetch: globalThis.fetch, ticket: process.env.MERCADO_PUBLICO_TICKET }) {
  return (await call({ codigo: code.slice(0, 60) }, dependencies))[0] ?? null;
}
