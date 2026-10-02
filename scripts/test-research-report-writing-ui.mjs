// The report's guide to write to the person (Plan 6, PR-C2): its own block «Cómo usarlo en el correo y los seguimientos», open,
// before the commercial reading and out of it; a report without it shows no empty block. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// The fixtures need node:crypto: they are built in Node and reach the page as JSON.
const fixtures = await build({ stdin: { contents: `import {draftReportV2Fixture, draftSnapshotFixture} from './src/lib/server/draft-v2-test-fixtures';
  module.exports = { snapshot: draftSnapshotFixture(), document: draftReportV2Fixture() };`, resolveDir: process.cwd(), loader: 'ts' },
bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error' });
const fixtureModule = { exports: {} };
new Function('module', 'exports', 'require', fixtures.outputFiles[0].text)(fixtureModule, fixtureModule.exports, createRequire(import.meta.url));
const data = JSON.stringify(fixtureModule.exports);

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {NativeResearchReport} from './src/components/research/NativeResearchReport';
  const { snapshot, document: fixtureDocument } = window.__fixtures;
  const result = {
    status: 'completed', researchSnapshotId: snapshot.id, score: null, evidence: [], sources: [], angle: '', warnings: [],
    lead: { id: 'lead-ada', fullName: 'Ada Lovelace', title: 'Gerenta de Finanzas', companyName: 'Acme', companyDomain: 'acme.example', email: null, linkedinUrl: null },
    quality: { score: null, sufficientResearch: true }, draftEligibility: { eligible: true, blockReason: null }, snapshot,
  };
  const guide = [
    { text: 'Ángulo 1: el cierre mensual. Respaldo: abrió dos sucursales este año.', claimIds: [], context: 'target', basis: 'analysis' },
    { text: 'Primer correo. Asunto: cierre con dos sucursales nuevas.', claimIds: [], context: 'target', basis: 'recommendation' },
    { text: 'Seguimientos: una pregunta sobre conciliación y un dato del sector.', claimIds: [], context: 'target', basis: 'recommendation' },
    { text: 'No afirmar: el número de empleados, que no se confirmó.', claimIds: [], context: 'target', basis: 'analysis' },
  ];
  function report(withGuide) {
    return { ...fixtureDocument, sections: fixtureDocument.sections.map(section => section.key === 'angle'
      ? { ...section, title: 'Cómo usarlo en el correo y los seguimientos', paragraphs: withGuide ? guide : [] } : section) };
  }
  const root = createRoot(document.getElementById('root'));
  window.__render = withGuide => root.render(<NativeResearchReport result={result} reportDocument={report(withGuide)} status="completed" />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'error' });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/saved/leads/enriched', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.fetch = async () => ({ ok: true, json: async () => ({}) });
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
window.eval(`window.__fixtures = ${data};`);
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 150) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const heading = title => [...window.document.querySelectorAll('h3')].find(item => item.textContent.includes(title));
try {
  window.__render(true);
  await settle();
  const writing = heading('Cómo usarlo en el correo y los seguimientos');
  assert.ok(writing, 'the guide has its own block');
  assert.match(writing.textContent, /Para escribirle/);
  const section = writing.closest('section');
  assert.match(section.textContent, /Primer correo\. Asunto: cierre con dos sucursales nuevas\./);
  assert.match(section.textContent, /No afirmar: el número de empleados/);
  const trigger = writing.querySelector('button');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'open: writing is what the person came to do');
  assert.ok(trigger.getAttribute('aria-describedby'), 'the button says what the block holds');
  const commercial = heading('Qué explorar y cómo ayudar');
  assert.ok(commercial, 'the commercial reading stays');
  assert.doesNotMatch(commercial.closest('section').textContent, /Primer correo\. Asunto/, 'the guide is not repeated there');
  assert.ok(writing.compareDocumentPosition(commercial) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'the guide comes first');
  assert.doesNotMatch(section.textContent, /Hipótesis/, 'an email idea is not labeled as a hypothesis');

  window.__render(false);
  await settle();
  assert.equal(heading('Cómo usarlo en el correo y los seguimientos'), undefined, 'a report without the guide shows no empty block');
  assert.ok(heading('Qué explorar y cómo ayudar'));
  console.log('PASS: the report shows its guide to write to the person in its own open block, before the commercial reading and not repeated in it; without it, no block.');
} finally { window.close(); }
