import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as laborCost from '../../lib/commercial-opportunities/labor-cost';
import * as priceScenarios from '../../lib/commercial-opportunities/price-scenarios';
import * as priceStudio from '../../lib/commercial-opportunities/price-studio';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/label': { Label: ({ children, ...props }: any) => React.createElement('label', props, children) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/labor-cost': laborCost,
  '@/lib/commercial-opportunities/price-scenarios': priceScenarios,
  '@/lib/commercial-opportunities/price-studio': priceStudio,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { PriceStudio } = load(await compile('./PriceStudio.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const html = renderToStaticMarkup(React.createElement(PriceStudio, { storageKey: 'anton:price-studio:v1:u1:op-1' }));

test('the price tool is a closed section that says what it calculates', () => {
  assert.match(html, /^<details[^>]*>/);
  assert.doesNotMatch(html, /^<details[^>]* open/);
  assert.match(text(html), /Calcular el precio valor hora y puntaje frente a un rival/);
  assert.match(html, /aria-label="Qué calcular"/);
  assert.match(html, /aria-pressed="true"[^>]*>Costo y valor hora<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Puntaje por precio<\/button>/);
});

test('it opens on the cost with the rates labelled as a starting point to confirm, and a profile ready to fill', () => {
  const words = text(html);
  assert.match(words, /confírmalos con tu contador antes de ofertar/);
  assert.match(words, /valores de octubre de 2026/);
  assert.match(html, /<label[^>]*>Sueldo base del perfil 1<\/label>/);
  assert.match(html, /<label[^>]*>Personas del perfil 1<\/label>/);
  for (const label of ['Gratificación (% del sueldo base)', 'Horas pagadas al mes', 'Ausentismo y reemplazos (%)', 'Gastos generales (% del precio)', 'Margen (% del precio)', 'IVA (%)', 'Plazo del contrato (meses)']) assert.match(words, new RegExp(label.replace(/[()%]/g, '\\$&')));
  assert.match(html, /value="0,93"/); assert.match(html, /value="182"/);
  assert.match(html, /value="Seguro de invalidez y sobrevivencia \(SIS\)"/, 'the employer contributions are lines the person can change');
  assert.match(words, /Margen y gastos generales se miden sobre el precio/);
  assert.match(words, /no se comparte con el equipo/);
});

test('before anything is typed it still shows the result, with what is missing said plainly, and a copy button', () => {
  const words = text(html);
  assert.match(words, /Perfil 1 × 1/);
  assert.match(words, /«Perfil sin nombre» no tiene sueldo base/);
  assert.match(words, /No incluiste reemplazos por vacaciones y licencias/);
  assert.match(words, /Copiar el cálculo/); assert.match(words, /Usar el total \(neto\) en el puntaje/);
  assert.equal((html.match(/aria-label="Quitar el perfil/g) || []).length, 0, 'a single profile cannot be removed');
});

const shiftDraft = () => {
  const draft = priceStudio.defaultDraft();
  Object.assign(draft.profiles[0], { name: 'Guardia 4x4', headcount: '2', base: '604.000', nonTaxable: '60.000', annualBonus: '60.000', holidays: '8', holidayHours: '11', exempt: '8.000', postPeople: '2', postHours: '334,58' });
  draft.loads = [['Cesantía', '2,4'], ['Mutual', '0,93'], ['SIS', '1,78'], ['Expectativa de vida', '0,72'], ['Capitalización individual', '0,1'], ['Rentabilidad protegida', '0,9'], ['Vacaciones (provisión)', '5,75'], ['Indemnización (provisión)', '8,33']]
    .map(([label, pct], index) => ({ id: `l${index}`, label, pct }));
  draft.expenses = [{ id: 'e0', label: 'Supervisor repartido', amount: '60.000' }];
  draft.sites = [{ id: 's0', name: 'Tienda Centro', posts: '3', postHours: '', hoursMonth: '1.003,75' }, { id: 's1', name: 'Tienda Norte', posts: '1', postHours: '309,6', hoursMonth: '309,6' }];
  Object.assign(draft.params, { profitOn: 'cost', margin: '10', minimumWage: '539.000', workerDeductions: '19,1', minNet: '670.000', guarantee: '10', absenteeism: '1', overhead: '1' });
  return draft;
};
const shifts = renderToStaticMarkup(React.createElement(PriceStudio, { storageKey: 'anton:price-studio:v1:u1:op-1', initialDraft: shiftDraft() }));

test('a post in shifts shows the price of the post, the net pay and the sites with their hour and their month, as the client\'s form asks', () => {
  const words = text(shifts);
  assert.match(words, /Guardia 4x4 × 2/);
  assert.match(words, /Puesto de 2 personas: \$[\d.]+ al mes por puesto/);
  assert.match(words, /Líquido estimado por persona: \$670\.795/);
  assert.match(words, /Precio por sitio o tienda/);
  assert.match(words, /Un puesto de «Guardia 4x4» cuesta \$[\d.]+ al mes \(neto\), con sus 2 personas/);
  assert.match(shifts, /<label[^>]*>Horas al mes del sitio 1<\/label>/);
  assert.match(shifts, /value="Tienda Centro"/); assert.match(shifts, /value="1\.003,75"/);
  assert.match(words, /Total de los sitios/);
  assert.match(words, /Garantía de fiel cumplimiento \(10 % del monto anual\): \$[\d.]+/);
  assert.match(words, /Usar el total anual de los sitios \(neto\) en el puntaje/);
  assert.match(words, /Totales de los sitios \(los puestos de «Guardia 4x4»\)/);
  assert.match(words, /Garantía de fiel cumplimiento \$[\d.]+/, 'with sites and a bond, the fourth figure is the bond');
  assert.match(words, /un puesto cubre 334,58 horas al mes con 2 personas en turno/, 'the form that halves the hour is warned about');
});

test('the profit over the cost says what it is, and the labels follow it', () => {
  const words = text(shifts);
  assert.match(shifts, /aria-pressed="true"[^>]*>El costo \(utilidad del formulario\)<\/button>/);
  assert.match(shifts, /aria-pressed="false"[^>]*>El precio \(margen\)<\/button>/);
  assert.match(words, /Utilidad \(% del costo\)/); assert.match(words, /Gastos generales \(% del costo\)/);
  assert.match(words, /un recargo sobre el costo total \(10 % de utilidad = costo × 1,10\)/);
  assert.match(words, /Margen y gastos generales se miden sobre el costo/);
  assert.doesNotMatch(words, /Margen \(% del precio\)/);
  assert.match(text(html), /El margen y los gastos generales son una parte del precio \(10 % de margen = costo ÷ 0,90\)/, 'by default it is the price, as in the financial scenario');
});

test('what is new has its fields, labelled, with the provisions empty and the expenses as lines to change', () => {
  const words = text(shifts);
  for (const label of ['Personas por puesto', 'Horas del puesto al mes', 'Aguinaldos y bonos al año \\(por persona\\)', 'Festivos trabajados al año', 'Horas de cada festivo', 'Costos sin utilidad al mes \\(por persona\\)',
    'Ingreso mínimo mensual', 'Jornada semanal \\(horas\\)', 'Descuentos del trabajador \\(%\\)', 'Líquido mínimo que piden las bases', 'Garantía de fiel cumplimiento \\(% del monto anual\\)']) assert.match(words, new RegExp(label), label);
  assert.match(shifts, /value="Supervisor repartido"/); assert.match(shifts, /<label[^>]*>Monto del gasto 1<\/label>/);
  assert.match(words, /Gastos por persona al mes/); assert.match(words, /Las provisiones de vacaciones y de indemnización empiezan vacías/);
  assert.match(html, /value="Vacaciones \(provisión\)"/); assert.match(html, /value="Indemnización por años de servicio \(provisión\)"/);
  assert.match(text(html), /Para cotizar sitio por sitio, define el puesto de un perfil/, 'without a post there is nothing to price by site');
  assert.doesNotMatch(text(html), /Total de los sitios/);
});

test('the person can remove a site and a row that says nothing is not matched to a result', () => {
  assert.equal((shifts.match(/aria-label="Quitar el sitio \d"/g) || []).length, 2);
  assert.equal((shifts.match(/aria-label="Quitar el gasto \d"/g) || []).length, 1);
  assert.equal(priceStudio.siteKept({ id: 'x', name: '', posts: '', postHours: '', hoursMonth: '' }), false);
  assert.equal(priceStudio.siteKept(priceStudio.newSite()), true);
});

// Saved for the team (OPP-23): the study comes from the server, says who saved it, keeps its versions and can feed the economic offer.
const study = priceStudio.cleanStudy({ profiles: [{ name: 'Guardia', headcount: '12', base: '600000' }] });
const version = (id: string, by: string, at: string) => ({ id, created_by: by, created_at: at, updated_at: at });
const shared = (over: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(PriceStudio, { storageKey: 'anton:price-studio:v1:u1:op-1',
  server: { available: true, latest: { ...version('v2', 'u-camila', '2026-10-24T15:00:00.000Z'), study }, versions: [version('v2', 'u-camila', '2026-10-24T15:00:00.000Z'), version('v1', 'u-diego', '2026-10-22T13:00:00.000Z')] },
  people: [{ user_id: 'u-camila', name: 'Camila Torres' }, { user_id: 'u-diego', name: 'Diego Fuentes' }], onSave: async () => ({ ok: true }), onOpenVersion: async () => study, ...over }));

test('saved for the team: it opens on the version in use, says who saved it, and keeps the ones before', () => {
  const page = shared();
  assert.match(text(page), /Guardado para quien fija los precios · Camila Torres, 24 de octubre a las 12:00/);
  assert.match(page, /value="Guardia"/, 'the study saved, not an empty one');
  assert.match(text(page), /Versiones guardadas 2/);
  assert.match(text(page), /24 de octubre a las 12:00 · Camila Torres en uso/);
  assert.match(text(page), /22 de octubre a las 10:00 · Diego Fuentes Usar esta/);
  assert.match(text(page), /Solo lo ven quien está a cargo y los administradores\./);
  assert.doesNotMatch(text(page), /vive en tu navegador/);
});

test('a figure of the calculation goes to a line of the economic offer, with VAT when the portal takes it so', () => {
  const net = text(shared({ offer: { lines: [{ index: 0, description: 'Servicio mensual de guardias' }], withTax: false, onUse: async () => true } }));
  assert.match(net, /Usar en la oferta económica/);
  assert.match(net, /Precio al mes: \$[\d.]+/);
  assert.match(net, /Servicio mensual de guardias/);
  assert.match(net, /Queda como precio unitario neto de esa línea/);
  const monthly = (words: string) => Number(words.match(/Precio al mes: \$([\d.]+)/)![1].replace(/\./g, ''));
  const gross = text(shared({ offer: { lines: [{ index: 0, description: 'Servicio mensual de guardias' }], withTax: true, onUse: async () => true } }));
  assert.match(gross, /Queda como precio unitario con IVA de esa línea/);
  assert.ok(Math.abs(monthly(gross) - monthly(net) * 1.19) <= 1, `${monthly(gross)} vs ${monthly(net)}`);
  assert.doesNotMatch(text(shared()), /Usar en la oferta económica/, 'without an economic offer there is nothing to put it in');
});

test('before its table exists, the study lives in the browser as before', () => {
  const local = text(renderToStaticMarkup(React.createElement(PriceStudio, { storageKey: 'anton:price-studio:v1:u1:op-1', server: { available: false, latest: null, versions: [] }, onSave: async () => ({ ok: true }) })));
  assert.match(local, /Esto vive en tu navegador: no se comparte con el equipo\./);
  assert.doesNotMatch(local, /Guardado para quien fija los precios|Versiones guardadas/);
});
