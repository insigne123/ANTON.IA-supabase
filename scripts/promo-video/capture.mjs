#!/usr/bin/env node
// Promo stills: every tutorial storyboard is played on the real app (visual-audit bench, demo data, no network) without the
// tutorial's notes, and a sharp screenshot is kept before the first step and after each one. The promo videos are composed
// from these stills (compose.mjs). Nothing real is read or sent.
//
//   node scripts/promo-video/capture.mjs --out=<dir> [--videos=hoy,cowork] [--skip-build]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_LISTEN_URL, APP_PORT, APP_URL, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from '../visual-audit/env.mjs';
import { startFakeSupabase } from '../visual-audit/fake-supabase/server.mjs';
import { authCookie } from '../visual-audit/fake-supabase/session.mjs';
import { buildDatasets } from '../visual-audit/fixtures/index.mjs';
import { installPolicy, installRealtime } from '../visual-audit/api-policy.mjs';
import { ensureBuild } from '../visual-audit/build.mjs';
import { STORYBOARDS } from '../tutorial-videos/storyboards/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, ...r] = arg.replace(/^--/, '').split('='); return [k, r.length ? r.join('=') : true]; }));
const wanted = typeof args.videos === 'string' ? args.videos.split(',') : null;
const outDir = path.resolve(String(args.out || 'promo-stills'));
const VIEWPORT = { width: 1440, height: 900 };
const log = message => process.stdout.write(`[promo] ${message}\n`);
// The bench's organization is called «Yago QA»: in a video for prospects it reads as a test account, so the stills use a
// made-up company instead, in the data and in the storyboard answers alike.
const RENAME = [[/Yago QA/g, 'Atlas Selección'], [/yago-qa\.cl/g, 'atlasseleccion.cl']];
const renameText = text => RENAME.reduce((out, [from, to]) => out.replace(from, to), text);
const renameDeep = value => (typeof value === 'string' ? renameText(value) : Array.isArray(value) ? value.map(renameDeep)
  : value && typeof value === 'object' && value.constructor === Object ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameDeep(v)])) : value);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean)) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  const global = path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright');
  return require(global);
}
async function waitForApp(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(`${APP_LISTEN_URL}/login`, { redirect: 'manual' }); if (response.status < 500) return; } catch { /* not yet */ }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('La app no respondió en 90 s.');
}
function locate(frame, target) {
  const exact = target.exact ?? true;
  if (target.css) return frame.locator(target.css).locator('visible=true').first();
  if (target.label) return frame.getByLabel(target.label, { exact }).locator('visible=true').first();
  if (target.text) return frame.getByText(target.text, { exact }).locator('visible=true').first();
  const scope = target.within ? frame.getByRole(target.within.role, target.within.name ? { name: target.within.name } : {}).locator('visible=true').first() : frame;
  return scope.getByRole(target.role, { name: target.name, exact }).locator('visible=true').first();
}
const settle = page => page.waitForTimeout(900);
/** The control as the storyboard names it; failing that, the same name without exact match (a menu entry that now carries a
 * count, «Oportunidades 2»), and then any visible text with that name (a button that became a tab). */
async function findVisible(page, target, timeout) {
  const tries = [target];
  if (target.exact !== false) tries.push({ ...target, exact: false });
  if (typeof target.name === 'string') tries.push({ text: target.name, exact: true });
  let last = null;
  for (const [index, attempt] of tries.entries()) {
    const element = locate(page, attempt);
    try { await element.waitFor({ state: 'visible', timeout: index === 0 ? timeout : 4000 }); return element; } catch (error) { last = error; }
  }
  throw last;
}
// Steps the promo leaves out: in Oportunidades, loading a received tender from its document (the form now asks before
// discarding, which the tutorial does not expect) — the promo shows the list, the file and the report instead.
// The tender is then opened from its «Informe listo» notice, since the list now starts on the recommended ones.
const OPEN_TENDER = { title: 'Ábrela', target: { text: /^Informe listo: Servicio de verificación/, exact: false }, waitFor: { text: 'Postular', exact: true } };
const PROMO_SKIP = { oportunidades: new Set(['Carga una que recibiste', 'La IA completa el formulario', 'Revisa y guarda', 'La lista', 'Por qué calza']) };
const PROMO_REPLACE = { oportunidades: { 'Ábrela': OPEN_TENDER } };

