#!/usr/bin/env node
// Journeys: what a person does to get something done, step by step, on the same bench as the visual audit (local Supabase stand-in,
// no network, app writes answered 503 unless the journey lists them). Each journey is a goal («asignar una recomendada») as a list of
// steps written the way a person says them; the runner clicks by what is on screen (role and name, never a selector), takes a
// picture after every step and reports how many clicks the goal took, how long each step waited and where a person would have got
// stuck. See README.md in this folder.
//
//   npm run audit:journeys -- [--file=scripts/visual-audit/journeys/opportunities.mjs] [--only=admin-asignar,miembro-urgente]
//                              [--skip-build] [--out=.visual-audit/<name>]
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_LISTEN_URL, APP_PORT, APP_URL, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from './env.mjs';
import { startFakeSupabase } from './fake-supabase/server.mjs';
import { authCookie } from './fake-supabase/session.mjs';
import { buildDatasets } from './fixtures/index.mjs';
import { installPolicy, installRealtime } from './api-policy.mjs';
import { screenshot, settle, trackRequests } from './checks.mjs';
import { ensureBuild } from './build.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const list = value => (typeof value === 'string' && value ? value.split(',').map(item => item.trim()).filter(Boolean) : null);
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : path.join('.visual-audit', `recorridos-${stamp}`));
const log = message => process.stdout.write(`[recorridos] ${message}\n`);
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const STEP_TIMEOUT = 12000;

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
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asName = name => (name instanceof RegExp ? name : new RegExp(escapeRegex(name), 'i'));
const slug = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/** What a step can do: the verbs of a person. A click is counted: the number of clicks is the first measure of how easy a goal is. */
function makeActions({ page, supabase, state }) {
  const locate = (target, scope = page) => {
    // Only what is on screen: a person never clicks the desktop version of a control the phone hides.
    const seen = locator => locator.filter({ visible: true }).first();
    if (typeof target === 'string') return seen(scope.getByRole('button', { name: asName(target) }).or(scope.getByRole('link', { name: asName(target) })).or(scope.getByRole('tab', { name: asName(target) })));
    if (target.text) return seen(scope.getByText(asName(target.text)));
    if (target.label) return seen(scope.getByLabel(asName(target.label)));
    if (target.placeholder) return seen(scope.getByPlaceholder(asName(target.placeholder)));
    return seen(scope.getByRole(target.role || 'button', { name: asName(target.name) }));
  };
  return {
    page,
    /** The rows of a table in the stand-in database, to check that what the person did was kept. */
    table: name => structuredClone(supabase.store.tables[name] || []),
    async go(route) { await page.goto(`${APP_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }); },
    async click(target, options = {}) { state.clicks += 1; await locate(target, options.within || page).click({ timeout: STEP_TIMEOUT, ...options.force ? { force: true } : {} }); },
    /** A click on a locator the journey built itself (a button inside a card): it counts like any other. */
    async clickOn(locator) { state.clicks += 1; await locator.click({ timeout: STEP_TIMEOUT }); },
    async fill(target, value) { state.typed += 1; const field = locate(typeof target === 'string' ? { label: target } : target); await field.fill(value, { timeout: STEP_TIMEOUT }); },
    async choose(label, option) { state.clicks += 1; await page.getByLabel(asName(label)).first().selectOption({ label: option }, { timeout: STEP_TIMEOUT }); },
    async press(key) { await page.keyboard.press(key); },
    /** Waits for text to be on screen, as a person looks for it; failing is the finding «no se encuentra». */
    async see(text, options = {}) { await page.getByText(asName(text)).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: options.timeout ?? STEP_TIMEOUT }); },
    async seeRole(role, name, options = {}) { await page.getByRole(role, { name: asName(name) }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: options.timeout ?? STEP_TIMEOUT }); },
    async notSee(text, options = {}) { await page.getByText(asName(text)).filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: options.timeout ?? 4000 }); },
    async has(text) { return page.getByText(asName(text)).filter({ visible: true }).first().isVisible().catch(() => false); },
    async wait(ms) { await page.waitForTimeout(ms); },
    /** A check on the result of the goal; it is reported, and a failed one does not stop the journey. */
    check(label, passed, detail = '') { state.checks.push({ label, passed: Boolean(passed), detail: String(detail).slice(0, 300) }); },
    /** Something a person would say about the step; it goes into the report as it is. */
    note(text) { state.notes.push(text); },
  };
}

async function runJourney(browser, built, supabase, journey, index) {
  supabase.reset('full');
  const viewport = VIEWPORTS[journey.viewport || 'desktop'];
  const context = await browser.newContext({ viewport, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce' });
  const userId = journey.persona === 'member' ? built.ctx.MEMBER : built.ctx.OWNER;
  await context.addCookies([authCookie(built.personas[userId], { appUrl: APP_URL })]);
  const writes = [];
  await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: record => writes.push(record), passWrites: journey.passWrites || [] });
  await installRealtime(context);
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error?.message || error).split('\n')[0]));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().split('\n')[0].slice(0, 160)); });
  // What the app answered with an error, and what it said: a step that «did nothing» usually has its reason here.
  page.on('response', async response => {
    if (response.status() < 400 || response.status() === 503 || !new URL(response.url()).pathname.startsWith('/api/')) return;
    const body = await response.text().catch(() => '');
    consoleErrors.push(`Respuesta ${response.status()} de ${response.request().method()} ${new URL(response.url()).pathname}: ${body.slice(0, 200)}`);
  });
  const state = { clicks: 0, typed: 0, checks: [], notes: [] };
  const actions = makeActions({ page, supabase, state });
  const tracker = trackRequests(page);
  const result = { id: journey.id, title: journey.title, persona: journey.persona, goal: journey.goal || '', viewport: journey.viewport || 'desktop', steps: [], outcome: 'completed' };
  const started = Date.now();
  for (const [number, step] of journey.steps.entries()) {
    const before = { clicks: state.clicks, notes: state.notes.length, errors: consoleErrors.length, writes: writes.length, checks: state.checks.length };
    const stepStarted = Date.now();
    let error = null;
    try { await step.do(actions); } catch (caught) { error = String(caught?.message || caught).split('\n')[0].slice(0, 300); }
    const settled = await settle(page, tracker, { timeoutMs: 8000 }).catch(() => ({ settled: false }));
    const shot = `shots/${String(index + 1).padStart(2, '0')}-${journey.id}/${String(number + 1).padStart(2, '0')}-${slug(step.say)}.png`;
    mkdirSync(path.dirname(path.join(outDir, shot)), { recursive: true });
    await screenshot(page, path.join(outDir, shot), { width: viewport.width, baseHeight: viewport.height, maxHeight: 2600 }).catch(() => {});
    result.steps.push({
      say: step.say, ok: !error, error, ms: Date.now() - stepStarted, shot, clicks: state.clicks - before.clicks, settled: settled.settled !== false,
      notes: state.notes.slice(before.notes), consoleErrors: consoleErrors.slice(before.errors), writes: writes.slice(before.writes).filter(item => item.kind !== 'external').map(item => `${item.method} ${new URL(item.url).pathname}${item.blocked ? ' (bloqueada)' : ''}`),
      checks: state.checks.slice(before.checks),
    });
    if (error) { result.outcome = `atascado en el paso ${number + 1}`; break; }
  }
  result.clicks = state.clicks; result.typed = state.typed; result.seconds = Math.round((Date.now() - started) / 100) / 10;
  result.checks = state.checks;
  if (state.checks.some(check => !check.passed) && result.outcome === 'completed') result.outcome = 'terminó, pero algo no quedó como se pidió';
  result.external = writes.filter(item => item.kind === 'external').map(item => new URL(item.url).host);
  await context.close().catch(() => {});
  return result;
}

function writeReport(results) {
  const lines = [`# Recorridos · ${startedAt.toISOString()}`, '', '| Recorrido | Persona | Clics | Pasos | Segundos | Resultado |', '|---|---|---|---|---|---|',
    ...results.map(item => `| ${item.title} | ${item.persona} (${item.viewport}) | ${item.clicks} | ${item.steps.length} | ${item.seconds} | ${item.outcome} |`), ''];
  for (const item of results) {
    lines.push(`## ${item.title}`, '', item.goal ? `Meta: ${item.goal}` : '', '', '| # | Paso | Resultado | Clics | ms | Imagen |', '|---|---|---|---|---|---|');
    item.steps.forEach((step, number) => lines.push(`| ${number + 1} | ${step.say} | ${step.ok ? 'ok' : `**no se pudo:** ${step.error}`} | ${step.clicks} | ${step.ms} | [ver](${step.shot}) |`));
    lines.push('');
    for (const step of item.steps) {
      for (const note of step.notes) lines.push(`- Paso «${step.say}»: ${note}`);
      for (const check of step.checks) lines.push(`- ${check.passed ? 'Bien' : '**Falla**'}: ${check.label}${check.detail ? ` (${check.detail})` : ''}`);
      for (const message of step.consoleErrors) lines.push(`- Error en consola (paso «${step.say}»): ${message}`);
      for (const write of step.writes) lines.push(`- Escritura (paso «${step.say}»): ${write}`);
    }
    if (item.external.length) lines.push(`- Hosts externos intentados: ${[...new Set(item.external)].join(', ')}`);
    lines.push('');
  }
  writeFileSync(path.join(outDir, 'journeys.md'), `${lines.join('\n')}\n`);
  writeFileSync(path.join(outDir, 'journeys.json'), JSON.stringify({ startedAt: startedAt.toISOString(), results }, null, 2));
}

async function loadJourneys() {
  const dir = path.join(ROOT, 'scripts/visual-audit/journeys');
  const files = (list(args.file) || readdirSync(dir).filter(file => file.endsWith('.mjs')).map(file => path.join('scripts/visual-audit/journeys', file)));
  const journeys = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.resolve(ROOT, file)).href);
    journeys.push(...(typeof mod.default === 'function' ? mod.default() : mod.default));
  }
  const only = list(args.only);
  return only ? journeys.filter(journey => only.includes(journey.id)) : journeys;
}

