#!/usr/bin/env node
// Interaction walk of every page (Plan 11, section 1): what the visual audit's still screenshots do not cover, on the same
// bench (local Supabase stand-in, no network, app writes answered 503). Per page:
//   overlays  every menu, dialog, sheet, select and disclosure: it opens, the focus goes in, axe passes on it, Esc closes
//             it and the focus comes back to what opened it, and opening it writes nothing;
//   tabs      each tab selects and shows its panel, and the arrow keys move between them;
//   keyboard  Tab through the page: every stop shows where the focus is;
//   error     every read fails (500): the page says so instead of crashing, staying blank or showing an empty state;
//   slow      every read takes 3 s: meanwhile the page shows it is loading, not an empty state;
//   long      names, companies and titles three times longer: nothing pushes the page sideways.
// See README.md in this folder.
//
//   npm run audit:interactions -- [--routes=/search,/crm] [--persona=owner,member] [--checks=overlays,tabs,keyboard,error,slow,long]
//                                 [--concurrency=3] [--skip-build] [--out=.visual-audit/<name>]
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_LISTEN_URL, APP_PORT, APP_URL, ROOT, SERVICE_KEY, SUPABASE_PORT, SUPABASE_URL, assertNoDotEnv, buildEnv, coworkOwnerEmail } from './env.mjs';
import { startFakeSupabase } from './fake-supabase/server.mjs';
import { authCookie } from './fake-supabase/session.mjs';
import { buildDatasets } from './fixtures/index.mjs';
import { routeList } from './routes.mjs';
import { installPolicy, installRealtime } from './api-policy.mjs';
import { axeAvailable, horizontalOverflow, settle, trackRequests } from './checks.mjs';
import { ensureBuild } from './build.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const list = (value, fallback) => (typeof value === 'string' && value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback);
const ALL_CHECKS = ['overlays', 'tabs', 'keyboard', 'error', 'slow', 'long'];
const options = {
  routes: list(args.routes, null),
  personas: list(args.persona, ['owner', 'member']),
  checks: list(args.checks, ALL_CHECKS),
  skipBuild: Boolean(args['skip-build']),
  concurrency: Math.max(1, Math.min(6, Number(args.concurrency) || 3)),
};
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : path.join('.visual-audit', `interacciones-${stamp}`));
const log = message => process.stdout.write(`[interacciones] ${message}\n`);
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MAX_TRIGGERS = 14;
const MAX_FOCUS_STOPS = 16;
const SLOW_MS = 3000;

/** How serious each finding is, for the report. */
const SEVERITY = {
  'page-error': 'crítico', 'write-on-open': 'grave', 'esc-does-not-close': 'grave', 'focus-not-moved': 'grave', 'overlay-axe': 'grave',
  'no-visible-focus': 'grave', 'silent-error': 'grave', 'empty-on-error': 'grave', 'crash-on-error': 'crítico', 'focus-not-returned': 'moderado',
  'tab-not-selected': 'moderado', 'tab-panel-hidden': 'moderado', 'tab-arrows': 'moderado', 'empty-while-loading': 'moderado',
  'long-overflow': 'moderado', 'no-loading-state': 'leve', 'no-response': 'leve', 'focus-lost': 'moderado',
};
const LABELS = {
  'page-error': 'Error de página al interactuar', 'write-on-open': 'Abrir algo escribe datos', 'esc-does-not-close': 'Esc no cierra',
  'focus-not-moved': 'El foco no entra a lo que se abre', 'overlay-axe': 'Accesibilidad (axe) de lo que se abre',
  'focus-not-returned': 'Al cerrar, el foco no vuelve', 'no-visible-focus': 'No se ve dónde está el foco', 'focus-lost': 'El foco se pierde',
  'tab-not-selected': 'La pestaña no queda elegida', 'tab-panel-hidden': 'La pestaña no muestra su contenido', 'tab-arrows': 'Las flechas no mueven entre pestañas',
  'silent-error': 'Un error no se avisa', 'empty-on-error': 'Un error se muestra como vacío', 'crash-on-error': 'Un error rompe la página',
  'empty-while-loading': 'Mientras carga dice que está vacío', 'no-loading-state': 'Mientras carga no se ve que carga',
  'long-overflow': 'Un texto largo desborda la página', 'no-response': 'Un control que abre algo no responde',
};
const EMPTY_WORDS = /\b(aún no|todavía no|no hay|no tienes|sin (contactos|resultados|datos|conversaciones|campañas|estilos|leads|empresas))\b/i;
const ERROR_WORDS = /no pudimos|no se pudo|no pudo|error|reintenta|vuelve a intentar|intenta de nuevo|inténtalo|problema|falló|fallo/i;
const LOADING_WORDS = /cargando|buscando|preparando|actualizando|revisando|consultando|comprobando|leyendo|un momento/i;

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

