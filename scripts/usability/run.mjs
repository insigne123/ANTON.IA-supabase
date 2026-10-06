#!/usr/bin/env node
// Simplicity measurement (Plan 11, section 2): twelve key tasks done as a new person would, on the visual-audit bench
// (local Supabase stand-in, no network; the few calls a task needs are answered by the browser). Per task and screen it
// measures what makes an app easy: whether the task can be done at all (desktop and phone), steps against the ideal
// path, time by the Keystroke-Level Model, how many controls each screen asks to choose from, whether the next control
// is in view and named as the person would expect, one clear main action, and how much there is to read. See README.md.
//
//   npm run audit:simplicity -- [--tasks=perfil,importar] [--viewports=desktop,phone] [--skip-build] [--out=.visual-audit/<name>]
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_LISTEN_URL, APP_PORT, APP_URL, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from '../visual-audit/env.mjs';
import { startFakeSupabase } from '../visual-audit/fake-supabase/server.mjs';
import { authCookie } from '../visual-audit/fake-supabase/session.mjs';
import { buildDatasets } from '../visual-audit/fixtures/index.mjs';
import { installPolicy, installRealtime } from '../visual-audit/api-policy.mjs';
import { settle, trackRequests } from '../visual-audit/checks.mjs';
import { ensureBuild } from '../visual-audit/build.mjs';
import { TASKS } from './tasks.mjs';
import { KLM, scoreTask, summarize } from './score.mjs';
import { writeSimplicityReport } from './report.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const list = (value, fallback) => (typeof value === 'string' && value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback);
const options = {
  tasks: list(args.tasks, null),
  viewports: list(args.viewports, ['desktop', 'phone']),
  skipBuild: Boolean(args['skip-build']),
};
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : path.join('.visual-audit', `sencillez-${stamp}`));
const log = message => process.stdout.write(`[sencillez] ${message}\n`);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean);
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm missing */ }
  for (const candidate of candidates) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  throw new Error('No encontré Playwright. Instálalo globalmente (npm i -g playwright) o indica su ruta en PLAYWRIGHT_MODULE.');
}

async function waitForApp(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(`${APP_LISTEN_URL}/login`, { redirect: 'manual' }); if (response.status < 500) return; } catch { /* not yet */ }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('La app no respondió en 90 s.');
}

/** What the screen asks of the person right now: controls to choose from, main actions, and words in view. */
function readScreen(page) {
  return page.evaluate(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const inView = element => { const box = element.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth; };
    // A dialog or sheet on top is the screen; otherwise the page content.
    const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    const scope = overlays.at(-1) || document.querySelector('main#contenido') || document.body;
    const controls = [...scope.querySelectorAll('button, a[href], input:not([type="hidden"]), textarea, select, [role="tab"], [role="combobox"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"]')]
      .filter(element => visible(element) && inView(element) && !element.closest('[aria-hidden="true"]'));
    const primary = controls.filter(element => (element.tagName === 'BUTTON' || element.tagName === 'A')
      && /(^|\s)(bg-primary|bg-cw-accent)(\s|$)/.test(String(element.className)) && !element.disabled);
    // Words a person reads before acting: the text in view, without the controls' own labels counted twice.
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let words = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !visible(parent) || !inView(parent) || parent.closest('script, style, [aria-hidden="true"], .sr-only')) continue;
      words += (node.textContent.match(/[\p{L}\p{N}]+/gu) || []).length;
    }
    return { controls: controls.length, primary: primary.length, words, inDialog: overlays.length > 0 };
  });
}

/** Finds the control of a step, by what the person reads on it. */
function locate(page, target) {
  // A written name is the whole name («Investigar» is not «Por investigar»); a pattern is for names with a number.
  const exact = target.exact ?? true;
  if (target.label) return page.getByLabel(target.label, { exact }).locator('visible=true').first();
  if (target.placeholder) return page.getByPlaceholder(target.placeholder).locator('visible=true').first();
  if (target.text) return page.getByText(target.text, { exact }).locator('visible=true').first();
  const scope = target.within ? page.getByRole(target.within.role, target.within.name ? { name: target.within.name } : {}).locator('visible=true').last() : page;
  return scope.getByRole(target.role, { name: target.name, exact }).locator('visible=true').first();
}

async function hydrated(page) {
  await page.waitForFunction(() => {
    const element = (document.querySelector('main#contenido') || document.body).querySelector('button, a[href], input');
    return !element || Object.keys(element).some(key => key.startsWith('__react'));
  }, null, { timeout: 20000 }).catch(() => {});
}

async function settleAfter(page, tracker) {
  await settle(page, tracker, { quietMs: 500, timeoutMs: 10000 });
}

