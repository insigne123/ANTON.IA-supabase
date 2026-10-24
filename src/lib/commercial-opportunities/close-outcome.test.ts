import assert from 'node:assert/strict';
import test from 'node:test';
import { closeBody, closeMotives, isFinalResult, lessonsLearned, moneyOf, resultLine, wonByUs } from './close-outcome';
import { tenderResultFromLicitacion } from './tenders';

// A tender of the Mercado Público API v1 after its award (licitaciones.json?codigo=…, Listado[0]): two items, one supplier won both.
const AWARDED = {
  CodigoExterno: '1509-5-LP26', Nombre: 'Servicio de guardias de seguridad', CodigoEstado: 8, Estado: 'Adjudicada', Moneda: 'CLP',
  Fechas: { FechaCierre: '2026-10-16T10:00:00', FechaAdjudicacion: '2026-10-20T17:27:00', FechaEstimadaAdjudicacion: '2026-10-20T17:27:00' },
  Adjudicacion: { Tipo: 1, Fecha: '2026-10-20T17:27:00', Numero: '412', NumeroOferentes: 5, UrlActa: 'http://www.mercadopublico.cl/Procurement/Modules/RFB/StepsProcessAward/PreviewAwardAct.aspx?qs=abc' },
  Items: { Cantidad: 2, Listado: [
    { Correlativo: 1, NombreProducto: 'Servicios de vigilancia', Adjudicacion: { RutProveedor: '76.543.210-K', NombreProveedor: 'Seguridad Sur SpA', CantidadAdjudicada: 12, MontoUnitario: 5_000_000 } },
    { Correlativo: 2, NombreProducto: 'Supervisión', Adjudicacion: { RutProveedor: '76543210-k', NombreProveedor: 'Seguridad Sur SpA', CantidadAdjudicada: 1, MontoUnitario: 25_000_000 } },
  ] },
};

test('the result of a tender: its state, the winner by supplier with what it adds up to, the bidders and the act, over https', () => {
  const result = tenderResultFromLicitacion(AWARDED)!;
  assert.equal(result.status, 'adjudicada');
  assert.deepEqual(result.winners, [{ rut: '76.543.210-K', name: 'Seguridad Sur SpA', amount: 85_000_000 }]);
  assert.deepEqual([result.total, result.bidders, result.currency], [85_000_000, 5, 'CLP']);
  assert.equal(result.awardedAt, '2026-10-20T20:27:00.000Z', 'Chilean time, kept as an instant');
  assert.match(result.actUrl!, /^https:\/\/www\.mercadopublico\.cl\//);
  assert.equal(tenderResultFromLicitacion({ ...AWARDED, Adjudicacion: { ...AWARDED.Adjudicacion, UrlActa: 'https://otro.example/acta' } })!.actUrl, null);
  // Still closed: nobody won anything yet, and the award is expected.
  const closed = tenderResultFromLicitacion({ ...AWARDED, CodigoEstado: 6, Estado: 'Cerrada', Adjudicacion: null, Items: { Listado: [{ Correlativo: 1, Adjudicacion: null }] } })!;
  assert.deepEqual([closed.status, closed.awardedAt, closed.winners, closed.total], ['cerrada', null, [], null]);
  assert.equal(closed.expectedAt, '2026-10-20T20:27:00.000Z');
  assert.equal(tenderResultFromLicitacion({ Nombre: 'sin código' }), null);
});

test('the result in one line, as a person reads it', () => {
  const result = tenderResultFromLicitacion(AWARDED)!;
  assert.equal(resultLine(result), 'Adjudicada el 20 de octubre a Seguridad Sur SpA por $85.000.000, entre 5 ofertas.');
  assert.equal(resultLine({ ...result, winners: [...result.winners, { rut: null, name: 'Otra SpA', amount: null }, { rut: null, name: 'Tercera', amount: 1 }] }),
    'Adjudicada el 20 de octubre a Seguridad Sur SpA y 2 empresas más por $85.000.000, entre 5 ofertas.');
  assert.equal(resultLine({ ...result, status: 'desierta', winners: [], total: null }), 'Declarada desierta el 20 de octubre: nadie se la adjudicó.');
  assert.equal(resultLine({ ...result, status: 'revocada', awardedAt: null }), 'Revocada por el comprador.');
  assert.equal(resultLine({ ...result, status: 'cerrada', awardedAt: null, expectedAt: '2026-10-28T15:00:00.000Z' }), 'Cerrada; la adjudicación se espera para el 28 de octubre.');
  assert.equal(moneyOf(1200, 'UF'), 'UF 1.200');
  assert.deepEqual(['adjudicada', 'desierta', 'revocada', 'cerrada', null].map(isFinalResult), [true, true, true, false, false]);
});

test('the company won it when a winner has the RUT of its tender profile, however it is written', () => {
  const result = tenderResultFromLicitacion(AWARDED)!;
  assert.equal(wonByUs(result, '76543210-K'), true);
  assert.equal(wonByUs(result, '77.111.222-3'), false);
  assert.equal(wonByUs(result, null), null, 'without the company RUT, nobody can tell');
  assert.equal(wonByUs({ winners: [{ rut: null, name: 'Sin RUT', amount: null }] }, '76543210-K'), null);
});

test('closing keeps only the reasons of its state, three at most, and the line says them with who won', () => {
  assert.deepEqual(closeMotives('lost', ['deadline', 'price', 'experience', 'price', 'void', 'capacity']), ['price', 'deadline', 'capacity']);
  assert.deepEqual(closeMotives('won', ['price', 'void']), ['price']);
  assert.equal(closeBody('Perdida', 'lost', { motives: ['price', 'competitor'], winner: 'Seguridad Sur SpA', amount: 85_000_000 }, 'Pidieron menor plazo.', 'CLP'),
    'Estado: Perdida · Precio, Otro proveedor mejor evaluado. Ganó Seguridad Sur SpA por $85.000.000. Pidieron menor plazo.');
  assert.equal(closeBody('Ganada', 'won', { motives: [], winner: 'ignored', amount: 40_000_000 }, undefined), 'Estado: Ganada. Por $40.000.000.');
  assert.equal(closeBody('Perdida', 'lost', {}, undefined), 'Estado: Perdida.');
});

test('what was learned counts the last close of each opportunity, its reasons and the suppliers that won the ones lost', () => {
  const learned = lessonsLearned([
    { opportunityId: 'a', to: 'lost', motives: ['price'], winner: 'Rival', createdAt: '2026-10-01T00:00:00Z' },
    { opportunityId: 'a', to: 'won', motives: ['technical'], createdAt: '2026-10-02T00:00:00Z' },
    { opportunityId: 'b', to: 'lost', motives: 'junk', winner: '  ', createdAt: '2026-10-03T00:00:00Z' },
    { opportunityId: 'c', to: 'archived', createdAt: '2026-10-03T00:00:00Z' },
  ]);
  assert.deepEqual([learned.won, learned.lost, learned.winRate], [1, 1, 0.5]);
  assert.deepEqual(learned.wonFor.map(item => item.id), ['technical']);
  assert.deepEqual([learned.lostFor, learned.rivals], [[], []], 'junk reasons and blank winners are not counted');
  assert.equal(lessonsLearned([]).winRate, null);
});
