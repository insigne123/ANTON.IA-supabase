import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCompraAgil } from './compra-agil';
import { getLicitacion, listOpenLicitaciones } from './mercado-publico';

const TICKET = 'TICKET-SECRETO-123';
const item = (code: string) => ({ codigo: code, nombre: `Suministro de personal ${code}`, estado: { codigo: 'publicada' }, fechas: {}, montos: {}, institucion: {} });

test('Compra Ágil sends the ticket only in its header, pages until the last one and names its errors', async () => {
  const urls: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    assert.equal((init?.headers as Record<string, string>).ticket, TICKET);
    const page = Number(new URL(url).searchParams.get('numero_pagina'));
    const items = page === 1 ? Array.from({ length: 50 }, (_, index) => item(`A-${index}-COT26`)) : [item('B-1-COT26')];
    return new Response(JSON.stringify({ success: 'OK', payload: { items, paginacion: { total_paginas: 2 } } }), { status: 200 });
  }) as typeof fetch;
  const result = await searchCompraAgil({ keyword: 'suministro de personal', publishedFrom: '2026-09-18T12:00:00Z', pages: 3 }, { fetch: fakeFetch, ticket: TICKET });
  assert.equal(result.tenders.length, 51);
  assert.equal(result.requests, 2);
  assert.ok(urls.every(url => !url.includes(TICKET)));
  assert.equal(new URL(urls[0]).searchParams.get('estado'), 'publicada');
  const limited = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(searchCompraAgil({ keyword: 'x', publishedFrom: '2026-09-18T12:00:00Z' }, { fetch: limited, ticket: TICKET }), /cuota diaria/);
  await assert.rejects(searchCompraAgil({ keyword: 'x', publishedFrom: '2026-09-18T12:00:00Z' }, { fetch: limited, ticket: undefined }), /MERCADO_PUBLICO_TICKET/);
});

test('Mercado Público errors never carry the ticket, even when the API answers 200 with an error', async () => {
  const rejected = (async () => new Response(JSON.stringify({ Codigo: 203, Mensaje: `Ticket ${TICKET} no válido` }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: rejected, ticket: TICKET }), (error: Error) => /revisa el ticket/.test(error.message) && !error.message.includes(TICKET));
  const ok = (async (url: string) => {
    assert.equal(new URL(url).searchParams.get('codigo'), '1509-5-LE26');
    return new Response(JSON.stringify({ Cantidad: 1, Listado: [{ CodigoExterno: '1509-5-LE26', Nombre: 'Outsourcing', CodigoEstado: 5 }] }), { status: 200 });
  }) as typeof fetch;
  assert.equal((await getLicitacion('1509-5-LE26', { fetch: ok, ticket: TICKET }))?.status, 'publicada');
  const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: down, ticket: TICKET }), (error: Error) => error.message === 'Mercado Público respondió 500.');
});
