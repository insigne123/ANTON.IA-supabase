// Lead search guidance, rendered: a LinkedIn profile problem shows its own title, sentence and buttons (and each button calls
// its action), the starting points fill the filters with one tap, and an empty search offers to drop one filter. Isolated DOM
// test of the components the search page renders; it does not cover the page's network flow.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { ProfileSearchProblemAlert } from './src/components/search/ProfileSearchProblemAlert';
      import { SearchStarters, FilterRelaxHint } from './src/components/search/SearchGuidance';
      import { profileSearchMessage } from './src/lib/search/profile-search-outcome';
      import { searchStartersFor, activeFilterChips, idealCustomerStarter } from './src/lib/search/search-guidance';
      import { DEFAULT_LEAD_SEARCH_FILTERS } from './src/lib/search/saved-search-criteria';
      window.__render = (kind, arg) => {
        const root = createRoot(document.getElementById('root'));
        const calls = [];
        flushSync(() => {
          if (kind === 'problem') root.render(<ProfileSearchProblemAlert message={profileSearchMessage(arg.problem, { url: arg.url })} onAction={(a) => calls.push(a)} onDismiss={() => calls.push('dismiss')} />);
          if (kind === 'starters') root.render(<SearchStarters starters={searchStartersFor(arg)} onPick={(s) => calls.push(s.id)} />);
          if (kind === 'ideal') root.render(<SearchStarters starters={[idealCustomerStarter(arg), ...searchStartersFor('Acme')].filter(Boolean).slice(0, 4)} onPick={(s) => calls.push(s.id)} missingIdealCustomer={!idealCustomerStarter(arg)} />);
          if (kind === 'relax') root.render(<FilterRelaxHint chips={activeFilterChips({ ...DEFAULT_LEAD_SEARCH_FILTERS, ...arg })} onRemove={(c) => calls.push(c.field)} />);
        });
        return { calls, unmount: () => root.unmount() };
      };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/search', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.process = { env: { NODE_ENV: 'test' } }; // next/link reads process.env in the browser bundle
window.eval(bundle.outputFiles[0].text);
const doc = window.document;
const buttons = () => [...doc.querySelectorAll('button')].map((button) => button.textContent.trim());
const click = (label) => [...doc.querySelectorAll('button')].find((button) => button.textContent.includes(label)).click();

try {
  // A profile the provider does not have: a clear title, who to look for next, and «Buscar en Empresa» first.
  let view = window.__render('problem', { problem: 'not_found', url: 'https://www.linkedin.com/in/maria-jose-perez' });
  const alert = doc.querySelector('[role="alert"]');
  assert.equal(alert.dataset.problem, 'not_found');
  assert.match(alert.textContent, /Nuestro proveedor no tiene este perfil/);
  assert.match(alert.textContent, /Busca a Maria Jose Perez/);
  assert.deepEqual(buttons(), ['Buscar en «Empresa»', 'Corregir la dirección', 'Ocultar aviso']);
  click('Buscar en «Empresa»');
  click('Ocultar aviso');
  assert.deepEqual([...view.calls], ['search_company', 'dismiss']);
  view.unmount();

  // A provider outage never blames the URL or the filters: one button, retry.
  view = window.__render('problem', { problem: 'provider_unavailable' });
  assert.match(doc.body.textContent, /El proveedor de datos no respondió/);
  assert.doesNotMatch(doc.body.textContent, /filtros|no es válida/);
  assert.deepEqual(buttons(), ['Reintentar', 'Ocultar aviso']);
  view.unmount();

  // A Sales Navigator link says how to get the right address.
  view = window.__render('problem', { problem: 'sales_navigator_url' });
  assert.match(doc.body.textContent, /Sales Navigator[\s\S]*linkedin\.com\/in\//);
  view.unmount();

  // GrupoExpro sees its four services; a tap returns that starting point.
  view = window.__render('starters', 'GrupoExpro');
  assert.deepEqual(buttons(), ['Servicios transitoriosRR. HH. y operaciones de empresas con temporadas altas y reemplazos.',
    'Outsourcing y BPOOperaciones, logística y servicio al cliente que pueden externalizar procesos.',
    'Reclutamiento y selecciónQuienes contratan perfiles difíciles o en volumen.',
    'ExproPay (nómina)Finanzas y remuneraciones de empresas de 100 a 500 personas.']);
  click('ExproPay');
  assert.deepEqual([...view.calls], ['expro-pay']);
  view.unmount();

  view = window.__render('starters', 'PSOL');
  assert.equal(doc.querySelectorAll('button').length, 3);
  assert.match(doc.body.textContent, /Evaluaciones psicolaborales/);
  view.unmount();

  // «Tu cliente ideal» from «Perfil» comes first; without it, the starters say where to define it.
  view = window.__render('ideal', { targetRoles: 'Gerente de Personas, Jefe de Operaciones', targetIndustries: 'Retail' });
  assert.match(buttons()[0], /^Tu cliente idealDesde tu perfil: Gerente de Personas y Jefe de Operaciones en Retail\.$/);
  assert.doesNotMatch(doc.body.textContent, /Define tu cliente ideal/);
  click('Tu cliente ideal');
  assert.deepEqual([...view.calls], ['profile-ideal-customer']);
  view.unmount();
  view = window.__render('ideal', {});
  assert.match(doc.body.textContent, /Define tu cliente ideal en Perfil/);
  assert.equal(doc.querySelector('a[href="/profile"]')?.textContent, 'Perfil');
  view.unmount();

  // Nothing found: the filters to drop, each one a button.
  view = window.__render('relax', { title: 'Gerente de RR. HH.', sizeRange: '201-500' });
  assert.deepEqual([...doc.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    ['Quitar Tamaño: 201-500', 'Quitar Cargo: Gerente de RR. HH.']);
  click('Tamaño');
  assert.deepEqual([...view.calls], ['sizeRange']);
  view.unmount();

  console.log('PASS: profile search problems with their buttons, organization starting points and filter relax hints. DOM only, not visual certification.');
} finally {
  window.close();
}
