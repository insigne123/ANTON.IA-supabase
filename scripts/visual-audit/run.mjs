#!/usr/bin/env node
// Visual audit of every page, signed in, against a local stand-in for Supabase. See README.md in this folder.
//
//   npm run audit:visual -- [--routes=/search,/crm] [--persona=owner,member,anon] [--dataset=full,empty]
//                           [--widths=390,1440] [--schemes=light,dark] [--baseline=.visual-audit/<run>] [--skip-build]
//                           [--concurrency=3] [--out=.visual-audit/<name>]
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_LISTEN_URL, APP_PORT, APP_URL, DIST_DIR, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from './env.mjs';
import { startFakeSupabase } from './fake-supabase/server.mjs';
import { authCookie } from './fake-supabase/session.mjs';
import { buildDatasets } from './fixtures/index.mjs';
import { routeList, planVisits } from './routes.mjs';
import { installPolicy, installRealtime } from './api-policy.mjs';
import { axeAvailable, axeViolations, horizontalOverflow, screenshot, settle, trackRequests } from './checks.mjs';
import { writeReports } from './report.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const list = (value, fallback) => (typeof value === 'string' && value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback);
const options = {
  routes: list(args.routes, null),
  personas: list(args.persona, ['owner', 'member', 'anon']),
  datasets: list(args.dataset, ['full', 'empty']),
  widths: list(args.widths, ['390', '1440']).map(Number),
  schemes: list(args.schemes, ['light', 'dark']),
  baseline: typeof args.baseline === 'string' ? path.resolve(ROOT, args.baseline) : null,
  skipBuild: Boolean(args['skip-build']),
  concurrency: Math.max(1, Math.min(6, Number(args.concurrency) || 3)),
};
const BASE_HEIGHT = width => (width < 768 ? 844 : 900);
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : path.join('.visual-audit', stamp));
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
const log = message => process.stdout.write(`[audit] ${message}\n`);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean);
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm missing */ }
  for (const candidate of candidates) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  throw new Error('No encontré Playwright. Instálalo globalmente (npm i -g playwright) o indica su ruta en PLAYWRIGHT_MODULE.');
}

/** A build is reused while HEAD, the working tree (outside this folder, docs and tests) and the public variables are unchanged. */
function buildFingerprint(env) {
  const diff = git('diff', 'HEAD', '--', '.', ':(exclude)scripts/visual-audit', ':(exclude)docs', ':(exclude)__tests__');
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'src', 'public');
  // Public variables are inlined at build time, so a change in them needs a new build too.
  const inlined = JSON.stringify(Object.entries(env).filter(([name]) => name.startsWith('NEXT_PUBLIC_')).sort());
  return createHash('sha256').update(`${git('rev-parse', 'HEAD')}\n${diff}\n${untracked}\n${inlined}`).digest('hex');
}

