// «¿Qué puedes hacer?» on the Cowork home (Plan 5, PR-7): the guide opens on demand with the seven groups, each example
// fills the message box to try it, and each group links to the help center. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CoworkHome} from './src/components/cowork/CoworkHome';
  createRoot(document.getElementById('root')).render(<CoworkHome composer={<textarea aria-label="Mensaje" />} threads={[]} ready loading={false}
    onSuggestion={prompt => { window.__suggested = (window.__suggested || []).concat(prompt); }} onOpenThread={() => {}} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 200) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
try {
  await settle();
  const document = window.document;
  const toggle = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '¿Qué puedes hacer?');
  assert.ok(toggle, 'the home offers the guide');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.getElementById('cw-guide-title'), null, 'closed, the home stays short');
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const section = document.querySelector('section[aria-labelledby="cw-guide-title"]');
  assert.ok(section);
  assert.deepEqual([...section.querySelectorAll('h3')].map(node => node.textContent),
    ['Buscar prospectos', 'Tus contactos', 'Investigar', 'Correos y campañas', 'LinkedIn', 'Seguimiento', 'Cifras e informes']);
  assert.match(section.textContent, /Antes de enviar, gastar créditos o cambiar algo te pido aprobación\./);
  const links = [...section.querySelectorAll('a')];
  assert.equal(links.length, 7);
  assert.ok(links.every(link => link.textContent === 'Ver en Ayuda' && link.getAttribute('href').startsWith('/ayuda')));
  // An example fills the message box to try it, and the guide closes.
  const tryLeads = [...section.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === 'Probar: Revisa mis leads');
  assert.ok(tryLeads);
  tryLeads.click();
  await settle();
  assert.deepEqual([...window.__suggested], ['Revisa mis leads: cuántos tienen correo, cuántos ya contacté y qué me conviene hacer con cada grupo.']);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  console.log('PASS: the Cowork home opens the guide on demand with the seven groups, examples that fill the message box and links to the help center.');
} finally { window.close(); }
