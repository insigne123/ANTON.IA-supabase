// Renders code artifacts as the app shows them (Plan 12, 3b and 3c): each page in a frame with
// sandbox="allow-scripts", served with the route's CSP, in Chromium. For each one it reports what the
// person would see: whether it started and drew without errors, its visible text (for the judge), the
// overflow at 390 px, the axe violations in light and dark, and screenshots when a directory is given.
// Playwright is not a dependency of the app: it is found as in scripts/test-cowork-artifact-sandbox.ts.
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob: data:";
const SURFACE = { light: '#ffffff', dark: '#020817' } as const;

export type CoworkArtifactRender = {
  /** It said it started (__antoniaStart) and no error reached the app. */
  ok: boolean;
  errors: string[];
  /** The text a person reads on the page (light, 1280 px), trimmed. */
  text: string;
  svgs: number;
  /** Horizontal overflow at 390 px, in pixels (0 is good). */
  overflow390: number;
  /** axe violations as «rule×nodes», per theme at 1280 px. */
  axe: { status: 'measured' | 'not_measured'; light: string[]; dark: string[] };
  screenshots: string[];
};

type Playwright = { chromium: { launch: () => Promise<Browser> } };
type Browser = { newContext: (options: { viewport: { width: number; height: number } }) => Promise<Context>; close: () => Promise<void> };
type Context = { newPage: () => Promise<Page>; close: () => Promise<void> };
type Frame = { url: () => string; evaluate: <T>(fn: string | (() => T | Promise<T>)) => Promise<T> };
type Page = { goto: (url: string) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void>; frames: () => Frame[];
  evaluate: <T>(fn: () => T) => Promise<T>; screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown> };

function loadPlaywright(): Playwright {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean) as string[];
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm missing */ }
  for (const candidate of candidates) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  throw new Error('No encontré Playwright (npm i -g playwright o PLAYWRIGHT_MODULE).');
}

function loadAxe() {
  try { return readFileSync(createRequire(import.meta.url).resolve(process.env.AXE_MODULE || 'axe-core/axe.min.js'), 'utf8'); } catch { return null; }
}

/** Renders each page; `shots` keeps light, dark and 390 px screenshots as `<id>-<theme>-<width>.png`. */
export async function renderCoworkArtifacts(pages: Array<{ id: string; html: string }>, options: { shots?: string; waitMs?: number } = {}) {
  const byId = new Map(pages.map(page => [page.id, page.html]));
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://local');
    if (url.pathname === '/parent') {
      const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
      const id = url.searchParams.get('id') || '';
      const origin = encodeURIComponent(`http://${request.headers.host}`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "frame-src 'self'" });
      response.end(`<!doctype html><body style="margin:0;background:${SURFACE[theme]}"><iframe sandbox="allow-scripts" style="border:0;width:100%;height:100vh" src="/a/${encodeURIComponent(id)}#theme=${theme}&origin=${origin}"></iframe><script>window.__m=[];addEventListener('message',e=>{if(e.data&&e.data.source==='antonia-artifact')window.__m.push(e.data)})</script></body>`);
      return;
    }
    const html = byId.get(decodeURIComponent(url.pathname.replace(/^\/a\//, '')));
    if (html === undefined) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
    response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const axe = loadAxe();
  const browser = await loadPlaywright().chromium.launch();
  const out = new Map<string, CoworkArtifactRender>();
  if (options.shots && !existsSync(options.shots)) mkdirSync(options.shots, { recursive: true });
  try {
    for (const { id } of pages) {
      const render: CoworkArtifactRender = { ok: false, errors: [], text: '', svgs: 0, overflow390: 0, axe: { status: axe ? 'measured' : 'not_measured', light: [], dark: [] }, screenshots: [] };
      let started = false;
      for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]] as const) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        try {
          const page = await context.newPage();
          await page.goto(`http://127.0.0.1:${port}/parent?id=${encodeURIComponent(id)}&theme=${theme}`);
          await page.waitForTimeout(options.waitMs ?? 1200);
          const messages = await page.evaluate(() => (window as unknown as { __m: Array<{ type: string; message?: string }> }).__m);
          for (const message of messages) {
            if (message.type === 'error' && message.message && !render.errors.includes(message.message)) render.errors.push(message.message);
            if (message.type === 'ready') started = true;
          }
          const frame = page.frames().find(item => item.url().includes('/a/'));
          if (!frame) { render.errors.push('El marco no cargó.'); continue; }
          const facts = await frame.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            svgs: document.querySelectorAll('svg').length,
            text: (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
          }));
          if (width === 390) render.overflow390 = facts.overflow;
          else if (theme === 'light') { render.text = facts.text.slice(0, 6000); render.svgs = facts.svgs; }
          if (axe && width === 1280) {
            await frame.evaluate(axe);
            render.axe[theme] = await frame.evaluate(async () => {
              const result = await (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } })
                .axe.run(document, { resultTypes: ['violations'] });
              return result.violations.map(violation => `${violation.id}×${violation.nodes.length}`);
            });
          }
          if (options.shots) {
            const shot = path.join(options.shots, `${id}-${theme}-${width}.png`);
            await page.screenshot({ path: shot });
            render.screenshots.push(shot);
          }
        } finally { await context.close(); }
      }
      render.ok = started && render.errors.length === 0;
      out.set(id, render);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  return out;
}