/** The full dataset with every name, company, title and subject three times longer, for the «long» check. */
function longDataset(full) {
  const FIELD = /^(name|full_name|fullName|first_name|last_name|company|company_name|companyName|organization_name|title|job_title|subject|lead_name|contact_name)$/;
  const grow = value => `${value} ${value} ${value}`.slice(0, 220);
  const walk = value => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' && item && FIELD.test(key) ? grow(item) : walk(item)]));
  };
  return { ...full, tables: Object.fromEntries(Object.entries(full.tables).map(([table, rows]) => [table, walk(rows)])) };
}

const shotName = value => value.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inicio';
const normalize = text => String(text).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}/gi, '<id>').replace(/\d{2,}/g, '<n>');

async function newPage(browser, data, persona, viewport, { records } = {}) {
  const context = await browser.newContext({ viewport, locale: 'es-CL', timezoneId: 'America/Santiago', reducedMotion: 'reduce' });
  await context.addCookies([authCookie(data.personas[persona === 'owner' ? data.ctx.OWNER : data.ctx.MEMBER], { appUrl: APP_URL })]);
  await installPolicy(context, { appOrigin: APP_URL, supabaseOrigin: SUPABASE_URL, onRecord: record => records?.push(record) });
  await installRealtime(context);
  const page = await context.newPage();
  const errors = [];
  // A promise rejected with a plain object (a database error) reaches «pageerror» as just «Object»: say what it was.
  await page.addInitScript(() => window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    if (reason && typeof reason === 'object' && !(reason instanceof Error)) console.warn('[ia-unhandled]', JSON.stringify(reason).slice(0, 240));
  }));
  // The app's own error logs, kept in order: the one before a rejection usually names the read that threw it.
  const logs = [];
  page.on('console', message => {
    if (message.type() === 'error') logs.push(message.text().replace(/\s+/g, ' ').slice(0, 90));
    if (message.type() === 'warning' && message.text().startsWith('[ia-unhandled]')) {
      const before = logs.slice(-2).join(' | ');
      errors.push(`Promesa rechazada sin capturar: ${message.text().slice(15)}${before ? ` (antes: ${before})` : ''}`);
    }
  });
  page.on('pageerror', error => {
    if (String(error?.message) === 'Object') return; // reported above, with its content
    // A thrown plain object reads «Object»: the first app frame of the stack says where it came from.
    const frame = String(error?.stack || '').split('\n').map(line => line.trim()).find(line => /\/_next\/static\/chunks\//.test(line)) || '';
    const source = frame.match(/chunks\/(?:app\/)?([^?:)]+)/)?.[1] || '';
    errors.push(`${String(error?.message || error).split('\n')[0]}${source ? ` (en ${source})` : ''}`);
  });
  return { context, page, errors };
}

