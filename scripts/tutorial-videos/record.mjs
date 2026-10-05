#!/usr/bin/env node
// Tutorial videos (Plan 11, PR 7a): each module's storyboard is played on the real app, on the visual-audit bench (local
// Supabase stand-in with demo data, no network, nothing real is sent), inside a stage that explains it: notes and a
// post-it at the side, an arrow and a highlight on the control, zoom into it, a slow and large cursor with a halo on
// each click, and subtitles. Frames are taken one by one at 30 fps with our own clock, so the cursor and the zoom move
// smoothly however long the app takes; then ffmpeg adds original music (music.mjs) and writes an H.264 MP4, its poster
// and a WebVTT file with the subtitles. See README.md in this folder.
//
//   npm run tutorial:videos -- [--videos=buscar,hoy] [--skip-build] [--out=public/tutorial-videos] [--keep-frames]
//
// ffmpeg: FFMPEG_PATH, or the one in imageio-ffmpeg (pip install imageio-ffmpeg), or ffmpeg on the PATH.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { APP_LISTEN_URL, APP_PORT, APP_URL, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from '../visual-audit/env.mjs';
import { startFakeSupabase } from '../visual-audit/fake-supabase/server.mjs';
import { authCookie } from '../visual-audit/fake-supabase/session.mjs';
import { buildDatasets } from '../visual-audit/fixtures/index.mjs';
import { installPolicy, installRealtime } from '../visual-audit/api-policy.mjs';
import { ensureBuild } from '../visual-audit/build.mjs';
import { writeMusic } from './music.mjs';
import { STORYBOARDS } from './storyboards/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const wanted = typeof args.videos === 'string' ? args.videos.split(',').map(item => item.trim()) : null;
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'public/tutorial-videos');
const workDir = path.join(os.tmpdir(), `tutorial-videos-${process.pid}`);
const log = message => process.stdout.write(`[videos] ${message}\n`);

