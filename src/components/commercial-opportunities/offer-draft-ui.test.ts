import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as offerDraft from '@/lib/commercial-opportunities/offer-draft';
import * as offerAnnexes from '@/lib/commercial-opportunities/offer-annexes';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => asChild ? children : React.createElement('button', props, children) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/label': { Label: ({ children, ...props }: any) => React.createElement('label', props, children) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/offer-draft': offerDraft,
  '@/lib/commercial-opportunities/offer-annexes': offerAnnexes,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { OfferDraft } = load(await compile('./OfferDraft.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

// «Servicio de aseo Hospital de Castro», as the draft comes back from the model.
const draft = offerDraft.clampOfferDraft({
  summary: 'Ofrecemos el servicio de aseo integral con [N.º de años] de experiencia en recintos de salud.',
  technical: [{ heading: 'Experiencia', criterion: 'Experiencia del oferente', weight: '40 %', body: 'Hemos prestado servicios a [clientes del sector salud].', evidence: [{ chunkId: 'c1', quote: 'Experiencia del oferente 40%' }] }],
  compliance: [{ requirement: 'Dotación mínima de 12 auxiliares', answer: 'Cumplimos con 12 auxiliares.', evidence: [] }],
  economic: { lines: [
    { description: 'Servicio de aseo mensual', unit: 'mes', quantity: 24, notes: 'Incluye insumos', evidence: [] },
    { description: 'Aseo terminal de pabellones', unit: 'servicio', quantity: null, notes: '', evidence: [] },
  ], priceBasis: 'net', validity: '90 días corridos', paymentTerms: '', notes: [] },
  letter: 'Señores Hospital de Castro: [nombre de la empresa] presenta su oferta.',
  missing: ['Certificado F30 vigente'],
});
const saved = { id: 'draft-1', draft, prices: { 0: 7000000 }, revision: 2, created_at: '2026-10-17T15:00:00Z' };
const props = (over: Record<string, unknown> = {}) => ({
  offer: { available: true, latest: saved }, job: null, onPrepare: () => undefined, onSavePrices: async () => null,
  downloadHref: '/api/commercial-opportunities/op-1/export?doc=offer&format=docx', annexHref: (index: number) => `/api/commercial-opportunities/op-1/export?doc=offer&format=docx&annex=${index}`, budget: { amount: 212000000, includesTax: true }, ...over,
});
const render = (over: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(OfferDraft, props(over)));

test('without the table in the database, the offer does not show', () => {
  assert.equal(render({ offer: { available: false, latest: null } }), '');
});

test('before a draft there is one action, and a preparation on its way says so instead', () => {
  const empty = text(render({ offer: { available: true, latest: null } }));
  assert.match(empty, /Tu oferta/);
  assert.match(empty, /Preparar borrador de oferta/);
  assert.match(empty, /Agregar indicaciones/);
  assert.match(empty, /en un Word para llenar/, 'says what it hands over');
  const working = render({ offer: { available: true, latest: null }, job: { id: 'j1', state: 'running', error: null, created_at: '2026-10-17T15:00:00Z' } });
  assert.match(working, /role="status"/);
  assert.match(text(working), /Preparando el borrador/);
  assert.doesNotMatch(text(working), /Preparar borrador de oferta/);
});

test('the draft shows what is left to fill in, the parts by criterion and the download', () => {
  const html = render();
  const page = text(html);
  assert.match(page, /Tu oferta · borrador/);
  assert.match(page, /Preparado el 17 de octubre a las 12:00\. Revísalo/);
  assert.match(html, /href="\/api\/commercial-opportunities\/op-1\/export\?doc=offer&amp;format=docx"/);
  assert.match(page, /Antes de enviar, completa 3 datos marcados/);
  assert.match(page, /Certificado F30 vigente/);
  assert.match(html, /<mark[^>]*>\[nombre de la empresa\]<\/mark>/);
  assert.match(page, /Responde a: Experiencia del oferente 40 %/);
  assert.match(page, /Bases: «Experiencia del oferente 40%»/);
  assert.match(page, /Cumplimiento de requisitos técnicos 1/);
});

test('the economic sheet multiplies, adds VAT, compares with the budget and says what is missing', () => {
  const html = render();
  const page = text(html);
  assert.match(html, /<label for="offer-price-0" class="sr-only">Precio unitario de Servicio de aseo mensual<\/label>/);
  assert.match(html, /id="offer-price-0"[^>]*value="7000000"/);
  assert.match(page, /24 mes Precio unitario de Servicio de aseo mensual \$168\.000\.000/);
  assert.match(page, /Neto \$168\.000\.000 IVA \(19 %\) \$31\.920\.000 Total \$199\.920\.000/);
  assert.match(page, /Dentro del presupuesto de \$212\.000\.000 \(margen \$12\.080\.000\)/);
  assert.match(page, /Faltan precios en 1 línea/);
  assert.match(page, /Vigencia de la oferta: 90 días corridos/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Guardar precios<\/button>/, 'nothing to save until a price changes');
});

test('the forms of the bases are listed, each with its own Word, and say how many fields are still open', () => {
  const withForms = { ...saved, draft: offerDraft.clampOfferDraft({ ...saved.draft, annexes: [
    { number: 'Anexo N°1', title: 'Identificación del oferente', intro: '', signed: true, faithful: true, blocks: [{ kind: 'fields', title: '', text: '', fields: [{ label: 'Razón social', value: 'Grupo Expro SpA' }, { label: 'Domicilio', value: '' }], columns: [], rows: [], blankRows: 0, options: [] }] },
    { number: 'Anexo N°6', title: 'Experiencia', intro: '', signed: true, faithful: false, blocks: [{ kind: 'table', title: '', text: '', fields: [], columns: ['N°', 'Cliente'], rows: [], blankRows: 3, options: [] }] },
  ] }) };
  const html = render({ offer: { available: true, latest: withForms } });
  const page = text(html);
  assert.match(page, /Formularios de las bases 2/);
  assert.match(page, /Anexo N°1 · Identificación del oferente Copiado del formulario de las bases · 1 por completar/);
  assert.match(page, /Anexo N°6 · Experiencia Armado con lo que piden las bases: compáralo con el oficial · 3 por completar/);
  assert.match(html, /href="\/api\/commercial-opportunities\/op-1\/export\?doc=offer&amp;format=docx&amp;annex=1"/);
  assert.match(page, /Descargar Word para llenar/);
  assert.doesNotMatch(page, /anterior a los formularios/, 'a draft with forms does not ask for another version');
  const older = text(render());
  assert.doesNotMatch(older, /Formularios de las bases/, 'an older draft has none');
  assert.match(older, /Este borrador es anterior a los formularios de las bases \(anexos\)\. Con «Preparar otra versión» sale con ellos/);
});

test('a new version that failed says so and keeps the previous one on view', () => {
  const page = text(render({ job: { id: 'j2', state: 'failed', error: 'Las bases no se pudieron leer.', created_at: '2026-10-18T10:00:00Z' } }));
  assert.match(page, /La nueva versión no terminó: Las bases no se pudieron leer\. Sigues viendo la anterior\./);
  assert.match(page, /Tu oferta · borrador/);
  const old = text(render({ job: { id: 'j0', state: 'failed', error: 'Vieja falla', created_at: '2026-10-16T10:00:00Z' } }));
  assert.doesNotMatch(old, /Vieja falla/, 'a failure older than the draft is history');
});