async function open(page, routePath) {
  const tracker = trackRequests(page);
  await page.goto(`${APP_URL}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page, tracker, { timeoutMs: 15000 });
  // Hydrated: the content can be clicked.
  await page.waitForFunction(() => {
    const main = document.querySelector('main#contenido') || document.body;
    const element = main.querySelector('button, a[href], input, [role="tab"]');
    return !element || Object.keys(element).some(key => key.startsWith('__react'));
  }, null, { timeout: 15000 }).catch(() => {});
}

/** Menus, dialogs, sheets, selects and disclosures that can be opened: the page's own, plus the shell's on one page. */
function findTriggers(page, { includeShell }) {
  return page.evaluate(({ includeShell, max }) => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const main = document.querySelector('main#contenido');
    const candidates = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')]
      .filter(element => element.matches('[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded]') && !element.matches('[role="tab"]'))
      .filter(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true')
      .filter(element => includeShell || (main && main.contains(element)));
    const seen = new Set();
    const found = [];
    for (const element of candidates) {
      const name = (element.getAttribute('aria-label') || element.textContent || element.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60) || element.tagName.toLowerCase();
      const key = `${element.getAttribute('aria-haspopup') || 'expanded'}|${name.replace(/\d+/g, '#')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `t${found.length}`;
      element.setAttribute('data-ia-trigger', id);
      found.push({ id, name, popup: element.getAttribute('aria-haspopup'), expanded: element.getAttribute('aria-expanded') });
      if (found.length >= max) break;
    }
    return found;
  }, { includeShell, max: MAX_TRIGGERS });
}

