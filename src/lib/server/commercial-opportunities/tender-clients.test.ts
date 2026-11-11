import assert from 'node:assert/strict';
import test from 'node:test';
import { CompraAgilError, compraAgilQuery, isCompraAgilOutage, isCompraAgilTimeout, searchCompraAgil, SMALL_PAGE_SIZE } from './compra-agil';
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

test('after a timeout Compra Ágil is asked in pages of 10: the same quotes in twice the pages, inside a time budget', async () => {
  // The failures a smaller page helps are told apart from a busy ticket or a broken service.
  const failing = (status: number) => (async () => json({}, status)) as unknown as typeof fetch;
  const failure = (work: Promise<unknown>) => work.then(() => null, (error: CompraAgilError) => error);
  const gateway = await failure(searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM }, { fetch: failing(504), ticket: TICKET, wait: noWait, canWait: () => false }));
  assert.deepEqual([gateway?.retryable, gateway?.timedOut], [true, true]);
  const dropped = await failure(searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM },
    { fetch: (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as unknown as typeof fetch, ticket: TICKET, wait: noWait, canWait: () => false }));
  assert.deepEqual([dropped?.retryable, dropped?.timedOut], [true, true]);
  for (const status of [500, 429]) {
    const other = await failure(searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM }, { fetch: failing(status), ticket: TICKET, wait: noWait, canWait: () => false }));
    assert.deepEqual([other?.retryable, other?.timedOut], [true, false]);
  }
  // The stored reason of a failed search says the same, for the afternoon round.
  assert.ok(isCompraAgilOutage(gateway?.message) && isCompraAgilTimeout(gateway?.message));
  assert.ok(isCompraAgilOutage(dropped?.message) && isCompraAgilTimeout(dropped?.message));
  assert.ok(isCompraAgilOutage('Compra Ágil respondió 500 (falla de Mercado Público).') && !isCompraAgilTimeout('Compra Ágil respondió 500 (falla de Mercado Público).'));
  assert.ok(isCompraAgilOutage('Compra Ágil no aceptó más consultas del ticket por ahora (429).'));
  assert.ok(!isCompraAgilOutage('Compra Ágil rechazó el ticket.') && !isCompraAgilOutage('Compra Ágil respondió 400.') && !isCompraAgilOutage(null));

  // Two pages of 20 are four pages of 10.
  const sizes: string[] = [];
  const full = (async (url: string) => {
    const params = new URL(url).searchParams;
    sizes.push(`${params.get('tamano_pagina')}:${params.get('numero_pagina')}`);
    return page(Array.from({ length: 10 }, (_, index) => item(`P${params.get('numero_pagina')}-${index}-COT26`)), 9);
  }) as unknown as typeof fetch;
  const small = await searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM, pages: 2, pageSize: SMALL_PAGE_SIZE }, { fetch: full, ticket: TICKET, wait: noWait });
  assert.deepEqual(sizes, ['10:1', '10:2', '10:3', '10:4']);
  assert.deepEqual([small.tenders.length, small.requests, small.error], [40, 4, null]);
  // Any other size is the page of 20.
  sizes.length = 0;
  await searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM, pageSize: 50 }, { fetch: full, ticket: TICKET, wait: noWait });
  assert.deepEqual(sizes, ['20:1']);

  // A slow service: past the budget no further page is asked, and what arrived is kept, said as partial.
  sizes.length = 0;
  let clock = 0;
  const slow = (async (url: string) => { clock += 60_000; return full(url); }) as unknown as typeof fetch;
  const partial = await searchCompraAgil({ keyword: 'aseo', publishedFrom: FROM, pages: 4, pageSize: SMALL_PAGE_SIZE, budgetMs: 150_000 },
    { fetch: slow, ticket: TICKET, wait: noWait, now: () => clock });
  assert.deepEqual(sizes, ['10:1', '10:2', '10:3']);
  assert.equal(partial.tenders.length, 30);
  assert.match(String(partial.error), /respondió lento/);
});

