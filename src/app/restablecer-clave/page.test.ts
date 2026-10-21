import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as React from 'react';
import { authErrorMessage, newPasswordProblem, PASSWORD_MIN_LENGTH } from '@/lib/auth-messages';
import { RESET_PASSWORD_PATH, recoveryTokenHash } from '@/lib/recovery-link';

// The end of «¿Olvidaste tu contraseña?» with the auth context, the router and the server in memory: what the person sees for a link, and what spends its token.
type Auth = { session: { user: { email: string } } | null; loading: boolean; updatePassword: (password: string) => Promise<void> };

function loadPage(search: string, auth: Auth) {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync('src/app/restablecer-clave/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const h = React.createElement;
  const box = (tag: string) => ({ children, ...props }: any) => h(tag, props, children);
  const icon = () => null;
  const stubs: Record<string, unknown> = {
    'next/link': { __esModule: true, default: ({ href, children }: any) => h('a', { href }, children) },
    'next/navigation': { useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams(search) },
    'lucide-react': { AlertCircle: icon, CheckCircle2: icon, Eye: icon, EyeOff: icon, Loader2: icon },
    '@/components/logo': { __esModule: true, default: () => null },
    '@/components/ui/alert': { Alert: box('div'), AlertDescription: box('p') },
    '@/components/ui/button': { Button: ({ asChild, children, ...props }: any) => (asChild ? children : h('button', props, children)) },
    '@/components/ui/card': { Card: box('div'), CardContent: box('div'), CardDescription: box('p'), CardHeader: box('div') },
    '@/components/ui/input': { Input: (props: any) => h('input', props) },
    '@/components/ui/label': { Label: box('label') },
    '@/context/AuthContext': { useAuth: () => auth },
    '@/lib/auth-messages': { PASSWORD_MIN_LENGTH, authErrorMessage, newPasswordProblem },
    '@/lib/recovery-link': { RESET_PASSWORD_PATH, recoveryTokenHash },
  };
  const exports: any = {};
  new Function('require', 'exports', source)((name: string) => stubs[name] ?? require(name), exports);
  return exports.default as React.ComponentType;
}

async function render(search: string, auth: Auth, fetchImpl?: (url: string, init: any) => Promise<{ ok: boolean }>) {
  const navigations: string[] = [];
  const virtualConsole = new VirtualConsole();
  // jsdom cannot navigate: it reports the attempt, and that is how a test sees a hard redirect.
  virtualConsole.on('jsdomError', error => { if (/navigation/i.test(error.message)) navigations.push('navigation'); });
  const dom = new JSDOM('<div id="root"></div>', { url: `https://app.test${RESET_PASSWORD_PATH}${search}`, virtualConsole });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT, fetch: globals.fetch };
  const requests: Array<{ url: string; init: any }> = [];
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: any) => { requests.push({ url, init }); return (fetchImpl ?? (async () => ({ ok: true })))(url, init); } });
  const { createRoot } = await import('react-dom/client');
  const Page = loadPage(search, auth);
  const root = createRoot(dom.window.document.getElementById('root')!);
  await React.act(async () => root.render(React.createElement(Page)));
  const text = () => dom.window.document.body.textContent ?? '';
  const button = (label: RegExp) => [...dom.window.document.querySelectorAll('button')].find(item => label.test(item.textContent ?? ''))!;
  const done = async () => {
    await React.act(async () => root.unmount());
    Object.assign(globals, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act, fetch: previous.fetch });
  };
  return { dom, text, button, requests, navigations, done };
}

const NO_SESSION: Auth = { session: null, loading: false, updatePassword: async () => undefined };

test('a link with a token asks for a click and spends nothing by being opened', async () => {
  const page = await render('?token_hash=abc_DEF-123&type=recovery', NO_SESSION);
  try {
    assert.match(page.text(), /confirma que abriste este enlace tú/);
    assert.ok(page.button(/Continuar/), 'the click is the person\'s');
    assert.equal(page.dom.window.document.querySelector('input'), null, 'the new password comes after it');
    assert.deepEqual(page.requests, [], 'a mail filter that renders the page spends nothing');
  } finally { await page.done(); }
});

test('«Continuar» posts the token once and reloads the page without it, now with the session', async () => {
  const page = await render('?token_hash=abc_DEF-123&type=recovery', NO_SESSION);
  try {
    await React.act(async () => page.button(/Continuar/).click());
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, '/api/auth/recovery');
    assert.equal(page.requests[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(page.requests[0].init.body), { tokenHash: 'abc_DEF-123' });
    assert.deepEqual(page.navigations, ['navigation'], 'a full load: the app starts as the person the token belongs to');
  } finally { await page.done(); }
});

test('a token that no longer works says so and offers a new link', async () => {
  const page = await render('?token_hash=old&type=recovery', NO_SESSION, async () => ({ ok: false }));
  try {
    await React.act(async () => page.button(/Continuar/).click());
    assert.match(page.text(), /Este enlace ya no sirve/);
    assert.match(page.text(), /filtro de seguridad del correo/);
    assert.equal(page.dom.window.document.querySelector('a')?.getAttribute('href'), '/login?recuperar=1');
    assert.deepEqual(page.navigations, []);
  } finally { await page.done(); }
});

test('with the session the token opened, the page asks for the new password; without link or session it offers a new link', async () => {
  const signedIn = await render('', { session: { user: { email: 'manuel@example.test' } }, loading: false, updatePassword: async () => undefined });
  try {
    assert.match(signedIn.text(), /manuel@example\.test/);
    assert.ok(signedIn.button(/Guardar contraseña/));
    assert.deepEqual(signedIn.requests, []);
  } finally { await signedIn.done(); }
  const stranger = await render('', NO_SESSION);
  try {
    assert.match(stranger.text(), /Este enlace ya no sirve/);
    assert.equal(stranger.button(/Continuar/), undefined);
  } finally { await stranger.done(); }
  const notRecovery = await render('?token_hash=abc&type=signup', NO_SESSION);
  try {
    assert.match(notRecovery.text(), /Este enlace ya no sirve/, 'a token of another kind of link is not offered a click');
  } finally { await notRecovery.done(); }
});