/** The overlays open right now (dialog, alert dialog, menu, listbox), the last one first: portals append at the end. */
function openOverlays(page) {
  return page.evaluate(() => {
    const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')]
      .filter(visible).map((element, index) => {
        element.setAttribute('data-ia-overlay', String(index));
        return { index: String(index), role: element.getAttribute('role'), label: (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') && document.getElementById(element.getAttribute('aria-labelledby'))?.textContent || '').trim().slice(0, 60) };
      }).reverse();
  });
}

async function axeOn(page, selector) {
  if (!axeAvailable) return [];
  return page.evaluate(async selector => {
    const element = document.querySelector(selector);
    if (!element || !window.axe) return [];
    const run = await window.axe.run(element, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return run.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
      .map(item => ({ id: item.id, help: item.help, count: item.nodes.length, targets: item.nodes.slice(0, 2).map(node => node.target.join(' ')) }));
  }, selector).catch(() => []);
}

async function loadAxe(page, axeSource) {
  if (axeSource) await page.evaluate(source => { if (!window.axe) (0, eval)(source); }, axeSource).catch(() => {});
}

async function checkOverlays(page, { routePath, includeShell, add, records, errors, axeSource, coverage }) {
  const triggers = await findTriggers(page, { includeShell });
  for (const trigger of triggers) {
    const where = `«${trigger.name}»`;
    const writesBefore = records.length;
    const errorsBefore = errors.length;
    const locator = page.locator(`[data-ia-trigger="${trigger.id}"]`);
    if (!(await locator.count())) continue;
    const before = await openOverlays(page);
    try { await locator.click({ timeout: 3000 }); } catch { continue; }
    await page.waitForTimeout(450);
    if (new URL(page.url()).pathname !== routePath.split('?')[0]) {
      await open(page, routePath);
      continue;
    }
    coverage.overlays += 1;
    const after = await openOverlays(page);
    const opened = after.length > before.length ? after[0] : null;
    const expandedNow = await locator.getAttribute('aria-expanded').catch(() => null);
    if (records.slice(writesBefore).some(record => record.kind !== 'external')) {
      add('write-on-open', where, `Abrir ${where} hizo ${records.slice(writesBefore).map(record => `${record.method} ${new URL(record.url).pathname}`).join(', ')}`);
    }
    if (opened) {
      const selector = `[data-ia-overlay="${opened.index}"]`;
      const focusInside = await page.evaluate(selector => { const overlay = document.querySelector(selector); return Boolean(overlay && overlay.contains(document.activeElement)); }, selector);
      if (!focusInside && opened.role !== 'listbox') add('focus-not-moved', where, `${where} abre un ${opened.role} y el foco queda afuera.`);
      await loadAxe(page, axeSource);
      for (const violation of await axeOn(page, selector)) add('overlay-axe', `${where} ${violation.id}`, `${where} (${opened.role}): ${violation.help} (${violation.count}): ${violation.targets.join(' · ')}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const stillOpen = await page.evaluate(selector => {
        const overlay = document.querySelector(selector);
        if (!overlay) return false;
        const box = overlay.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(overlay).visibility !== 'hidden';
      }, selector);
      if (stillOpen) {
        add('esc-does-not-close', where, `${where} abre un ${opened.role} que no se cierra con Esc.`);
        await open(page, routePath);
        continue;
      }
      const focusBack = await page.evaluate(id => {
        const triggerElement = document.querySelector(`[data-ia-trigger="${id}"]`);
        return Boolean(triggerElement && (document.activeElement === triggerElement || triggerElement.contains(document.activeElement)));
      }, trigger.id);
      if (!focusBack) {
        const active = await page.evaluate(() => { const element = document.activeElement; return element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} «${(element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 30)}»` : 'nada'; });
        add('focus-not-returned', where, `Al cerrar ${where} con Esc, el foco queda en ${active}.`);
      }
    } else if (trigger.expanded === 'false' && expandedNow === 'true') {
      // A disclosure: close it again so the next trigger finds the page as it was.
      await locator.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
    } else if (trigger.popup && trigger.popup !== 'false' && expandedNow !== 'true') {
      add('no-response', where, `${where} dice que abre un ${trigger.popup} y no abrió nada.`);
    }
    if (errors.length > errorsBefore) add('page-error', `${where} ${errors.at(-1)}`, `Al abrir ${where}: ${errors.slice(errorsBefore).join(' | ')}`);
  }
}

async function checkTabs(page, { add, coverage }) {
  const lists = await page.evaluate(() => {
    const main = document.querySelector('main#contenido') || document.body;
    return [...main.querySelectorAll('[role="tablist"]')].filter(list => list.getBoundingClientRect().width > 0).slice(0, 3).map((list, index) => {
      list.setAttribute('data-ia-tablist', String(index));
      return { index: String(index), tabs: [...list.querySelectorAll('[role="tab"]')].slice(0, 6).map(tab => (tab.textContent || '').trim().slice(0, 40)) };
    });
  });
  for (const list of lists) {
    const tabs = page.locator(`[data-ia-tablist="${list.index}"] [role="tab"]`);
    const count = Math.min(await tabs.count(), 6);
    for (let index = 0; index < count; index += 1) {
      const tab = tabs.nth(index);
      if (await tab.isDisabled().catch(() => true)) continue;
      await tab.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
      coverage.tabs += 1;
      const name = `«${list.tabs[index]}»`;
      if ((await tab.getAttribute('aria-selected')) !== 'true') { add('tab-not-selected', name, `La pestaña ${name} no queda elegida al hacer clic.`); continue; }
      const panelVisible = await tab.evaluate(element => {
        const panel = element.getAttribute('aria-controls') && document.getElementById(element.getAttribute('aria-controls'));
        if (!panel) return null;
        const box = panel.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      if (panelVisible === false) add('tab-panel-hidden', name, `La pestaña ${name} queda elegida pero su contenido no se ve.`);
    }
    if (count >= 2) {
      await tabs.nth(0).click({ timeout: 3000 }).catch(() => {});
      await tabs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const moved = await page.evaluate(index => {
        const tabsInList = [...document.querySelectorAll(`[data-ia-tablist="${index}"] [role="tab"]`)];
        return tabsInList.indexOf(document.activeElement) === 1;
      }, list.index);
      if (!moved) add('tab-arrows', `«${list.tabs.join(' / ')}»`, `En las pestañas «${list.tabs.join(' / ')}», la flecha derecha no lleva a la siguiente.`);
    }
  }
}

/** Tab through the content: each stop must look different when it has the focus (outline, ring, border or background). */
async function checkKeyboard(page, { add, coverage }) {
  const ready = await page.evaluate(() => {
    const main = document.querySelector('main#contenido');
    if (!main) return false;
    main.focus();
    return document.activeElement === main;
  });
  if (!ready) return;
  const look = () => page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const id = element.getAttribute('data-ia-stop') || `s${Math.random().toString(36).slice(2, 8)}`;
    element.setAttribute('data-ia-stop', id);
    // A visually hidden control (a styled checkbox or radio) shows its focus on its label or its parent.
    const proxy = (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) || element.closest('label') || element.parentElement;
    const parent = proxy ? getComputedStyle(proxy) : null;
    return {
      id, inMain: Boolean(element.closest('main#contenido')), visible: box.width > 1 && box.height > 1,
      hasProxy: Boolean(proxy && proxy.getBoundingClientRect().width > 1),
      name: `${element.tagName.toLowerCase()} «${(element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent) || element.getAttribute('type') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}»`,
      style: [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.textDecorationLine,
        parent?.boxShadow, parent?.outlineStyle, parent?.outlineColor, parent?.borderColor, parent?.backgroundColor].join('|'),
    };
  });
  const seen = new Set();
  for (let stop = 0; stop < MAX_FOCUS_STOPS; stop += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const focused = await look();
    // Past the page's last control the focus leaves the document: that is the end of the tab order, not a lost focus.
    if (!focused) break;
    if (!focused.inMain || seen.has(focused.id)) break;
    seen.add(focused.id);
    coverage.focusStops += 1;
    if (!focused.visible && !focused.hasProxy) { add('focus-lost', focused.name, `El foco cae en ${focused.name}, que no se ve.`); continue; }
    // The same element without the focus: one step back and forth with the keyboard.
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(60);
    const unfocusedStyle = await page.evaluate(id => {
      const element = document.querySelector(`[data-ia-stop="${id}"]`);
      if (!element) return null;
      const style = getComputedStyle(element);
      const proxy = (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) || element.closest('label') || element.parentElement;
      const parent = proxy ? getComputedStyle(proxy) : null;
      return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.textDecorationLine,
        parent?.boxShadow, parent?.outlineStyle, parent?.outlineColor, parent?.borderColor, parent?.backgroundColor].join('|');
    }, focused.id);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    if (unfocusedStyle !== null && unfocusedStyle === focused.style) add('no-visible-focus', focused.name, `Con el teclado, ${focused.name} no muestra que tiene el foco.`);
  }
}

