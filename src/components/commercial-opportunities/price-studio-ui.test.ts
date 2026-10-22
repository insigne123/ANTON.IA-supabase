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
