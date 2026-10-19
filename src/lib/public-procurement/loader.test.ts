import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateMonth, csvRows, durationMonths, foldName, monthPlan, normalizeRut, parseAmount, tenderStatus } from '../../../scripts/public-procurement/aggregate.mjs';

async function* chunks(text: string, size = 7) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
async function rows(text: string, size?: number) { const out: string[][] = []; for await (const row of csvRows(chunks(text, size))) out.push(row); return out; }

test('the CSV reader keeps «;», quotes and line breaks inside quoted fields, across chunk borders', async () => {
  const text = '"a";"b";"c"\r\n"1";"dice ""hola""; y sigue";"línea\nnueva"\n2;;"fin"\n';
  for (const size of [1, 3, 7, 1000]) {
    assert.deepEqual(await rows(text, size), [['a', 'b', 'c'], ['1', 'dice "hola"; y sigue', 'línea\nnueva'], ['2', '', 'fin']], `chunks of ${size}`);
  }
  assert.deepEqual(await rows('x;y'), [['x', 'y']], 'the last row without a line break');
});

test('names, RUTs, lengths and states read the way the file writes them', () => {
  assert.equal(foldName(' I. Municipalidad de Peñalolén '), 'i municipalidad de penalolen');
  assert.equal(normalizeRut('76.020.266-5'), '76020266-5');
  assert.equal(normalizeRut('5.126.663-k'), '5126663-K');
  assert.equal(normalizeRut('0076020266-5'), '76020266-5');
  assert.equal(normalizeRut('sin rut'), null);
  assert.equal(parseAmount('611330260'), 611330260);
  assert.equal(parseAmount('2520,5'), 2520.5);
  assert.equal(parseAmount('2e+86'), null, 'a typo of the file is not an amount');
  assert.equal(parseAmount('NA'), null);
  assert.equal(durationMonths('24', '4'), 24);
  assert.equal(durationMonths('90', '2'), 3);
  assert.equal(durationMonths('6', '3'), 1.4);
  assert.equal(durationMonths('24', '1'), null, 'unit 1 carries no length');
  assert.equal(durationMonths('0', '4'), null);
  assert.equal(tenderStatus('Desierta (o art. 3 ó 9 Ley 19.886)'), 'desierta');
  assert.equal(tenderStatus('Adjudicada'), 'adjudicada');
});

const HEADER = ['Codigo', 'CodigoExterno', 'Nombre', 'Estado', 'CodigoOrganismo', 'NombreOrganismo', 'sector', 'NombreUnidad', 'RegionUnidad', 'Tipo',
  'Moneda Adquisicion', 'VisibilidadMonto', 'MontoEstimado', 'NumeroOferentes', 'FechaPublicacion', 'FechaCierre', 'FechaAdjudicacion',
  'TiempoDuracionContrato', 'UnidadTiempoDuracionContrato', 'CriteriosEvaluacion', 'Rubro1', 'Rubro2', 'RutProveedor', 'RazonSocialProveedor',
  'NombreProveedor', 'Valor Total Ofertado', 'MontoLineaAdjudica', 'Oferta seleccionada'];
const line = (values: Record<string, string>) => HEADER.map(name => `"${(values[name] ?? '').replace(/"/g, '""')}"`).join(';');
const base = { Codigo: '100', CodigoExterno: '2429-27-LE26', Nombre: 'Servicio de aseo', Estado: 'Adjudicada', CodigoOrganismo: '7312',
  NombreOrganismo: 'I. Municipalidad de Antofagasta', sector: 'Municipalidades', Tipo: 'LE', 'Moneda Adquisicion': 'Peso Chileno', VisibilidadMonto: '1',
  MontoEstimado: '1000000', NumeroOferentes: '2', FechaPublicacion: '2026-09-01', FechaCierre: '2026-09-15', FechaAdjudicacion: '2026-09-30',
  TiempoDuracionContrato: '24', UnidadTiempoDuracionContrato: '4', CriteriosEvaluacion: 'Precio ; Experiencia', Rubro1: 'SERVICIOS', Rubro2: 'LIMPIEZA' };