async function main() {
  assertNoDotEnv();
  mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const journeys = await loadJourneys();
  if (!journeys.length) throw new Error('No hay recorridos que correr.');
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: startedAt.getTime() });
  const env = buildEnv({ ownerId: built.ctx.OWNER, ownerEmail });
  await ensureBuild({ env, logFile: path.join(outDir, 'build.log'), skipBuild: Boolean(args['skip-build']), log });

  const supabase = await startFakeSupabase({ port: SUPABASE_PORT, datasets: built.datasets, personas: built.personas, serviceKey: SERVICE_KEY, onLog: () => {} });
  const appLog = createWriteStream(path.join(outDir, 'app.log'));
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT, env: { ...env, NODE_OPTIONS: `--require ${path.join(ROOT, 'scripts/visual-audit/egress-guard.cjs')}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(appLog); app.stderr.pipe(appLog);
  const stop = async () => { app.kill('SIGTERM'); await supabase.close(); };
  process.on('exit', () => { try { app.kill('SIGKILL'); } catch { /* already gone */ } });
  process.on('SIGINT', () => { stop().finally(() => process.exit(130)); });

  try {
    await waitForApp();
    const browser = await loadPlaywright().chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
    const results = [];
    // One at a time: the stand-in database is shared, and a journey changes it.
    for (const [index, journey] of journeys.entries()) {
      const result = await runJourney(browser, built, supabase, journey, index);
      results.push(result);
      log(`${journey.id}: ${result.outcome} · ${result.clicks} clics · ${result.seconds} s`);
    }
    await browser.close();
    writeReport(results);
    log(`Listo: ${path.relative(ROOT, outDir)}/journeys.md`);
  } finally {
    await stop();
  }
}

main().catch(error => { console.error(`[recorridos] ${error.stack || error.message}`); process.exit(1); });
