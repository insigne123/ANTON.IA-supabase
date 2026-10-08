/**
 * The `antonia` library that goes inside every code artifact (Plan 12, 3a). Cowork writes the
 * design and the logic of an artifact; the server puts the data in (`antonia.data`) and this
 * runtime gives the code the app's look and safe helpers: charts drawn in SVG with a data table
 * beside them, a table that sorts and filters, figure tiles, es-CL formats and aggregates over the
 * rows, so a figure on screen is one the data holds.
 *
 * It also guards the page before the artifact's own code runs (code-artifact.ts assembles the
 * document): HTML written into the page is cleaned of scripts, frames, forms and links out, links
 * cannot navigate, `<meta>` cannot become a refresh, loops cannot freeze the tab, and every error
 * reaches the app (`antonia-artifact` messages) so it can offer «Arreglarlo». The sandbox and the
 * CSP of the document are the real walls; this is the second line.
 *
 * Plain ES5-style JavaScript in a string, so the downloaded file works on its own. No backticks
 * and no `${` inside: the string is a String.raw template.
 */

/** Categorical colors, in fixed order (blue, orange, violet, green, red): the app's chart tokens. */
export const COWORK_ARTIFACT_SERIES = ['#3d84f5', '#fb923c', '#7456fb', '#21c45d', '#ef4343'] as const;

