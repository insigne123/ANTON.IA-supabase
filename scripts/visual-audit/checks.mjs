// The checks one visit runs once the page has settled: horizontal overflow (and which elements cause it), axe-core's
// serious and critical violations, and a screenshot tall enough to show the page's scroll container.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';

const AXE_PATH = path.join(ROOT, 'node_modules/axe-core/axe.min.js');
const axeSource = existsSync(AXE_PATH) ? readFileSync(AXE_PATH, 'utf8') : null;
export const axeAvailable = Boolean(axeSource);

/** Waits until no request has been in flight for `quietMs` and no loading placeholder is visible, up to `timeoutMs`. */
export async function settle(page, tracker, { quietMs = 700, timeoutMs = 15000 } = {}) {
  const started = Date.now();
  let quietSince = Date.now();
  let lastBusy = [];
  while (Date.now() - started < timeoutMs) {
    if (tracker.inFlight() > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) {
      const busy = await page.evaluate(() => {
        const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
        // Skeletons and spinners, not small pulsing dots (live indicators) that never stop.
        return [...document.querySelectorAll('[aria-busy="true"], .animate-pulse, .animate-spin, [data-loading="true"]')]
          .filter(element => { const box = element.getBoundingClientRect(); return visible(element) && (element.matches('.animate-spin') || element.matches('[aria-busy="true"]') || box.width * box.height >= 400); })
          .map(element => `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/).slice(0, 3).join('.')}`).slice(0, 3);
      }).catch(() => []);
      lastBusy = busy;
      if (!busy.length) return { settled: true, ms: Date.now() - started };
    }
    await page.waitForTimeout(100);
  }
  return { settled: false, ms: Date.now() - started, pending: tracker.pendingUrls(), busy: lastBusy };
}

/** Whether the page scrolls sideways, and the widest offenders (elements whose box crosses the right edge). */
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollers = [document.documentElement, document.body, ...document.querySelectorAll('main')];
    const overflow = Math.max(...scrollers.map(element => element.scrollWidth - element.clientWidth));
    if (overflow <= 1) return { overflow: 0, offenders: [] };
    const describe = element => {
      const id = element.id ? `#${element.id}` : '';
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 3).map(name => `.${name}`).join('') : '';
      const text = (element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` «${text}»` : ''}`;
    };
    const offenders = [];
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= width + 1) continue;
      // Content inside its own horizontal scroller (tables, carousels) is fine; <main> and <body> are the page itself.
      let clipped = false;
      for (let parent = element.parentElement; parent && parent !== document.body && parent.tagName !== 'MAIN'; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && parent.getBoundingClientRect().right <= width + 1) { clipped = true; break; }
      }
      if (!clipped) offenders.push({ selector: describe(element), right: Math.round(box.right) });
    }
    return { overflow, offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 5) };
  });
}

/** axe-core violations with impact serious or critical, one entry per rule with up to three example targets. */
export async function axeViolations(page) {
  if (!axeSource) return null;
  await page.evaluate(source => { if (!window.axe) (0, eval)(source); }, axeSource);
  const result = await page.evaluate(async () => {
    const run = await window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return run.violations.filter(item => item.impact === 'serious' || item.impact === 'critical').map(item => ({
      id: item.id, impact: item.impact, help: item.help, count: item.nodes.length,
      targets: item.nodes.slice(0, 3).map(node => node.target.join(' ')),
    }));
  });
  return result;
}

/** Grows the viewport to the content's height (the app scrolls inside <main>, so a full-page shot would cut it). */
export async function screenshot(page, file, { width, baseHeight, maxHeight = 3200 }) {
  const height = await page.evaluate(() => Math.max(
    document.documentElement.scrollHeight,
    ...[...document.querySelectorAll('main, [data-scroll-container]')].map(element => element.scrollHeight + element.getBoundingClientRect().top),
  )).catch(() => baseHeight);
  const target = Math.min(maxHeight, Math.max(baseHeight, Math.ceil(height)));
  if (target !== baseHeight) await page.setViewportSize({ width, height: target });
  await page.waitForTimeout(150);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  if (target !== baseHeight) await page.setViewportSize({ width, height: baseHeight });
}

/**
 * Counts requests in flight on one page, ignoring long-lived streams and requests older than `staleMs`: a fetch the page
 * aborts while it is being routed never reports an end, and would otherwise hold the page «loading» forever.
 */
export function trackRequests(page, { staleMs = 8000 } = {}) {
  const pending = new Map();
  const isStream = request => /\/(events|stream)(\?|$)/.test(new URL(request.url()).pathname) || request.resourceType() === 'eventsource' || request.resourceType() === 'websocket';
  page.on('request', request => { if (!isStream(request)) pending.set(request, Date.now()); });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => pending.delete(request));
  const live = () => [...pending].filter(([, startedAt]) => Date.now() - startedAt < staleMs).map(([request]) => request);
  return { inFlight: () => live().length, pendingUrls: () => live().map(request => `${request.method()} ${new URL(request.url()).pathname}`).slice(0, 5) };
}
