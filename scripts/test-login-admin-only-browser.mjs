// Real login form, simulated Auth calls. No real accounts, credentials or email requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mocks = {
  'next/navigation': `export const useSearchParams=()=>new URLSearchParams(location.search);`,
  'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>}`,
  'next/image': `import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}`,
  '@/context/AuthContext': `export const useAuth=()=>({
    signInWithPassword:(email,password)=>{window.loginCalls.push({email,password});return new Promise((resolve,reject)=>{window.finishLogin=resolve;window.rejectLogin=reject;});},
    signInWithGoogle:async path=>{window.googleDestination=path;},
    requestPasswordReset:async email=>{window.resetCalls.push(email);},
  });`,
};
const output = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/login/page';createRoot(document.getElementById('root')).render(<Page/>);`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'simulated-auth', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: mocks[args.path] }));
  } }],
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [1440, 'light'], [1440, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.loginCalls = []; window.resetCalls = []; });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><body><div id="root"></div></body></html>' });
      if (url.pathname === '/search') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="es"><body><h1>Búsqueda de leads</h1></body></html>' });
      return route.abort();
    });
    await page.goto('http://localhost:9017/login?next=%2Fsearch');
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.getByRole('heading', { name: 'Entra a tu cuenta' }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Crear cuenta' }).count(), 0);
    await page.getByLabel('Correo', { exact: true }).fill('persona@example.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
    await page.getByLabel('Correo', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByLabel('Contraseña', { exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    assert.equal(await page.getByLabel('Contraseña', { exact: true }).getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForFunction(() => window.loginCalls.length === 1);
    assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.rejectLogin({ code: 'invalid_credentials', message: 'Invalid login credentials' }));
    await page.getByRole('alert').getByText('El correo o la contraseña no coinciden.').waitFor();
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByRole('heading', { name: 'Recupera tu contraseña' }).waitFor();
    assert.equal(await page.getByLabel('Correo', { exact: true }).inputValue(), 'persona@example.test');
    await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
    await page.getByRole('status').getByText(/Si hay una cuenta con ese correo/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.resetCalls), ['persona@example.test']);
    await page.getByRole('button', { name: 'Volver a iniciar sesión' }).click();
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForFunction(() => window.loginCalls.length === 2);
    await page.evaluate(() => window.finishLogin());
    await page.waitForURL('http://localhost:9017/search');
    await page.getByRole('heading', { name: 'Búsqueda de leads' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS login ${width}/${scheme}: no registration, keyboard, loading, errors, reset and next destination.`);
    await context.close();
  }
} finally {
  await browser.close();
}