/** The page with every read failing, or taking SLOW_MS: Supabase rows and the app's own API. Auth keeps working. */
async function routeReads(page, mode) {
  const handler = async route => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falla de prueba', message: 'Falla de prueba' }) });
    await new Promise(done => setTimeout(done, SLOW_MS));
    return route.fallback();
  };
  await page.route(`${SUPABASE_URL}/rest/v1/**`, handler);
  await page.route(`${APP_URL}/api/**`, handler);
}

/** The text of the page's main area once it loaded with its data: the reference for the error and slow checks. */
async function mainText(browser, data, route, persona) {
  const { context, page } = await newPage(browser, data, persona, DESKTOP);
  try {
    await page.goto(`${APP_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    return await page.evaluate(() => ((document.querySelector('main#contenido') || document.body).innerText || '').replace(/\s+/g, ' ').trim());
  } finally {
    await context.close().catch(() => {});
  }
}

async function checkErrorMode(browser, data, route, persona, add, coverage) {
  // A page that reads nothing looks the same with every read failing: there is nothing for it to say.
  const normal = await mainText(browser, data, route, persona).catch(() => null);
  const { context, page, errors } = await newPage(browser, data, persona, DESKTOP);
  try {
    await routeReads(page, 'error');
    await page.goto(`${APP_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    coverage.error = true;
    await page.screenshot({ path: path.join(outDir, 'shots', `${shotName(route.path)}-error.png`) }).catch(() => {});
    const state = await page.evaluate(({ errorWords, emptyWords }) => {
      const main = document.querySelector('main#contenido') || document.body;
      const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
      // Toasts live outside <main>; the menu's own notices (workspaces) do not speak for the page.
      const alert = [...document.querySelectorAll('li[role="status"], [data-sonner-toast], [role="region"] ol li')]
        .filter(element => !element.closest('[data-sidebar], nav, aside')).map(element => element.innerText || '').join(' ');
      return {
        length: text.length, crashed: /Algo salió mal|Application error|Unhandled Runtime Error/i.test(document.body.innerText || ''),
        // The failing reads answer «Falla de prueba»: a page that shows the server's message is telling the person.
        errorShown: new RegExp(errorWords, 'i').test(`${text} ${alert}`) || /Falla de prueba/.test(`${text} ${alert}`),
        emptyShown: new RegExp(emptyWords, 'i').test(text), sample: text.slice(0, 160), text,
      };
    }, { errorWords: ERROR_WORDS.source, emptyWords: EMPTY_WORDS.source });
    const unchanged = normal !== null && normal === state.text;
    // «Empty» counts only when it is new: a help text that says «aún no…» with or without data is not an empty state.
    const emptyPhrases = text => new Set((text.match(new RegExp(`.{0,30}(?:${EMPTY_WORDS.source}).{0,30}`, 'gi')) || []).map(phrase => phrase.trim()));
    const before = normal === null ? new Set() : emptyPhrases(normal);
    state.emptyShown = [...emptyPhrases(state.text)].some(phrase => !before.has(phrase));
    if (state.crashed || state.length < 20) add('crash-on-error', 'error', `Con las lecturas fallando, la página ${state.crashed ? 'muestra el error genérico' : 'queda en blanco'}: «${state.sample}»`);
    else if (unchanged) { /* nothing on the page depends on the reads */ }
    else if (!state.errorShown && state.emptyShown) add('empty-on-error', 'error', `Con las lecturas fallando, la página dice que está vacía en vez de avisar el error: «${state.sample}»`);
    else if (!state.errorShown) add('silent-error', 'error', `Con las lecturas fallando, la página no avisa nada: «${state.sample}»`);
    for (const message of new Set(errors)) add('page-error', `error-mode ${message}`, `Con las lecturas fallando: ${message}`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function checkSlowMode(browser, data, route, persona, add, coverage) {
  const { context, page } = await newPage(browser, data, persona, DESKTOP);
  try {
    await routeReads(page, 'slow');
    await page.goto(`${APP_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    coverage.slow = true;
    await page.screenshot({ path: path.join(outDir, 'shots', `${shotName(route.path)}-slow.png`) }).catch(() => {});
    const state = await page.evaluate(({ emptyWords, loadingWords }) => {
      const main = document.querySelector('main#contenido') || document.body;
      const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const busy = [...main.querySelectorAll('[aria-busy="true"], [class*="animate-pulse"], [class*="animate-spin"], [role="progressbar"], [data-loading="true"]')].some(visible);
      const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
      return { busy: busy || new RegExp(loadingWords, 'i').test(text), empty: new RegExp(emptyWords, 'i').test(text), sample: text.slice(0, 160), text };
    }, { emptyWords: EMPTY_WORDS.source, loadingWords: LOADING_WORDS.source });
    if (!state.busy) {
      // What the page shows once its data arrives: if nothing changes, it never depended on it.
      await page.waitForTimeout(SLOW_MS + 2500);
      const later = await page.evaluate(() => ((document.querySelector('main#contenido') || document.body).innerText || '').replace(/\s+/g, ' ').trim());
      const changed = later !== state.text;
      const stillEmpty = new RegExp(EMPTY_WORDS.source, 'i').test(later);
      if (changed && state.empty && !stillEmpty) add('empty-while-loading', 'slow', `Mientras carga, la página dice que está vacía y después muestra datos: «${state.sample}»`);
      else if (changed) add('no-loading-state', 'slow', `Durante ${SLOW_MS / 1000} s de carga no se ve que está cargando, y después cambia: «${state.sample}»`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function checkLong(browser, data, route, persona, add, coverage) {
  for (const viewport of [PHONE, DESKTOP]) {
    const { context, page } = await newPage(browser, data, persona, viewport);
    try {
      await open(page, route.path);
      coverage.long = true;
      const overflow = await horizontalOverflow(page).catch(() => ({ overflow: 0, offenders: [] }));
      if (overflow.overflow > 1) add('long-overflow', `${viewport.width}`, `${viewport.width}px: ${overflow.overflow}px de más con textos largos. ${overflow.offenders.map(item => item.selector).join(' | ')}`);
    } finally {
      await context.close().catch(() => {});
    }
  }
}

function writeReport(results) {
  const findings = results.flatMap(result => result.findings.map(finding => ({ ...finding, path: result.path, name: result.name, persona: result.persona })));
  const bySeverity = { crítico: 0, grave: 0, moderado: 0, leve: 0 };
  for (const finding of findings) bySeverity[SEVERITY[finding.type] || 'leve'] += 1;
  const byType = {};
  for (const finding of findings) byType[finding.type] = (byType[finding.type] || 0) + 1;
  const lines = [
    `# Recorrido de interacciones · ${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
    `Revisiones: ${options.checks.join(', ')} · personas: ${options.personas.join(', ')} · ${results.length} visitas.`, '',
    `**Hallazgos: ${findings.length}** (críticos ${bySeverity.crítico}, graves ${bySeverity.grave}, moderados ${bySeverity.moderado}, leves ${bySeverity.leve}).`, '',
    '## Por tipo', '', '| Tipo | Gravedad | Hallazgos |', '|---|---|---:|',
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => `| ${LABELS[type] || type} | ${SEVERITY[type] || 'leve'} | ${count} |`), '',
    '## Cobertura por página', '', '| Página | Persona | Menús y diálogos | Pestañas | Paradas de foco | Error | Lento | Textos largos | Hallazgos |', '|---|---|---:|---:|---:|---|---|---|---:|',
    ...results.map(result => `| ${result.name} \`${result.path}\` | ${result.persona} | ${result.coverage.overlays} | ${result.coverage.tabs} | ${result.coverage.focusStops} | ${result.coverage.error ? 'sí' : '—'} | ${result.coverage.slow ? 'sí' : '—'} | ${result.coverage.long ? 'sí' : '—'} | ${result.findings.length} |`), '',
    '## Hallazgos', '',
  ];
  for (const result of results.filter(item => item.findings.length)) {
    lines.push(`### ${result.name} · \`${result.path}\` · ${result.persona}`, '');
    for (const finding of result.findings) lines.push(`- **${LABELS[finding.type] || finding.type}** (${SEVERITY[finding.type] || 'leve'}${finding.width ? `, ${finding.width}px` : ''}): ${finding.detail}`);
    lines.push('');
  }
  writeFileSync(path.join(outDir, 'interactions.md'), `${lines.join('\n')}\n`);
  writeFileSync(path.join(outDir, 'interactions.json'), JSON.stringify({ startedAt: startedAt.toISOString(), options, results }, null, 2));
  return { total: findings.length, bySeverity };
}

async function main() {
  assertNoDotEnv();
  mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const ownerEmail = coworkOwnerEmail();
  const built = await buildDatasets({ ownerEmail, now: startedAt.getTime() });
  built.datasets.long = longDataset(built.datasets.full);
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
    const { readFileSync, existsSync } = await import('node:fs');
    const axePath = path.join(ROOT, 'node_modules/axe-core/axe.min.js');
    const axeSource = existsSync(axePath) ? readFileSync(axePath, 'utf8') : null;
    const routes = routeList(built.ctx)
      .filter(route => route.area === 'app' && !route.redirectsTo && !route.notFound && !route.oauth)
      .filter(route => !options.routes || options.routes.some(wanted => route.path === wanted || (wanted !== '/' && route.path.startsWith(`${wanted.replace(/\/$/, '')}/`))));
    const visits = options.personas.flatMap(persona => routes.filter(route => persona === 'owner' || !route.gate).map(route => ({ persona, route })));
    const results = [];
    const runAll = async (items, work) => {
      let next = 0;
      const worker = async () => { while (next < items.length) { const item = items[next++]; await work(item); } };
      await Promise.all(Array.from({ length: options.concurrency }, worker));
    };
    const resultFor = ({ persona, route }) => {
      let result = results.find(item => item.persona === persona && item.path === route.path);
      if (!result) {
        result = { persona, path: route.path, name: route.name, findings: [], coverage: { overlays: 0, tabs: 0, focusStops: 0, error: false, slow: false, long: false } };
        results.push(result);
      }
      const add = (type, key, detail, width) => {
        const id = `${type}|${normalize(key)}|${width || ''}`;
        if (result.findings.some(finding => finding.id === id)) return;
        result.findings.push({ id, type, key: normalize(key).slice(0, 160), detail: String(detail).slice(0, 500), width });
      };
      return { result, add };
    };

    // 1. Overlays, tabs and the keyboard, on the full dataset: desktop for everyone, and the phone for the owner.
    supabase.reset('full');
    const interactive = ['overlays', 'tabs', 'keyboard'].filter(check => options.checks.includes(check));
    if (interactive.length) {
      log(`Interacciones: ${visits.length} visitas.`);
      await runAll(visits, async visit => {
        const { result, add } = resultFor(visit);
        const viewports = visit.persona === 'owner' ? [DESKTOP, PHONE] : [DESKTOP];
        for (const viewport of viewports) {
          const records = [];
          const { context, page, errors } = await newPage(browser, built, visit.persona, viewport, { records });
          const addAt = (type, key, detail) => add(type, key, detail, viewport === PHONE ? 390 : undefined);
          try {
            await open(page, visit.route.path);
            records.length = 0;
            const includeShell = visit.route.path === '/';
            if (interactive.includes('overlays')) await checkOverlays(page, { routePath: visit.route.path, includeShell, add: addAt, records, errors, axeSource, coverage: result.coverage });
            if (viewport === DESKTOP && interactive.includes('tabs')) { await open(page, visit.route.path); await checkTabs(page, { add: addAt, coverage: result.coverage }); }
            if (viewport === DESKTOP && interactive.includes('keyboard')) { await open(page, visit.route.path); await checkKeyboard(page, { add: addAt, coverage: result.coverage }); }
          } catch (error) {
            addAt('page-error', `walk ${error.message.split('\n')[0]}`, `El recorrido no terminó: ${error.message.split('\n')[0]}`);
          } finally {
            await context.close().catch(() => {});
          }
        }
        log(`${visit.persona.padEnd(6)} ${visit.route.path} · ${result.findings.length} hallazgos`);
      });
    }

    // 2. Every read failing, and every read slow: desktop, owner.
    const ownerVisits = visits.filter(visit => visit.persona === 'owner');
    if (options.checks.includes('error') || options.checks.includes('slow')) {
      log(`Errores y carga lenta: ${ownerVisits.length} páginas.`);
      await runAll(ownerVisits, async visit => {
        const { result, add } = resultFor(visit);
        if (options.checks.includes('error')) await checkErrorMode(browser, built, visit.route, visit.persona, add, result.coverage);
        if (options.checks.includes('slow')) await checkSlowMode(browser, built, visit.route, visit.persona, add, result.coverage);
      });
    }

    // 3. Long texts: the owner, on the phone and the desktop.
    if (options.checks.includes('long')) {
      supabase.reset('long');
      log(`Textos largos: ${ownerVisits.length} páginas.`);
      await runAll(ownerVisits, async visit => {
        const { result, add } = resultFor(visit);
        await checkLong(browser, built, visit.route, visit.persona, add, result.coverage);
      });
      supabase.reset('full');
    }

    await browser.close();
    const order = new Map(routes.map((route, index) => [route.path, index]));
    results.sort((a, b) => options.personas.indexOf(a.persona) - options.personas.indexOf(b.persona) || order.get(a.path) - order.get(b.path));
    const { total, bySeverity } = writeReport(results);
    log(`Listo: ${path.relative(ROOT, outDir)}/interactions.md · ${total} hallazgos (críticos ${bySeverity.crítico}, graves ${bySeverity.grave}, moderados ${bySeverity.moderado}, leves ${bySeverity.leve}).`);
  } finally {
    await stop();
  }
}

main().catch(error => { console.error(`[interacciones] ${error.stack || error.message}`); process.exit(1); });
