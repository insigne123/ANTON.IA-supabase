// «Perfil», rendered: the website comes from the work email, «Leer mi sitio» proposes every field with its source, the
// review keeps current content unless checked, applying fills the form without saving, and «Guardar cambios» writes the new
// fields. Also: an unreachable site says what to do. Isolated: esbuild bundles the real page with the profile service, the
// auth context and the password form stubbed; DOM via jsdom; fetch is stubbed. Not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const sources = {
  '@/lib/services/profile-service': `export const profileService = {
    getProfile: async () => globalThis.__profile.stored,
    updateProfile: async (update) => { globalThis.__profile.updates.push(update); return { ...globalThis.__profile.stored, ...update }; },
  };`,
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'u1', email: 'ana@grupoexpro.com' } });`,
  '@/components/profile/password-change-form': `export function PasswordChangeForm() { return null; }`,
};
const externals = new RegExp(`^(${Object.keys(sources).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import ProfilePage from './src/app/(app)/profile/page';
      import { Toaster } from './src/components/ui/toaster';
      window.mount = () => { const root = createRoot(document.getElementById('root')); root.render(<><ProfilePage /><Toaster /></>); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: externals }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});

const AUTOFILL = {
  companyName: 'GrupoExpro', sector: 'Outsourcing de recursos humanos', website: 'https://grupoexpro.com', domain: 'grupoexpro.com',
  description: 'Servicios de RR. HH. y externalización para empresas en Chile.',
  services: ['Servicios transitorios: personal temporal para peaks', 'Outsourcing (BPO): procesos de apoyo'],
  valueProposition: 'Ayuda a cubrir peaks con personal listo y procesos externalizados.',
  painPoints: ['Rotación alta en temporada'], differentiators: ['Cobertura nacional'], proofPoints: [], referenceClients: [],
  targetIndustries: ['Retail', 'Logística'], targetRoles: ['Gerente de Personas', 'Jefe de Operaciones'], targetCompanySize: '', targetLocations: ['Chile'],
  sources: { services: [{ url: 'https://grupoexpro.com/portfolio/servicios-transitorios/', title: 'Servicios transitorios' }] },
  pagesRead: [{ url: 'https://grupoexpro.com/chile/', title: 'GrupoExpro' }, { url: 'https://grupoexpro.com/portfolio/servicios-transitorios/', title: 'Servicios transitorios' }],
  emptyReason: null, websiteFrom: 'input',
};

const rate = (part, whole) => ({ pct: Math.round((part / whole) * 1000) / 10, low: 1, high: 60 });
const group = (value, sent, replied, positive) => ({ value, sent, replied, positive, replyRate: rate(replied, sent), positiveRate: rate(positive, sent) });
const ICP = {
  totals: { people: 12, replied: 3, positive: 2, meetings: 0, firstSend: '2026-07-01', lastSend: '2026-09-30',
    replyRate: rate(3, 12), positiveRate: rate(2, 12), confidence: 'muestra chica: no concluyas' },
  segments: {
    area: { groups: [group('Personas y RR. HH.', 8, 2, 2), group('Operaciones', 4, 1, 0)], otherGroups: 0, otherSent: 0 },
    level: { groups: [group('Gerencia', 12, 3, 2)], otherGroups: 0, otherSent: 0 },
    industry: { groups: [group('Minería', 5, 2, 2), group('Retail', 7, 1, 0)], otherGroups: 0, otherSent: 0 },
    location: { groups: [group('Santiago', 12, 3, 2)], otherGroups: 0, otherSent: 0 },
  },
  coverage: null, gaps: ['Hay 12 personas con envíos registrados: muy pocas para concluir qué segmento responde mejor.'],
  method: 'Cuenta a cada persona contactada una vez.',
};

