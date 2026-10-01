// «De:» in compose: the real mailbox when the provider confirms it, a connect action when there is no token, and a soft warning
// when the provider does not answer. The resolver never returns a token and keeps Outlook's rotated refresh token. Isolated:
// esbuild bundles with stubbed token storage and provider calls; DOM via jsdom. Not visual certification.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// 1. The resolver.
const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient = () => ({ from: () => ({ update: (row) => { globalThis.__sender.updates.push(row); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } }) });`,
  '@/lib/services/token-service': `export const tokenService = { getToken: async (_c, _u, provider) => globalThis.__sender.tokens[provider] || null };`,
  '@/lib/server-auth-helpers': `export const refreshGoogleToken = async () => globalThis.__sender.refresh('google'); export const refreshMicrosoftToken = async () => globalThis.__sender.refresh('outlook');`,
  '@/lib/server/token-crypto': `export const encryptStoredToken = (value) => 'enc:' + value;`,
  '@/lib/server/cowork/sender-identity': `export const coworkMailboxIdentity = async (provider, token) => { if (globalThis.__sender.identityFails) throw new Error('down'); return { provider, email: provider + '@empresa.cl', identityHash: 'h' }; };`,
};
const externals = new RegExp(`^(${Object.keys(sources).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const server = await build({
  entryPoints: ['src/lib/server/mail-sender.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: externals }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', server.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { resolveMailSender } = loaded.exports;
const reset = (over = {}) => { globalThis.__sender = { tokens: {}, updates: [], identityFails: false, refresh: async () => ({ access_token: 'a' }), ...over }; };

reset();
assert.deepEqual(await resolveMailSender('u1', 'google'), { provider: 'google', state: 'not_connected' });
reset({ tokens: { google: { refresh_token: 'r' } } });
assert.deepEqual(await resolveMailSender('u1', 'google'), { provider: 'google', state: 'connected', email: 'google@empresa.cl' });
reset({ tokens: { outlook: { refresh_token: 'r' } }, refresh: async () => ({ access_token: 'a', refresh_token: 'rotated' }) });
const outlook = await resolveMailSender('u1', 'outlook');
assert.equal(outlook.email, 'outlook@empresa.cl');
assert.equal(globalThis.__sender.updates[0].refresh_token, 'enc:rotated', 'the rotated Outlook token is kept, encrypted');
reset({ tokens: { google: { refresh_token: 'r' } }, identityFails: true });
assert.deepEqual(await resolveMailSender('u1', 'google'), { provider: 'google', state: 'unverified' });
reset({ tokens: { google: { refresh_token: 'r' } }, refresh: async () => { throw new Error('invalid_grant'); } });
assert.deepEqual(await resolveMailSender('u1', 'google'), { provider: 'google', state: 'unverified' });
for (const result of [outlook]) assert.doesNotMatch(JSON.stringify(result), /refresh|access|token/i, 'no token leaves the resolver');

// 2. The line.
const ui = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
      import { SenderLine } from './src/components/compose/SenderLine';
      window.__render = (props) => { const root = createRoot(document.getElementById('root')); flushSync(() => root.render(<SenderLine {...props} />)); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/contact/compose', runScripts: 'outside-only', pretendToBeVisual: true });
dom.window.process = { env: { NODE_ENV: 'test' } };
dom.window.eval(ui.outputFiles[0].text);
const doc = dom.window.document;
const show = (props) => { const unmount = dom.window.__render(props); const text = doc.body.textContent; const links = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')); unmount(); return { text, links }; };

let view = show({ name: 'Gabriela Meneses', provider: 'gmail', sender: { state: 'connected', email: 'gmeneses@grupoexpro.com' } });
assert.match(view.text, /De:Gabriela Meneses <gmeneses@grupoexpro\.com>por Gmail/);
view = show({ name: '', provider: 'outlook', sender: { state: 'not_connected' } });
assert.match(view.text, /Outlook no está conectado/);
assert.deepEqual(view.links, ['/outlook']);
view = show({ name: 'Ana', provider: 'gmail', sender: { state: 'unverified' } });
assert.match(view.text, /No pudimos confirmarla/);
assert.deepEqual(view.links, ['/gmail']);
view = show({ name: 'Ana', provider: 'gmail', sender: { state: 'loading' } });
assert.match(view.text, /Comprobando tu cuenta de Gmail/);
dom.window.close();

console.log('PASS: compose shows the real sender, asks to connect when there is no mailbox, and never exposes tokens.');
