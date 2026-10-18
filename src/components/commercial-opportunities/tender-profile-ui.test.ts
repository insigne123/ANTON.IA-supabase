import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as profile from '../../lib/commercial-opportunities/tender-profile';
import * as documents from '../../lib/commercial-opportunities/company-documents';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const plain = (tag: string) => { const Plain = ({ children, ...props }: any) => React.createElement(tag, props, children); Plain.displayName = tag; return Plain; };
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/label': { Label: ({ htmlFor, ...props }: any) => React.createElement('label', { htmlFor, ...props }) },
  '@/components/ui/progress': { Progress: (props: any) => React.createElement('div', { role: 'progressbar', 'aria-label': props['aria-label'] }) },
  '@/components/ui/sheet': { Sheet: plain('div'), SheetContent: plain('div'), SheetDescription: plain('p'), SheetFooter: plain('div'), SheetHeader: plain('div'), SheetTitle: plain('h2') },
  '@/lib/commercial-opportunities/tender-profile': profile,
  '@/lib/commercial-opportunities/company-documents': documents,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { CompanyDocumentForm, CompanyDocumentRow } = dependencies['./CompanyDocuments'] = load(await compile('./CompanyDocuments.tsx'));
const { TenderProfileFields, TenderProfileSheet, formFromProfile, profileFromForm } = load(await compile('./TenderProfileSheet.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

test('the form keeps amounts as typed and saves them as numbers; blanks and empty regions are «no sé»', () => {
  const form = formFromProfile({ ...profile.EMPTY_TENDER_PROFILE, guaranteeMax: 10_000_000, regions: [] });
  assert.equal(form.guaranteeMax, '10.000.000');
  assert.equal(form.employees, '');
  const saved = profileFromForm({ ...form, employees: '45', contractMax: '300.000.000', legalName: '  ', regions: [] });
  assert.deepEqual([saved.employees, saved.contractMax, saved.guaranteeMax, saved.legalName, saved.regions], [45, 300_000_000, 10_000_000, null, null]);
});

test('the questions come in their groups, with «No sé» as an answer and the AI\'s suggestions marked', () => {
  const form = formFromProfile({ ...profile.EMPTY_TENDER_PROFILE, rut: '76.086.428-4', certifications: [], publicExperience: 'si' });
  const html = renderToStaticMarkup(React.createElement(TenderProfileFields, { form, sources: { legalName: 'sitio web' }, onChange: () => {} }));
  for (const title of ['Tu empresa', 'Dónde y cuánto', 'Experiencia', 'Lo que suelen pedir las bases', 'Medios y límites']) assert.match(text(html), new RegExp(title));
  assert.match(html, /<label for="tp-legalName">Razón social<\/label>/);
  assert.match(text(html), /Sugerido por la IA · sitio web/);
  assert.match(html, /aria-invalid="true"[^>]*aria-describedby="tp-rut-error"/);
  assert.match(html, /role="alert"[^>]*>Revisa el RUT: el dígito verificador no calza\./);
  assert.match(html, /<legend[^>]*>¿Le has vendido al Estado\?<\/legend>/);
  assert.match(html, /<input type="radio" name="tp-public"[^>]*checked=""[^>]*\/>Sí/);
  assert.match(text(html), /No tenemos certificaciones/);
  assert.match(html, /<input type="checkbox"[^>]*checked=""[^>]*\/>No tenemos certificaciones/, 'an empty list reads as «none»');
  assert.match(text(html), /Sin marcar, la IA no sabe dónde operas y no descarta por región\./);
  assert.equal((html.match(/>No sé</g) || []).length, 4, 'size, registry, public experience and insurance can stay unknown');
});

test('the sheet opens loading its answers', () => {
  const html = renderToStaticMarkup(React.createElement(TenderProfileSheet, { open: true, onOpenChange: () => {} }));
  assert.match(text(html), /Ficha para licitaciones/);
  assert.match(text(html), /Abriendo la ficha…/);
});

test('each company document says if it is current, with a download and its date or removal at hand', () => {
  const today = documents.chileToday();
  const inDays = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const row = (expiresAt: string | null) => renderToStaticMarkup(React.createElement(CompanyDocumentRow, { busy: false, onRenew: () => {}, onDelete: () => {},
    document: { id: 'd1', kind: 'f30', label: 'Certificado F30', fileName: 'F30.pdf', expiresAt, createdAt: '' } }));
  assert.match(row(inDays(5)), /class="text-xs text-cw-warning">Vence en 5 días</);
  assert.match(row(inDays(-2)), /class="text-xs text-destructive">Venció el/);
  assert.match(row(inDays(90)), /class="text-xs text-cw-success">Vigente hasta el/);
  assert.match(row(null), />Sin vencimiento</);
  assert.match(row(null), /href="\/api\/commercial-opportunities\/company-documents\?document=d1"[^>]*aria-label="Descargar Certificado F30"/);
  assert.match(text(row(null)), /Cambiar vencimiento .*Quitar/);
});

test('the add form starts with the F30, explains it and asks when it was issued', () => {
  const html = renderToStaticMarkup(React.createElement(CompanyDocumentForm, { busy: false, onAdd: () => {} }));
  assert.match(html, /<label for="doc-kind">Documento<\/label>/);
  assert.match(html, /<option value="f30" selected="">Certificado F30<\/option>/);
  assert.match(text(html), /Las bases suelen pedirlo con menos de 30 días\./);
  assert.match(html, /<label for="doc-issued">Emitido el<\/label>/);
  assert.match(html, /accept="\.pdf,\.docx/);
  assert.match(html, /<button type="submit"[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Subir documento<\/button>/, 'nothing to upload until a file is chosen');
});