function run(command, commandArgs, { env, logFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(logFile);
    child.stdout.pipe(out); child.stderr.pipe(out);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} terminó con código ${code}. Revisa ${logFile}`))));
  });
}

async function waitForApp(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(`${APP_LISTEN_URL}/login`, { redirect: 'manual' }); if (response.status < 500) return; } catch { /* not yet */ }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('La app no respondió en 90 s.');
}

const slug = value => value.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inicio';
const pathOf = url => { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return url; } };
const normalize = text => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}/gi, '<id>').replace(/\d{2,}/g, '<n>');

let realtimeMocked = false;

async function visitPage(browser, visit, data) {
  const { persona, dataset, route } = visit;
  const result = { persona, dataset, path: route.path, name: route.name, gate: route.gate || null, status: null, finalPath: null, findings: [], shots: [] };
  const add = (type, key, detail, where = {}) => result.findings.push({ type, key: normalize(String(key)).slice(0, 160), detail: String(detail).slice(0, 600), ...where });
  for (const width of options.widths) {
    const baseHeight = BASE_HEIGHT(width);
    const context = await browser.newContext({ viewport: { width, height: baseHeight }, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce', colorScheme: options.schemes[0], deviceScaleFactor: 1 });
    const records = [];
    try {
      if (persona !== 'anon') await context.addCookies([authCookie(data.personas[persona === 'owner' ? data.ctx.OWNER : data.ctx.MEMBER], { appUrl: APP_URL })]);
      await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: record => records.push(record) });
      realtimeMocked = await installRealtime(context);
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const serverErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error?.message || error).split('\n')[0]));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const source = message.location()?.url || '';
        // A request the audit blocked or aborted is already reported as such, and the page's own status is checked apart.
        if (records.some(record => record.blocked && record.url === source)) return;
        if (source && pathOf(source) === route.path && message.text().startsWith('Failed to load resource')) return;
        const text = message.text().split('\n')[0];
        consoleErrors.push(text.startsWith('Failed to load resource') && source ? `${text} · ${pathOf(source)}` : text);
      });
      page.on('response', response => { if (response.status() >= 500 && !(response.status() === 503 && records.some(record => record.blocked && record.url === response.url()))) serverErrors.push(`${response.status()} ${response.request().method()} ${pathOf(response.url())}`); });
      const tracker = trackRequests(page);
      let response = null;
      try { response = await page.goto(`${APP_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
      catch (error) { add('pageError', 'navigation', `No cargó: ${error.message.split('\n')[0]}`, { width }); }
      result.status = response?.status() ?? result.status;
      result.finalPath = new URL(page.url()).pathname;
      const settled = await settle(page, tracker);
      if (!settled.settled) add('unsettled', 'settle', `Seguía cargando después de ${Math.round(settled.ms / 1000)} s. Pendiente: ${[...settled.pending, ...settled.busy].join(', ') || '—'}`, { width });
      for (const [index, scheme] of options.schemes.entries()) {
        if (index > 0 || scheme !== options.schemes[0]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(300); }
        const where = { width, scheme };
        const overflow = await horizontalOverflow(page).catch(() => ({ overflow: 0, offenders: [] }));
        if (overflow.overflow > 1) add('overflow', 'overflow', `${overflow.overflow}px de más. ${overflow.offenders.map(item => item.selector).join(' | ')}`, where);
        const violations = await axeViolations(page).catch(error => [{ id: 'axe-error', impact: 'serious', help: error.message.split('\n')[0], count: 1, targets: [] }]);
        for (const violation of violations || []) add('axe', violation.id, `${violation.help} (${violation.impact}, ${violation.count}): ${violation.targets.join(' · ')}`, where);
        const file = `shots/${slug(route.path)}__${persona}-${dataset}-${width}-${scheme}.png`;
        await screenshot(page, path.join(outDir, file), { width, baseHeight }).catch(error => add('pageError', 'screenshot', `Sin captura: ${error.message.split('\n')[0]}`, where));
        result.shots.push({ file, width, scheme });
      }
      for (const message of new Set(pageErrors)) add('pageError', message, message, { width });
      for (const message of new Set(consoleErrors)) add('consoleError', message, message, { width });
      for (const message of new Set(serverErrors)) add('serverError', message, message, { width });
      for (const record of records.filter(item => item.kind === 'external')) add('external', new URL(record.url).host, `${record.method} ${record.url}`, { width });
      for (const record of records.filter(item => item.kind !== 'external')) add('writeOnLoad', `${record.method} ${new URL(record.url).pathname}`, `${record.method} ${pathOf(record.url)}${record.blocked ? ' (bloqueada)' : ''}`, { width });
    } finally {
      await context.close().catch(() => {});
    }
  }
  // De-duplicate findings repeated at both widths (errors, writes): keep one row per type and key.
  const seen = new Set();
  result.findings = result.findings.filter(finding => {
    const key = finding.scheme ? `${finding.type}|${finding.key}|${finding.width}|${finding.scheme}` : `${finding.type}|${finding.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(finding => (finding.scheme ? finding : { ...finding, width: undefined }));
  // Access: a gated page must not show its content to someone off the list; a private page must send a visitor to /login.
  const blocked = result.status === 404 || result.finalPath !== route.path;
  if (persona === 'member' && route.gate && !blocked) add('access', route.gate, `El miembro (fuera de la lista «${route.gate}») ve la página con estado ${result.status}.`);
  if (persona === 'anon' && route.area === 'app' && !(result.finalPath || '').startsWith('/login')) add('access', 'anon', `Sin sesión no redirige a /login (terminó en ${result.finalPath}).`);
  if (persona === 'owner' && !route.notFound && !route.legacy && result.status && result.status >= 400) add('status', result.status, `Respondió ${result.status}.`);
  return result;
}

async function main() {
  assertNoDotEnv();
  mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: startedAt.getTime() });
  const env = buildEnv({ ownerId: built.ctx.OWNER, ownerEmail });
  const head = git('rev-parse', '--short', 'HEAD');

  // 1. Build (or reuse) the production bundle in its own folder, with the same public flags production uses.
  const fingerprintFile = path.join(ROOT, DIST_DIR, 'audit-fingerprint');
  const fingerprint = buildFingerprint(env);
  const reusable = existsSync(fingerprintFile) && readFileSync(fingerprintFile, 'utf8') === fingerprint;
  if (options.skipBuild && !existsSync(path.join(ROOT, DIST_DIR, 'BUILD_ID'))) throw new Error(`--skip-build sin compilación previa en ${DIST_DIR}.`);
  if (!options.skipBuild && !reusable) {
    log(`Compilando en ${DIST_DIR} (unos minutos)…`);
    // The build may fetch Google Fonts, so it keeps the machine's proxy settings; the audited server never gets them.
    const network = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(https?_proxy|no_proxy|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/.test(name)));
    await run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { env: { ...env, ...network }, logFile: path.join(outDir, 'build.log') });
    writeFileSync(fingerprintFile, fingerprint);
  } else log(`Reutilizo la compilación de ${DIST_DIR}.`);

  // 2. The stand-in Supabase and the app, which can only reach loopback.
  const serverLog = [];
  let activeDataset = null;
  const supabase = await startFakeSupabase({ port: SUPABASE_PORT, datasets: built.datasets, personas: built.personas, serviceKey: SERVICE_KEY, onLog: entry => serverLog.push({ ...entry, dataset: activeDataset }) });
  const appLogFile = path.join(outDir, 'app.log');
  const appLog = createWriteStream(appLogFile);
  const egress = new Set();
  const serverErrors = new Set();
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT, env: { ...env, NODE_OPTIONS: `--require ${path.join(ROOT, 'scripts/visual-audit/egress-guard.cjs')}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const watch = stream => {
    let buffer = '';
    stream.on('data', chunk => {
      appLog.write(chunk);
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const blocked = line.match(/\[audit-egress\] blocked (\S+)/);
        if (blocked) egress.add(blocked[1]);
        else if (/error|Error|⨯/.test(line)) serverErrors.add(normalize(line.trim()).slice(0, 300));
      }
    });
  };
  watch(app.stdout); watch(app.stderr);
  const stop = async () => { app.kill('SIGTERM'); await supabase.close(); };
  process.on('SIGINT', () => { stop().finally(() => process.exit(130)); });

  try {
    await waitForApp();
    log(`App en ${APP_URL}, Supabase simulado en ${SUPABASE_URL}.`);
    const playwright = loadPlaywright();
    const browser = await playwright.chromium.launch({
      headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    });
    const routes = routeList(built.ctx).filter(route => !options.routes || options.routes.some(wanted => route.path === wanted || (wanted !== '/' && route.path.startsWith(`${wanted.replace(/\/$/, '')}/`))));
    const visits = [];
    for (const dataset of options.datasets) {
      supabase.reset(dataset);
      activeDataset = dataset;
      const planned = planVisits(routes, { personas: options.personas, datasets: [dataset] });
      log(`Datos «${dataset}»: ${planned.length} visitas × ${options.widths.length} anchos × ${options.schemes.length} temas.`);
      let next = 0;
      const worker = async () => {
        while (next < planned.length) {
          const visit = planned[next++];
          const result = await visitPage(browser, visit, built);
          visits.push(result);
          log(`${String(visits.length).padStart(3)} ${visit.persona.padEnd(6)} ${dataset.padEnd(5)} ${visit.route.path} → ${result.status ?? '—'}${result.findings.length ? ` · ${result.findings.length} hallazgos` : ''}`);
        }
      };
      await Promise.all(Array.from({ length: options.concurrency }, worker));
    }
    await browser.close();
    const order = new Map(routes.map((route, index) => [route.path, index]));
    visits.sort((a, b) => options.datasets.indexOf(a.dataset) - options.datasets.indexOf(b.dataset) || ['owner', 'member', 'anon'].indexOf(a.persona) - ['owner', 'member', 'anon'].indexOf(b.persona) || order.get(a.path) - order.get(b.path));
    const report = {
      startedAt: startedAt.toISOString(), head, durationMs: Date.now() - startedAt.getTime(),
      options: { ...options, baseline: options.baseline ? path.relative(ROOT, options.baseline) : null }, axe: axeAvailable, realtimeMocked,
      visits,
      global: {
        // Only the full dataset counts: the empty one leaves most tables out on purpose.
        unfixturedTables: [...new Set(serverLog.filter(entry => entry.kind === 'table-unfixtured' && entry.dataset === 'full').map(entry => entry.table))].sort(),
        unfixturedRpc: [...new Set(serverLog.filter(entry => entry.kind === 'rpc-unfixtured' && entry.dataset === 'full').map(entry => entry.name))].sort(),
        egress: [...egress].sort(),
        serverErrors: [...serverErrors],
      },
    };
    const { counts, diff } = writeReports(outDir, report);
    log(`Listo: ${path.relative(ROOT, outDir)}/report.md · ${Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(' · ') || 'sin hallazgos'}${diff ? ` · nuevos ${diff.added.length}, resueltos ${diff.resolved.length}` : ''}`);
  } finally {
    await stop();
  }
}

main().catch(error => { console.error(`[audit] ${error.stack || error.message}`); process.exit(1); });