async function open(respond) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/profile', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.process = { env: { NODE_ENV: 'test' } };
  window.matchMedia = (media) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  globalThis.__profile = { stored: { full_name: 'Ana Pérez', job_title: '', company_name: '', company_domain: '', signatures: { gmail: { html: '<p>Firma</p>' } } }, updates: [] };
  window.__profile = globalThis.__profile;
  const calls = [];
  const icpCalls = [];
  window.fetch = async (url, options = {}) => {
    // «Lo que dicen tus resultados» loads on its own: answered apart so the profile calls keep their order.
    if (String(url) === '/api/icp') { icpCalls.push(String(url)); return ok(ICP); }
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return respond(calls.length);
  };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.mount();
  const doc = window.document;
  const text = () => doc.body.textContent;
  const button = (label) => [...doc.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));
  const field = (id) => doc.getElementById(id);
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out: ${label}`);
  };
  return { window, doc, text, button, field, waitFor, calls, icpCalls, close: () => { unmount(); window.close(); } };
}

const ok = (data) => ({ ok: true, status: 200, json: async () => data });

// 1. A new member: the site comes from the work email, the AI proposes, the person reviews, applies and saves.
{
  const app = await open(() => ok(AUTOFILL));
  try {
    await app.waitFor(() => app.text().includes('Tu perfil:') && app.field('ai-website').value, 'the page');
    assert.equal(app.field('ai-website').value, 'grupoexpro.com');
    assert.match(app.text(), /Lo tomamos de tu correo corporativo/);
    assert.match(app.text(), /la IA no puede redactar tus correos/, 'what blocks drafting is said first');
    assert.match(app.text(), /Tu perfil: 0 de 10/);
    await app.waitFor(() => app.text().includes('personas contactadas'), 'the results panel');
    assert.match(app.text(), /12 personas contactadas entre el 1 jul y el 30 sept: 3 respondieron \(25 %, entre 1 % y 60 %\) y 2 con interés/);
    assert.match(app.text(), /Muestra chica/);
    assert.equal(app.icpCalls.length, 1);

    app.button('Leer mi sitio').click();
    await app.waitFor(() => app.text().includes('Revisa lo que encontramos'), 'the review');
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0])), { url: '/api/ai/company-profile', body: { website: 'grupoexpro.com' } });
    const dialog = app.doc.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /EmpresaNombre de la empresa/);
    assert.match(dialog.textContent, /Fuente:grupoexpro\.com\/portfolio\/servicios-transitor…/, 'the page behind the services, shortened');
    assert.equal(dialog.querySelector('a[href="https://grupoexpro.com/portfolio/servicios-transitorios/"]')?.getAttribute('target'), '_blank');
    assert.match(dialog.textContent, /Sugerencia de la IA según tu oferta/, 'inferred buyers are marked as a suggestion');
    assert.match(dialog.textContent, /Leímos 2 fuentes/);

    // Keep the suggested roles out, apply the rest.
    app.doc.getElementById('suggestion-targetRoles').click();
    await app.waitFor(() => app.doc.getElementById('suggestion-targetRoles').getAttribute('data-state') === 'unchecked', 'unchecked');
    app.button('Usar').click();
    await app.waitFor(() => !app.doc.querySelector('[role="dialog"]'), 'closed');
    assert.equal(app.field('services').value, 'Servicios transitorios: personal temporal para peaks\nOutsourcing (BPO): procesos de apoyo');
    assert.equal(app.field('targetIndustries').value, 'Retail, Logística');
    assert.equal(app.field('targetRoles').value, '', 'an unchecked field stays as it was');
    assert.match(app.text(), /Cambios sin guardar/);
    assert.equal(globalThis.__profile.updates.length, 0, 'nothing is saved before «Guardar cambios»');

    app.button('Guardar cambios').click();
    await app.waitFor(() => globalThis.__profile.updates.length === 1, 'saved');
    // Objects built inside the page's realm: compare their JSON, not their prototypes.
    const saved = JSON.parse(JSON.stringify(globalThis.__profile.updates[0]));
    assert.equal(saved.company_domain, 'grupoexpro.com');
    assert.deepEqual(saved.signatures.gmail, { html: '<p>Firma</p>' }, 'the email signature is kept');
    assert.deepEqual(saved.signatures.profile_extended.painPoints, ['Rotación alta en temporada']);
    assert.deepEqual(saved.signatures.profile_extended.targetIndustries, ['Retail', 'Logística']);
    assert.equal('targetRoles' in saved.signatures.profile_extended, false);
    await app.waitFor(() => app.text().includes('Perfil guardado'), 'the toast');
  } finally { app.close(); }
}

// 2. «Sumar» an industry that answered: it joins the form, unsaved.
{
  const app = await open(() => ok(AUTOFILL));
  try {
    await app.waitFor(() => app.text().includes('personas contactadas'), 'the results panel');
    app.button('Industria').click();
    await app.waitFor(() => app.text().includes('Minería'), 'by industry');
    const add = app.doc.querySelector('button[aria-label="Sumar Minería a las industrias de tu cliente ideal"]');
    assert.ok(add, 'an industry with positive answers can be added');
    assert.equal(app.doc.querySelector('button[aria-label="Sumar Retail a las industrias de tu cliente ideal"]'), null, 'one without positive answers cannot');
    add.click();
    await app.waitFor(() => app.field('targetIndustries').value === 'Minería', 'added');
    assert.match(app.text(), /En tu perfil/);
    assert.match(app.text(), /Cambios sin guardar/);
    assert.equal(globalThis.__profile.updates.length, 0, 'nothing is saved before «Guardar cambios»');
  } finally { app.close(); }
}

// 3. An unreachable site: no dialog, and the card says what to do.
{
  const app = await open(() => ok({ ...AUTOFILL, emptyReason: 'site_unreachable', services: [], pagesRead: [], sources: {} }));
  try {
    await app.waitFor(() => app.text().includes('Tu perfil:') && app.field('ai-website').value, 'the page');
    app.button('Leer mi sitio').click();
    await app.waitFor(() => app.text().includes('No pudimos abrir grupoexpro.com'), 'the explanation');
    assert.match(app.text(), /escribe el nombre de tu empresa/);
    assert.equal(app.doc.querySelector('[role="dialog"]'), null);
  } finally { app.close(); }
}

console.log('PASS: Perfil reads the site from the work email, proposes with sources, applies only what was checked and saves the new fields. DOM only, not visual certification.');
