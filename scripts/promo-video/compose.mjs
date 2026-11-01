#!/usr/bin/env node
// Promo videos: the three timelines (timelines.mjs) are drawn frame by frame on stage.html from the app stills
// (capture.mjs), with original music (tutorial-videos/music.mjs), burned captions of the voice-over and, when the
// ElevenLabs files are there, the voice itself. Each block keeps its script time; a voice longer than its block stretches
// that block and pushes the rest. Writes the MP4, an .srt with the voice text and, for the long video, its YouTube chapters.
//
//   node scripts/promo-video/compose.mjs --stills=<dir> --out=<dir> [--videos=v90,v30,v5] [--voice=<dir>] [--no-captions]
//        [--fps=30] [--url=anton.ia] [--preview=<seconds>]   (--preview writes one JPEG per block at that offset instead)
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMusic } from '../tutorial-videos/music.mjs';
import { TIMELINES } from './timelines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, ...r] = arg.replace(/^--/, '').split('='); return [k, r.length ? r.join('=') : true]; }));
const stillsDir = path.resolve(String(args.stills || 'promo-stills'));
const outDir = path.resolve(String(args.out || 'promo-videos'));
const voiceDir = args.voice ? path.resolve(String(args.voice)) : null;
const FPS = Number(args.fps || 30);
const wanted = typeof args.videos === 'string' ? args.videos.split(',') : Object.keys(TIMELINES);
const log = message => process.stdout.write(`[compose] ${message}\n`);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean)) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright'));
}

/** The app's own Poppins and PT Sans (latin subset), taken from the build so nothing is downloaded. */
function appFonts() {
  const build = ['.next-audit', '.next'].map(dir => path.join(ROOT, dir, 'static')).find(dir => existsSync(path.join(dir, 'css')));
  if (!build) throw new Error('Falta un build (.next-audit o .next) para tomar las fuentes de la app.');
  const fonts = {};
  for (const file of readdirSync(path.join(build, 'css'))) {
    const css = readFileSync(path.join(build, 'css', file), 'utf8');
    for (const [, body] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
      const family = (body.match(/font-family:([^;]+)/) || [])[1] || '';
      const weight = (body.match(/font-weight:([^;]+)/) || [])[1];
      const src = (body.match(/url\(([^)]+)\)/) || [])[1];
      const latin = /unicode-range:u\+00\?\?/i.test(body);
      if (!latin || !src || !weight) continue;
      const name = /poppins/i.test(family) ? 'poppins' : /pt.?sans/i.test(family) ? 'ptsans' : null;
      if (name) fonts[`${name}-${weight}.woff2`] = path.join(build, 'media', path.basename(src));
    }
  }
  for (const need of ['poppins-500.woff2', 'poppins-600.woff2', 'poppins-700.woff2', 'ptsans-400.woff2', 'ptsans-700.woff2']) if (!fonts[need]) throw new Error(`No encontré ${need} en el build.`);
  return fonts;
}