const file = [HEADER.map(name => `"${name}"`).join(';'),
  line({ ...base, RutProveedor: '76.020.266-5', RazonSocialProveedor: 'Aseo Norte SpA', 'Valor Total Ofertado': '600000', MontoLineaAdjudica: '600000', 'Oferta seleccionada': 'Seleccionada' }),
  line({ ...base, RutProveedor: '76.020.266-5', RazonSocialProveedor: 'Aseo Norte SpA', 'Valor Total Ofertado': '300000', MontoLineaAdjudica: '300000', 'Oferta seleccionada': 'Seleccionada', Rubro2: 'JARDINERIA' }),
  line({ ...base, RutProveedor: '11.111.111-1', RazonSocialProveedor: 'Limpia Sur Ltda', 'Valor Total Ofertado': '950000', MontoLineaAdjudica: '0', 'Oferta seleccionada': 'No Seleccionada' }),
  line({ ...base, Codigo: '101', CodigoExterno: '2429-28-L126', Nombre: 'Compra de resmas', Estado: 'Cerrada', VisibilidadMonto: '0', MontoEstimado: '500000',
    TiempoDuracionContrato: '0', UnidadTiempoDuracionContrato: '1', RutProveedor: '11.111.111-1', RazonSocialProveedor: 'Limpia Sur Ltda', 'Valor Total Ofertado': '400000', 'Oferta seleccionada': 'No Seleccionada' }),
  // The same tender written with a typo in its code: one tender, the well-formed code.
  line({ ...base, Codigo: '101', CodigoExterno: '2429;28-L126', Nombre: 'Compra de resmas', Estado: 'Cerrada', VisibilidadMonto: '0', MontoEstimado: '500000',
    TiempoDuracionContrato: '0', UnidadTiempoDuracionContrato: '1' }),
  line({ ...base, Codigo: '102', CodigoExterno: '2429-29-LE26', Nombre: 'Guardias 6 meses', TiempoDuracionContrato: '6', RutProveedor: '76.020.266-5', RazonSocialProveedor: 'Aseo Norte SpA',
    'Valor Total Ofertado': '100', MontoLineaAdjudica: '100', 'Oferta seleccionada': 'Seleccionada' }),
].join('\r\n') + '\r\n';

test('one month becomes tenders with their winner, bids per supplier and the agency, by scope', async () => {
  const aggregate = await aggregateMonth('2026-09-01', chunks(file, 50));
  const all = aggregate.forScope('all');
  assert.deepEqual(all.tenders.map((tender: any) => [tender.code, tender.status, tender.awarded_amount, tender.category, tender.duration_months]), [
    ['2429-27-LE26', 'adjudicada', 900000, 'LIMPIEZA', 24],
    ['2429-28-L126', 'cerrada', null, 'LIMPIEZA', null],
    ['2429-29-LE26', 'adjudicada', 100, 'LIMPIEZA', 6],
  ]);
  assert.equal(all.tenders[1].estimated_amount, null, 'a hidden estimate stays hidden');
  assert.deepEqual(all.bids.map((bid: any) => [bid.tenderId, bid.rut, bid.offered, bid.awarded, bid.selected]), [
    [100, '76020266-5', 900000, 900000, true],
    [100, '11111111-1', 950000, null, false],
    [101, '11111111-1', 400000, null, false],
    [102, '76020266-5', 100, 100, true],
  ]);
  assert.deepEqual(all.agencies, [{ id: 7312, name: 'I. Municipalidad de Antofagasta', name_key: 'i municipalidad de antofagasta', sector: 'Municipalidades' }]);

  const winners = aggregate.forScope('winners');
  assert.deepEqual(winners.tenders.map((tender: any) => [tender.code, tender.bids_scope]), [['2429-27-LE26', 'winners'], ['2429-29-LE26', 'winners']]);
  assert.deepEqual(winners.bids.map((bid: any) => bid.rut), ['76020266-5', '76020266-5']);
  assert.deepEqual(winners.suppliers.map((supplier: any) => supplier.name), ['Aseo Norte SpA'], 'only the suppliers of the bids kept');

  const long = aggregate.forScope('long');
  assert.deepEqual(long.tenders.map((tender: any) => tender.code), ['2429-27-LE26'], 'awarded and 18 months or more');
});

test('the plan: 12 months with every bid, then 12 of winners, then 24 of long contracts', () => {
  const plan = monthPlan(new Date('2026-10-19T12:00:00Z'));
  assert.equal(plan.length, 48);
  assert.deepEqual(plan[0], { index: 0, year: 2026, month: 10, sourceMonth: '2026-10-01', scope: 'all' });
  assert.deepEqual([plan[11].sourceMonth, plan[11].scope], ['2025-11-01', 'all']);
  assert.deepEqual([plan[12].sourceMonth, plan[12].scope], ['2025-10-01', 'winners']);
  assert.deepEqual([plan[24].sourceMonth, plan[24].scope], ['2024-10-01', 'long']);
  assert.deepEqual([plan[47].year, plan[47].month], [2022, 11]);
});
