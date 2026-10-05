import assert from 'node:assert/strict';
import test from 'node:test';
import { matchTender, tenderFromCompraAgil, tenderFromLicitacion, tenderUrl } from './tenders';
import { tenderFromStoredRow, tenderOpportunityRow, tenderSignalRow } from './records';

const NOW = '2026-10-02T12:00:00Z';
const compraAgil = {
  codigo: '1057539-228-COT26', nombre: 'Servicio de suministro de personal para bodega', descripcion: 'Personal transitorio por 3 meses',
  estado: { codigo: 'publicada' }, fechas: { fecha_publicacion: '2026-09-30T10:00:00Z', fecha_cierre: '2026-10-08T15:00:00Z' },
  montos: { moneda: 'CLP', monto_disponible: 4_500_000, monto_disponible_clp: 4_500_000 },
  institucion: { organismo_comprador: 'Hospital Regional', unidad_compra: 'Abastecimiento', region: 2, nombre_region: 'Región de Antofagasta' },
  productos_solicitados: [{ codigo_producto: 80111600, nombre: 'Servicios de personal temporal' }],
};
const licitacion = {
  CodigoExterno: '1509-5-LE26', Nombre: 'Outsourcing de call center municipal', Descripcion: 'Atención telefónica', CodigoEstado: 5,
  MontoEstimado: 60_000_000, Moneda: 'CLP', Fechas: { FechaPublicacion: '2026-09-28T09:00:00', FechaCierre: '2026-10-20T15:00:00' },
  Comprador: { NombreOrganismo: 'Municipalidad de Maipú', NombreUnidad: 'Compras', RegionUnidad: 'Región Metropolitana de Santiago',
    NombreUsuario: 'Persona Funcionaria', CargoUsuario: 'Jefa de compras' },
  Items: { Listado: [{ CodigoProducto: 83111603, NombreProducto: 'Servicios de centro de llamadas' }] },
};
const profile = { keywords: ['suministro de personal', 'outsourcing', 'call center'], unspscCodes: ['801116'], regions: ['Antofagasta'] };

test('a Compra Ágil quote and a tender become the same shape, without the official who published it', () => {
  const quote = tenderFromCompraAgil(compraAgil)!;
  assert.deepEqual([quote.source, quote.code, quote.buyer, quote.region, quote.amount, quote.closesAt],
    ['compra_agil', '1057539-228-COT26', 'Hospital Regional', 'Antofagasta', 4_500_000, '2026-10-08T15:00:00.000Z']);
  assert.deepEqual(quote.items, [{ code: '80111600', name: 'Servicios de personal temporal' }]);
  const tender = tenderFromLicitacion(licitacion)!;
  assert.deepEqual([tender.source, tender.status, tender.region, tender.buyer, tender.buyerUnit], ['mercado_publico', 'publicada', 'Metropolitana', 'Municipalidad de Maipú', 'Compras']);
  assert.equal(tender.closesAt, '2026-10-20T18:00:00.000Z', 'Mercado Público dates are Chilean time');
  assert.doesNotMatch(JSON.stringify([quote, tender]), /Persona Funcionaria|Jefa de compras/);
  assert.equal(tenderFromCompraAgil({ codigo: '' }), null);
  assert.equal(tenderFromLicitacion({ Nombre: 'sin código' }), null);
});

test('a tender fits by a keyword in its name, its text or an item code, and closed ones never fit', () => {
  const quote = tenderFromCompraAgil(compraAgil)!;
  const quoteMatch = matchTender(quote, profile, NOW)!;
  assert.deepEqual(quoteMatch.keywords, ['suministro de personal']);
  assert.equal(quoteMatch.score, 45 + 20 + 5 + 10 + 10, 'name, UNSPSC family, amount under 10 M, 6 days left, profile region');
  assert.ok(quoteMatch.reasons.includes('cierra en 6 días'));
  const tender = tenderFromLicitacion(licitacion)!;
  assert.equal(matchTender(tender, profile, NOW)?.score, 45 + 15 + 10);
  assert.equal(matchTender(tender, { ...profile, keywords: ['aseo'] , unspscCodes: [] }, NOW), null);
  assert.equal(matchTender({ ...tender, name: 'Servicio integral', description: 'Incluye outsourcing de digitación' }, profile, NOW)?.reasons[0], 'la descripción dice «outsourcing»');
  assert.equal(matchTender(tender, profile, '2026-10-21T00:00:00Z'), null, 'past the deadline');
  assert.equal(matchTender({ ...tender, status: 'cerrada' }, profile, NOW), null);
  assert.equal(matchTender({ ...tender, name: 'Arriendo de bodega' , description: null, items: [] }, { ...profile, keywords: ['bodega'] }, NOW)?.keywords[0], 'bodega');
});

test('rows and evidence keep the code, buyer and deadline; only a tender has a public link', () => {
  const quote = tenderFromCompraAgil(compraAgil)!;
  const row = tenderOpportunityRow(quote, matchTender(quote, profile, NOW)!, { organizationId: 'org', profileId: 'p1' }, NOW);
  assert.deepEqual([row.kind, row.dedupe_key, row.buyer_name, row.url, row.deadline_at], ['compra_agil', quote.code, 'Hospital Regional', null, quote.closesAt]);
  for (const key of ['status', 'claimed_by', 'first_seen_at']) assert.equal(key in row, false, key);
  const tender = tenderFromLicitacion(licitacion)!;
  assert.match(tenderUrl(tender)!, /DetailsAcquisition\.aspx\?idlicitacion=1509-5-LE26$/);
  const signal = tenderSignalRow(tender, { organizationId: 'org', opportunityId: 'o1' }, NOW);
  assert.deepEqual([signal.source, signal.external_id, signal.publisher], ['mercado_publico', '1509-5-LE26', 'Municipalidad de Maipú']);
});

test('a tender saved with its detail comes back the same, so the next search reuses it instead of asking again', () => {
  const tender = tenderFromLicitacion(licitacion)!;
  const row = tenderOpportunityRow(tender, matchTender(tender, profile, NOW)!, { organizationId: 'org', profileId: 'p1' }, NOW);
  const again = tenderFromStoredRow({ ...row, amount: row.amount === null ? null : String(row.amount) });
  assert.deepEqual(again, { ...tender, description: tender.description, items: tender.items.slice(0, 10) });
  assert.deepEqual(tenderFromStoredRow({ ...row, amount: null, data: null }).items, []);
});