/** Answers one call of a task with its mock: `{ status, json }` sets the HTTP status, any other answer is a 200 body. */
async function answerMock(route, mock, calls) {
  const request = route.request();
  if (mock.method && request.method() !== mock.method) return route.fallback();
  let body = null;
  try { body = request.postDataJSON(); } catch { body = request.postData(); }
  calls.push({ url: request.url(), method: request.method(), body });
  const answer = typeof mock.respond === 'function' ? mock.respond(body, request) : mock.respond;
  if (answer?.abort) return route.abort('blockedbyclient');
  const wrapped = answer && typeof answer === 'object' && 'json' in answer;
  return route.fulfill({ status: wrapped ? Number(answer.status) || 200 : 200, contentType: 'application/json', body: JSON.stringify(wrapped ? answer.json : answer ?? {}) });
}

/** Runs one task at one viewport: every step is found by its visible name, measured, then done. */
async function runTask(browser, data, supabase, task, viewportName) {
  const viewport = VIEWPORTS[viewportName];
  const phone = viewportName === 'phone';
  supabase.reset(task.dataset || 'full');
  const context = await browser.newContext({ viewport, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce' });
  const persona = task.persona === 'member' ? data.ctx.MEMBER : data.ctx.OWNER;
  await context.addCookies([authCookie(data.personas[persona], { appUrl: APP_URL })]);
  await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: () => {} });
  await installRealtime(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.message || error).split('\n')[0]));
  const calls = [];
  // What the task wrote to the database stand-in (a saved stage, a profile): some tasks are done when that happens.
  const writes = [];
  page.on('request', request => {
    if (request.url().startsWith(SUPABASE_URL) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ url: request.url(), method: request.method() });
  });
  for (const mock of task.mocks || []) {
    await page.route(mock.url, async route => {
      try {
        await answerMock(route, mock, calls);
      } catch (error) {
        errors.push(`Respuesta simulada de ${mock.url}: ${String(error.message).slice(0, 120)}`);
        await route.fallback().catch(() => {});
      }
    });
  }
  const tracker = trackRequests(page);

  const run = { task: task.id, viewport: viewportName, steps: [], success: false, failedAt: null, failure: null, errors };
  try {
    await page.goto(`${APP_URL}${task.start}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settleAfter(page, tracker);
    await hydrated(page);
    for (const [index, step] of task.steps.entries()) {
      if (step.only && step.only !== viewportName) continue;
      if (step.wait) {
        await locate(page, step.wait).waitFor({ timeout: step.timeout || 15000 });
        continue;
      }
      // On a phone the menu is folded: a menu step costs one more click.
      if (step.menu && phone) {
        // On a phone the menu button reads «Abrir menú» (sidebar.tsx).
        const toggle = page.getByRole('button', { name: 'Abrir menú', exact: true }).locator('visible=true').first();
        const screen = await readScreen(page);
        await toggle.click({ timeout: 5000 });
        await page.waitForTimeout(350);
        run.steps.push({ index, kind: 'click', name: 'Menú', ...screen, inView: true, ops: KLM.click() });
      }
      // A step the screen already did for the person (a selection made for them) is not a step they take.
      if (step.skipIf && await step.skipIf(page).catch(() => false)) continue;
      const target = step.menu ? { role: 'link', name: step.menu, exact: true, within: { role: 'navigation', name: 'Navegación principal' } } : step.target;
      const screen = await readScreen(page);
      const element = locate(page, target);
      // How long the person waits for the control to be there (data loading, a slow screen): part of what they feel.
      const waitStarted = Date.now();
      try {
        await element.waitFor({ state: 'visible', timeout: step.optional ? 3000 : step.timeout || 15000 });
        await page.waitForFunction(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true', await element.elementHandle(), { timeout: step.timeout || 15000 });
      } catch {
        if (step.optional) continue;
        run.failedAt = index;
        run.failure = `No se encontró «${describe(target)}»${step.why ? ` (${step.why})` : ''}.`;
        break;
      }
      const inView = await element.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
      }).catch(() => false);
      const kind = step.fill !== undefined ? 'fill' : step.upload ? 'upload' : step.select ? 'select' : step.choose !== undefined ? 'choose' : 'click';
      try {
        if (kind === 'fill' && step.append) {
          // Adds to what the screen already wrote for the person (an objective drafted from «Perfil»).
          await element.click({ timeout: 5000 });
          await element.evaluate(node => { node.selectionStart = node.selectionEnd = node.value.length; });
          await element.pressSequentially(step.fill, { delay: 0 });
        } else if (kind === 'fill') {
          await element.fill('');
          await element.pressSequentially(step.fill, { delay: 0 });
        } else if (kind === 'upload') {
          const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
          await element.click({ timeout: 5000 });
          await (await chooser).setFiles(step.upload);
        } else if (kind === 'choose') {
          await element.selectOption(String(step.choose));
        } else if (kind === 'select') {
          await element.click({ timeout: 5000 });
          await page.getByRole('option', { name: step.select }).first().click({ timeout: 5000 });
        } else {
          await element.click({ timeout: 8000 });
        }
      } catch (error) {
        run.failedAt = index;
        run.failure = `«${describe(target)}» no respondió: ${String(error.message).split('\n')[0].slice(0, 160)}`;
        break;
      }
      const ops = kind === 'fill' ? KLM.fill(step.fill.length) : kind === 'upload' ? KLM.upload() : kind === 'select' || kind === 'choose' ? KLM.select() : KLM.click();
      if (!inView) ops.push(...KLM.scroll());
      run.steps.push({ index, kind, name: describe(target), ...screen, inView, ops, waitMs: Date.now() - waitStarted });
      await settleAfter(page, tracker);
      if (step.after) await page.waitForTimeout(step.after);
    }
    if (run.failedAt === null) {
      try {
        await task.done(page, { calls, writes });
        run.success = true;
      } catch (error) {
        run.failure = `No terminó: ${String(error.message).split('\n')[0].slice(0, 200)}`;
      }
    }
  } catch (error) {
    run.failure = `No terminó: ${String(error.message).split('\n')[0].slice(0, 200)}`;
  } finally {
    if (!run.success) await page.screenshot({ path: path.join(outDir, 'shots', `${task.id}-${viewportName}-fallo.png`), fullPage: false }).catch(() => {});
    else await page.screenshot({ path: path.join(outDir, 'shots', `${task.id}-${viewportName}.png`), fullPage: false }).catch(() => {});
    await context.close().catch(() => {});
  }
  return run;
}

function describe(target) {
  if (!target) return '';
  if (target.label) return target.label;
  if (target.placeholder) return target.placeholder;
  if (target.text) return String(target.text);
  return `${target.name instanceof RegExp ? target.name.source.replace(/\\/g, '') : target.name}`;
}

async function main() {
  assertNoDotEnv();
  mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: startedAt.getTime() });
  const env = buildEnv({ ownerId: built.ctx.OWNER, ownerEmail });
  await ensureBuild({ env, logFile: path.join(outDir, 'build.log'), skipBuild: options.skipBuild, log });

  const supabase = await startFakeSupabase({ port: SUPABASE_PORT, datasets: built.datasets, personas: built.personas, serviceKey: SERVICE_KEY, onLog: () => {} });
  const appLog = createWriteStream(path.join(outDir, 'app.log'));
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT, env: { ...env, NODE_OPTIONS: `--require ${path.join(ROOT, 'scripts/visual-audit/egress-guard.cjs')}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(appLog); app.stderr.pipe(appLog);
  const stop = async () => { app.kill('SIGTERM'); await supabase.close(); };
  // Whatever ends this process, the app server ends with it (an orphan would hold the port for the next run).
  process.on('exit', () => { try { app.kill('SIGKILL'); } catch { /* already gone */ } });
  process.on('SIGINT', () => { stop().finally(() => process.exit(130)); });

  try {
    await waitForApp();
    const playwright = loadPlaywright();
    const browser = await playwright.chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
    const tasks = TASKS(built.ctx, { root: ROOT, fixtures: path.join(ROOT, 'scripts/usability/fixtures') })
      .filter(task => !options.tasks || options.tasks.includes(task.id));
    const results = [];
    for (const task of tasks) {
      const runs = {};
      for (const viewportName of options.viewports) {
        runs[viewportName] = await runTask(browser, built, supabase, task, viewportName);
        const run = runs[viewportName];
        log(`${task.id.padEnd(10)} ${viewportName.padEnd(7)} ${run.success ? 'OK  ' : 'FALLA'} ${run.steps.length} pasos${run.failure ? ` · ${run.failure}` : ''}`);
      }
      results.push({ task, runs, score: scoreTask(task, runs) });
    }
    await browser.close();
    const summary = summarize(results);
    const json = { startedAt: startedAt.toISOString(), options, summary, results: results.map(({ task, runs, score }) => ({
      id: task.id, title: task.title, module: task.module, ideal: task.ideal, dataset: task.dataset || 'full', persona: task.persona || 'owner',
      pending: task.pending || null, runs, score,
    })) };
    writeFileSync(path.join(outDir, 'simplicity.json'), JSON.stringify(json, null, 2));
    writeSimplicityReport(path.join(outDir, 'simplicity.md'), json);
    log(`Listo: ${path.relative(ROOT, outDir)}/simplicity.md · índice ${summary.index} de 100.`);
  } finally {
    await stop();
  }
}

if (!existsSync(path.join(ROOT, 'scripts/usability/tasks.mjs'))) throw new Error('Faltan las tareas: scripts/usability/tasks.mjs');
main().catch(error => { console.error(`[sencillez] ${error.stack || error.message}`); process.exit(1); });
