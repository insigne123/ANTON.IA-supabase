// «¿Les está sirviendo?» rendered: results against the previous period, the adoption funnel with where people stop, who needs
// help with a message to copy (never sent by the app), the CSV export, and a retry when the summary does not load. Isolated:
// esbuild bundles the section with the real pure helpers; DOM via jsdom; fetch and clipboard are stubbed. Not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { AdminValueSection } from './src/components/admin/AdminValueSection';
    import { Toaster } from './src/components/ui/toaster';
    window.mount = () => { const root = createRoot(document.getElementById('root'));
      root.render(<><AdminValueSection from="2026-09-02" to="2026-10-01" refreshToken={0} /><Toaster /></>); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});

const MEMBERS = [
  { userId: 'a', name: 'Ana Pérez', email: 'ana@empresa.cl', role: 'owner', invitedAt: null, lastSignInAt: '2026-09-30T12:00:00Z', lastActivityAt: null, mailConnected: true, profileReady: true, hasSent: true },
  { userId: 'b', name: 'Beto Soto', email: 'beto@empresa.cl', role: 'member', invitedAt: null, lastSignInAt: null, lastActivityAt: null, mailConnected: false, profileReady: false, hasSent: false },
];
const breakdown = (over = {}) => ({ real: 0, meeting: 0, positive: 0, neutral: 0, negative: 0, unsubscribe: 0, automatic: 0, bounced: 0, ...over });
const metric = (value, previous) => ({ value, previous, delta: value - previous, trend: value > previous ? 'up' : value < previous ? 'down' : 'flat' });
const VALUE = {
  organization: { id: 'org', name: 'GrupoExpro' },
  range: { from: '2026-09-02', to: '2026-10-01' }, previousRange: { from: '2026-08-03', to: '2026-09-01' },
  scope: 'organization', generatedAt: '2026-10-01T15:00:00Z',
  adoption: { members: 28, active7: 3, active30: 11, neverSignedIn: 15, profileReady: 3, funnel: [
    { id: 'invited', label: 'Invitadas', value: 28 }, { id: 'signed_in', label: 'Entraron alguna vez', value: 13 },
    { id: 'active', label: 'Activas en 30 días', value: 11 }, { id: 'mail', label: 'Con correo conectado', value: 1 },
    { id: 'first_send', label: 'Enviaron su primer correo', value: 0 }] },
  needsHelp: [{ userId: 'b', name: 'Beto Soto', email: 'beto@empresa.cl', reason: 'never_signed_in', title: 'Nunca ha entrado', detail: 'Recibió la invitación, pero aún no inicia sesión.', action: 'copy_invite' }],
  results: {
    current: { sent: 12, replies: breakdown({ real: 3, meeting: 1, positive: 1, neutral: 1, automatic: 2 }), interested: 2, pipelineMeetings: 1, savedContacts: 40, researched: 6 },
    previous: { sent: 4, replies: breakdown({ real: 1 }), interested: 0, pipelineMeetings: 1, savedContacts: 10, researched: 2 },
    comparison: { sent: metric(12, 4), replies: metric(3, 1), interested: metric(2, 0), pipelineMeetings: metric(1, 1), savedContacts: metric(40, 10), researched: metric(6, 2) },
    replyRate: 25, previousReplyRate: 25, partial: false,
  },
  people: MEMBERS,
};

async function open(respond) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example.cl/dashboard/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = (media) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.process = { env: { NODE_ENV: 'test' } };
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return respond(calls.length); };
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (text) => { copied.push(text); } }, configurable: true });
  const downloads = [];
  window.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.mount();
  const doc = window.document;
  const text = () => doc.body.textContent;
  const button = (label) => [...doc.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out: ${label}`);
  };
  return { window, doc, text, button, waitFor, calls, copied, downloads, close: () => { unmount(); window.close(); } };
}

const ok = (data) => ({ ok: true, status: 200, json: async () => data });

// 1. The summary an admin opens.
{
  const app = await open(() => ok(VALUE));
  try {
    await app.waitFor(() => app.text().includes('¿Les está sirviendo?'), 'the section');
    assert.match(app.calls[0], /\/api\/dashboard\/admin\/value\?from=2026-09-02&to=2026-10-01/);
    assert.match(app.text(), /Correos enviados12/);
    assert.match(app.text(), /\+8 vs\. período anterior \(4\)/);
    assert.match(app.text(), /Igual que el período anterior/, 'meetings did not move');
    assert.match(app.text(), /25 % de los envíos/);
    assert.match(app.text(), /No cuentan: 2 automáticas y 0 rebotes/);
    assert.match(app.text(), /Dónde se quedan: 15 personas llegan a «Invitadas» y no a «Entraron alguna vez»/);
    assert.match(app.text(), /Beto Soto · Nunca ha entrado/);

    app.button('Copiar invitación').click();
    await app.waitFor(() => app.copied.length === 1, 'the copy');
    assert.match(app.copied[0], /^Hola, Beto: te invitamos a ANTON\.IA, donde GrupoExpro .* https:\/\/app\.example\.cl\/login con tu correo beto@empresa\.cl/);
    await app.waitFor(() => app.text().includes('ANTON.IA no lo envía por ti'), 'the toast says nothing was sent');
    assert.equal(app.calls.length, 1, 'copying never calls the server');

    app.button('Exportar personas (CSV)').click();
    assert.equal(app.downloads[1], 'personas-2026-09-02-2026-10-01.csv');
  } finally { app.close(); }
}

// 2. Everyone is set up: an empty state that says so.
{
  const app = await open(() => ok({ ...VALUE, needsHelp: [] }));
  try {
    await app.waitFor(() => app.text().includes('Todos tienen lo necesario para vender'), 'the empty state');
  } finally { app.close(); }
}

// 3. The summary fails, then loads on «Reintentar».
{
  const app = await open((n) => (n === 1 ? { ok: false, status: 500, json: async () => ({ error: 'No pudimos cargar el resumen de adopción. Inténtalo de nuevo.' }) } : ok(VALUE)));
  try {
    await app.waitFor(() => app.text().includes('No pudimos cargar el resumen de adopción'), 'the error');
    assert.ok(app.doc.querySelector('[role="alert"]'));
    app.button('Reintentar').click();
    await app.waitFor(() => app.text().includes('¿Les está sirviendo?'), 'loaded after retry');
  } finally { app.close(); }
}

console.log('PASS: admin value summary renders results, adoption, help with copy-only messages, CSV export, empty and error states. DOM only, not visual certification.');
