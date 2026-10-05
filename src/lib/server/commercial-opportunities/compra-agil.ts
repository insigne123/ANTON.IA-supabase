import { tenderFromCompraAgil, type Tender } from '@/lib/commercial-opportunities/tenders';
import { sleep, withRetries, type Wait } from './retry';

/**
 * Compra Ágil API v2 (ChileCompra, beta since May 2026): open quotes found by keyword. Free with the Mercado Público
 * ticket (MERCADO_PUBLICO_TICKET), which travels only in the `ticket` header and never in a message. Each ticket has a
 * daily quota. Guide: «API Compra Ágil v2», version 3.0, May 2026.
 *
 * Measured against the API on 5 Oct 2026: 50 per page goes past the 29 s limit of its gateway (504 «Endpoint request timed
 * out») while 20 answers in about 15 s (10 is the minimum); a 500 «Servicio no disponible» or a 504 now and then works
 * again a few seconds later.
 */
export const COMPRA_AGIL_BASE = 'https://api2.mercadopublico.cl';
const PAGE_SIZE = 20;
const RETRY_WAITS = [2_000, 5_000];

type Dependencies = { fetch: typeof fetch; ticket: string | undefined; wait?: Wait; canWait?: (ms: number) => boolean };

/** A failed request. `retryable` for the gateway timeouts, the 5xx and the 429, which work again a few seconds later. */
export class CompraAgilError extends Error {
  requests = 0;
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

const CONNECTORS = new Set(['a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'sin', 'sobre', 'u', 'un', 'una', 'y']);
/**
 * What to ask Compra Ágil for one keyword of the profile. Its search matches any of the words («servicios transitorios»
 * brought 538 quotes, all of them for «servicios», and «transitorios» alone none) and fails with 500 on phrases with «de»
 * («selección de personal», «guardia de seguridad»). So it is asked for the longest word that is not a connector, which
 * every quote with the whole phrase also has, and matchTender keeps only the quotes that do say the phrase.
 */
export function compraAgilQuery(keyword: string) {
  const words = keyword.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const meaningful = words.filter(word => !CONNECTORS.has(word.toLowerCase()));
  const pool = meaningful.length ? meaningful : words;
  return (pool.reduce((best, word) => (word.length > best.length ? word : best), '') || keyword.trim()).slice(0, 120);
}

type Page = { payload?: { items?: unknown[]; paginacion?: { total_paginas?: number } } };
async function fetchPage(params: URLSearchParams, dependencies: Dependencies & { ticket: string }): Promise<Page> {
  let response: Response;
  try {
    response = await dependencies.fetch(`${COMPRA_AGIL_BASE}/v2/compra-agil?${params}`, {
      headers: { ticket: dependencies.ticket, accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Our own timeout or a dropped connection: the same as the gateway's 504.
    throw new CompraAgilError('Compra Ágil no respondió a tiempo (falla de Mercado Público).', true);
  }
  if (response.status === 401 || response.status === 403) throw new CompraAgilError('Compra Ágil rechazó el ticket.', false);
  if (response.status === 429) throw new CompraAgilError('Compra Ágil no aceptó más consultas del ticket por ahora (429).', true);
  if (response.status >= 500) throw new CompraAgilError(`Compra Ágil respondió ${response.status} (falla de Mercado Público).`, true);
  if (!response.ok) throw new CompraAgilError(`Compra Ágil respondió ${response.status}.`, false);
  try {
    return await response.json() as Page;
  } catch {
    throw new CompraAgilError('Compra Ágil respondió algo ilegible.', true);
  }
}

/**
 * The open quotes of one keyword, newest first. Each page is asked again after a timeout, a 5xx or a 429; a later page
 * that still fails keeps what the earlier pages brought, with its `error`. `requests` counts every request, retries too.
 */
export async function searchCompraAgil(input: { keyword: string; publishedFrom: string; pages?: number },
  dependencies: Dependencies = { fetch: globalThis.fetch, ticket: process.env.MERCADO_PUBLICO_TICKET }) {
  const ticket = dependencies.ticket;
  if (!ticket) throw new Error('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).');
  const tenders: Tender[] = [];
  let requests = 0;
  const pages = Math.max(1, Math.min(4, input.pages ?? 1));
  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({ q: input.keyword.slice(0, 120), estado: 'publicada', publicado_desde: input.publishedFrom,
      tamano_pagina: String(PAGE_SIZE), numero_pagina: String(page), ordenar_por: 'FechaPublicacion' });
    let body: Page;
    try {
      body = await withRetries(() => { requests++; return fetchPage(params, { ...dependencies, ticket }); }, {
        waits: RETRY_WAITS, retryable: error => error instanceof CompraAgilError && error.retryable,
        wait: dependencies.wait ?? sleep, canWait: dependencies.canWait,
      });
    } catch (error) {
      const failure = error instanceof CompraAgilError ? error : new CompraAgilError('Compra Ágil falló.', false);
      if (page > 1) return { tenders, requests, error: failure.message };
      failure.requests = requests;
      throw failure;
    }
    const items = Array.isArray(body.payload?.items) ? body.payload!.items! : [];
    for (const item of items) {
      const tender = item && typeof item === 'object' ? tenderFromCompraAgil(item as Record<string, unknown>) : null;
      if (tender) tenders.push(tender);
    }
    if (items.length < PAGE_SIZE || page >= Number(body.payload?.paginacion?.total_paginas || 1)) break;
  }
  return { tenders, requests, error: null as string | null };
}
