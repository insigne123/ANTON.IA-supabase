import { randomBytes } from 'node:crypto';
import { parse, type Node as AcornNode } from 'acorn';
import { JSDOM } from 'jsdom';
import { COWORK_ARTIFACT_BASE_CSS, COWORK_ARTIFACT_RUNTIME_JS } from '@/lib/cowork/artifact-runtime';

/**
 * Code artifacts (Plan 12, 3a): Cowork writes the HTML, the CSS and the JavaScript of a page and
 * the app shows it beside the chat, isolated. This file checks that code, guards its loops and
 * assembles the document: the `antonia` runtime (artifact-runtime.ts), the data the server read in
 * JSON, and the artifact's own code, under a CSP that leaves it without network, frames, forms or
 * eval, and with only the document's own scripts (nonce).
 *
 * The walls, from the outside in:
 * 1. The app frames it with `sandbox="allow-scripts"` (opaque origin: no cookies, no app, no
 *    popups, no forms, no top navigation) and the page that frames it allows frames only from
 *    itself (`frame-src 'self'`, next.config.js), so the artifact cannot navigate itself out.
 * 2. The route serves it with a sandbox CSP and the document carries its own CSP in `<meta>`
 *    (also when downloaded): `default-src 'none'`, scripts by nonce only.
 * 3. This check refuses what it can see (network, navigation, storage, eval, other frames) with a
 *    message the writer can act on, and the runtime cleans HTML written at run time.
 * The model writes the design and the logic, never the figures: those come in `antonia.data`.
 */

export type CoworkCodeArtifact = { html: string; css: string; js: string };
export type CoworkArtifactCodeIssue = { part: 'html' | 'css' | 'js' | 'size' | 'data'; message: string; line?: number };

export type CoworkArtifactColumnType = 'text' | 'number' | 'money' | 'percent' | 'date';
export type CoworkArtifactColumn = { key: string; label: string; type: CoworkArtifactColumnType };
export type CoworkArtifactCell = string | number | boolean | null;
export type CoworkArtifactTable = {
  label: string; source: string; columns: CoworkArtifactColumn[];
  rows: Array<Record<string, CoworkArtifactCell>>; total: number; truncated: boolean;
};
export type CoworkArtifactData = { tables: Record<string, CoworkArtifactTable>; currency?: string; timeZone?: string };

export const COWORK_ARTIFACT_CODE_MAX_BYTES = 200_000;
export const COWORK_ARTIFACT_DATA_MAX_ROWS = 2000;
export const COWORK_ARTIFACT_DATA_MAX_BYTES = 1_500_000;