async function captureStoryboard(browser, built, supabase, storyboard) {
  supabase.reset(storyboard.dataset || 'full');
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce', colorScheme: 'light' });
  const persona = storyboard.persona === 'member' ? built.ctx.MEMBER : built.ctx.OWNER;
  await context.addCookies([authCookie(built.personas[persona], { appUrl: APP_URL })]);
  await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: () => {} });
  await installRealtime(context);
  for (const mock of storyboard.mocks || []) {
    await context.route(mock.url, async route => {
      const request = route.request();
      if (mock.method && request.method() !== mock.method) return route.fallback();
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      const answer = typeof mock.respond === 'function' ? mock.respond(body, request) : mock.respond;
      const wrapped = answer && typeof answer === 'object' && 'json' in answer;
      return route.fulfill({ status: wrapped ? Number(answer.status) || 200 : 200, contentType: 'application/json', body: renameText(JSON.stringify(wrapped ? answer.json : answer ?? {})) });
    }).catch(() => {});
  }
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const shots = [];
  const shot = async (label, element = null) => {
    // What the screen shows is scrubbed too: the bench signs in with the real Cowork owner's address, which a prospect must not see.
    await page.evaluate(({ email, swaps }) => {
      const rules = [[email, 'camila.torres@atlasseleccion.cl'], ...swaps];
      const fix = text => rules.reduce((out, [from, to]) => out.split(from).join(to), text);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) { const next = fix(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; }
      for (const field of document.querySelectorAll('input, textarea')) { const next = fix(field.value); if (next !== field.value) field.value = next; }
    }, { email: built.ownerEmail, swaps: [['Yago QA', 'Atlas Selección'], ['yago-qa.cl', 'atlasseleccion.cl']] }).catch(() => {});
    const file = path.join(outDir, `${storyboard.id}-${String(shots.length).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    // where the step's control is, as a share of the screen, so the edit can ring it
    const box = element ? await element.boundingBox().catch(() => null) : null;
    const spot = box && box.width > 0 ? { x: +(box.x / VIEWPORT.width).toFixed(4), y: +(box.y / VIEWPORT.height).toFixed(4), w: +(box.width / VIEWPORT.width).toFixed(4), h: +(box.height / VIEWPORT.height).toFixed(4) } : null;
    shots.push({ file: path.basename(file), label, spot });
  };
  try {
    await page.goto(`${APP_URL}${storyboard.start}`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const element = (document.querySelector('main#contenido') || document.body).querySelector('button, a[href], input');
      return Boolean(element && Object.keys(element).some(key => key.startsWith('__react')));
    }, null, { timeout: 30000 });
    if (storyboard.ready) await locate(page, storyboard.ready).waitFor({ state: 'visible', timeout: 30000 });
    await settle(page);
    await shot('inicio');
    const scenes = storyboard.scenes.filter(item => !PROMO_SKIP[storyboard.id]?.has(item.title)).map(item => PROMO_REPLACE[storyboard.id]?.[item.title] || item);
    for (const scene of scenes) {
      let element = null;
      try {
        // a step that tidies up after the one before (closing a form) may find nothing to tidy once that step is skipped
        if (scene.before) await Promise.resolve().then(() => scene.before(page, page)).catch(error => log(`${storyboard.id}: «${scene.title}», paso previo omitido: ${String(error.message).split('\n')[0]}`));
        if (scene.target) {
          // a menu entry can carry a count since the storyboard was written («Oportunidades 2»): retry without exact names
          element = await findVisible(page, scene.target, 15000);
          await element.scrollIntoViewIfNeeded().catch(() => {});
          if (scene.type) { await element.click(); await element.fill(''); await element.pressSequentially(scene.type, { delay: 5 }); }
          else if (scene.choose !== undefined) await element.selectOption(String(scene.choose));
          else if (scene.action === 'hover') await element.hover();
          else if (scene.upload) { const chooser = page.waitForEvent('filechooser', { timeout: 10000 }); await element.click({ timeout: 10000 }); await (await chooser).setFiles(scene.upload); }
          else if (scene.action !== 'none') await element.click({ timeout: 10000 });
        }
        if (scene.waitFor) await findVisible(page, scene.waitFor, 30000);
        if (scene.after) await scene.after(page, page);
        await settle(page);
        await shot(scene.title || scene.say || '', element && await element.isVisible().catch(() => false) ? element : null);
      } catch (error) {
        log(`${storyboard.id}: paso «${scene.title}» falló: ${String(error.message).split('\n')[0]}`);
        await shot(`fallo: ${scene.title}`).catch(() => {});
        break;
      }
    }
  } finally {
    await context.close();
  }
  return { id: storyboard.id, title: storyboard.title, shots };
}

async function main() {
  assertNoDotEnv();
  mkdirSync(outDir, { recursive: true });
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: Date.now() });
  built.ownerEmail = ownerEmail;
  built.datasets = renameDeep(built.datasets);
  const env = buildEnv({ ownerId: built.ctx.OWNER, ownerEmail });
  await ensureBuild({ env, logFile: path.join(outDir, 'build.log'), skipBuild: Boolean(args['skip-build']), log });
  const supabase = await startFakeSupabase({ port: SUPABASE_PORT, datasets: built.datasets, personas: built.personas, serviceKey: SERVICE_KEY, onLog: () => {} });
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT, env: { ...env, NODE_OPTIONS: `--require ${path.join(ROOT, 'scripts/visual-audit/egress-guard.cjs')}` }, stdio: 'ignore',
  });
  process.on('exit', () => { try { app.kill('SIGKILL'); } catch { /* gone */ } });
  const index = [];
  try {
    await waitForApp();
    const browser = await loadPlaywright().chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
    for (const storyboard of STORYBOARDS(built.ctx).filter(item => !wanted || wanted.includes(item.id))) {
      try { const result = await captureStoryboard(browser, built, supabase, storyboard); index.push(result); log(`${storyboard.id}: ${result.shots.length} capturas`); }
      catch (error) { log(`${storyboard.id}: FALLÓ ${String(error.message).split('\n')[0]}`); }
    }
    await browser.close();
  } finally {
    const indexFile = path.join(outDir, 'index.json');
    const earlier = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).filter(item => !index.some(next => next.id === item.id)) : [];
    writeFileSync(indexFile, JSON.stringify([...earlier, ...index], null, 2));
    app.kill('SIGTERM');
    await supabase.close();
  }
}
main().catch(error => { console.error(`[promo] ${error.stack || error.message}`); process.exit(1); });
