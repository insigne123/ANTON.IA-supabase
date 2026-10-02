// Isolated approval UI: no env files, database, provider calls or invitations.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace'; createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
});

for (const theme of ['light', 'dark']) {
  const id = '00000000-0000-4000-8000-000000000001';
  const profile = 'https://www.linkedin.com/in/contacto-de-prueba-23825746';
  const dom = new JSDOM(`<html class="${theme}"><body><div id="root"></div></body></html>`, {
    url: `http://localhost/cowork?work=${id}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  let approved = false;
  let writes = 0;
  let release;
  window.fetch = async (url, options = {}) => {
    if (url === '/api/cowork/wake') return { ok: true, status: 202, json: async () => ({ woken: true }) };
    if (options.method === 'POST') {
      assert.ok(url.endsWith('/search-approval'), 'only a lookup approval is submitted, no save or invitation');
      assert.deepEqual(JSON.parse(options.body), { approve: true });
      writes++;
      await new Promise(resolve => { release = resolve; });
      approved = true;
      return { ok: true, status: 200, json: async () => ({ resolved: true }) };
    }
    const run = { id, message: `Invita por LinkedIn a la persona de ${profile}`, mode: 'approval', status: 'waiting_approval', created_at: '2026-10-02T13:24:00Z' };
    const events = [{ kind: 'approval.requested', sequence: 1, created_at: run.created_at,
      payload: { action: 'prospecting.search', criteria: { linkedinUrl: `${profile}/?trk=test`, titles: [], industries: [], locations: [], limit: 1 } } }];
    if (approved) events.push({ kind: 'search.approved', sequence: 2, created_at: run.created_at, payload: {} });
    return { ok: true, status: 200, json: async () => url.endsWith('/runs') ? { runs: [run], canSubmit: true } : { run, events } };
  };
  const waitFor = async predicate => {
    for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error(`Profile review update timed out (${theme})`);
  };
  const button = text => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
  try {
    window.eval(bundle.outputFiles[0].text);
    await waitFor(() => button('Consultar perfil'));
    assert.match(window.document.body.textContent, /Se consulta solo la persona de este perfil/);
    assert.match(window.document.body.textContent, /aproximadamente 1 crédito/);
    assert.match(window.document.body.textContent, /no se envía una invitación/);
    assert.doesNotMatch(window.document.body.textContent, /Cargos \(y parecidos\)|Ubicación de la persona/);
    const link = window.document.querySelector(`a[href="${profile}"]`);
    assert.ok(link, 'the exact canonical profile is visible before deciding');
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    assert.ok(link.className.includes('break-all') && link.className.includes('focus-visible:ring-2'));
    link.focus();
    assert.equal(window.document.activeElement, link);
    button('Consultar perfil').click();
    await waitFor(() => release && window.document.querySelector('button[disabled]'));
    assert.equal(writes, 1);
    release();
    await waitFor(() => window.document.body.textContent.includes('espera su turno'));
    assert.equal(button('Consultar perfil'), undefined);
    assert.equal(writes, 1);
  } finally { window.close(); }
}
console.log('PASS: exact profile and cost visible in both themes, keyboard link, approval-only request, loading and no repeated action.');