const FPS = 30;
const STAGE = { width: 1280, height: 720 };
// The app window of the stage (stage.html): where the iframe is drawn and at what scale.
const WINDOW = { x: 32, y: 88, width: 870, height: 544 };
const APP = { width: 1280, height: 800 };
const BASE_SCALE = WINDOW.width / APP.width;
const NOTE_ANCHOR = { x: 922, y: 140 };

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const python of ['python3', 'python']) {
    try { return execFileSync(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  return 'ffmpeg';
}

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

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const words = value => String(value || '').split(/\s+/).filter(Boolean).length;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The camera on the app: the scale and offset that frame `rect` (app pixels) at `zoom` times the fitted size. */
function frameFor(rect, zoom) {
  if (!rect || zoom <= 1) return { s: BASE_SCALE, tx: 0, ty: 0 };
  const s = BASE_SCALE * zoom;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    s,
    tx: clamp(WINDOW.width / 2 - cx * s, WINDOW.width - APP.width * s, 0),
    ty: clamp(WINDOW.height / 2 - cy * s, WINDOW.height - APP.height * s, 0),
  };
}
const toStage = (point, camera) => ({ x: WINDOW.x + camera.tx + point.x * camera.s, y: WINDOW.y + camera.ty + point.y * camera.s });
const rectToStage = (rect, camera) => {
  const a = toStage({ x: rect.x, y: rect.y }, camera);
  return { x: a.x, y: a.y, w: rect.w * camera.s, h: rect.h * camera.s };
};

/** Finds the control a scene talks about, inside the app, by what the person reads on it. */
function locate(frame, target) {
  const exact = target.exact ?? true;
  if (target.css) return frame.locator(target.css).locator('visible=true').first();
  if (target.label) return frame.getByLabel(target.label, { exact }).locator('visible=true').first();
  if (target.text) return frame.getByText(target.text, { exact }).locator('visible=true').first();
  const scope = target.within ? frame.getByRole(target.within.role, target.within.name ? { name: target.within.name } : {}).locator('visible=true').first() : frame;
  return scope.getByRole(target.role, { name: target.name, exact }).locator('visible=true').first();
}

class Recorder {
  constructor(page, frame, dir, storyboard) {
    this.page = page;
    this.frame = frame;
    this.dir = dir;
    this.storyboard = storyboard;
    this.count = 0;
    this.lastFile = null;
    this.subtitles = [];
    this.state = {
      module: storyboard.title, chapter: '', zoom: frameFor(null, 1), note: null, postit: null, steps: [], subtitle: { text: '', opacity: 0 },
      highlight: null, arrow: null, cursor: { x: WINDOW.x + WINDOW.width / 2, y: WINDOW.y + WINDOW.height / 2, visible: false, pressed: false, halo: 0 }, card: null,
    };
    this.zoomRect = null;
    this.zoomLevel = 1;
  }

  get seconds() { return this.count / FPS; }

  /** One frame: the stage drawn with the current state, then a screenshot (or the last one again when nothing moved). */
  async shot({ reuse = false } = {}) {
    const file = path.join(this.dir, `${String(this.count).padStart(5, '0')}.jpg`);
    if (reuse && this.lastFile) copyFileSync(this.lastFile, file);
    else {
      await this.page.evaluate(state => window.stage.render(state), this.state);
      await this.page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      this.lastFile = file;
    }
    this.count += 1;
  }

  /** `seconds` of frames while `update(t)` (0→1) changes the state. */
  async animate(seconds, update) {
    const frames = Math.max(1, Math.round(seconds * FPS));
    for (let index = 1; index <= frames; index += 1) {
      update(ease(index / frames), index / frames);
      await this.shot();
    }
  }

  /** `seconds` without our own movement: the app is still captured twice a second, in case it changes. */
  async hold(seconds) {
    const frames = Math.max(1, Math.round(seconds * FPS));
    for (let index = 0; index < frames; index += 1) await this.shot({ reuse: index % 15 !== 0 });
  }

  async measure(target) {
    const element = locate(this.frame, target);
    await element.waitFor({ state: 'visible', timeout: target.timeout || 20000 })
      .catch(() => { throw new Error(`No apareció «${String(target.name || target.label || target.text || target.css)}»`); });
    // Bring it into the app's view first, gently, if it is below or above.
    const box = await element.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, vh: window.innerHeight }; });
    if (box.y < 60 || box.y + box.h > box.vh - 40) {
      await element.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await this.animate(0.35, () => {});
    }
    const rect = await element.evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    return { element, rect };
  }

  setSubtitle(text) {
    const previous = this.subtitles.at(-1);
    if (previous && previous.end == null) previous.end = this.seconds;
    if (text) this.subtitles.push({ start: this.seconds, end: null, text });
    this.state.subtitle = { text: text || '', opacity: text ? 1 : 0 };
  }

  async card(card, seconds) {
    this.state.cursor.visible = false;
    this.setSubtitle('');
    await this.animate(0.45, t => { this.state.card = { ...card, opacity: t }; });
    await this.hold(seconds);
    await this.animate(0.45, t => { this.state.card = { ...card, opacity: 1 - t }; });
    this.state.card = null;
  }

  async scene(scene, index, total) {
    const state = this.state;
    state.chapter = `Paso ${index + 1} de ${total}`;
    state.steps = Array.from({ length: total }, (_, step) => (step < index ? 'done' : step === index ? 'now' : ''));
    // In: the note, the post-it and the subtitle of this step.
    const note = { kicker: scene.kicker || state.chapter, title: scene.title, text: scene.text };
    this.setSubtitle(scene.say || scene.title);
    await this.animate(0.5, t => {
      state.note = { ...note, opacity: t };
      state.postit = scene.postit ? { text: scene.postit, opacity: t } : state.postit && { ...state.postit, opacity: 1 - t };
      state.arrow = state.arrow && { ...state.arrow, opacity: 1 - t };
      state.highlight = state.highlight && { ...state.highlight, opacity: 1 - t };
    });
    if (!scene.postit) state.postit = null;
    state.arrow = null;
    state.highlight = null;
    if (scene.before) await scene.before(this.frame, this.page);

    let target = null;
    if (scene.target) target = await this.measure(scene.target);
    // Camera: into the control (or the area of the scene), or back out.
    const zoomRect = scene.zoomOn ? (await this.measure(scene.zoomOn)).rect : target?.rect;
    const nextCamera = frameFor(zoomRect, scene.zoom || 1);
    const fromCamera = state.zoom;
    if (Math.abs(nextCamera.s - fromCamera.s) > 0.001 || Math.abs(nextCamera.tx - fromCamera.tx) > 0.5 || Math.abs(nextCamera.ty - fromCamera.ty) > 0.5) {
      const cursorApp = this.cursorApp;
      await this.animate(1.1, t => {
        state.zoom = { s: lerp(fromCamera.s, nextCamera.s, t), tx: lerp(fromCamera.tx, nextCamera.tx, t), ty: lerp(fromCamera.ty, nextCamera.ty, t) };
        if (cursorApp && state.cursor.visible) Object.assign(state.cursor, toStage(cursorApp, state.zoom));
      });
      // A cursor the camera left outside the window would float over the frame: it goes away until the next click.
      const { x, y } = state.cursor;
      if (state.cursor.visible && (x < WINDOW.x || x > WINDOW.x + WINDOW.width || y < WINDOW.y || y > WINDOW.y + WINDOW.height)) state.cursor.visible = false;
    }
    if (target) {
      const rect = rectToStage(target.rect, state.zoom);
      const aim = { x: target.rect.x + Math.min(target.rect.w / 2, 120), y: target.rect.y + target.rect.h / 2 };
      const destination = toStage(aim, state.zoom);
      // The cursor: slow, eased, from where it was.
      if (scene.action !== 'none') {
        const from = { x: state.cursor.x, y: state.cursor.y };
        if (!state.cursor.visible) { from.x = destination.x + 140; from.y = destination.y + 90; state.cursor.visible = true; }
        const distance = Math.hypot(destination.x - from.x, destination.y - from.y);
        await this.animate(clamp(0.8 + distance / 650, 0.9, 2), t => {
          state.cursor.x = lerp(from.x, destination.x, t);
          state.cursor.y = lerp(from.y, destination.y, t) - Math.sin(Math.PI * t) * Math.min(40, distance * 0.08);
        });
        this.cursorApp = aim;
      }
      if (scene.highlight !== false || scene.arrow) {
        await this.animate(0.6, t => {
          if (scene.highlight !== false) state.highlight = { rect, opacity: t };
          if (scene.arrow) state.arrow = { from: { x: NOTE_ANCHOR.x, y: NOTE_ANCHOR.y + 40 }, to: { x: rect.x + rect.w + 8, y: rect.y + rect.h / 2 }, progress: t, opacity: 1 };
        });
      }
      await this.hold(scene.pause ?? 0.6);
      if (scene.type) {
        await target.element.click();
        await target.element.fill('');
        for (const char of scene.type) {
          await target.element.pressSequentially(char);
          await this.shot();
          await this.shot({ reuse: true });
        }
      } else if (scene.choose !== undefined) {
        await target.element.selectOption(String(scene.choose));
        await this.animate(0.4, () => {});
      } else if (scene.action === 'hover') {
        await target.element.hover();
        await this.animate(0.4, () => {});
      } else if (scene.upload) {
        state.cursor.pressed = true;
        await this.shot();
        const chooser = this.page.waitForEvent('filechooser', { timeout: 10000 });
        await target.element.click({ timeout: 10000 });
        await (await chooser).setFiles(scene.upload);
        state.cursor.pressed = false;
        await this.animate(0.5, (t, raw) => { state.cursor.halo = raw; });
        state.cursor.halo = 0;
      } else if (scene.action !== 'none') {
        // Click: the cursor presses, the halo opens, and the app does what it does.
        state.cursor.pressed = true;
        await this.shot();
        await target.element.click({ timeout: 10000 });
        state.cursor.pressed = false;
        await this.animate(0.5, (t, raw) => { state.cursor.halo = raw; });
        state.cursor.halo = 0;
      }
    }
    if (scene.waitFor) {
      const started = Date.now();
      const done = locate(this.frame, scene.waitFor).waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false);
      // While the app works, keep filming for up to 1.5 s; longer waits are cut.
      let finished = false;
      done.then(value => { finished = value; });
      while (!finished && Date.now() - started < 1500) await this.shot();
      if (!(await done)) throw new Error(`No apareció «${scene.waitFor.name || scene.waitFor.text || scene.waitFor.label}»`);
      state.highlight = null;
      await this.shot();
    }
    if (scene.after) await scene.after(this.frame, this.page);
    // Long enough to read the subtitle and the note.
    await this.hold(scene.hold ?? clamp(words(scene.say || scene.title) / 2.6 + 0.8, 2.2, 6.5));
  }

  vtt() {
    const last = this.subtitles.at(-1);
    if (last && last.end == null) last.end = this.seconds;
    const time = seconds => {
      const ms = Math.round(seconds * 1000);
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
    };
    return `WEBVTT\n\n${this.subtitles.filter(cue => cue.end > cue.start).map((cue, index) => `${index + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.text}\n`).join('\n')}`;
  }
}

