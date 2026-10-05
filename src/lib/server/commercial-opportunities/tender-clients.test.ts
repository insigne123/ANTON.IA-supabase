import assert from 'node:assert/strict';
import test from 'node:test';
import { CompraAgilError, compraAgilQuery, searchCompraAgil } from './compra-agil';
import { getLicitacion, isMercadoPublicoBusy, listOpenLicitaciones } from './mercado-publico';

const TICKET = 'TICKET-SECRETO-123';
const FROM = '2026-09-18T12:00:00Z';
const noWait = async () => {};
const item = (code: string) => ({ codigo: code, nombre: `Suministro de personal ${code}`, estado: { codigo: 'publicada' }, fechas: {}, montos: {}, institucion: {} });
const page = (items: unknown[], pages = 1) => new Response(JSON.stringify({ success: 'OK', payload: { items, paginacion: { total_paginas: pages } } }), { status: 200 });
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

test('Compra Ágil sends the ticket only in its header, 20 per page, pages until the last one and names its errors', async () => {
  const urls: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    assert.equal((init?.headers as Record<string, string>).ticket, TICKET);
    const number = Number(new URL(url).searchParams.get('numero_pagina'));
    return number === 1 ? page(Array.from({ length: 20 }, (_, index) => item(`A-${index}-COT26`)), 2) : page([item('B-1-COT26')], 2);
  }) as typeof fetch;
  const result = await searchCompraAgil({ keyword: 'suministro', publishedFrom: FROM, pages: 3 }, { fetch: fakeFetch, ticket: TICKET, wait: noWait });
  assert.equal(result.tenders.length, 21);
  assert.equal(result.requests, 2);
  assert.equal(result.error, null);
  assert.ok(urls.every(url => !url.includes(TICKET)));
  assert.equal(new URL(urls[0]).searchParams.get('estado'), 'publicada');
  assert.equal(new URL(urls[0]).searchParams.get('tamano_pagina'), '20', '50 per page goes past the gateway\'s 29 seconds');
  const refused = (async () => json({ success: 'NOK', errors: [{ codigo: '401', mensaje: 'El ticket no existe' }] }, 401)) as unknown as typeof fetch;
  await assert.rejects(searchCompraAgil({ keyword: 'x', publishedFrom: FROM }, { fetch: refused, ticket: TICKET, wait: noWait }), /rechazó el ticket/);
  await assert.rejects(searchCompraAgil({ keyword: 'x', publishedFrom: FROM }, { fetch: refused, ticket: undefined }), /MERCADO_PUBLICO_TICKET/);
});

test('Compra Ágil asks again after a 500, a 504 or a timeout, and counts every try', async () => {
  const waits: number[] = [];
  let calls = 0;
  const flaky = (async () => {
    calls++;
    if (calls === 1) return json({ success: 'ERROR', errors: [{ codigo: 'ERROR_INTERNO', mensaje: 'Servicio no disponible' }] }, 500);
    if (calls === 2) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return page([item('A-1-COT26')]);
  }) as unknown as typeof fetch;
  const result = await searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM }, { fetch: flaky, ticket: TICKET, wait: async ms => { waits.push(ms); } });
  assert.deepEqual([result.tenders.length, result.requests, waits], [1, 3, [2_000, 5_000]]);

  const down = (async () => json({ message: 'Endpoint request timed out' }, 504)) as unknown as typeof fetch;
  await assert.rejects(searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM }, { fetch: down, ticket: TICKET, wait: noWait }),
    (error: CompraAgilError) => /504 \(falla de Mercado Público\)/.test(error.message) && error.requests === 3);
  let tries = 0;
  const outOfTime = (async () => { tries++; return json({}, 500); }) as unknown as typeof fetch;
  await assert.rejects(searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM }, { fetch: outOfTime, ticket: TICKET, wait: noWait, canWait: () => false }));
  assert.equal(tries, 1, 'no retry past the time budget');
});

test('a later Compra Ágil page that fails keeps what the first one brought', async () => {
  const fakeFetch = (async (url: string) => (Number(new URL(url).searchParams.get('numero_pagina')) === 1
    ? page(Array.from({ length: 20 }, (_, index) => item(`A-${index}-COT26`)), 3) : json({}, 500))) as unknown as typeof fetch;
  const result = await searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM, pages: 2 }, { fetch: fakeFetch, ticket: TICKET, wait: noWait });
  assert.equal(result.tenders.length, 20);
  assert.equal(result.requests, 4);
  assert.match(String(result.error), /500/);
});

test('Compra Ágil is asked for the longest word that is not a connector', () => {
  assert.equal(compraAgilQuery('selección de personal'), 'selección');
  assert.equal(compraAgilQuery('suministro de personal'), 'suministro');
  assert.equal(compraAgilQuery('personal de reemplazo'), 'reemplazo');
  assert.equal(compraAgilQuery('call center'), 'center');
  assert.equal(compraAgilQuery('outsourcing'), 'outsourcing');
  assert.equal(compraAgilQuery('  de  '), 'de');
});

test('Mercado Público errors never carry the ticket, and 10500 is «busy», not the daily quota', async () => {
  const rejected = (async () => json({ Codigo: 203, Mensaje: `Ticket ${TICKET} no válido` }, 203)) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: rejected, ticket: TICKET }), (error: Error) => /rechazó el ticket/.test(error.message) && !error.message.includes(TICKET));
  const wrongQuery = (async () => json({ Codigo: 400, Mensaje: `Consulta inválida ${TICKET}` }, 200)) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: wrongQuery, ticket: TICKET }), (error: Error) => /revisa el ticket/.test(error.message) && !error.message.includes(TICKET));
  const busy = (async () => json({ Codigo: 10500, Mensaje: 'Lo sentimos. Hemos detectado que existen peticiones simultáneas.' }, 429)) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: busy, ticket: TICKET }), (error: Error) => isMercadoPublicoBusy(error) && !/cuota/.test(error.message));
  const quota = (async () => json({ Codigo: 10600, Mensaje: 'Se excedió la cuota diaria' }, 429)) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: quota, ticket: TICKET }), (error: Error) => !isMercadoPublicoBusy(error) && /cuota diaria/.test(error.message));
  const ok = (async (url: string) => {
    assert.equal(new URL(url).searchParams.get('codigo'), '1509-5-LE26');
    return json({ Cantidad: 1, Listado: [{ CodigoExterno: '1509-5-LE26', Nombre: 'Outsourcing', CodigoEstado: 5 }] }, 200);
  }) as typeof fetch;
  assert.equal((await getLicitacion('1509-5-LE26', { fetch: ok, ticket: TICKET }))?.status, 'publicada');
  const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(listOpenLicitaciones({ fetch: down, ticket: TICKET }), (error: Error) => error.message === 'Mercado Público respondió 500.');
});