function serve(fonts) {
  const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (url === '/' || url === '/stage.html') file = path.join(HERE, 'stage.html');
    else if (url === '/icon.png') file = path.join(ROOT, 'public/icon.png');
    else if (url.startsWith('/fonts/')) file = fonts[path.basename(url)];
    else if (url.startsWith('/stills/')) file = path.join(stillsDir, path.basename(url));
    if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
    res.end(readFileSync(file));
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

const ffprobeSeconds = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
function voiceFile(code) {
  if (!voiceDir) return null;
  for (const ext of ['.mp3', '.wav', '.m4a', '.ogg']) { const file = path.join(voiceDir, code + ext); if (existsSync(file)) return file; }
  return null;
}

/** Captions: the voice text in short lines: whole sentences, and a long one in balanced parts, cut at a comma or a colon
 * when one is near, so no line is left with a word or two. */
function splitBalanced(sentence, max) {
  if (sentence.length <= max * 1.2) return [sentence];
  const out = [];
  let rest = sentence;
  for (let parts = Math.ceil(sentence.length / max); parts > 1; parts--) {
    const ideal = Math.round(rest.length / parts);
    let best = -1, bestScore = Infinity;
    for (let i = 1; i < rest.length - 1; i++) {
      if (rest[i] !== ' ') continue;
      const score = Math.abs(i - ideal) - (/[,:;]/.test(rest[i - 1]) ? ideal * 0.35 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    out.push(rest.slice(0, best).trim()); rest = rest.slice(best).trim();
  }
  out.push(rest);
  return out;
}
function cueLines(text, max) {
  const safe = text.replace(/ANTON\.IA/g, 'ANTON\u2024IA');
  return safe.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
    .flatMap(sentence => splitBalanced(sentence, max)).map(line => line.replace(/\u2024/g, '.'));
}

/** The capture's index: where each step's control was, to ring it and point the camera at it. */
function loadSpots() {
  const file = path.join(stillsDir, 'index.json');
  const spots = {};
  if (!existsSync(file)) return spots;
  for (const item of JSON.parse(readFileSync(file, 'utf8'))) for (const entry of item.shots) spots[entry.file] = entry.spot || null;
  return spots;
}
const mix = (a, b, t) => a + (b - a) * t;
/** A shot from the timeline ({ still, zoom, ring, at }) becomes a camera move ({ from, to }) and, maybe, a ring. */
function resolveShot(shot, spots) {
  if (shot.from || shot.to) return shot;
  const found = spots[shot.still];
  const ring = shot.ring && found && found.w < 0.7 && found.h < 0.6 ? found : null;
  const target = shot.at || (ring ? { x: ring.x + ring.w / 2, y: ring.y + ring.h / 2 } : { x: 0.5, y: 0.4 });
  const zoom = shot.zoom || 1.2;
  return { still: shot.still, from: { x: mix(0.5, target.x, 0.5), y: mix(0.4, target.y, 0.5), z: Math.max(1, zoom - 0.22) }, to: { x: target.x, y: target.y, z: zoom }, spot: ring };
}

/** Times each block (stretching for a longer voice), and its cues. */
function plan(timeline) {
  const spots = loadSpots();
  const vertical = timeline.height > timeline.width;
  const voices = {};
  for (const block of timeline.blocks) if (block.code && !(block.code in voices)) {
    const file = voiceFile(block.code);
    voices[block.code] = file ? { file, seconds: ffprobeSeconds(file) } : null;
  }
  // a code can span several blocks (the long video's opening): the voice runs across them
  let t = 0;
  const blocks = timeline.blocks.map(block => ({ ...block, ...(block.shots ? { shots: block.shots.map(shot => resolveShot(shot, spots)) } : {}) }));
  const byCode = {};
  for (const block of blocks) (byCode[block.code] ||= []).push(block);
  for (const block of blocks) {
    const group = byCode[block.code] || [block];
    const voice = block.code ? voices[block.code] : null;
    if (voice && group[group.length - 1] === block) {
      const planned = group.reduce((sum, b) => sum + b.duration, 0);
      const needed = (block.voiceAt ?? 0.35) + voice.seconds + 0.6 + (block.tail || 0);
      if (needed > planned) block.duration += needed - planned;
    }
  }
  for (const block of blocks) { block.start = t; t += block.duration; }
  const total = timeline.total ? Math.max(timeline.total, t) : t;
  for (const [code, group] of Object.entries(byCode)) {
    const text = group.find(b => b.say)?.say;
    if (!text || code === 'undefined') continue;
    const first = group[0]; const last = group[group.length - 1];
    const voiceAt = first.voiceAt ?? 0.35;
    const voice = voices[code];
    const from = first.start + voiceAt;
    const to = voice ? from + voice.seconds : last.start + last.duration - (last.tail || 0) - 0.35;
    const lines = cueLines(text, vertical ? 70 : 78);
    const weight = lines.reduce((sum, line) => sum + line.length + 8, 0);
    let at = from;
    const cues = lines.map(line => { const span = (to - from) * (line.length + 8) / weight; const cue = { text: line, from: at, to: at + span }; at += span; return cue; });
    for (const block of group) block.cues = cues.map(cue => ({ ...cue, from: cue.from - block.start, to: cue.to - block.start }))
      .filter(cue => cue.to > 0 && cue.from < block.duration).map(cue => ({ ...cue, from: Math.max(0, cue.from), to: Math.min(block.duration, cue.to) }));
    first.voice = voice ? { file: voice.file, at: from } : null;
    first.allCues = cues;
  }
  return { ...timeline, blocks, total };
}

const stamp = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
function writeSrt(file, planned) {
  const cues = planned.blocks.flatMap(block => block.allCues || []);
  writeFileSync(file, cues.map((cue, i) => `${i + 1}\n${stamp(cue.from)} --> ${stamp(cue.to - 0.05)}\n${cue.text}\n`).join('\n'));
}
function writeChapters(file, planned) {
  const lines = planned.blocks.filter(block => block.chapter).map(block => { const s = Math.round(block.start); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${block.chapter}`; });
  writeFileSync(file, lines.join('\n') + '\n');
}

async function render(browser, port, name, timeline) {
  const planned = plan(timeline);
  const { width, height, total } = planned;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/stage.html?w=${width}&h=${height}`);
  await page.evaluate(tl => window.__build(tl), { ...planned, captions: !args['no-captions'] });
  const missing = await page.evaluate(() => window.__ready());
  if (missing.length) throw new Error(`Faltan capturas: ${missing.join(', ')}`);
  if (args.preview !== undefined) {
    const dir = path.join(outDir, `preview-${name}`); mkdirSync(dir, { recursive: true });
    for (const [i, block] of planned.blocks.entries()) {
      const offsets = String(args.preview === true ? '0.5' : args.preview).split(',').map(Number);
      for (const off of offsets) {
        const t = Math.min(block.start + (off < 0 ? block.duration + off : off), block.start + block.duration - 0.05);
        await page.evaluate(x => window.__renderAt(x), t);
        await page.screenshot({ path: path.join(dir, `${String(i).padStart(2, '0')}-${block.code || 'x'}-${off}.jpg`), type: 'jpeg', quality: 85 });
      }
    }
    await page.close(); log(`${name}: vistas previas en ${dir}`); return;
  }
  const base = path.join(outDir, name);
  const music = `${base}.music.wav`;
  writeMusic(music, total + 1, timeline.musicId || name);
  const voices = planned.blocks.filter(block => block.voice).map(block => block.voice);
  const inputs = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', music];
  for (const voice of voices) inputs.push('-i', voice.file);
  const fadeOut = Math.max(0, total - 3.5);
  let filter;
  if (voices.length) {
    const delayed = voices.map((voice, i) => `[${i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(voice.at * 1000)}:all=1[v${i}]`);
    filter = `${delayed.join(';')};${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0,volume=1.0,asplit=2[voice][key];`
      + `[1:a]volume=0.55,afade=t=in:d=1.2,afade=t=out:st=${fadeOut}:d=3.5[bed];[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[ducked];`
      + `[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]`;
  } else {
    filter = `[1:a]volume=0.85,afade=t=in:d=1.2,afade=t=out:st=${fadeOut}:d=3.5[a]`;
  }
  const ffmpeg = spawn('ffmpeg', [...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-t', total.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', `${base}.mp4`],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = ''; ffmpeg.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${errors}`)))));
  const frames = Math.ceil(total * FPS);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate(x => window.__renderAt(x), f / FPS);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ffmpeg.stdin.write(jpg)) await new Promise(r => ffmpeg.stdin.once('drain', r));
    if (f % (FPS * 15) === 0) log(`${name}: ${Math.round(f / FPS)} s de ${Math.round(total)} s (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  ffmpeg.stdin.end();
  await done;
  await page.close();
  writeSrt(`${base}.srt`, planned);
  if (planned.blocks.some(block => block.chapter)) writeChapters(`${base}.capitulos.txt`, planned);
  log(`${name}: listo, ${total.toFixed(1)} s${voices.length ? `, con ${voices.length} audios de voz` : ''}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const fonts = appFonts();
  const server = await serve(fonts);
  const { port } = server.address();
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const jobs = wanted.map(name => {
      const timeline = TIMELINES[name];
      if (!timeline) throw new Error(`No existe el video ${name}`);
      return render(browser, port, timeline.file || name, timeline);
    });
    await Promise.all(jobs);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(`[compose] ${error.stack || error.message}`); process.exit(1); });
