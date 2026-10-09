// Rendered acceptance of changed components and deterministic deliverables. Fixture API only, no app credentials.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outputDir = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const pilots = process.argv.find(arg => arg.startsWith('--pilots='))?.slice(9);
if (!outputDir || !pilots || !process.env.AXE_MODULE) throw new Error('Explicit --output, --pilots, PLAYWRIGHT_MODULE and AXE_MODULE required');
mkdirSync(outputDir, { recursive: true });
const axe = readFileSync(require.resolve(process.env.AXE_MODULE), 'utf8');
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/app/globals.css', '-o', path.join(outputDir, 'styles.css')]);
const css = readFileSync(path.join(outputDir, 'styles.css'), 'utf8') + readFileSync('src/styles/design-tokens.css', 'utf8') + readFileSync('src/styles/cowork.css', 'utf8');
const built = await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {BlockCard,CoworkBlockView} from './src/components/cowork/CoworkBlocks';import {CoworkComposer} from './src/components/cowork/CoworkComposer';
const id='00000000-0000-4000-8000-000000000001:block:0';const block={type:'email_draft',title:'Correo para Ana',to:['Ana'],subject:'Consulta de selección',body:'Hola Ana,\\n\\n¿Quién revisa los antecedentes en tu equipo?\\n\\nNicolás'};
const artifact={kind:'block',id,runId:id.split(':')[0],title:block.title,block,createdAt:'2026-10-09T00:00:00Z'};
function App(){const[value,setValue]=useState('');return <main className="mx-auto max-w-3xl space-y-6 p-4"><h1 className="text-2xl font-semibold">Trabajo comercial</h1>
<BlockCard artifact={artifact} active={false} onOpen={()=>{}}/><CoworkBlockView block={block} draftKey={'cowork:draft:'+id} onSend={text=>window.used=text}/>
<CoworkComposer id="audit-message" value={value} onChange={setValue} onSubmit={()=>{}} placeholder="Continúa el trabajo" ready sending={false} submitLabel="Enviar mensaje" onStop={()=>window.stopped=true}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
  loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  for (const theme of ['light', 'dark']) for (const width of [360, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'cowork.test') return route.abort();
      if (url.pathname === '/calculator') return route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(pilots, 'calculadora.html'), 'utf8') });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es" class="${theme}"><head><title>Auditoría Cowork</title><style>${css}</style></head><body><div id="root"></div></body></html>` });
      if (url.pathname === '/api/cowork/export') return route.fulfill({ status: 503, json: { error: 'No se pudo preparar el archivo de prueba.' } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('http://cowork.test/');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } }, configurable: true }));
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Asunto', { exact: true }).fill('Asunto editado');
    await page.getByLabel('Cuerpo', { exact: true }).fill('Hola Ana,\n\nTexto editado que conservamos.\nNicolás');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.getByRole('button', { name: 'Copiar correo', exact: true }).click();
    assert.match(await page.evaluate(() => window.copied), /Asunto editado[\s\S]*Texto editado/);
    await page.getByRole('button', { name: 'Usar esta versión', exact: true }).click();
    assert.match(await page.evaluate(() => window.used), /Resultado: 00000000-0000-4000-8000-000000000001:block:0/);
    assert.match(await page.evaluate(() => window.used), /Texto editado/);
    await page.locator('#audit-message').fill('Una instrucción en espera');
    assert.equal(await page.getByRole('button', { name: 'Detener', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Detener', exact: true }).click();
    assert.equal(await page.evaluate(() => window.stopped), true);
    await page.getByRole('button', { name: 'Descargar correo', exact: true }).first().click();
    await page.getByRole('menuitem', { name: /Word/ }).click();
    await page.getByRole('alert').first().waitFor();
    assert.match(await page.getByRole('alert').first().innerText(), /Vuelve a intentar/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.addScriptTag({ content: axe });
    const accessibility = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    await page.screenshot({ path: path.join(outputDir, `workspace-${theme}-${width}.png`), fullPage: true });
    evidence.push({ surface: 'changed-components', theme, width, errors, accessibility, overflow: false, editsCopyAndUse: 'passed', stopWhileTyping: 'passed', exportError: 'passed' });
    await page.goto('http://cowork.test/calculator');
    await page.getByLabel('Personas o registros').fill('100'); await page.getByLabel('Minutos actuales por registro').fill('12');
    await page.getByLabel('Minutos estimados por registro').fill('3'); await page.getByLabel('Horas de preparación').fill('2');
    await page.getByRole('button', { name: 'Calcular esfuerzo' }).click();
    assert.match(await page.locator('#result').innerText(), /13 horas/);
    await page.getByLabel('Minutos estimados por registro').fill('15'); await page.getByRole('button', { name: 'Calcular esfuerzo' }).click();
    assert.match(await page.locator('#result').innerText(), /-7 horas/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('Personas o registros').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.getByLabel('Minutos actuales por registro').evaluate(node => node === document.activeElement), true);
    await page.addScriptTag({ content: axe });
    const miniappAxe = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    await page.screenshot({ path: path.join(outputDir, `calculator-${theme}-${width}.png`), fullPage: true });
    evidence.push({ surface: 'calculator', theme, width, accessibility: miniappAxe, formulaCases: 'passed', keyboard: 'passed', overflow: false });
    await page.close();
  }
} finally { await browser.close(); writeFileSync(path.join(outputDir, 'evidence.json'), `${JSON.stringify({ mode: 'rendered-fixture-not-authenticated', evidence }, null, 2)}\n`); }
const violations = evidence.flatMap(item => item.accessibility);
console.log(JSON.stringify({ renders: evidence.length, axeViolations: violations.length, errors: evidence.flatMap(item => item.errors || []).length, outputDir }));
if (violations.length) process.exitCode = 1;
