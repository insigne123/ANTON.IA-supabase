import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';
import * as reportMarks from '@/lib/commercial-opportunities/report-marks';
import * as submissionKit from '@/lib/commercial-opportunities/submission-kit';
import * as offerAnnexes from '@/lib/commercial-opportunities/offer-annexes';
import * as markQueue from '@/lib/commercial-opportunities/mark-queue';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => asChild ? children : React.createElement('button', props, children) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/label': { Label: ({ children, ...props }: any) => React.createElement('label', props, children) },
  '@/components/ui/popover': { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: passthrough },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
  '@/lib/commercial-opportunities/report-marks': reportMarks,
  '@/lib/commercial-opportunities/submission-kit': submissionKit,
  '@/lib/commercial-opportunities/offer-annexes': offerAnnexes,
  '@/lib/commercial-opportunities/mark-queue': markQueue,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./ReportMarks'] = load(await compile('./ReportMarks.tsx'));
const { SubmissionKit } = load(await compile('./SubmissionKit.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

const base = {
  title: 'Ornato Dalcahue', executive: '', recommendation: 'conditional', reasons: [], sections: [],
  requirements: [{ title: 'Certificado F30 vigente', status: 'pending', evidence: [], action: 'Pedirlo en la Dirección del Trabajo', role: '', due: '' }],
  tasks: [], milestones: [{ label: 'Fin de consultas', date: '20-10-2099 15:00', state: 'documented', citations: [] }], risks: [], scenarios: [], questions: [], warnings: [],
  generatedAt: '2026-10-16T12:00:00Z', coverage: [], sources: [], kind: 'tender',
};
const submission = {
  channel: 'portal', channelDetail: 'Mercado Público, en carpetas de anexos administrativos, técnicos y económicos.',
  folders: [{ name: 'Económicos', documents: [
    { title: 'Anexo 4 Formato Oficial de Oferta Económica', source: 'annex', signed: true, validity: '', excludesIfMissing: true, howTo: 'Neto y total con IVA deben coincidir.', evidence: [] },
    { title: 'Certificado F30', source: 'certificate', signed: false, validity: 'No más de 30 días antes de la apertura', excludesIfMissing: false, howTo: '', evidence: [] },
  ] }],
  rules: [{ text: 'Sueldo líquido de al menos $620.000.', kind: 'minimum', evidence: [{ chunkId: 'c2', quote: 'Sueldo líquido mínimo solicitado $ 620.000' }] }],
  numbers: { budget: 212000000, budgetLabel: '$212.000.000 impuestos incluidos', currency: 'CLP', budgetIncludesTax: true, portalValue: 'net', notes: [] },
  guarantees: [{ kind: 'Fiel cumplimiento', amount: '5% del valor contratado', validity: 'Contrato más 60 días hábiles', when: 'A la firma del contrato', payableTo: 'Ilustre Municipalidad de Dalcahue' }],
  afterSubmit: [], inconsistencies: [{ text: 'Las bases hablan de dos carpetas y nombran tres.', question: '¿Se entregan en dos o en tres carpetas?' }],
};
const opportunity = { title: 'Ornato Dalcahue', kind: 'tender', amount: 212000000, currency: 'CLP', deadline: '2099-10-29T18:00:00Z' };

test('«Cómo postular» reads as the bases ask: documents by folder with their ticks, what leaves the offer out, the numbers, the guarantee and the forum', () => {
  const marks = { available: true, items: reportMarks.marksFromRows([{ item_key: reportMarks.reportItemKey('document', 'Anexo 4 Formato Oficial de Oferta Económica'), done: true, highlight: false, note: '' }]) };
  const html = renderToStaticMarkup(React.createElement(SubmissionKit, { report: { ...base, submission }, opportunity, marks, onMark: async () => null, onDraft: () => undefined }));
  const page = text(html);
  assert.match(page, /Por el portal: Mercado Público/);
  assert.match(page, /1 de 2 documentos listos/);
  assert.match(page, /Económicos/);
  assert.match(html, /role="checkbox" aria-checked="true" aria-label="Listo: Anexo 4 Formato Oficial de Oferta Económica"/);
  assert.match(page, /Formulario de las bases · Con firma/);
  assert.match(page, /Si falta, quedas fuera/);
  assert.equal((page.match(/Preparar borrador/g) || []).length, 1, 'a certificate is not drafted by the AI');
  assert.match(page, /Lo que te deja fuera Sueldo líquido de al menos \$620\.000\. Bases: «Sueldo líquido mínimo solicitado \$ 620\.000»/);
  assert.match(page, /En el portal va el valor neto/);
  assert.match(page, /Presupuesto según las bases: \$212\.000\.000, impuestos incluidos\./);
  assert.match(page, /Fiel cumplimiento Monto 5% del valor contratado/);
  assert.match(page, /¿Se entregan en dos o en tres carpetas\?/);
  assert.match(page, /Pregunta antes del 20-10-2099 15:00/);
  assert.match(page, /Cómo se envía en Mercado Público/);
});

test('a report from before the guide lists its requirements with the same ticks, and asks to update for the full guide', () => {
  const page = text(renderToStaticMarkup(React.createElement(SubmissionKit, { report: base, opportunity, marks: { available: true, items: {} }, onMark: async () => null, onGenerate: () => undefined })));
  assert.match(page, /Este informe es anterior a la guía de postulación/);
  assert.match(page, /Actualizar informe/);
  assert.match(page, /Requisitos del informe 1 Certificado F30 vigente/);
  assert.match(page, /0 de 1 requisitos listos/);
  // Without a report: the steps of the portal and the calculator still help.
  const empty = text(renderToStaticMarkup(React.createElement(SubmissionKit, { report: null, opportunity, onGenerate: () => undefined })));
  assert.match(empty, /Genera el informe y la IA armará esta guía/);
  assert.match(empty, /Monto de la ficha: \$212\.000\.000/);
  assert.match(empty, /Ingresa la oferta con «Ofertar»/);
});

test('the page uses its whole width: a header with the progress, what to prepare in the wide column and what to check beside it', () => {
  const html = renderToStaticMarkup(React.createElement(SubmissionKit, { report: { ...base, submission }, opportunity, marks: { available: true, items: {} }, onMark: async () => null }));
  assert.doesNotMatch(html, /max-w-3xl/, 'no narrow centered column');
  assert.match(html, /<header[^>]*lg:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,26rem\)\]/, 'title and progress side by side');
  const main = html.indexOf('Qué entregar');
  const side = html.indexOf('<aside');
  assert.ok(main > 0 && side > main, 'documents first, the checks in the aside');
  const aside = html.slice(side);
  for (const heading of ['Lo que te deja fuera', 'Los números', 'Garantías', 'Para preguntar en el foro', 'Cómo se envía en Mercado Público', 'Después de enviar']) assert.ok(aside.includes(heading), heading);
  assert.ok(!html.slice(0, side).includes('Lo que te deja fuera'), 'the rules are not in the wide column');
});

test('a form the offer already filled in offers its Word on its own row, in place of the chat draft', () => {
  const annexes = [{ number: 'Anexo N°4', title: 'Formato oficial de oferta económica', intro: '', signed: true, faithful: true, blocks: [{ kind: 'text', title: '', text: 'Declaro.', fields: [], columns: [], rows: [], blankRows: 0, options: [] }] }];
  const html = renderToStaticMarkup(React.createElement(SubmissionKit, { report: { ...base, submission }, opportunity, marks: { available: true, items: {} }, onMark: async () => null, onDraft: () => undefined,
    annexes, annexHref: (index: number) => `/export?annex=${index}` }));
  assert.match(html, /<a href="\/export\?annex=0">/);
  assert.match(text(html), /Descargar Word para llenar/);
  assert.doesNotMatch(text(html), /Preparar borrador/, 'the only form with a draft is the annex, and its Word replaces the chat');
});
