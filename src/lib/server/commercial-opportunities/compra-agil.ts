import { tenderFromCompraAgil, type Tender } from '@/lib/commercial-opportunities/tenders';

/**
 * Compra Ágil API v2 (ChileCompra, beta since May 2026): open quotes found by keyword. Free with the Mercado Público
 * ticket (MERCADO_PUBLICO_TICKET), which travels only in the `ticket` header and never in a message. Each ticket has a
 * daily quota (429 when spent). Guide: «API Compra Ágil v2», version 3.0, May 2026.
 */
export const COMPRA_AGIL_BASE = 'https://api2.mercadopublico.cl';
const PAGE_SIZE = 50;

type Dependencies = { fetch: typeof fetch; ticket: string | undefined };

export async function searchCompraAgil(input: { keyword: string; publishedFrom: string; pages?: number },
  dependencies: Dependencies = { fetch: globalThis.fetch, ticket: process.env.MERCADO_PUBLICO_TICKET }) {
  if (!dependencies.ticket) throw new Error('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).');
  const tenders: Tender[] = [];
  let requests = 0;
  const pages = Math.max(1, Math.min(4, input.pages ?? 2));
  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({ q: input.keyword.slice(0, 120), estado: 'publicada', publicado_desde: input.publishedFrom,
      tamano_pagina: String(PAGE_SIZE), numero_pagina: String(page), ordenar_por: 'FechaPublicacion' });
    const response = await dependencies.fetch(`${COMPRA_AGIL_BASE}/v2/compra-agil?${params}`, {
      headers: { ticket: dependencies.ticket, accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    requests++;
    if (response.status === 401 || response.status === 403) throw new Error('Compra Ágil rechazó el ticket.');
    if (response.status === 429) throw new Error('Compra Ágil: se acabó la cuota diaria del ticket.');
    if (!response.ok) throw new Error(`Compra Ágil respondió ${response.status}.`);
    const body = await response.json() as { payload?: { items?: unknown[]; paginacion?: { total_paginas?: number } } };
    const items = Array.isArray(body.payload?.items) ? body.payload!.items! : [];
    for (const item of items) {
      const tender = item && typeof item === 'object' ? tenderFromCompraAgil(item as Record<string, unknown>) : null;
      if (tender) tenders.push(tender);
    }
    if (items.length < PAGE_SIZE || page >= Number(body.payload?.paginacion?.total_paginas || 1)) break;
  }
  return { tenders, requests };
}