async function recordVideo(browser, built, supabase, storyboard, ffmpeg) {
  const dir = path.join(workDir, storyboard.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  supabase.reset(storyboard.dataset || 'full');
  const context = await browser.newContext({ viewport: STAGE, deviceScaleFactor: 1, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce', colorScheme: 'light' });
  const persona = storyboard.persona === 'member' ? built.ctx.MEMBER : built.ctx.OWNER;
  await context.addCookies([authCookie(built.personas[persona], { appUrl: APP_URL })]);
  await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: () => {} });
  await installRealtime(context);
  const stageHtml = readFileSync(path.join(ROOT, 'scripts/tutorial-videos/stage.html'), 'utf8');
  await context.route(`${APP_URL}/__tutorial-stage`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: stageHtml }));
  for (const mock of storyboard.mocks || []) {
    await context.route(mock.url, async route => {
      const request = route.request();
      if (mock.method && request.method() !== mock.method) return route.fallback();
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      const answer = typeof mock.respond === 'function' ? mock.respond(body, request) : mock.respond;
      const wrapped = answer && typeof answer === 'object' && 'json' in answer;
      return route.fulfill({ status: wrapped ? Number(answer.status) || 200 : 200, contentType: 'application/json', body: JSON.stringify(wrapped ? answer.json : answer ?? {}) });
    }).catch(() => {});
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
  try {
    await page.goto(`${APP_URL}/__tutorial-stage`, { waitUntil: 'load' });
    await page.evaluate(src => { document.getElementById('app').src = src; }, `${APP_URL}${storyboard.start}`);
    const handle = await page.waitForSelector('#app');
    const frame = await handle.contentFrame();
    await frame.waitForLoadState('domcontentloaded');
    await frame.waitForFunction(() => {
      const element = (document.querySelector('main#contenido') || document.body).querySelector('button, a[href], input');
      return Boolean(element && Object.keys(element).some(key => key.startsWith('__react')));
    }, null, { timeout: 30000 });
    if (storyboard.ready) await locate(frame, storyboard.ready).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.stage.adoptFonts());
    const recorder = new Recorder(page, frame, dir, storyboard);
    await recorder.card({ kicker: 'Tutorial · ANTON.IA', title: storyboard.title, text: storyboard.intro, items: storyboard.learn }, 3.2);
    const total = storyboard.scenes.length;
    for (const [index, scene] of storyboard.scenes.entries()) {
      try {
        await recorder.scene(scene, index, total);
      } catch (error) {
        // What the screen showed when the step failed, to fix the storyboard.
        mkdirSync(outDir, { recursive: true });
        await page.screenshot({ path: path.join(outDir, `${storyboard.id}-fallo.png`) }).catch(() => {});
        throw new Error(`paso ${index + 1} («${scene.title}»): ${String(error.message).split('\n')[0]}`);
      }
    }
    recorder.state.highlight = null;
    recorder.state.arrow = null;
    await recorder.card({ kicker: 'Listo', title: storyboard.outro.title, text: storyboard.outro.text, items: storyboard.outro.items }, 3.4);

    // Music, then the video, the poster and the subtitles.
    const seconds = recorder.count / FPS;
    const music = path.join(dir, 'music.wav');
    writeMusic(music, seconds + 0.5, storyboard.id);
    mkdirSync(outDir, { recursive: true });
    const video = path.join(outDir, `${storyboard.id}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-i', music,
      '-filter_complex', '[1:a]volume=0.7[a]', '-map', '0:v', '-map', '[a]', '-shortest',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', String(FPS * 4),
      '-c:a', 'aac', '-b:a', '80k', '-ac', '2', '-movflags', '+faststart', video,
    ]);
    copyFileSync(path.join(dir, '00020.jpg'), path.join(outDir, `${storyboard.id}.jpg`));
    writeFileSync(path.join(outDir, `${storyboard.id}.vtt`), recorder.vtt());
    if (!args['keep-frames']) rmSync(dir, { recursive: true, force: true });
    return { id: storyboard.id, title: storyboard.title, seconds: Math.round(seconds), bytes: statSync(video).size, errors };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  assertNoDotEnv();
  mkdirSync(workDir, { recursive: true });
  const ffmpeg = ffmpegPath();
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: Date.now() });
  const env = buildEnv({ ownerId: built.ctx.OWNER, ownerEmail });
  await ensureBuild({ env, logFile: path.join(workDir, 'build.log'), skipBuild: Boolean(args['skip-build']), log });
  const supabase = await startFakeSupabase({ port: SUPABASE_PORT, datasets: built.datasets, personas: built.personas, serviceKey: SERVICE_KEY, onLog: () => {} });
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT, env: { ...env, NODE_OPTIONS: `--require ${path.join(ROOT, 'scripts/visual-audit/egress-guard.cjs')}` }, stdio: 'ignore',
  });
  process.on('exit', () => { try { app.kill('SIGKILL'); } catch { /* already gone */ } });
  try {
    await waitForApp();
    const browser = await loadPlaywright().chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
    const results = [];
    for (const storyboard of STORYBOARDS(built.ctx).filter(item => !wanted || wanted.includes(item.id))) {
      const started = Date.now();
      try {
        const result = await recordVideo(browser, built, supabase, storyboard, ffmpeg);
        results.push(result);
        log(`${storyboard.id.padEnd(14)} ${result.seconds} s · ${(result.bytes / 1048576).toFixed(1)} MB · ${Math.round((Date.now() - started) / 1000)} s de grabación${result.errors.length ? ` · errores de página: ${[...new Set(result.errors)].join(' | ')}` : ''}`);
      } catch (error) {
        results.push({ id: storyboard.id, failed: String(error.message).split('\n')[0] });
        log(`${storyboard.id.padEnd(14)} FALLÓ: ${String(error.message).split('\n')[0]}`);
      }
    }
    await browser.close();
    if (existsSync(outDir)) writeFileSync(path.join(workDir, 'results.json'), JSON.stringify(results, null, 2));
    log(`Listo: ${results.filter(item => !item.failed).length} de ${results.length} videos en ${path.relative(ROOT, outDir)}.`);
    if (results.some(item => item.failed)) process.exitCode = 1;
  } finally {
    app.kill('SIGTERM');
    await supabase.close();
  }
}

main().catch(error => { console.error(`[videos] ${error.stack || error.message}`); process.exit(1); });
