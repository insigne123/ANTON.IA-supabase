import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSummary, needsTenderDetail, opportunitySummary, summaryBasis, summaryCase, summaryPrompt } from './summaries';

const tender = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 't1', kind: 'tender', title: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', buyer_name: null,
  company_name: null, amount: null, currency: null, deadline_at: null, data, ...extra });

test('a tender listed by name only asks for its official file; one with buyer and description, or already read, does not', () => {
  assert.equal(needsTenderDetail(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { code: '1234-5-LP26' } })), true);
  assert.equal(needsTenderDetail(tender({ description: 'Guardias 24/7 para el recinto del aeropuerto', observed: { code: '1234-5-LP26' } }, { buyer_name: 'Servicio Agrícola y Ganadero' })), false);
  assert.equal(needsTenderDetail(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { code: '1234-5-LP26' }, detail: { at: '2026-10-19' } })), false);
  assert.equal(needsTenderDetail(tender({ description: 'x', observed: {} })), false, 'without a code there is nothing to ask');
  assert.equal(needsTenderDetail({ ...tender({ observed: { code: '9-1-COT26' } }), kind: 'compra_agil' }), false, 'Compra Ágil comes with its buyer');
});

test('the case the model reads says only what the opportunity says, and drops a description that repeats the name', () => {
  const read = summaryCase(tender({ description: 'servicio de vigilancia sag aeropuerto', buyerUnit: 'Unidad Aeropuerto', observed: { code: '1', region: 'Región Metropolitana', items: [{ name: 'Guardias de seguridad' }, { name: '' }] } },
    { buyer_name: 'Servicio Agrícola y Ganadero', amount: 48000000, currency: 'CLP' }));
  assert.deepEqual(read, { id: 't1', tipo: 'Licitación pública', nombre: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', organismoOEmpresa: 'Servicio Agrícola y Ganadero', unidad: 'Unidad Aeropuerto',
    descripcion: null, lineas: ['Guardias de seguridad'], region: 'Región Metropolitana', monto: '48000000 CLP', avisos: null });
  const hiring = summaryCase({ id: 'h1', kind: 'hiring', title: 'Actividad de contratación: ISEG CHILE', company_name: 'ISEG CHILE', data: { description: 'Urgente Guardia de Seguridad 4x4 · Santiago', observed: { ads: 3 } } });
  assert.equal(hiring.tipo, 'Avisos de trabajo en LinkedIn');
  assert.equal(hiring.avisos, 3);
  assert.match(hiring.descripcion!, /Guardia de Seguridad/);
});

test('the basis records whether the model had the official file, a text or only the name', () => {
  assert.equal(summaryBasis(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', detail: { at: 'x' } })), 'ficha');
  assert.equal(summaryBasis(tender({ description: 'Guardias para el recinto' })), 'texto');
  assert.equal(summaryBasis(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { items: [] } })), 'nombre');
});

test('the prompt asks for one or two sentences without invented facts or advice', () => {
  const prompt = summaryPrompt([summaryCase(tender({}))]);
  assert.match(prompt, /máximo 200 caracteres/);
  assert.match(prompt, /Nunca inventes montos, plazos, cantidades ni lugares/);
  assert.match(prompt, /No opines si conviene postular/);
  assert.match(prompt, /"id":"t1"/);
});

test('a summary is one line, without quotes, ending in a period and cut at a word when long', () => {
  assert.equal(cleanSummary('«Guardias para el SAG en el aeropuerto»'), 'Guardias para el SAG en el aeropuerto.');
  assert.equal(cleanSummary('Aseo de oficinas\n en Castro.'), 'Aseo de oficinas en Castro.');
  const long = cleanSummary(`${'Servicio de vigilancia y control de accesos '.repeat(8)}final`);
  assert.ok(long.length <= 220, String(long.length));
  assert.match(long, /…$/);
  assert.doesNotMatch(long, / …$/);
});

test('the saved summary is read only when it has text', () => {
  assert.equal(opportunitySummary({ summary: { text: ' Guardias para el SAG. ' } }), 'Guardias para el SAG.');
  assert.equal(opportunitySummary({ summary: { text: '' } }), null);
  assert.equal(opportunitySummary({}), null);
  assert.equal(opportunitySummary(null), null);
});
