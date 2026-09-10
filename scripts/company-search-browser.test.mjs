import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(pathToFileURL(path.join(process.env.LOCALAPPDATA, 'Temp/opencode/campaign-browser/node_modules/playwright/index.mjs')).href);

test('company windows preserve scope, retry first page, expand filtered pages and recover checkpoints', async () => {
  const mocks = {
    'next/image': `import React from 'react'; export default function Image({unoptimized,...props}) {return <img {...props}/>}`,
    '@/lib/supabase-service': `export const supabaseService={getLeads:async()=>[],addLeadsDedup:async()=>({addedCount:1,duplicateCount:0})};`,
    '@/lib/services/enriched-leads-service': `export const enrichedLeadsStorage={get:async()=>[],addDedup:async()=>({addedCount:1,duplicateCount:0})};`,
    '@/lib/services/contacted-leads-service': `export const contactedLeadsStorage={get:async()=>[]};`,
    '@/lib/services/saved-searches-service': `export class DuplicateSavedSearchNameError extends Error {} export const savedSearchesService={getSavedSearches:async()=>[]};`,
    '@/lib/services/organization-service': `export const organizationService={subscribeToCurrentOrganizationChanges:()=>()=>{}};`,
  };
  const output = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from './src/app/(app)/search/page'; createRoot(document.getElementById('root')).render(<Page/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
    plugins: [{ name: 'isolated-data', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: mocks[args.path] }));
    } }],
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const calls = [];
    let snapshot = null;
    let revision = 0;
    let firstFailure = true;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' });
      if (url.pathname === '/api/leads/search/checkpoint') {
        if (route.request().method() === 'PUT') { snapshot = route.request().postDataJSON().snapshot; revision++; }
        return route.fulfill({ json: { snapshot, revision, scope: 'org:user' } });
      }
      if (url.pathname === '/api/leads/search') {
        const body = route.request().postDataJSON(); calls.push(body);
        if (body.search_mode === 'companies') return route.fulfill({ json: { count: 1, organizations: [{ id: 'org-3', name: 'Empresa Tres', primary_domain: 'three.example.test' }], page: 1, total_pages: 1 } });
        if (firstFailure) { firstFailure = false; return route.fulfill({ status: 503, json: { error: 'Temporary error' } }); }
        const leads = body.page === 1 ? [{ id: 'lead-1', first_name: 'Ana', title: 'Directora' }] : body.page === 2 ? [] : [{ id: 'lead-2', first_name: 'Luis', title: 'Director' }];
        return route.fulfill({ json: { count: leads.length, leads, organization_id: 'org-3', page: body.page, per_page: 50, raw_count: 50, total_entries: 150 } });
      }
      return route.abort();
    });
    await page.goto('http://company.test/');
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.waitForTimeout(500);
    assert.deepEqual(errors, []);
    await page.getByLabel('Sede de la empresa', { exact: true }).fill('Chile');
    assert.equal(await page.getByLabel('Leads por empresa', { exact: true }).inputValue(), '50');
    await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Seleccionar Empresa Tres' }).check();
    await page.getByRole('button', { name: 'Buscar contactos (1)' }).click();
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.getByText('Ana', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Expandir · hasta 50 más' }).click();
    await page.getByText('Esta página no añadió contactos nuevos. Puedes seguir expandiendo.').waitFor();
    await page.getByRole('button', { name: 'Expandir · hasta 50 más' }).click();
    await page.getByText('Luis', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Expandir · hasta 50 más' }).isDisabled(), true);
    assert.deepEqual(calls.filter(call => call.search_mode === 'company_people').map(call => call.page), [1, 1, 2, 3]);
    assert.ok(calls.filter(call => call.search_mode === 'company_people').every(call => call.organization_id === 'org-3'));
    await page.waitForTimeout(700);
    assert.equal(snapshot.companyWindows['org-3'].page, 3);
    const countBeforeReload = calls.length;
    await page.reload();
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.getByText('Luis', { exact: true }).waitFor();
    await page.getByText('Ana', { exact: true }).waitFor();
    assert.equal(calls.length, countBeforeReload, 'recovery must not request Apollo again');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