const BLOCKED_TAG = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|form|base|meta|link|portal|noscript|template|fencedframe|plaintext|xmp|noembed|noframes)\b/i;
// SVG and XHTML namespaces are names, not addresses: they are the only URLs the code may carry.
const NAMESPACES = /https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace|2000\/xmlns\/?)/gi;
const URL_PATTERN = /\b(?:https?|ftp|wss?|file):\/\/|(?:^|[\s"'(=])\/\/[a-z0-9-]+\.[a-z]/i;
const EXTERNAL_URL = { exec: (text: string) => URL_PATTERN.exec(text.replace(NAMESPACES, match => ' '.repeat(match.length))), test: (text: string) => URL_PATTERN.test(text.replace(NAMESPACES, '')) };

const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');
const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

type Pattern = { exec: (text: string) => RegExpExecArray | null };

function htmlIssues(html: string): CoworkArtifactCodeIssue[] {
  const issues: CoworkArtifactCodeIssue[] = [];
  const add = (pattern: Pattern, message: string) => {
    const match = pattern.exec(html);
    if (match) issues.push({ part: 'html', message, line: lineAt(html, match.index) });
  };
  const tag = BLOCKED_TAG.exec(html);
  if (tag) {
    const name = tag[1].toLowerCase();
    issues.push({ part: 'html', line: lineAt(html, tag.index), message: name === 'script'
      ? 'El HTML no puede traer <script>: el código va en js.'
      : `<${name}> no está permitido en un artefacto: no tiene red, formularios ni otras páginas.` });
    return issues;
  }
  add(/\son[a-z]+\s*=/i, 'Sin atributos on… (onclick, onload): agrega los eventos con addEventListener en js.');
  add(/javascript\s*:/i, 'Sin enlaces javascript:.');
  add(/\s(?:src|srcset|action|formaction|poster|background|ping|data|srcdoc)\s*=\s*(?!["']?\s*data:image\/)/i, 'Sin archivos externos: las imágenes van como data:image/… y los datos están en antonia.data.');
  add(/\s(?:href|xlink:href)\s*=\s*(?!["']?\s*#)/i, 'Los enlaces solo pueden ir a una sección del mismo artefacto (href="#…").');
  add(/url\s*\(\s*(?!["']?\s*(?:data:image\/|#))/i, 'Sin url() externas en estilos.');
  add(EXTERNAL_URL, 'Sin direcciones externas: el artefacto no tiene red.');
  // A comment, a quote or a <textarea>/<style> left open swallows the code that comes after the
  // HTML: parse it as the page will and look for the script that follows.
  if (!issues.length && html.trim()) {
    const dom = new JSDOM(`<!doctype html><body>${html}<script id="antonia-end"></script>`);
    if (!dom.window.document.getElementById('antonia-end')) {
      issues.push({ part: 'html', message: 'El HTML deja algo abierto (un comentario <!--, unas comillas o un <textarea>/<style>/<title>) y se come lo que viene después: ciérralo.' });
    }
    dom.window.close();
  }
  return issues;
}

function cssIssues(css: string): CoworkArtifactCodeIssue[] {
  const issues: CoworkArtifactCodeIssue[] = [];
  const add = (pattern: Pattern, message: string) => {
    const match = pattern.exec(css);
    if (match) issues.push({ part: 'css', message, line: lineAt(css, match.index) });
  };
  add(/<\s*\/\s*style/i, 'El CSS no puede cerrar la etiqueta <style>.');
  add(/<\s*(?:script|!--)/i, 'El CSS no puede traer etiquetas HTML.');
  add(/@import/i, 'Sin @import: el artefacto no tiene red.');
  add(/url\s*\(\s*(?!["']?\s*(?:data:image\/|data:font\/|#))/i, 'Sin url() externas: solo data:image/… o data:font/….');
  add(/expression\s*\(|behavior\s*:|-moz-binding/i, 'Ese CSS ejecuta código y no está permitido.');
  add(EXTERNAL_URL, 'Sin direcciones externas: el artefacto no tiene red.');
  return issues;
}

// Names the artifact's code cannot reach: network, navigation, other windows, storage, eval,
// dialogs (the frame has none) and the runtime's own hooks.
const BLOCKED_GLOBALS: Record<string, string> = {
  fetch: 'El artefacto no tiene red: los datos ya están en antonia.data.',
  XMLHttpRequest: 'El artefacto no tiene red: los datos ya están en antonia.data.',
  WebSocket: 'El artefacto no tiene red.', EventSource: 'El artefacto no tiene red.', WebTransport: 'El artefacto no tiene red.',
  RTCPeerConnection: 'El artefacto no tiene red.', Worker: 'Sin workers en un artefacto.', SharedWorker: 'Sin workers en un artefacto.',
  importScripts: 'Sin scripts externos.', eval: 'Sin eval.', Function: 'Sin new Function.',
  location: 'El artefacto no puede navegar.', top: 'El artefacto no puede tocar la app.', parent: 'El artefacto no puede tocar la app.',
  opener: 'El artefacto no puede tocar otras ventanas.', frames: 'El artefacto no puede tocar otras ventanas.', frameElement: 'El artefacto no puede tocar la app.',
  open: 'El artefacto no abre ventanas.', close: 'El artefacto no cierra ventanas.', print: 'Imprimir lo ofrece el panel.',
  alert: 'Sin alert: muestra el mensaje en la página.', confirm: 'Sin confirm: muestra la pregunta en la página.', prompt: 'Sin prompt: usa un campo en la página.',
  navigator: 'El artefacto no usa navigator.', postMessage: 'El artefacto no envía mensajes.',
  localStorage: 'Sin almacenamiento: el artefacto vive en una sola vista.', sessionStorage: 'Sin almacenamiento: el artefacto vive en una sola vista.',
  indexedDB: 'Sin almacenamiento.', caches: 'Sin almacenamiento.', cookieStore: 'Sin cookies.',
  Reflect: 'Sin Reflect.', WebAssembly: 'Sin WebAssembly.', DOMParser: 'Arma el HTML con antonia.h o innerHTML.', XSLTProcessor: 'Sin XSLT.',
  Notification: 'Sin notificaciones.',
};
// Common words the code may declare for itself (function walk(node, parent)): once declared, a
// reference is taken as the code's own. Other frames and the top page are out of reach anyway
// (the sandbox has no top navigation); network, eval, storage and location never are.
const SHADOWABLE = new Set(['top', 'parent', 'opener', 'frames', 'open', 'close', 'print', 'alert', 'confirm', 'prompt', 'navigator', 'caches', 'Notification', 'self', 'frameElement']);
// Objects whose members are the window's: window.fetch, self.location, document.cookie.
const WINDOW_ALIASES = new Set(['window', 'self', 'globalThis', 'frames', 'document']);
// Members the code cannot read on any object, because they lead out of the artifact.
const BLOCKED_MEMBERS: Record<string, string> = {
  cookie: 'Sin cookies.', defaultView: 'El artefacto no puede tocar la ventana.', frameElement: 'El artefacto no puede tocar la app.',
  opener: 'El artefacto no puede tocar otras ventanas.', sendBeacon: 'El artefacto no tiene red.', contentWindow: 'Sin otros marcos.',
  contentDocument: 'Sin otros marcos.', srcdoc: 'Sin otros marcos.', httpEquiv: 'Las etiquetas <meta> no se cambian.',
  postMessage: 'El artefacto no envía mensajes.', importScripts: 'Sin scripts externos.', constructor: 'Sin acceso a constructor.',
  write: 'Sin document.write: usa antonia.mount o innerHTML.', writeln: 'Sin document.write.', domain: 'Sin document.domain.',
};
const BLOCKED_STRINGS: Array<[{ test: (text: string) => boolean }, string]> = [
  [EXTERNAL_URL, 'Sin direcciones externas: el artefacto no tiene red.'],
  [/javascript\s*:/i, 'Sin enlaces javascript:.'],
  [/http-equiv|<\s*meta\b/i, 'Las etiquetas <meta> no están permitidas.'],
];
const BLOCKED_CREATE = /^(?:script|iframe|frame|frameset|object|embed|applet|form|base|meta|link|portal|noscript|template|fencedframe)$/i;

type AnyNode = AcornNode & Record<string, unknown>;

function walk(node: unknown, visit: (node: AnyNode, parent: AnyNode | null) => void, parent: AnyNode | null = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit, parent); return; }
  const current = node as AnyNode;
  if (typeof current.type !== 'string') return;
  visit(current, parent);
  for (const key of Object.keys(current)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = current[key];
    if (value && typeof value === 'object') walk(value, visit, current);
  }
}

// The code runs inside `(async function(){'use strict';…})()`: strict, top-level await allowed,
// and `this` is not the window. The prefix has no newline, so lines keep their numbers.
const CODE_PREFIX = "(async function(){'use strict';";
const CODE_SUFFIX = '\n})().catch(function(error){window.__antoniaReport(error)});';

function parseCode(js: string) {
  return parse(`${CODE_PREFIX}${js}\n})();`, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
}

function jsIssues(js: string): CoworkArtifactCodeIssue[] {
  if (/<\s*\/\s*script/i.test(js) || /<!--/.test(js)) {
    return [{ part: 'js', message: 'El código no puede contener "</script" ni "<!--": si lo necesitas en un texto, divídelo (\'<\' + \'/script\').' }];
  }
  let program: AcornNode;
  try {
    program = parseCode(js);
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const message = error instanceof Error ? error.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : 'Error de sintaxis';
    return [{ part: 'js', message: `Error de sintaxis: ${message}.`, ...(loc ? { line: loc.line } : {}) }];
  }
  const issues: CoworkArtifactCodeIssue[] = [];
  const seen = new Set<string>();
  // Names the code declares itself: variables, functions, classes, parameters, catch bindings.
  const declared = new Set<string>();
  const declare = (pattern: unknown) => walk(pattern, (node, parent) => {
    if (node.type !== 'Identifier') return;
    if (parent && parent.type === 'Property' && parent.key === node && parent.value !== node) return;
    if (parent && parent.type === 'AssignmentPattern' && parent.right === node) return;
    if (parent && parent.type === 'MemberExpression') return;
    declared.add(String(node.name));
  });
  walk(program, node => {
    if (node.type === 'VariableDeclarator') declare(node.id);
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.id) declare(node.id);
      declare(node.params);
    } else if (node.type === 'ClassDeclaration' && node.id) declare(node.id);
    else if (node.type === 'CatchClause' && node.param) declare(node.param);
  });
  const add = (node: AnyNode, message: string) => {
    const line = (node.loc as { start: { line: number } } | undefined)?.start.line;
    const key = `${message}@${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ part: 'js', message, ...(line ? { line } : {}) });
  };
  walk(program, (node, parent) => {
    if (node.type === 'ImportExpression' || node.type === 'MetaProperty') { add(node, 'Sin import: todo va en el mismo código.'); return; }
    if (node.type === 'WithStatement') { add(node, 'Sin with.'); return; }
    if (node.type === 'Identifier') {
      const name = String(node.name);
      if (name.startsWith('__antonia')) { add(node, 'Los nombres que empiezan con __antonia son del motor.'); return; }
      // A name in a property position (obj.name, { name: … }, class methods) is not a reference.
      const isProperty = parent && ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed)
        || ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && parent.key === node && !parent.computed));
      if (isProperty) return;
      if (SHADOWABLE.has(name) && declared.has(name)) return;
      if (BLOCKED_GLOBALS[name]) { add(node, `${name}: ${BLOCKED_GLOBALS[name]}`); return; }
      // window, self, document… only as the object of a member: no aliases (const w = window).
      if (WINDOW_ALIASES.has(name) && !(parent && parent.type === 'MemberExpression' && parent.object === node)) {
        add(node, `${name} solo se usa como ${name}.algo: no se guarda ni se pasa.`);
      }
      return;
    }
    if (node.type === 'MemberExpression') {
      const object = node.object as AnyNode;
      const property = node.property as AnyNode;
      const name = !node.computed && property.type === 'Identifier' ? String(property.name)
        : property.type === 'Literal' && typeof property.value === 'string' ? property.value : null;
      if (name && BLOCKED_MEMBERS[name]) { add(node, `.${name}: ${BLOCKED_MEMBERS[name]}`); return; }
      if (object.type === 'Identifier' && WINDOW_ALIASES.has(String(object.name)) && !(SHADOWABLE.has(String(object.name)) && declared.has(String(object.name)))) {
        if (name === null) { add(node, `${object.name}[…] no está permitido: usa el nombre directo.`); return; }
        if (BLOCKED_GLOBALS[name]) add(node, `${object.name}.${name}: ${BLOCKED_GLOBALS[name]}`);
        else if (name === 'location' || name === 'open' || name === 'close') add(node, `${object.name}.${name}: el artefacto no navega ni abre ventanas.`);
      }
      return;
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee as AnyNode;
      const args = (node.arguments as AnyNode[]) || [];
      const calleeName = callee.type === 'Identifier' ? String(callee.name)
        : callee.type === 'MemberExpression' && !callee.computed && (callee.property as AnyNode).type === 'Identifier' ? String((callee.property as AnyNode).name) : '';
      if ((calleeName === 'setTimeout' || calleeName === 'setInterval') && args[0] && (args[0].type === 'Literal' || args[0].type === 'TemplateLiteral')) {
        add(node, `${calleeName} recibe una función, no un texto.`);
      }
      if ((calleeName === 'createElement' || calleeName === 'createElementNS') && args.length) {
        const tagArg = args[calleeName === 'createElementNS' ? 1 : 0];
        if (tagArg && tagArg.type === 'Literal' && typeof tagArg.value === 'string' && BLOCKED_CREATE.test(tagArg.value.split(':').pop() || '')) {
          add(node, `<${tagArg.value}> no está permitido en un artefacto.`);
        }
      }
      return;
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      for (const [pattern, message] of BLOCKED_STRINGS) if (pattern.test(node.value)) { add(node, message); break; }
      return;
    }
    if (node.type === 'TemplateElement') {
      const cooked = String((node.value as { cooked?: string; raw: string }).cooked ?? (node.value as { raw: string }).raw);
      for (const [pattern, message] of BLOCKED_STRINGS) if (pattern.test(cooked)) { add(node, message); break; }
    }
  });
  return issues;
}

/** What is wrong with a code artifact, as messages the writer can act on. Empty when it is fine. */
export function checkCoworkArtifactCode(code: CoworkCodeArtifact): CoworkArtifactCodeIssue[] {
  const html = String(code.html ?? '');
  const css = String(code.css ?? '');
  const js = String(code.js ?? '');
  const size = byteLength(html) + byteLength(css) + byteLength(js);
  if (size > COWORK_ARTIFACT_CODE_MAX_BYTES) {
    return [{ part: 'size', message: `El código pesa ${Math.round(size / 1000)} KB y el máximo es ${COWORK_ARTIFACT_CODE_MAX_BYTES / 1000} KB: los datos van en antonia.data, no en el código.` }];
  }
  if (!html.trim() && !js.trim()) return [{ part: 'html', message: 'El artefacto está vacío: falta el HTML o el código.' }];
  return [...htmlIssues(html), ...cssIssues(css), ...jsIssues(js)];
}

/**
 * Puts `__antoniaLoop();` at the start of every loop body, so a loop that never ends throws after
 * two seconds instead of freezing the tab (the runtime's clock, reset each time the page gets a
 * turn). Lines keep their numbers. Throws on code that does not parse: check it first.
 */
export function guardCoworkArtifactLoops(js: string): string {
  const offset = CODE_PREFIX.length;
  const program = parseCode(js);
  const inserts: Array<{ at: number; text: string }> = [];
  walk(program, node => {
    if (!['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type)) return;
    const body = node.body as AnyNode;
    if (body.type === 'BlockStatement') inserts.push({ at: body.start + 1 - offset, text: '__antoniaLoop();' });
    else {
      inserts.push({ at: body.start - offset, text: '{__antoniaLoop();' });
      inserts.push({ at: body.end - offset, text: '}' });
    }
  });
  // From the end, so earlier positions stay valid; at the same position, a closing brace goes
  // before an opening one (a body that ends where another starts).
  inserts.sort((a, b) => b.at - a.at || (a.text === '}' ? 1 : -1));
  let out = js;
  for (const insert of inserts) out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  return out;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
// JSON inside <script type="application/json">: no "<" at all, so nothing can close the tag.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
  .split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

const COLUMN_TYPES = new Set<CoworkArtifactColumnType>(['text', 'number', 'money', 'percent', 'date']);

/** The data as it goes into the page: known column types, plain cells, at most 2,000 rows a table. */
export function normalizeCoworkArtifactData(data: CoworkArtifactData): CoworkArtifactData {
  const tables: Record<string, CoworkArtifactTable> = {};
  for (const [key, table] of Object.entries(data.tables || {})) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || !table) continue;
    const columns = (table.columns || []).slice(0, 30).map(column => ({
      key: String(column.key).slice(0, 60), label: String(column.label || column.key).slice(0, 80),
      type: COLUMN_TYPES.has(column.type) ? column.type : 'text' as const,
    }));
    const rows = (table.rows || []).slice(0, COWORK_ARTIFACT_DATA_MAX_ROWS).map(row => Object.fromEntries(columns.map(column => {
      const value = row?.[column.key];
      const cell: CoworkArtifactCell = typeof value === 'number' ? (Number.isFinite(value) ? value : null)
        : typeof value === 'boolean' ? value : typeof value === 'string' ? value.slice(0, 500) : null;
      return [column.key, cell];
    })));
    const total = Number.isFinite(table.total) ? Math.max(rows.length, Math.round(table.total)) : rows.length;
    tables[key] = { label: String(table.label || key).slice(0, 80), source: String(table.source || '').slice(0, 120), columns, rows, total,
      truncated: Boolean(table.truncated) || total > rows.length };
  }
  return { tables, currency: /^[A-Z]{3}$/.test(data.currency || '') ? data.currency : 'CLP', timeZone: data.timeZone || 'America/Santiago' };
}

export type CoworkArtifactDocument = { ok: true; html: string; bytes: number } | { ok: false; issues: CoworkArtifactCodeIssue[] };

/**
 * The whole artifact as one HTML file: CSP, the app's theme, the runtime, the data and the code.
 * It works the same in the app's frame and downloaded. `nonce` is for tests; each build gets its own.
 */
export function buildCoworkArtifactDocument(input: { title: string; code: CoworkCodeArtifact; data: CoworkArtifactData; generatedAt?: string; nonce?: string }): CoworkArtifactDocument {
  const issues = checkCoworkArtifactCode(input.code);
  if (issues.length) return { ok: false, issues };
  const data = normalizeCoworkArtifactData(input.data);
  const json = scriptJson({ title: input.title, generatedAt: input.generatedAt || null, currency: data.currency, timeZone: data.timeZone, tables: data.tables });
  if (byteLength(json) > COWORK_ARTIFACT_DATA_MAX_BYTES) {
    return { ok: false, issues: [{ part: 'data', message: `Los datos pesan ${Math.round(byteLength(json) / 1000)} KB y el máximo es ${COWORK_ARTIFACT_DATA_MAX_BYTES / 1000} KB: pide menos filas o columnas.` }] };
  }
  const nonce = input.nonce && /^[a-z0-9]{16,64}$/i.test(input.nonce) ? input.nonce : randomBytes(18).toString('hex');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'`;
  const head = [
    '<!doctype html>',
    '<html lang="es" data-theme="light">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(String(input.title || 'Artefacto').slice(0, 120))}</title>`,
    `<style>${COWORK_ARTIFACT_BASE_CSS}</style>`,
    `<style>${input.code.css || ''}</style>`,
    `<script type="application/json" id="antonia-data">${json}</script>`,
    `<script nonce="${nonce}">${COWORK_ARTIFACT_RUNTIME_JS}</script>`,
    '</head>',
    '<body>',
    // One <main> holds the artifact, unless its HTML brings its own.
    /<main[\s>]/i.test(input.code.html || '') ? input.code.html : `<main id="antonia-root">\n${input.code.html || ''}\n</main>`,
  ].join('\n');
  // The line the artifact's code starts on, so an error can say which line of its code failed.
  const line = `${head}\n`.split('\n').length;
  // window.__antoniaStart() tells the runtime the code was reached (an HTML left open would swallow it).
  const html = `${head}\n<script nonce="${nonce}" id="antonia-code" data-line="${line}">window.__antoniaStart();${CODE_PREFIX}${guardCoworkArtifactLoops(input.code.js || '')}${CODE_SUFFIX}</script>\n</body>\n</html>\n`;
  return { ok: true, html, bytes: byteLength(html) };
}
