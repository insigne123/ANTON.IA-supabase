// The app-wide motion base, rendered: each screen arrives inside a motion-safe wrapper (Cowork excluded), an empty list
// says why and offers one action, and buttons press with motion-safe classes only. Isolated DOM test; not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const nextNavigation = { name: 'next-navigation-stub', setup(b) {
  b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next-navigation', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const usePathname = () => window.__pathname;', loader: 'js' }));
} };
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import AppTemplate from './src/app/(app)/template';
    import { EmptyState } from './src/components/ui/empty-state';
    import { Button } from './src/components/ui/button';
    import { Inbox } from 'lucide-react';
    window.mount = () => { const root = createRoot(document.getElementById('root')); flushSync(() => root.render(
      <AppTemplate><main><EmptyState icon={Inbox} title="Aún no tienes contactos con correo" description="Busca su correo en «Por completar»."
        action={<Button>Ir a «Por completar»</Button>} /></main></AppTemplate>)); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [nextNavigation],
  define: { 'process.env.NODE_ENV': '"test"' },
});

function render(pathname) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
  dom.window.__pathname = pathname;
  dom.window.eval(bundle.outputFiles[0].text);
  dom.window.mount();
  return dom.window.document;
}

const doc = render('/saved/leads/enriched');
const wrapper = doc.getElementById('root').firstElementChild;
assert.equal(wrapper.tagName, 'DIV');
for (const token of wrapper.className.split(/\s+/)) assert.ok(token.startsWith('motion-safe:'), `screen motion is motion-safe only: ${token}`);
assert.match(wrapper.className, /fade-in-0/);
const heading = doc.querySelector('h2');
assert.equal(heading.textContent, 'Aún no tienes contactos con correo');
assert.equal(doc.querySelectorAll('button').length, 1, 'one action');
assert.match(doc.querySelector('button').className, /motion-safe:active:scale-\[0\.98\]/);
assert.doesNotMatch(doc.querySelector('button').className, /(^|\s)active:scale/, 'no press motion without motion-safe');
assert.equal(doc.querySelector('svg').getAttribute('aria-hidden'), 'true');

const cowork = render('/cowork');
assert.equal(cowork.getElementById('root').firstElementChild.tagName, 'MAIN', 'Cowork keeps its own motion and layout');

console.log('PASS: screens arrive with motion-safe motion (not in Cowork), empty states explain and offer one action. DOM only, not visual certification.');
