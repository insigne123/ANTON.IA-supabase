// Real login, AuthProvider and Supabase cookie storage; only Auth HTTP responses are simulated.
// A stale client-router decision must not keep an authenticated person on /login.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const AUTH_ORIGIN = 'https://login-fixture.supabase.test';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const user = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'persona@example.test',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z',
};
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const jwt = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: USER_ID, aud: 'authenticated', role: 'authenticated', email: user.email, exp: expiresAt },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture-signature';
const session = { access_token: jwt, refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user };

const mocks = {
  'next/navigation': `
    export const useSearchParams = () => new URLSearchParams(location.search);
    // Model a cached unauthenticated route: a soft push leaves the old login screen in place.
    export const useRouter = () => ({ push: path => window.staleRouterCalls.push(path) });`,
  'next/link': `import React from 'react'; export default function Link(props) { return <a {...props}/>; }`,
  'next/image': `import React from 'react'; export default function Image({fill,priority,unoptimized,...props}) { return <img {...props}/>; }`,
};
const output = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AuthProvider} from './src/context/AuthContext'; import Page from './src/app/login/page';
      createRoot(document.getElementById('root')).render(<AuthProvider><Page/></AuthProvider>);`,
    loader: 'tsx', resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"test"',
    'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(AUTH_ORIGIN),
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"fixture-public-key"',
    'process.env': '{}',
  },
  plugins: [{ name: 'stale-router', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: mocks[args.path] }));
  } }],
});
const requests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(output.outputFiles[0].text);
    return;
  }
  const hasSessionCookie = /sb-login-fixture-auth-token(?:\.\d+)?=/.test(request.headers.cookie || '');
  requests.push({ path: url.pathname + url.search, hasSessionCookie });
  if (url.pathname === '/api/organizations') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ activeOrganizationId: 'fixture-org', organizations: [{ id: 'fixture-org', name: 'Demo', role: 'member', memberCount: 1 }] }));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/login') {
    response.end('<!doctype html><html lang="es"><body><div id="root"></div><script>window.staleRouterCalls=[];</script><script src="/bundle.js"></script></body></html>');
    return;
  }
  if (['/dashboard', '/search'].includes(url.pathname)) {
    response.statusCode = hasSessionCookie ? 200 : 401;
    response.end(`<html lang="es"><body><h1>${hasSessionCookie ? 'Sesión recibida' : 'Sin sesión'}</h1></body></html>`);
    return;
  }
  response.statusCode = 404;
  response.end();
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const scenarios = [
    { width: 390, scheme: 'light', next: null, destination: '/dashboard' },
    { width: 390, scheme: 'dark', next: '/search?status=pending', destination: '/search?status=pending' },
    { width: 1440, scheme: 'light', next: '//external.example.test', destination: '/dashboard' },
    { width: 1440, scheme: 'dark', next: '/search', destination: '/search' },
  ];
  for (const scenario of scenarios) {
    requests.length = 0;
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 }, colorScheme: scenario.scheme });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let releaseLogin;
      let validAttempts = 0;
      await context.route(`${AUTH_ORIGIN}/**`, async route => {
        const url = new URL(route.request().url());
        if (url.pathname !== '/auth/v1/token' || url.searchParams.get('grant_type') !== 'password') {
          return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } });
        }
        const credentials = route.request().postDataJSON();
        if (credentials.password === 'incorrect-fixture') {
          return route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } });
        }
        assert.equal(credentials.email, user.email);
        assert.equal(credentials.password, 'valid-fixture-only');
        validAttempts += 1;
        await new Promise(resolve => { releaseLogin = resolve; });
        return route.fulfill({ json: session });
      });
      const loginUrl = `${origin}/login${scenario.next ? `?next=${encodeURIComponent(scenario.next)}` : ''}`;
      await page.goto(loginUrl);
      await page.getByLabel('Correo', { exact: true }).fill(user.email);
      await page.getByLabel('Contraseña', { exact: true }).fill('incorrect-fixture');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.getByRole('alert').getByText('El correo o la contraseña no coinciden.').waitFor();
      assert.equal(page.url(), loginUrl, 'invalid credentials must not navigate');
      assert.equal(requests.some(request => ['/dashboard', '/search'].includes(request.path.split('?')[0])), false);

      await page.getByLabel('Contraseña', { exact: true }).fill('valid-fixture-only');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled);
      assert.equal(page.url(), loginUrl, 'wait for authentication before navigating');
      for (let i = 0; !releaseLogin && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseLogin, 'authentication request was sent');
      assert.deepEqual(await page.evaluate(() => window.staleRouterCalls), []);
      releaseLogin();

      await page.waitForURL(`${origin}${scenario.destination}`, { timeout: 8000 });
      await page.getByRole('heading', { name: 'Sesión recibida' }).waitFor();
      assert.equal(validAttempts, 1, 'one successful submit is sufficient');
      assert.equal(requests.filter(request => request.path.startsWith('/login')).length, 1, 'no manual login reload');
      assert.ok(requests.some(request => request.path === scenario.destination && request.hasSessionCookie), 'the fresh destination request includes the persisted session');
      assert.deepEqual(errors, []);
      console.log(`PASS ${scenario.width}/${scenario.scheme}: wrong credentials stay put, pending login waits, successful login reaches ${scenario.destination} with cookies on the first attempt.`);
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