export const COWORK_ARTIFACT_BASE_CSS = String.raw`
:root{color-scheme:light;--bg:#f8fafc;--surface:#ffffff;--panel:#f8fafc;--text:#0f172a;--muted:#64748b;--faint:#8996a9;--border:#e2e8f0;--border-strong:#c9d2de;--accent:#0a5adb;--accent-text:#0a5adb;--accent-soft:rgba(10,90,219,.09);--on-accent:#f8fafc;--success:#047857;--success-soft:#ecfdf5;--warning:#b45309;--warning-soft:#fffbeb;--danger:#b81e1e;--danger-soft:#fef2f2;--series-1:#3d84f5;--series-2:#fb923c;--series-3:#7456fb;--series-4:#21c45d;--series-5:#ef4343;--stage-1:#6da2f8;--stage-2:#4689f6;--stage-3:#1a6df4;--stage-4:#0a57d4;--stage-5:#0846ab;--stage-6:#063581;--radius:14px;--radius-sm:10px;--shadow:0 1px 2px rgba(15,23,42,.04),0 10px 28px -16px rgba(15,23,42,.18);--font:'PT Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
:root[data-theme=dark]{color-scheme:dark;--bg:#090e1a;--surface:#0c1322;--panel:#111a2c;--text:#e1e7ef;--muted:#94a3b8;--faint:#6b7c94;--border:#1e293b;--border-strong:#344156;--accent:#3b82f6;--accent-text:#5e98f8;--accent-soft:rgba(59,130,246,.14);--on-accent:#020817;--success:#34d399;--success-soft:rgba(16,185,129,.12);--warning:#fbbf24;--warning-soft:rgba(245,158,11,.12);--danger:#e66565;--danger-soft:rgba(239,68,68,.12);--stage-1:#07409c;--stage-2:#0951c5;--stage-3:#0b63f1;--stage-4:#3780f6;--stage-5:#619af8;--stage-6:#88b3fa;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 30px -16px rgba(0,0,0,.7)}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{background:var(--bg);color:var(--text);font:15px/1.5 var(--font);-webkit-text-size-adjust:100%}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);font:inherit;overflow-wrap:anywhere}
@media (max-width:480px){body{padding:16px}}
h1,h2,h3,h4{color:var(--text);line-height:1.25;margin:0 0 8px}
h1{font-size:22px;font-weight:700;letter-spacing:-.01em}
h2{font-size:17px;font-weight:700}
h3{font-size:15px;font-weight:600}
p{margin:0 0 8px}
small,.small{font-size:13px}
.muted{color:var(--muted)}
.num{font-variant-numeric:tabular-nums}
a{color:var(--accent-text)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button,input,select,textarea{font:inherit;color:inherit}
input,select,textarea{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);min-height:36px;padding:0 10px}
.btn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px;font-weight:600}
.btn:hover{background:var(--panel)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn-primary:hover{background:var(--accent);filter:brightness(1.08)}
.chip{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px;font-weight:600}
.chip:hover{background:var(--panel)}
.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:20px}
.header p{color:var(--muted);margin:0}
.stack{display:flex;flex-direction:column;gap:16px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.grid-2{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}
.grid-3{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width:900px){.grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){.grid-2,.grid-3{grid-template-columns:minmax(0,1fr)}}
.span-all{grid-column:1/-1}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-width:0}
.card>h2:first-child,.card>h3:first-child{margin-top:0}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:var(--panel);color:var(--muted);font-size:12px;font-weight:600;line-height:18px;white-space:nowrap}
.badge-accent{background:var(--accent-soft);border-color:transparent;color:var(--accent-text)}
.badge-success{background:var(--success-soft);border-color:transparent;color:var(--success)}
.badge-warning{background:var(--warning-soft);border-color:transparent;color:var(--warning)}
.badge-danger{background:var(--danger-soft);border-color:transparent;color:var(--danger)}
.divider{height:1px;background:var(--border);border:0;margin:16px 0}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.antonia-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))}
.antonia-kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;min-width:0}
.antonia-kpi-label{margin:0;color:var(--muted);font-size:13px;font-weight:600}
.antonia-kpi-value{margin:2px 0 0;font-size:26px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--text);white-space:nowrap;overflow-wrap:normal;overflow:hidden;text-overflow:ellipsis}
.antonia-kpi-foot{margin:4px 0 0;font-size:12.5px;color:var(--muted)}
.antonia-delta{font-weight:700;font-variant-numeric:tabular-nums}
.antonia-delta.is-up{color:var(--success)}
.antonia-delta.is-down{color:var(--danger)}
.antonia-chart{margin:0;min-width:0}
.antonia-chart figcaption{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
.antonia-chart-title{font-size:15px;font-weight:600;color:var(--text)}
.antonia-chart-note{font-size:13px;color:var(--muted)}
.antonia-chart-plot{position:relative;width:100%}
.antonia-chart-plot svg{display:block;width:100%;overflow:visible}
.antonia-legend{display:flex;flex-wrap:wrap;gap:6px 14px;list-style:none;margin:0 0 10px;padding:0;font-size:13px;color:var(--text)}
.antonia-legend li{display:inline-flex;align-items:center;gap:6px}
.antonia-legend .antonia-swatch{width:10px;height:10px;border-radius:3px;flex:none}
.antonia-legend .antonia-legend-value{color:var(--muted);font-variant-numeric:tabular-nums}
.antonia-tooltip{position:absolute;z-index:5;pointer-events:none;min-width:120px;max-width:260px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow);font-size:12.5px;line-height:1.45;color:var(--text);opacity:0;transition:opacity .12s}
.antonia-tooltip.is-on{opacity:1}
.antonia-tooltip strong{display:block;margin-bottom:2px;font-size:13px}
.antonia-tooltip .antonia-tip-row{display:flex;align-items:center;gap:6px;justify-content:space-between}
.antonia-tooltip .antonia-tip-row span:first-child{display:inline-flex;align-items:center;gap:6px;color:var(--muted)}
.antonia-tooltip .antonia-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.antonia-chart-data{margin-top:8px;font-size:13px}
.antonia-chart-data summary{cursor:pointer;color:var(--muted);width:max-content;border-radius:6px}
.antonia-chart-data summary:hover{color:var(--text)}
.antonia-chart-data table{margin-top:8px}
.antonia-axis text,.antonia-label{fill:var(--muted);font-size:12px;font-family:var(--font)}
.antonia-value{fill:var(--text);font-size:12px;font-weight:600;font-family:var(--font);font-variant-numeric:tabular-nums}
.antonia-grid line{stroke:var(--border);stroke-width:1}
.antonia-baseline{stroke:var(--border-strong);stroke-width:1}
.antonia-hit{fill:transparent;cursor:default}
.antonia-hit:hover+.antonia-hover,.antonia-hover{pointer-events:none}
.antonia-table-wrap{min-width:0}
.antonia-table-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.antonia-table-tools input{min-width:min(100%,240px)}
.antonia-table-count{color:var(--muted);font-size:13px}
.antonia-table-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:break-word}
thead th{background:var(--panel);color:var(--muted);font-size:12.5px;font-weight:600;white-space:nowrap;position:sticky;top:0}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--accent-soft)}
td.is-num,th.is-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.antonia-sort{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;border-radius:4px}
.antonia-sort:hover{color:var(--text)}
.antonia-sort-mark{font-size:10px;opacity:.7}
.antonia-more{margin-top:8px}
.antonia-empty{padding:20px;text-align:center;color:var(--muted);font-size:13.5px}
.antonia-error{margin:0 0 16px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--danger-soft);color:var(--danger);font-size:13.5px;font-weight:600}
@media print{body{background:#fff;padding:0}.card,.antonia-kpi{break-inside:avoid}.antonia-table-tools,.antonia-more,.antonia-chart-data summary{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export const COWORK_ARTIFACT_RUNTIME_JS = String.raw`(function () {
  'use strict';
  var W = window, D = document;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LOOP_LIMIT_MS = 2000;

  function readHash() {
    var out = {};
    String(W.location.hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at <= 0) return;
      try { out[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(pair.slice(at + 1)); } catch (error) { /* ignored */ }
    });
    return out;
  }
  var hash = readHash();

  // Messages to the app: only to the origin the app named, only from this runtime.
  var host = W.parent && W.parent !== W ? W.parent : null;
  var hostOrigin = /^https?:\/\/[^\/\s]+$/.test(hash.origin || '') ? hash.origin : null;
  function send(type, detail) {
    if (!host || !hostOrigin) return;
    try { host.postMessage({ source: 'antonia-artifact', type: type, detail: detail || null }, hostOrigin); } catch (error) { /* ignored */ }
  }

  // ---- Errors ------------------------------------------------------------------------------
  var errors = [];
  function codeLine(line) {
    var script = D.getElementById('antonia-code');
    var start = script ? Number(script.getAttribute('data-line')) : NaN;
    if (!line || !isFinite(start)) return null;
    var relative = line - start + 1;
    return relative >= 1 ? relative : null;
  }
  function stackLine(error) {
    var match = error && typeof error.stack === 'string' ? /:(\d+):(\d+)\)?\s*(?:\n|$)/.exec(error.stack) : null;
    return match ? Number(match[1]) : null;
  }
  function showError() {
    if (!D.body || D.getElementById('antonia-error')) return;
    var banner = D.createElement('p');
    banner.id = 'antonia-error';
    banner.className = 'antonia-error';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'Una parte de este artefacto no se pudo mostrar.';
    D.body.insertBefore(banner, D.body.firstChild);
  }
  function report(error, line) {
    var message = error && error.message ? error.message : String(error || 'Error');
    var detail = { message: String(message).slice(0, 500), line: codeLine(line || stackLine(error)) };
    if (errors.length >= 5) return;
    errors.push(detail);
    send('error', detail);
    showError();
  }
  W.addEventListener('error', function (event) { report(event.error || event.message, event.lineno); });
  W.addEventListener('unhandledrejection', function (event) { report(event.reason, null); });
  Object.defineProperty(W, '__antoniaReport', { value: function (error) { report(error, null); } });
  var codeStarted = false;
  Object.defineProperty(W, '__antoniaStart', { value: function () { codeStarted = true; } });

  // ---- Loop guard ----------------------------------------------------------------------------
  // code-artifact.ts puts __antoniaLoop() at the start of every loop body. A run of the page that
  // keeps looping for LOOP_LIMIT_MS without giving the browser a turn throws; the message channel
  // resets the clock as soon as the page gets a turn, so async loops that wait are never cut.
  var loopArmed = false, loopStart = 0, loopCount = 0;
  var loopChannel = new MessageChannel();
  loopChannel.port1.onmessage = function () { loopArmed = false; };
  Object.defineProperty(W, '__antoniaLoop', { value: function () {
    if (!loopArmed) { loopArmed = true; loopStart = Date.now(); loopCount = 0; loopChannel.port2.postMessage(0); return; }
    if ((++loopCount & 255) === 0 && Date.now() - loopStart > LOOP_LIMIT_MS) {
      throw new Error('Un bucle no terminó en ' + (LOOP_LIMIT_MS / 1000) + ' segundos y se detuvo.');
    }
  } });

  // ---- Hardening -----------------------------------------------------------------------------
  var BLOCKED_TAGS = /^(?:script|iframe|frame|frameset|object|embed|applet|form|base|meta|link|portal|noscript|template|fencedframe)$/i;
  var URL_ATTRS = /^(?:href|xlink:href|src|srcset|action|formaction|poster|background|ping|data|srcdoc|lowsrc|dynsrc|codebase|cite|longdesc|usemap|manifest)$/i;
  function safeUrl(name, value) {
    var text = String(value || '').trim().toLowerCase();
    if (/^(?:href|xlink:href)$/i.test(name)) return text.charAt(0) === '#';
    if (/^src$/i.test(name)) return text.indexOf('data:image/') === 0 || text.indexOf('blob:') === 0;
    return false;
  }
  function cleanTree(root) {
    if (!root || !root.querySelectorAll) return root;
    var all = root.querySelectorAll('*');
    for (var i = all.length - 1; i >= 0; i--) {
      var node = all[i];
      if (BLOCKED_TAGS.test(node.localName)) { node.parentNode && node.parentNode.removeChild(node); continue; }
      for (var j = node.attributes.length - 1; j >= 0; j--) {
        var attr = node.attributes[j];
        var name = attr.name;
        if (/^on/i.test(name) || /^http-equiv$/i.test(name) || /^(?:is|nonce)$/i.test(name)
          || (URL_ATTRS.test(name) && !safeUrl(name, attr.value))
          || (/^style$/i.test(name) && /url\s*\(|expression\s*\(|@import/i.test(attr.value))) {
          node.removeAttribute(name);
        }
      }
    }
    return root;
  }
  var innerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  var outerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
  var scratch = D.createElement('template');
  function cleanHtml(html) {
    innerDesc.set.call(scratch, String(html == null ? '' : html));
    cleanTree(scratch.content);
    return innerDesc.get.call(scratch);
  }
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: false, enumerable: innerDesc.enumerable,
    get: innerDesc.get, set: function (value) { innerDesc.set.call(this, cleanHtml(value)); } });
  if (outerDesc) Object.defineProperty(Element.prototype, 'outerHTML', { configurable: false, enumerable: outerDesc.enumerable,
    get: outerDesc.get, set: function (value) { outerDesc.set.call(this, cleanHtml(value)); } });
  var shadowDesc = W.ShadowRoot && Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'innerHTML');
  if (shadowDesc) Object.defineProperty(ShadowRoot.prototype, 'innerHTML', { configurable: false,
    get: shadowDesc.get, set: function (value) { shadowDesc.set.call(this, cleanHtml(value)); } });
  var insertAdjacent = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (where, html) { return insertAdjacent.call(this, where, cleanHtml(html)); };
  ['setHTMLUnsafe', 'setHTML'].forEach(function (name) {
    [Element.prototype, W.ShadowRoot && ShadowRoot.prototype].forEach(function (proto) {
      if (proto && typeof proto[name] === 'function') {
        var original = proto[name];
        proto[name] = function (html) { return original.call(this, cleanHtml(html)); };
      }
    });
  });
  if (W.Range && Range.prototype.createContextualFragment) {
    var contextual = Range.prototype.createContextualFragment;
    Range.prototype.createContextualFragment = function (html) { return cleanTree(contextual.call(this, cleanHtml(html))); };
  }
  if (W.DOMParser) {
    var parse = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (text, type) { var doc = parse.call(this, text, type); cleanTree(doc); return doc; };
  }
  if (W.Document && Document.parseHTMLUnsafe) {
    var parseUnsafe = Document.parseHTMLUnsafe;
    Document.parseHTMLUnsafe = function (html) { return cleanTree(parseUnsafe.call(Document, cleanHtml(html))); };
  }
  function refuse(what) { return function () { throw new Error(what + ' no está disponible en un artefacto.'); }; }
  Document.prototype.write = refuse('document.write');
  Document.prototype.writeln = refuse('document.writeln');
  Document.prototype.open = refuse('document.open');
  var execCommand = Document.prototype.execCommand;
  Document.prototype.execCommand = function (command) {
    if (/^insertHTML$/i.test(String(command))) throw new Error('insertHTML no está disponible en un artefacto.');
    return execCommand.apply(this, arguments);
  };
  var createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tag) {
    if (BLOCKED_TAGS.test(String(tag))) throw new Error('<' + tag + '> no está permitido en un artefacto.');
    return createElement.apply(this, arguments);
  };
  var createElementNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function (ns, tag) {
    var local = String(tag).split(':').pop();
    if (BLOCKED_TAGS.test(local)) throw new Error('<' + local + '> no está permitido en un artefacto.');
    return createElementNS.apply(this, arguments);
  };
  // A <meta> already in the page must not turn into a refresh.
  function metaGuard(element, name) {
    if ((element && element.localName === 'meta') || /^http-equiv$/i.test(String(name))) {
      throw new Error('Las etiquetas <meta> no se pueden cambiar en un artefacto.');
    }
  }
  ['setAttribute', 'setAttributeNS', 'toggleAttribute'].forEach(function (name) {
    var original = Element.prototype[name];
    if (!original) return;
    Element.prototype[name] = function () {
      var attrName = name === 'setAttributeNS' ? arguments[1] : arguments[0];
      metaGuard(this, attrName);
      if (/^on/i.test(String(attrName).split(':').pop())) throw new Error('Usa addEventListener en vez de atributos on…');
      return original.apply(this, arguments);
    };
  });
  ['setAttributeNode', 'setAttributeNodeNS'].forEach(function (name) {
    var original = Element.prototype[name];
    if (original) Element.prototype[name] = function (attr) { metaGuard(this, attr && attr.name); return original.apply(this, arguments); };
  });
  ['setNamedItem', 'setNamedItemNS'].forEach(function (name) {
    var original = NamedNodeMap.prototype[name];
    if (original) NamedNodeMap.prototype[name] = function (attr) { metaGuard(null, attr && attr.name); return original.apply(this, arguments); };
  });
  ['value', 'nodeValue', 'textContent'].forEach(function (name) {
    var proto = name === 'value' ? Attr.prototype : Node.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || !desc.set) return;
    var setter = desc.set;
    desc.set = function (value) {
      if (this && this.nodeType === 2) metaGuard(this.ownerElement, this.name);
      return setter.call(this, value);
    };
    Object.defineProperty(proto, name, desc);
  });
  if (W.HTMLMetaElement) ['httpEquiv', 'content', 'name'].forEach(function (name) {
    var desc = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, name);
    if (desc && desc.set) Object.defineProperty(HTMLMetaElement.prototype, name, { get: desc.get, set: refuse('Cambiar <meta>'), configurable: false });
  });
  if (W.XSLTProcessor) W.XSLTProcessor = undefined;
  W.open = function () { return null; };
  // Links only move inside the artifact (#section): a link out, a form or a script cannot navigate.
  W.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a, area') : null;
    if (!target) return;
    var href = target.getAttribute('href') || target.getAttribute('xlink:href') || '';
    if (href.charAt(0) !== '#') { event.preventDefault(); }
  }, true);
  W.addEventListener('submit', function (event) { event.preventDefault(); }, true);

  // ---- Data and theme ------------------------------------------------------------------------
  function parseData() {
    var node = D.getElementById('antonia-data');
    try { return node ? JSON.parse(node.textContent || '{}') : {}; } catch (error) { report(error, null); return {}; }
  }
  var payload = parseData();
  var tables = payload && typeof payload.tables === 'object' && payload.tables ? payload.tables : {};
  Object.keys(tables).forEach(function (key) {
    var table = tables[key] || {};
    table.rows = Array.isArray(table.rows) ? table.rows : [];
    table.columns = Array.isArray(table.columns) ? table.columns : inferColumns(table.rows);
  });
  var meta = { title: payload.title || D.title || '', generatedAt: payload.generatedAt || null,
    currency: payload.currency || 'CLP', timeZone: payload.timeZone || 'America/Santiago', today: '' };
  // The day it was made, in the person's time zone: «hoy» and «este mes» of the data, not of whoever opens it later.
  meta.today = (function () {
    var made = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
    if (isNaN(made.getTime())) made = new Date();
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: meta.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(made); }
    catch (error) { return made.toISOString().slice(0, 10); }
  })();

  var themeListeners = [];
  var theme = { mode: 'light', colors: {} };
  function readColors() {
    var style = W.getComputedStyle(D.documentElement);
    var names = ['bg', 'surface', 'panel', 'text', 'muted', 'faint', 'border', 'accent', 'success', 'warning', 'danger'];
    var colors = { series: [1, 2, 3, 4, 5].map(function (at) { return style.getPropertyValue('--series-' + at).trim(); }) };
    names.forEach(function (name) { colors[name] = style.getPropertyValue('--' + name).trim(); });
    return colors;
  }
  function applyTheme(mode) {
    theme.mode = mode === 'dark' ? 'dark' : 'light';
    D.documentElement.setAttribute('data-theme', theme.mode);
    theme.colors = readColors();
    themeListeners.forEach(function (listener) { try { listener(theme); } catch (error) { report(error, null); } });
  }
  applyTheme(hash.theme);
  W.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== host || !message || message.source !== 'antonia-host') return;
    if (message.type === 'theme') applyTheme(message.mode);
  });
  W.addEventListener('hashchange', function () { applyTheme(readHash().theme); });

  // ---- Formats (es-CL) -----------------------------------------------------------------------
  function isNum(value) { return typeof value === 'number' && isFinite(value); }
  function toNum(value) {
    if (isNum(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value))) return Number(value);
    return null;
  }
  var formatters = {};
  function nf(options) {
    var key = JSON.stringify(options);
    if (!formatters[key]) {
      try { formatters[key] = new Intl.NumberFormat('es-CL', options); } catch (error) { formatters[key] = new Intl.NumberFormat('es', options); }
    }
    return formatters[key];
  }
  function toDate(value) {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00Z');
    if (typeof value === 'string' || isNum(value)) { var date = new Date(value); return isNaN(date.getTime()) ? null : date; }
    return null;
  }
  var format = {
    number: function (value, digits) {
      var n = toNum(value);
      if (n === null) return '—';
      return nf({ maximumFractionDigits: digits == null ? (Math.abs(n) < 100 && n % 1 ? 1 : 0) : digits }).format(n);
    },
    money: function (value, currency) {
      var n = toNum(value);
      if (n === null) return '—';
      var code = currency || meta.currency || 'CLP';
      try { return nf({ style: 'currency', currency: code, maximumFractionDigits: code === 'CLP' ? 0 : 2 }).format(n); }
      catch (error) { return format.number(n) + ' ' + code; }
    },
    compact: function (value, unit) {
      var n = toNum(value);
      if (n === null) return '—';
      if (Math.abs(n) < 10000) return unit === 'money' ? format.money(n) : format.number(n);
      var text = nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n);
      return unit === 'money' ? '$' + text : text;
    },
    percent: function (ratio, digits) {
      var n = toNum(ratio);
      if (n === null) return '—';
      return nf({ style: 'percent', maximumFractionDigits: digits == null ? 1 : digits }).format(n);
    },
    date: function (value, style) {
      var date = toDate(value);
      if (!date) return '—';
      var dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
      var options = style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' }
        : style === 'month' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' };
      options.timeZone = dateOnly ? 'UTC' : meta.timeZone;
      try { return new Intl.DateTimeFormat('es-CL', options).format(date); } catch (error) { return date.toISOString().slice(0, 10); }
    },
    value: function (value, type) {
      if (value === null || value === undefined || value === '') return '—';
      if (type === 'money') return format.money(value);
      if (type === 'percent') return format.percent(value);
      if (type === 'number') return format.number(value);
      if (type === 'date') return format.date(value);
      if (typeof value === 'boolean') return value ? 'Sí' : 'No';
      return String(value);
    },
  };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // ---- DOM helpers ---------------------------------------------------------------------------
  function append(parent, children) {
    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) { append(parent, child); return; }
      parent.appendChild(child && child.nodeType ? child : D.createTextNode(String(child)));
    });
    return parent;
  }
  function h(tag, attrs) {
    var children = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
    var element = D.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class' || key === 'className') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key === 'style' && typeof value === 'object') {
        Object.keys(value).forEach(function (prop) {
          if (prop.indexOf('--') === 0) element.style.setProperty(prop, value[prop]); else element.style[prop] = value[prop];
        });
      } else if (key === 'on' && typeof value === 'object') {
        Object.keys(value).forEach(function (name) { element.addEventListener(name, value[name]); });
      } else if (/^on[A-Z]/.test(key) && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
      else element.setAttribute(key, value === true ? '' : String(value));
    });
    return append(element, children);
  }
  function resolve(target) {
    var element = typeof target === 'string' ? D.querySelector(target) : target;
    if (!element || !element.appendChild) throw new Error('No encontré el contenedor ' + String(target) + '.');
    return element;
  }
  function mount(target) {
    var element = resolve(target);
    while (element.firstChild) element.removeChild(element.firstChild);
    return append(element, Array.prototype.slice.call(arguments, 1));
  }
  function svg(tag, attrs, children) {
    var element = D.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (key) { if (attrs[key] !== null && attrs[key] !== undefined) element.setAttribute(key, String(attrs[key])); });
    (children || []).forEach(function (child) { element.appendChild(typeof child === 'string' ? D.createTextNode(child) : child); });
    return element;
  }

  // ---- Aggregates ----------------------------------------------------------------------------
  function rowsOf(input) { return Array.isArray(input) ? input : input && Array.isArray(input.rows) ? input.rows : []; }
  function pick(row, key) { return typeof key === 'function' ? key(row) : row ? row[key] : undefined; }
  var agg = {
    sum: function (input, key) { return rowsOf(input).reduce(function (total, row) { var n = toNum(pick(row, key)); return n === null ? total : total + n; }, 0); },
    count: function (input, test) { var rows = rowsOf(input); return test ? rows.filter(function (row) { return typeof test === 'function' ? test(row) : Boolean(pick(row, test)); }).length : rows.length; },
    avg: function (input, key) {
      var values = rowsOf(input).map(function (row) { return toNum(pick(row, key)); }).filter(function (n) { return n !== null; });
      return values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : null;
    },
    min: function (input, key) { var v = rowsOf(input).map(function (row) { return toNum(pick(row, key)); }).filter(isNum); return v.length ? Math.min.apply(null, v) : null; },
    max: function (input, key) { var v = rowsOf(input).map(function (row) { return toNum(pick(row, key)); }).filter(isNum); return v.length ? Math.max.apply(null, v) : null; },
    // [{ key, rows, count, value }], biggest first unless options.sort says otherwise.
    groupBy: function (input, key, options) {
      options = options || {};
      var groups = [], index = {};
      rowsOf(input).forEach(function (row) {
        var raw = pick(row, key);
        var name = raw === null || raw === undefined || raw === '' ? (options.empty || 'Sin dato') : String(raw);
        if (!index.hasOwnProperty(name)) { index[name] = groups.length; groups.push({ key: name, rows: [] }); }
        groups[index[name]].rows.push(row);
      });
      groups.forEach(function (group) {
        group.count = group.rows.length;
        group.value = !options.value ? group.count : options.op === 'avg' ? agg.avg(group.rows, options.value) : agg.sum(group.rows, options.value);
      });
      if (Array.isArray(options.order)) {
        groups.sort(function (a, b) {
          var ia = options.order.indexOf(a.key), ib = options.order.indexOf(b.key);
          return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
        });
      } else if (typeof options.sort === 'function') groups.sort(options.sort);
      else if (options.sort !== 'none') groups.sort(function (a, b) { return options.sort === 'asc' ? a.value - b.value : b.value - a.value; });
      return options.limit ? groups.slice(0, options.limit) : groups;
    },
    // { labels, values } ready for antonia.chart; options as in groupBy.
    series: function (input, key, options) {
      var groups = agg.groupBy(input, key, options);
      return { labels: groups.map(function (g) { return g.key; }), values: groups.map(function (g) { return g.value; }) };
    },
    // Rows by calendar month of a date column, oldest first: { labels, values, keys }.
    byMonth: function (input, dateKey, options) {
      options = options || {};
      var buckets = {};
      rowsOf(input).forEach(function (row) {
        var date = toDate(pick(row, dateKey));
        if (!date) return;
        var key = date.toISOString().slice(0, 7);
        (buckets[key] = buckets[key] || []).push(row);
      });
      var keys = Object.keys(buckets).sort();
      if (options.last) keys = keys.slice(-options.last);
      return { keys: keys, labels: keys.map(function (key) { return format.date(key + '-01', 'month'); }),
        values: keys.map(function (key) { return options.value ? (options.op === 'avg' ? agg.avg(buckets[key], options.value) : agg.sum(buckets[key], options.value)) : buckets[key].length; }) };
    },
    since: function (input, dateKey, days) {
      var from = new Date(meta.today + 'T12:00:00Z').getTime() - Math.max(0, Number(days) || 0) * 86400000 - 43200000;
      return rowsOf(input).filter(function (row) { var date = toDate(pick(row, dateKey)); return Boolean(date) && date.getTime() >= from; });
    },
    inMonth: function (input, dateKey, month) {
      var wanted = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : meta.today.slice(0, 7);
      return rowsOf(input).filter(function (row) { var date = toDate(pick(row, dateKey)); return Boolean(date) && date.toISOString().slice(0, 7) === wanted; });
    },
    top: function (input, key, n, direction) {
      return rowsOf(input).slice().sort(function (a, b) {
        var x = toNum(pick(a, key)), y = toNum(pick(b, key));
        x = x === null ? -Infinity : x; y = y === null ? -Infinity : y;
        return direction === 'asc' ? x - y : y - x;
      }).slice(0, n || 5);
    },
  };
  function inferColumns(rows) {
    var first = rows && rows[0] ? rows[0] : {};
    return Object.keys(first).map(function (key) {
      var value = first[key];
      return { key: key, label: key, type: isNum(value) ? 'number' : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? 'date' : 'text' };
    });
  }

  // ---- Charts --------------------------------------------------------------------------------
  function niceDomain(lo, hi, count) {
    lo = Math.min(0, lo); hi = Math.max(0, hi);
    if (lo === hi) hi = lo + 1;
    var raw = (hi - lo) / (count || 4);
    var step = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var err = raw / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var ticks = [];
    for (var v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks: ticks };
  }
  function seriesColor(at) { return 'var(--series-' + ((at % 5) + 1) + ')'; }
  function stageColor(at, total) {
    var step = total <= 1 ? 3 : Math.round(at * 5 / (total - 1)) + 1;
    return 'var(--stage-' + Math.max(1, Math.min(6, step)) + ')';
  }
  function chartValue(spec, value) {
    if (!isNum(value)) return '—';
    if (spec.unit === 'money') return format.money(value);
    if (spec.unit === 'percent') return format.percent(value);
    return format.number(value);
  }
  // Labels on the marks are short (a million is "$186 M"); the tooltip and the table keep it whole.
  function labelValue(spec, value) {
    if (spec.unit === 'money' && isNum(value) && Math.abs(value) >= 1e6) return format.compact(value, 'money');
    return chartValue(spec, value);
  }
  function axisValue(spec, value) {
    if (spec.unit === 'percent') return format.percent(value, 0);
    return format.compact(value, spec.unit);
  }
  function truncate(text, chars) { text = String(text); return text.length > chars ? text.slice(0, Math.max(1, chars - 1)) + '…' : text; }
  function normalizeChart(spec) {
    var type = ['bar', 'line', 'donut', 'funnel', 'stacked'].indexOf(spec.type) >= 0 ? spec.type : 'bar';
    var labels = (spec.labels || []).map(function (label) { return label === null || label === undefined ? '—' : String(label); });
    var series = (spec.series || (spec.values ? [{ name: spec.name || spec.title || 'Valor', values: spec.values }] : [])).map(function (item, at) {
      return { name: String(item.name === undefined ? 'Serie ' + (at + 1) : item.name),
        values: labels.map(function (_, i) { return toNum(item.values ? item.values[i] : null); }) };
    });
    if (type === 'donut' || type === 'funnel') series = series.slice(0, 1);
    if (series.length > 5 && type !== 'line') {
      var kept = series.slice(0, 4);
      var rest = series.slice(4);
      kept.push({ name: 'Otros', values: labels.map(function (_, i) { return rest.reduce(function (total, item) { return total + (item.values[i] || 0); }, 0); }) });
      series = kept;
    }
    series = series.slice(0, 5);
    if (type === 'donut' && labels.length > 6) {
      var pairs = labels.map(function (label, i) { return { label: label, value: series[0].values[i] || 0 }; }).sort(function (a, b) { return b.value - a.value; });
      var head = pairs.slice(0, 5);
      head.push({ label: 'Otros', value: pairs.slice(5).reduce(function (total, pair) { return total + pair.value; }, 0) });
      labels = head.map(function (pair) { return pair.label; });
      series = [{ name: series[0].name, values: head.map(function (pair) { return pair.value; }) }];
    }
    return { type: type, title: spec.title ? String(spec.title) : '', note: spec.note ? String(spec.note) : '', unit: spec.unit || null,
      labels: labels, series: series, height: toNum(spec.height), horizontal: spec.horizontal };
  }
  function summaryText(spec) {
    var kinds = { bar: 'Gráfico de barras', line: 'Gráfico de líneas', donut: 'Gráfico de dona', funnel: 'Embudo', stacked: 'Barras apiladas' };
    var first = spec.series[0];
    if (!first || !spec.labels.length) return kinds[spec.type] + ' sin datos.';
    var best = 0;
    first.values.forEach(function (value, i) { if ((value || 0) > (first.values[best] || 0)) best = i; });
    var unit = spec.type === 'funnel' ? (spec.labels.length === 1 ? ' etapa' : ' etapas') : (spec.labels.length === 1 ? ' categoría' : ' categorías');
    return kinds[spec.type] + ' con ' + spec.labels.length + unit + (spec.series.length > 1 ? ' y ' + spec.series.length + ' series' : '')
      + '. Mayor' + (spec.series.length > 1 ? ' en ' + first.name + ': ' : ': ') + spec.labels[best] + ', ' + chartValue(spec, first.values[best]) + '. La tabla de datos está debajo.';
  }
  function dataTable(spec) {
    var head = h('tr', null, h('th', { scope: 'col' }, spec.type === 'funnel' ? 'Etapa' : 'Categoría'),
      spec.series.map(function (item) { return h('th', { scope: 'col', class: 'is-num' }, spec.series.length > 1 ? item.name : (item.name || 'Valor')); }));
    var body = spec.labels.map(function (label, i) {
      return h('tr', null, h('th', { scope: 'row' }, label), spec.series.map(function (item) { return h('td', { class: 'is-num' }, chartValue(spec, item.values[i])); }));
    });
    return h('details', { class: 'antonia-chart-data' }, h('summary', null, 'Ver datos'),
      h('div', { class: 'antonia-table-scroll' }, h('table', null, h('thead', null, head), h('tbody', null, body))));
  }
  function legend(spec) {
    if (spec.type === 'donut') {
      var total = spec.series[0] ? spec.series[0].values.reduce(function (a, b) { return a + (b || 0); }, 0) : 0;
      return h('ul', { class: 'antonia-legend' }, spec.labels.map(function (label, i) {
        var value = spec.series[0].values[i] || 0;
        return h('li', null, h('span', { class: 'antonia-swatch', style: { background: label === 'Otros' ? 'var(--faint)' : seriesColor(i) } }), label,
          h('span', { class: 'antonia-legend-value' }, chartValue(spec, value) + (total ? ' · ' + format.percent(value / total, 0) : '')));
      }));
    }
    if (spec.series.length < 2 || spec.type === 'funnel') return null;
    return h('ul', { class: 'antonia-legend' }, spec.series.map(function (item, at) {
      return h('li', null, h('span', { class: 'antonia-swatch', style: { background: seriesColor(at) } }), item.name);
    }));
  }
  function barPath(x, y0, y1, w, horizontal) {
    // A bar with its data end rounded (4px) and its base square on the baseline.
    var length = Math.abs(y1 - y0);
    if (length < 0.5 || w <= 0) return '';
    var r = Math.min(4, w / 2, length);
    if (!horizontal) {
      if (y1 <= y0) return 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z';
      return 'M' + x + ',' + y0 + 'V' + (y1 - r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - r) + 'V' + y0 + 'Z';
    }
    // Horizontal: x is the band top, y0 the baseline x, y1 the value x, w the band height.
    if (y1 >= y0) return 'M' + y0 + ',' + x + 'H' + (y1 - r) + 'Q' + y1 + ',' + x + ' ' + y1 + ',' + (x + r) + 'V' + (x + w - r) + 'Q' + y1 + ',' + (x + w) + ' ' + (y1 - r) + ',' + (x + w) + 'H' + y0 + 'Z';
    return 'M' + y0 + ',' + x + 'H' + (y1 + r) + 'Q' + y1 + ',' + x + ' ' + y1 + ',' + (x + r) + 'V' + (x + w - r) + 'Q' + y1 + ',' + (x + w) + ' ' + (y1 + r) + ',' + (x + w) + 'H' + y0 + 'Z';
  }
  function tooltip(plot) {
    var tip = h('div', { class: 'antonia-tooltip', 'aria-hidden': 'true' });
    plot.appendChild(tip);
    return {
      show: function (spec, index, x, y, singleSeries) {
        var rows = (singleSeries ? [singleSeries] : spec.series).map(function (item) {
          var at = spec.series.indexOf(item);
          var color = spec.type === 'donut' ? (spec.labels[index] === 'Otros' ? 'var(--faint)' : seriesColor(index)) : spec.type === 'funnel' ? stageColor(index, spec.labels.length) : seriesColor(at);
          return h('div', { class: 'antonia-tip-row' }, h('span', null, h('span', { class: 'antonia-swatch', style: { background: color } }), spec.series.length > 1 ? item.name : (spec.unit === 'money' ? 'Monto' : 'Valor')),
            h('b', { class: 'num' }, chartValue(spec, item.values[index])));
        });
        mount(tip, h('strong', null, spec.labels[index]), rows);
        var width = plot.clientWidth;
        tip.style.left = Math.max(0, Math.min(width - tip.offsetWidth, x + 12)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
        tip.classList.add('is-on');
      },
      hide: function () { tip.classList.remove('is-on'); },
    };
  }
  function drawBars(plot, spec, width, stacked) {
    var labels = spec.labels;
    var longest = labels.reduce(function (max, label) { return Math.max(max, label.length); }, 0);
    var horizontal = spec.horizontal === true || (spec.horizontal !== false && !stacked && (labels.length > 10 || (longest > 14 && width / Math.max(1, labels.length) < longest * 7)));
    var totals = labels.map(function (_, i) { return spec.series.reduce(function (total, item) { return total + Math.max(0, item.values[i] || 0); }, 0); });
    var values = stacked ? totals : [].concat.apply([], spec.series.map(function (item) { return item.values.filter(isNum); }));
    var lows = stacked ? [0] : values;
    var domain = niceDomain(Math.min.apply(null, lows.concat([0])), Math.max.apply(null, values.concat([0])), 4);
    var tip = tooltip(plot);
    var showValues = !stacked && spec.series.length === 1 && labels.length <= 12;
    var root;
    if (horizontal) {
      var labelWidth = Math.min(Math.round(width * 0.38), Math.max(60, longest * 7 + 8));
      var valueRoom = showValues ? 72 : 12;
      var band = 30, inner = Math.max(40, width - labelWidth - valueRoom);
      var height = labels.length * band + 8;
      var scale = function (v) { return labelWidth + (v - domain.min) / (domain.max - domain.min) * inner; };
      root = svg('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true', focusable: 'false' });
      var zero = scale(0);
      labels.forEach(function (label, i) {
        var top = i * band + 4;
        var barBand = (band - 10) / spec.series.length;
        root.appendChild(svg('text', { class: 'antonia-label', x: labelWidth - 8, y: top + band / 2 - 2, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, [truncate(label, Math.floor((labelWidth - 8) / 6.6))]));
        spec.series.forEach(function (item, at) {
          var value = item.values[i];
          if (!isNum(value)) return;
          var d = barPath(top + 3 + at * barBand, zero, scale(value), Math.max(2, barBand - 2), true);
          if (d) root.appendChild(svg('path', { d: d, style: 'fill:' + seriesColor(at) }));
          if (showValues) root.appendChild(svg('text', { class: 'antonia-value', x: scale(value) + (value >= 0 ? 6 : -6), y: top + band / 2 - 2, 'text-anchor': value >= 0 ? 'start' : 'end', 'dominant-baseline': 'middle' }, [labelValue(spec, value)]));
        });
        var hit = svg('rect', { class: 'antonia-hit', x: 0, y: top, width: width, height: band });
        hit.addEventListener('pointermove', function (event) { var box = plot.getBoundingClientRect(); tip.show(spec, i, event.clientX - box.left, event.clientY - box.top); });
        hit.addEventListener('pointerleave', tip.hide);
        root.appendChild(hit);
      });
      root.appendChild(svg('line', { class: 'antonia-baseline', x1: zero, x2: zero, y1: 0, y2: height }));
      return root;
    }
    var chartHeight = spec.height || 260;
    var axisWidth = Math.max(36, domain.ticks.reduce(function (max, tick) { return Math.max(max, axisValue(spec, tick).length); }, 0) * 7 + 10);
    var top = showValues ? 20 : 8, bottom = 28, left = axisWidth, right = 8;
    var plotHeight = chartHeight - top - bottom, plotWidth = Math.max(40, width - left - right);
    var y = function (v) { return top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotHeight; };
    var bandWidth = plotWidth / Math.max(1, labels.length);
    var groupWidth = Math.min(bandWidth * 0.72, 28 * spec.series.length + 8 * (spec.series.length - 1) + 24);
    root = svg('svg', { width: width, height: chartHeight, viewBox: '0 0 ' + width + ' ' + chartHeight, 'aria-hidden': 'true', focusable: 'false' });
    var grid = svg('g', { class: 'antonia-grid' }), axis = svg('g', { class: 'antonia-axis' });
    domain.ticks.forEach(function (tick) {
      grid.appendChild(svg('line', { x1: left, x2: width - right, y1: y(tick), y2: y(tick) }));
      axis.appendChild(svg('text', { x: left - 8, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, [axisValue(spec, tick)]));
    });
    root.appendChild(grid);
    var every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / 64))));
    labels.forEach(function (label, i) {
      if (i % every) return;
      axis.appendChild(svg('text', { x: left + bandWidth * (i + 0.5), y: chartHeight - 8, 'text-anchor': 'middle' }, [truncate(label, Math.max(4, Math.floor(bandWidth * every / 7)))]));
    });
    root.appendChild(axis);
    var zero = y(0);
    labels.forEach(function (label, i) {
      var x0 = left + bandWidth * i + (bandWidth - groupWidth) / 2;
      if (stacked) {
        var base = zero;
        spec.series.forEach(function (item, at) {
          var value = Math.max(0, item.values[i] || 0);
          if (!value) return;
          var next = base - (value / (domain.max - domain.min)) * plotHeight;
          var isTop = spec.series.slice(at + 1).every(function (other) { return !(other.values[i] > 0); });
          var d = isTop ? barPath(x0, base, next, groupWidth, false) : 'M' + x0 + ',' + base + 'V' + next + 'H' + (x0 + groupWidth) + 'V' + base + 'Z';
          root.appendChild(svg('path', { d: d, style: 'fill:' + seriesColor(at) + ';stroke:var(--surface);stroke-width:2;paint-order:stroke' }));
          base = next;
        });
      } else {
        var slot = (groupWidth - 2 * (spec.series.length - 1)) / spec.series.length;
        spec.series.forEach(function (item, at) {
          var value = item.values[i];
          if (!isNum(value)) return;
          var x = x0 + at * (slot + 2);
          var d = barPath(x, zero, y(value), slot, false);
          if (d) root.appendChild(svg('path', { d: d, style: 'fill:' + seriesColor(at) }));
          if (showValues) root.appendChild(svg('text', { class: 'antonia-value', x: x + slot / 2, y: value >= 0 ? y(value) - 6 : y(value) + 14, 'text-anchor': 'middle' }, [labelValue(spec, value)]));
        });
      }
      var hit = svg('rect', { class: 'antonia-hit', x: left + bandWidth * i, y: top, width: bandWidth, height: plotHeight });
      hit.addEventListener('pointermove', function (event) { var box = plot.getBoundingClientRect(); tip.show(spec, i, event.clientX - box.left, event.clientY - box.top); });
      hit.addEventListener('pointerleave', tip.hide);
      root.appendChild(hit);
    });
    root.appendChild(svg('line', { class: 'antonia-baseline', x1: left, x2: width - right, y1: zero, y2: zero }));
    return root;
  }
  function drawLine(plot, spec, width) {
    var chartHeight = spec.height || 260;
    var values = [].concat.apply([], spec.series.map(function (item) { return item.values.filter(isNum); }));
    var domain = niceDomain(Math.min.apply(null, values.concat([0])), Math.max.apply(null, values.concat([0])), 4);
    var labelRoom = spec.series.length <= 4 ? Math.min(140, Math.max.apply(null, spec.series.map(function (item) { return item.name.length; })) * 7 + 16) : 8;
    var axisWidth = Math.max(36, domain.ticks.reduce(function (max, tick) { return Math.max(max, axisValue(spec, tick).length); }, 0) * 7 + 10);
    var top = 10, bottom = 28, left = axisWidth, right = Math.min(labelRoom, width * 0.25);
    var plotHeight = chartHeight - top - bottom, plotWidth = Math.max(40, width - left - right);
    var n = spec.labels.length;
    var x = function (i) { return left + (n <= 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth); };
    var y = function (v) { return top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotHeight; };
    var root = svg('svg', { width: width, height: chartHeight, viewBox: '0 0 ' + width + ' ' + chartHeight, 'aria-hidden': 'true', focusable: 'false' });
    var grid = svg('g', { class: 'antonia-grid' }), axis = svg('g', { class: 'antonia-axis' });
    domain.ticks.forEach(function (tick) {
      grid.appendChild(svg('line', { x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) }));
      axis.appendChild(svg('text', { x: left - 8, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, [axisValue(spec, tick)]));
    });
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotWidth / 64))));
    // Every n-th label, and always the last one: it takes the place of the one before when they would touch.
    var shown = spec.labels.map(function (_, i) { return i % every === 0; });
    if (n > 1 && !shown[n - 1]) { var before = n - 1 - ((n - 1) % every); if (n - 1 - before < every) shown[before] = before === 0; shown[n - 1] = true; }
    spec.labels.forEach(function (label, i) {
      if (!shown[i]) return;
      axis.appendChild(svg('text', { x: x(i), y: chartHeight - 8, 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle' }, [truncate(label, 12)]));
    });
    root.appendChild(grid);
    root.appendChild(axis);
    var cross = svg('line', { class: 'antonia-baseline', x1: 0, x2: 0, y1: top, y2: top + plotHeight, style: 'opacity:0' });
    root.appendChild(cross);
    spec.series.forEach(function (item, at) {
      var d = '', open = false;
      item.values.forEach(function (value, i) {
        if (!isNum(value)) { open = false; return; }
        d += (open ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(value).toFixed(1);
        open = true;
      });
      root.appendChild(svg('path', { d: d, style: 'fill:none;stroke:' + seriesColor(at) + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }));
      if (n <= 24) item.values.forEach(function (value, i) {
        if (isNum(value)) root.appendChild(svg('circle', { cx: x(i), cy: y(value), r: 4, style: 'fill:' + seriesColor(at) + ';stroke:var(--surface);stroke-width:2' }));
      });
      var last = -1;
      item.values.forEach(function (value, i) { if (isNum(value)) last = i; });
      if (spec.series.length <= 4 && last >= 0 && right > 20) {
        root.appendChild(svg('text', { class: 'antonia-value', x: x(last) + 8, y: y(item.values[last]), 'dominant-baseline': 'middle' },
          [truncate(spec.series.length > 1 ? item.name : chartValue(spec, item.values[last]), Math.floor((right - 10) / 7))]));
      }
    });
    var tip = tooltip(plot);
    var hit = svg('rect', { class: 'antonia-hit', x: left, y: top, width: plotWidth, height: plotHeight });
    hit.addEventListener('pointermove', function (event) {
      var box = plot.getBoundingClientRect();
      var px = (event.clientX - box.left) * (width / Math.max(1, box.width));
      var index = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - left) / plotWidth * (n - 1))));
      cross.setAttribute('x1', x(index)); cross.setAttribute('x2', x(index)); cross.setAttribute('style', 'opacity:1');
      tip.show(spec, index, event.clientX - box.left, event.clientY - box.top);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('style', 'opacity:0'); tip.hide(); });
    root.appendChild(hit);
    return root;
  }
  function drawDonut(plot, spec, width) {
    var item = spec.series[0] || { values: [] };
    var size = Math.min(width, spec.height || 240);
    var radius = size / 2 - 4, inner = radius * 0.62;
    var cx = width / 2, cy = size / 2;
    var total = item.values.reduce(function (a, b) { return a + Math.max(0, b || 0); }, 0);
    var root = svg('svg', { width: width, height: size, viewBox: '0 0 ' + width + ' ' + size, 'aria-hidden': 'true', focusable: 'false' });
    var tip = tooltip(plot);
    var angle = -Math.PI / 2;
    var point = function (r, a) { return (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2); };
    item.values.forEach(function (value, i) {
      value = Math.max(0, value || 0);
      if (!total || !value) return;
      var sweep = value / total * Math.PI * 2;
      var end = angle + sweep;
      var large = sweep > Math.PI ? 1 : 0;
      var d = sweep >= Math.PI * 2 - 1e-6
        ? 'M' + point(radius, angle) + 'A' + radius + ',' + radius + ' 0 1 1 ' + point(radius, angle + Math.PI) + 'A' + radius + ',' + radius + ' 0 1 1 ' + point(radius, angle)
          + 'M' + point(inner, angle) + 'A' + inner + ',' + inner + ' 0 1 0 ' + point(inner, angle + Math.PI) + 'A' + inner + ',' + inner + ' 0 1 0 ' + point(inner, angle) + 'Z'
        : 'M' + point(radius, angle) + 'A' + radius + ',' + radius + ' 0 ' + large + ' 1 ' + point(radius, end) + 'L' + point(inner, end) + 'A' + inner + ',' + inner + ' 0 ' + large + ' 0 ' + point(inner, angle) + 'Z';
      var color = spec.labels[i] === 'Otros' ? 'var(--faint)' : seriesColor(i);
      var slice = svg('path', { d: d, style: 'fill:' + color + ';stroke:var(--surface);stroke-width:2;fill-rule:evenodd' });
      slice.addEventListener('pointermove', function (event) { var box = plot.getBoundingClientRect(); tip.show(spec, i, event.clientX - box.left, event.clientY - box.top); });
      slice.addEventListener('pointerleave', tip.hide);
      root.appendChild(slice);
      angle = end;
    });
    root.appendChild(svg('text', { class: 'antonia-value', x: cx, y: cy - 4, 'text-anchor': 'middle', style: 'font-size:20px;font-weight:700' }, [spec.unit === 'money' ? format.compact(total, 'money') : chartValue(spec, total)]));
    root.appendChild(svg('text', { class: 'antonia-label', x: cx, y: cy + 16, 'text-anchor': 'middle' }, ['Total']));
    return root;
  }
  function drawFunnel(plot, spec, width) {
    var item = spec.series[0] || { values: [] };
    var max = Math.max.apply(null, item.values.map(function (v) { return v || 0; }).concat([0])) || 1;
    var longest = spec.labels.reduce(function (m, label) { return Math.max(m, label.length); }, 0);
    var labelWidth = Math.min(Math.round(width * 0.36), Math.max(60, longest * 7 + 8));
    // Conversion from the stage before only when every stage holds fewer than the one before (a real funnel).
    var narrowing = item.values.every(function (value, i) { return i === 0 || (value || 0) <= (item.values[i - 1] || 0); });
    var valueRoom = narrowing ? 108 : 76, band = 34;
    var inner = Math.max(40, width - labelWidth - valueRoom);
    var height = spec.labels.length * band + 4;
    var root = svg('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true', focusable: 'false' });
    var tip = tooltip(plot);
    spec.labels.forEach(function (label, i) {
      var value = Math.max(0, item.values[i] || 0);
      var top = i * band + 2;
      var length = Math.max(value ? 3 : 0, value / max * inner);
      root.appendChild(svg('text', { class: 'antonia-label', x: labelWidth - 8, y: top + band / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, [truncate(label, Math.floor((labelWidth - 8) / 6.6))]));
      var d = barPath(top + 4, labelWidth, labelWidth + length, band - 8, true);
      if (d) root.appendChild(svg('path', { d: d, style: 'fill:' + stageColor(i, spec.labels.length) }));
      var previous = i > 0 ? item.values[i - 1] : null;
      var conversion = narrowing && previous ? ' · ' + format.percent(value / previous, 0) : '';
      root.appendChild(svg('text', { class: 'antonia-value', x: labelWidth + length + 8, y: top + band / 2, 'dominant-baseline': 'middle' }, [labelValue(spec, value) + conversion]));
      var hit = svg('rect', { class: 'antonia-hit', x: 0, y: top, width: width, height: band });
      hit.addEventListener('pointermove', function (event) { var box = plot.getBoundingClientRect(); tip.show(spec, i, event.clientX - box.left, event.clientY - box.top); });
      hit.addEventListener('pointerleave', tip.hide);
      root.appendChild(hit);
    });
    return root;
  }
  function chart(target, input) {
    var spec = normalizeChart(input || {});
    var figure = h('figure', { class: 'antonia-chart' });
    var caption = spec.title || spec.note ? h('figcaption', null, spec.title ? h('span', { class: 'antonia-chart-title' }, spec.title) : null,
      spec.note ? h('span', { class: 'antonia-chart-note' }, spec.note) : null) : null;
    var plot = h('div', { class: 'antonia-chart-plot' });
    append(figure, [caption, legend(spec), h('p', { class: 'sr-only' }, summaryText(spec)), plot, dataTable(spec)]);
    var element = target ? mount(target, figure) : null;
    var lastWidth = 0;
    function draw() {
      var width = Math.round(plot.clientWidth || (element && element.clientWidth) || 640);
      if (width === lastWidth && plot.firstChild) return;
      lastWidth = width;
      while (plot.firstChild) plot.removeChild(plot.firstChild);
      if (!spec.labels.length || !spec.series.length) { plot.appendChild(h('p', { class: 'antonia-empty' }, 'No hay datos para este gráfico.')); return; }
      var drawn = spec.type === 'line' ? drawLine(plot, spec, width) : spec.type === 'donut' ? drawDonut(plot, spec, width)
        : spec.type === 'funnel' ? drawFunnel(plot, spec, width) : drawBars(plot, spec, width, spec.type === 'stacked');
      plot.insertBefore(drawn, plot.firstChild);
    }
    draw();
    if (W.ResizeObserver) new ResizeObserver(function () { W.requestAnimationFrame(draw); }).observe(plot);
    return figure;
  }

  // ---- Table ---------------------------------------------------------------------------------
  function table(target, input, options) {
    options = options || {};
    var rows = rowsOf(input).slice();
    var columns = (options.columns || (input && input.columns) || inferColumns(rows)).map(function (column) {
      return typeof column === 'string' ? { key: column, label: column, type: 'text' } : column;
    });
    var numeric = function (column) { return column.type === 'number' || column.type === 'money' || column.type === 'percent'; };
    var state = { key: options.sortBy || null, dir: options.sortDir === 'asc' ? 1 : -1, query: '', limit: options.pageSize || 25 };
    var wrap = h('div', { class: 'antonia-table-wrap' });
    var count = h('span', { class: 'antonia-table-count', 'aria-live': 'polite' });
    var filter = options.filter === false || rows.length <= 8 ? null
      : h('input', { type: 'search', placeholder: options.filterPlaceholder || 'Filtrar…', 'aria-label': options.filterLabel || 'Filtrar filas' });
    var tbody = h('tbody');
    var more = h('button', { type: 'button', class: 'btn antonia-more' });
    var headCells = columns.map(function (column) {
      var th = h('th', { scope: 'col', class: numeric(column) ? 'is-num' : null });
      if (options.sortable === false) th.textContent = column.label || column.key;
      else {
        var mark = h('span', { class: 'antonia-sort-mark', 'aria-hidden': 'true' });
        var button = h('button', { type: 'button', class: 'antonia-sort' }, column.label || column.key, mark);
        button.addEventListener('click', function () {
          if (state.key === column.key) state.dir = -state.dir; else { state.key = column.key; state.dir = numeric(column) || column.type === 'date' ? -1 : 1; }
          render();
        });
        th.appendChild(button);
        th._mark = mark;
      }
      th._column = column;
      return th;
    });
    function matches(row) {
      if (!state.query) return true;
      var query = state.query.toLowerCase();
      return columns.some(function (column) { return String(format.value(row[column.key], column.type)).toLowerCase().indexOf(query) >= 0; });
    }
    function cell(column, row) {
      var value = row[column.key];
      var content = column.render ? column.render(value, row) : format.value(value, column.type);
      return h('td', { class: numeric(column) ? 'is-num' : null }, content);
    }
    function render() {
      var list = rows.filter(matches);
      if (state.key) {
        var column = columns.filter(function (c) { return c.key === state.key; })[0] || {};
        list.sort(function (a, b) {
          var x = a[state.key], y = b[state.key];
          if (x === null || x === undefined || x === '') return 1;
          if (y === null || y === undefined || y === '') return -1;
          if (numeric(column)) return (toNum(x) - toNum(y)) * state.dir;
          if (column.type === 'date') return ((toDate(x) || 0) - (toDate(y) || 0)) * state.dir;
          return String(x).localeCompare(String(y), 'es', { sensitivity: 'base', numeric: true }) * state.dir;
        });
      }
      headCells.forEach(function (th) {
        if (!th._mark) return;
        var active = th._column.key === state.key;
        th.setAttribute('aria-sort', active ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
        th._mark.textContent = active ? (state.dir > 0 ? '▲' : '▼') : '';
      });
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      if (!list.length) tbody.appendChild(h('tr', null, h('td', { colspan: columns.length, class: 'antonia-empty' }, state.query ? 'Ninguna fila coincide con «' + state.query + '».' : (options.empty || 'No hay filas.'))));
      list.slice(0, state.limit).forEach(function (row) {
        var tr = h('tr', null, columns.map(function (column) { return cell(column, row); }));
        if (options.onRowClick) { tr.style.cursor = 'pointer'; tr.addEventListener('click', function () { options.onRowClick(row); }); }
        tbody.appendChild(tr);
      });
      count.textContent = list.length === rows.length ? format.number(rows.length) + (rows.length === 1 ? ' fila' : ' filas') : format.number(list.length) + ' de ' + format.number(rows.length) + ' filas';
      var left = list.length - state.limit;
      more.hidden = left <= 0;
      more.textContent = left > 0 ? 'Mostrar ' + Math.min(options.pageSize || 25, left) + ' más (quedan ' + format.number(left) + ')' : '';
    }
    if (filter) filter.addEventListener('input', function () { state.query = filter.value.trim(); state.limit = options.pageSize || 25; render(); });
    more.addEventListener('click', function () { state.limit += options.pageSize || 25; render(); });
    append(wrap, [h('div', { class: 'antonia-table-tools' }, filter, count),
      h('div', { class: 'antonia-table-scroll' }, h('table', null, options.caption ? h('caption', { class: 'sr-only' }, options.caption) : null, h('thead', null, h('tr', null, headCells)), tbody)), more]);
    render();
    if (target) mount(target, wrap);
    return wrap;
  }

  // ---- Figures -------------------------------------------------------------------------------
  function kpi(target, items) {
    var grid = h('div', { class: 'antonia-kpis' }, (items || []).map(function (item) {
      var delta = toNum(item.delta);
      var deltaNode = delta === null ? null : h('span', { class: 'antonia-delta ' + (delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '') },
        (delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '') + format.percent(delta, 0));
      var unit = item.unit || item.type || 'number';
      var value = typeof item.value === 'string' && toNum(item.value) === null ? item.value : format.value(item.value, unit);
      var short = typeof item.value === 'string' ? value : format.compact(item.value, unit === 'money' ? 'money' : null);
      return h('div', { class: 'antonia-kpi' }, h('p', { class: 'antonia-kpi-label' }, item.label),
        h('p', { class: 'antonia-kpi-value', 'data-full': value, 'data-short': unit === 'percent' ? value : short }, value),
        deltaNode || item.hint ? h('p', { class: 'antonia-kpi-foot' }, deltaNode, deltaNode && item.hint ? ' ' : null, item.hint || null) : null);
    }));
    // A figure too wide for its tile («$568.000.000» on a phone) shows short («$568 M»), whole on hover.
    function fit() {
      Array.prototype.forEach.call(grid.querySelectorAll('.antonia-kpi-value'), function (node) {
        var full = node.getAttribute('data-full'), short = node.getAttribute('data-short');
        node.textContent = full;
        node.removeAttribute('title');
        if (short && short !== full && node.scrollWidth > node.clientWidth + 1) { node.textContent = short; node.setAttribute('title', full); }
      });
    }
    if (target) mount(target, grid);
    fit();
    if (W.ResizeObserver) new ResizeObserver(function () { W.requestAnimationFrame(fit); }).observe(grid);
    return grid;
  }

  var antonia = {
    data: tables, meta: meta, theme: theme, format: format, agg: agg,
    h: h, mount: mount, esc: esc, chart: chart, table: table, kpi: kpi,
    onTheme: function (listener) { if (typeof listener === 'function') themeListeners.push(listener); },
  };
  Object.defineProperty(W, 'antonia', { value: Object.freeze(antonia), enumerable: true });

  W.addEventListener('load', function () {
    if (!codeStarted) {
      report(new Error('El código del artefacto no llegó a ejecutarse: el HTML deja algo abierto (un comentario, unas comillas o una etiqueta).'), null);
    }
    W.requestAnimationFrame(function () { send('ready', { errors: errors.length, height: D.documentElement.scrollHeight }); });
  });
})();`;
