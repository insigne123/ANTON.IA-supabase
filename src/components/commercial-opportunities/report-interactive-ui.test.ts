import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';
import * as reportMarks from '@/lib/commercial-opportunities/report-marks';
import * as workspace from '@/lib/commercial-opportunities/workspace';
import * as requirementFit from '@/lib/commercial-opportunities/requirement-fit';
import * as markQueue from '@/lib/commercial-opportunities/mark-queue';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => asChild ? children : React.createElement('button', props, children) },
  '@/components/ui/popover': { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: ({ children }: any) => React.createElement('div', { 'data-popover': '' }, children) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
  '@/lib/commercial-opportunities/report-marks': reportMarks,
  '@/lib/commercial-opportunities/workspace': workspace,
  '@/lib/commercial-opportunities/requirement-fit': requirementFit,
  '@/lib/commercial-opportunities/mark-queue': markQueue,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./RoutePath'] = load(await compile('./RoutePath.tsx'));
dependencies['./ReportMarks'] = load(await compile('./ReportMarks.tsx'));
dependencies['./RequirementFit'] = load(await compile('./RequirementFit.tsx'));
const { OpportunityWorkReport } = load(await compile('./OpportunityWorkReport.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

const report = {
  title: 'Seguridad Museo', executive: 'Conviene postular si se consigue la boleta a tiempo.', recommendation: 'conditional', reasons: [],
  sections: [], requirements: [
    { title: 'Boleta de garantía de seriedad', status: 'pending', evidence: [], action: 'Pedirla al banco', role: 'Finanzas', due: 'Antes del cierre' },
    { title: 'Anexo N.º 1 firmado', status: 'supported', evidence: [], action: 'Completar y firmar', role: 'Legal', due: '' },
  ],
  tasks: [{ title: 'Armar la oferta técnica', role: 'Operaciones', due: 'Semana 1', dependency: '', evidence: '' }],
  milestones: [
    { label: 'Fin de consultas', date: '16-10-2099 9:00', state: 'documented', citations: [] },
    { label: 'Cierre de ofertas', date: '29-10-2099 9:00', state: 'documented', citations: [] },
    { label: 'Adjudicación', date: 'Por confirmar', state: 'unknown', citations: [] },
  ],
  risks: [], scenarios: [], questions: ['¿Se acepta póliza en vez de boleta?'], warnings: [], nextSteps: ['Pedir la boleta de garantía'],
  generatedAt: '2026-10-16T12:00:00Z', coverage: [], sources: [], kind: 'tender',
};
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(OpportunityWorkReport, {
  report, opportunity: { title: 'Seguridad Museo', deadline: '2099-10-29T12:00:00Z' }, onTask: () => {}, onAsk: () => {}, ...props }));
const key = (kind: any, label: string) => reportMarks.reportItemKey(kind, label);

test('without the marks table the report reads as before: no checks, no progress, no tools', () => {
  const html = render();
  assert.doesNotMatch(html, /role="checkbox"/);
  assert.doesNotMatch(html, /Avance de la postulación/);
  assert.doesNotMatch(html, /Destacar:/);
  assert.match(text(html), /Ruta de la postulación/, 'the route is drawn from the dates and the plan');
});

test('with marks: each requirement, task and step can be ticked, and the progress counts them', () => {
  const marks = { available: true, items: reportMarks.marksFromRows([
    { item_key: key('requirement', 'Boleta de garantía de seriedad'), done: true, highlight: true, note: 'Lo ve Ana el lunes', updated_by: 'u1', updated_at: '2026-10-16T14:00:00Z' },
  ]) };
  const html = render({ marks, onMark: async () => null, people: [{ user_id: 'u1', name: 'Ana Soto' }] });
  // A step, two requirements and a task; and the route's four steps (the task and three dates), drawn as a zigzag for
  // wide screens and as a line for phones (CSS shows one).
  assert.equal((html.match(/role="checkbox"/g) || []).length, 4 + 4 * 2);
  assert.match(html, /aria-checked="true" aria-label="Listo: Boleta de garantía de seriedad"/);
  assert.match(text(html), /Avance de la postulación 1 de 4 listos/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="1"/);
  // Highlighted: listed on top and marked in place; its note sits beside it with who wrote it.
  assert.match(text(html), /Destacados 1 Boleta de garantía de seriedad/);
  assert.match(html, /aria-pressed="true" aria-label="Quitar destacado: Boleta de garantía de seriedad"/);
  assert.match(html, /aria-label="Nota: Boleta de garantía de seriedad"/);
  assert.match(text(html), /Lo ve Ana el lunes Ana Soto · 16 de octubre de 2026, 11:00/);
});

test('each future date offers a reminder, with Google Calendar and a calendar file, and the dates without a day do not', () => {
  const html = render({ marks: { available: true, items: {} }, onMark: async () => null });
  assert.equal((html.match(/Agregar a Google Calendar/g) || []).length, 2, 'one per dated milestone; «Por confirmar» has none');
  assert.match(html, /href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^"]*dates=20991028T120000Z%2F20991028T123000Z/, 'one day before by default');
  assert.match(text(html), /Recordatorios de todas/);
  assert.match(text(html), /Descargar todas juntas \(\.ics\)/);
  assert.match(text(html), /Una semana antes/);
});

test('«Recordatorios de todas» also adds each date to Google Calendar, one by one, and every reminder says which purchase it is about', () => {
  const html = render({ marks: { available: true, items: {} }, onMark: async () => null,
    opportunity: { id: 'op-1', kind: 'tender', code: '1217466-29-LP26', url: 'https://www.mercadopublico.cl/ficha?idlicitacion=1217466-29-LP26', title: 'SERVICIO ASEO PARA DEPENDENCIAS DEL MHN', buyer: 'Servicio Nacional del Patrimonio Cultural', deadline: '2099-10-29T12:00:00Z' } });
  const all = html.slice(html.indexOf('aria-label="Agregar cada fecha a Google Calendar"'));
  assert.ok(all.includes('aria-label="Agregar «Fin de consultas» a Google Calendar"') && all.includes('aria-label="Agregar «Cierre de ofertas» a Google Calendar"'), 'a Google Calendar link for each dated milestone');
  assert.ok(!all.slice(0, all.indexOf('</ul>')).includes('Adjudicación'), 'a date without a day has none');
  const links = [...html.matchAll(/href="(https:\/\/calendar\.google\.com\/[^"]+)"/g)].map(match => new URL(match[1].replace(/&amp;/g, '&')));
  assert.ok(links.length >= 4, 'the list of all and one for each date');
  for (const link of links) {
    assert.match(link.searchParams.get('text')!, /SERVICIO ASEO PARA DEPENDENCIAS DEL MHN \(ID 1217466-29-LP26\)$/, 'the purchase is in the title of every event');
    assert.match(link.searchParams.get('details')!, /Organismo: Servicio Nacional del Patrimonio Cultural/);
    assert.match(link.searchParams.get('details')!, /Ficha oficial: https:\/\/www\.mercadopublico\.cl\//);
  }
});

test('a tick is never blocked while it saves: no check is disabled, and the one being saved only says it is busy', () => {
  const html = render({ marks: { available: true, items: {} }, onMark: async () => null });
  assert.doesNotMatch(html, /role="checkbox"[^>]*disabled=""/);
});

test('a question that takes figures is asked in words, not with Sí / No, and the questions for the offer come apart, with their reason', () => {
  const key = (title: string) => reportMarks.reportItemKey('requirement', title);
  const extra = requirementFit.extraQuestionKey('¿Desde qué fecha podrían empezar el servicio?');
  const fit = { available: true, profileRevision: 3, latest: { profileRevision: 3, createdAt: '', noRestsOnRequirements: false, items: {
    [key('Boleta de garantía de seriedad')]: { fit: 'missing', basis: '', question: '¿Cuántos contratos de aseo por más de $20.000.000 ha ejecutado desde 2023, con qué clientes y por qué montos?', answerKind: 'detail' },
    [key('Anexo N.º 1 firmado')]: { fit: 'missing', basis: '', question: '¿Pueden firmar el anexo con firma electrónica avanzada?' },
    [extra]: { fit: 'missing', basis: 'Las bases piden inicio inmediato.', question: '¿Desde qué fecha podrían empezar el servicio?', answerKind: 'detail' },
  } } };
  const html = renderToStaticMarkup(React.createElement(OpportunityWorkReport, { report, opportunity: { title: 'Seguridad Museo' }, onTask: () => {}, onAsk: () => {}, fit, onFit: () => {}, onAnswer: () => {} }));
  assert.equal((html.match(/aria-label="Responder a la IA"/g) || []).length, 1, 'only the yes / no question has the buttons');
  assert.match(html, /<textarea[^>]*id="fit-0-answer"/, 'the question with figures starts as a text box');
  assert.match(html, /<textarea[^>]*id="fit-extra-0-answer"/);
  assert.match(text(html), /Guardar y revisar/);
  assert.match(text(html), /Para armar tu oferta Datos que necesitamos aunque ningún requisito los nombre/);
  assert.match(text(html), /¿Desde qué fecha podrían empezar el servicio\? Las bases piden inicio inmediato\./);
  assert.match(text(html), /0 cumples · 2 faltan un dato/, 'the summary counts the requirements, not the questions for the offer');
});

test('the questions for the buyer join the report\'s and the contradictions of the bases, once', () => {
  const html = render({ report: { ...report, questions: ['¿Se acepta póliza en vez de boleta?'], submission: { channel: 'portal', channelDetail: '', folders: [], rules: [], guarantees: [], afterSubmit: [],
    numbers: { budget: null, budgetLabel: '', currency: 'CLP', budgetIncludesTax: null, portalValue: 'unknown', notes: [] },
    inconsistencies: [{ text: 'Dos horas de cierre.', question: '¿Cuál es la hora de cierre: la del portal o la de las bases?' }, { text: 'x', question: '¿Se acepta póliza en vez de boleta?' }] } } });
  assert.match(text(html), /Preguntas para el comprador 2/);
  assert.match(text(html), /¿Cuál es la hora de cierre: la del portal o la de las bases\?/);
});

test('with the tender profile, each requirement says if the company meets it, asks what is missing, and a «No postular» without evidence softens', () => {
  const key = (title: string) => reportMarks.reportItemKey('requirement', title);
  const fit = { available: true, profileRevision: 3, latest: { profileRevision: 3, createdAt: '', noRestsOnRequirements: true, items: {
    [key('Boleta de garantía de seriedad')]: { fit: 'missing', basis: '', question: '¿Pueden entregar una boleta por $4.500.000?' },
    [key('Anexo N.º 1 firmado')]: { fit: 'na', basis: '', question: null },
  } } };
  const html = renderToStaticMarkup(React.createElement(OpportunityWorkReport, { report: { ...report, recommendation: 'do_not_advance' }, opportunity: { title: 'Seguridad Museo' },
    onTask: () => {}, onAsk: () => {}, fit, onFit: () => {}, onAnswer: () => {} }));
  assert.match(text(html), /Postular si se resuelve lo pendiente/, 'no requirement proven against the company: conditional, not «No postular»');
  assert.doesNotMatch(text(html), /No postular/);
  assert.match(text(html), /Con tu ficha no encontramos un requisito que te deje fuera: responde la pregunta de «Falta un dato» para decidir\./);
  assert.match(text(html), /0 cumples · 1 falta un dato · 0 no cumples/);
  assert.match(text(html), /Falta un dato/);
  assert.match(text(html), /¿Pueden entregar una boleta por \$4\.500\.000\?/);
  assert.match(html, /role="group" aria-label="Responder a la IA"/);
  assert.match(text(html), /Trámite de la postulación/);
  assert.doesNotMatch(text(html), /Revisar de nuevo con mi ficha/, 'the reading is current');
  const stale = renderToStaticMarkup(React.createElement(OpportunityWorkReport, { report, opportunity: { title: 'Seguridad Museo' }, onTask: () => {}, onAsk: () => {},
    fit: { ...fit, profileRevision: 4 }, onFit: () => {} }));
  assert.match(text(stale), /tu ficha cambió desde esta revisión/);
  assert.match(text(stale), /Revisar de nuevo con mi ficha/);
  const none = renderToStaticMarkup(React.createElement(OpportunityWorkReport, { report, opportunity: { title: 'Seguridad Museo' }, onTask: () => {}, onAsk: () => {},
    fit: { available: true, profileRevision: null, latest: null } }));
  assert.match(text(none), /Con la «Ficha para licitaciones» de tu empresa, la IA te dice qué requisitos cumples/);
});

test('after answering «No» the page says the AI is reading the requirements again, with a bar that moves, so it never looks stuck', () => {
  const { FitThinking } = dependencies['./RequirementFit'] as any;
  const html = renderToStaticMarkup(React.createElement(FitThinking, { answer: 'No' }));
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
  assert.match(text(html), /Guardé tu respuesta \(«No»\)\. La IA está revisando todos los requisitos con tu ficha…/);
  assert.match(text(html), /Tarda unos segundos\. Puedes seguir leyendo el informe\./);
  assert.match(html, /motion-safe:animate-thinking-slide/, 'moving, only with motion allowed');
  assert.match(html, /motion-reduce:w-full/, 'and still, filled, when motion is reduced');
  const long = text(renderToStaticMarkup(React.createElement(FitThinking, { answer: 'x'.repeat(200) })));
  assert.ok(long.includes(`${'x'.repeat(80)}…`) && !long.includes('x'.repeat(81)), 'a long answer is shortened');
});
