import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'acorn';
import { COWORK_ARTIFACT_RUNTIME_JS } from '@/lib/cowork/artifact-runtime';
import {
  COWORK_ARTIFACT_CODE_MAX_BYTES, buildCoworkArtifactDocument, checkCoworkArtifactCode, guardCoworkArtifactLoops, normalizeCoworkArtifactData,
  type CoworkArtifactData,
} from './code-artifact';
import { COWORK_ARTIFACT_EXAMPLES, coworkExamplePipeline } from './code-artifact-examples';
import { COWORK_ARTIFACT_FRAME_SRC, coworkArtifactFrameMessage, coworkArtifactFrameUrl, coworkArtifactThemeMessage } from '@/lib/cowork/code-artifact-frame';

const ok = (js: string, html = '<div id="app"></div>', css = '') => checkCoworkArtifactCode({ html, css, js });
const messages = (js: string, html = '<div id="app"></div>', css = '') => ok(js, html, css).map(issue => issue.message);
const empty: CoworkArtifactData = { tables: {} };

test('the examples pass the check and build', () => {
  for (const example of COWORK_ARTIFACT_EXAMPLES) {
    assert.deepEqual(checkCoworkArtifactCode(example.code), [], example.id);
    const built = buildCoworkArtifactDocument({ title: example.title, code: example.code, data: example.data });
    assert.equal(built.ok, true, example.id);
  }
});

test('ordinary artifact code passes: DOM, events, charts, async, the window for its own events', () => {
  assert.deepEqual(ok(`const rows = antonia.data.pipeline.rows;
document.querySelector('#app').addEventListener('click', () => {});
window.addEventListener('resize', () => {});
const ns = 'http://www.w3.org/2000/svg';
const el = document.createElementNS(ns, 'rect');
await new Promise(done => setTimeout(done, 10));
function walk(node, parent) { return parent ? node : null; }
const style = { top: 0 }; style.top = 4; el.style.top = '2px';
for (const row of rows) { if (row.location) console.log(row.location); }
class Card { constructor(title) { this.title = title; } }
new Card('x');`), []);
  assert.deepEqual(ok('', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="#top"><rect width="10" height="10"/></a></svg><img src="data:image/png;base64,AAAA" alt="">'), []);
});

test('network, navigation, storage, eval and other windows are refused with a message the writer can act on', () => {
  const cases: Array<[string, RegExp]> = [
    ['fetch("/x")', /fetch: El artefacto no tiene red/],
    ['new XMLHttpRequest()', /XMLHttpRequest/],
    ['new WebSocket("ws://x")', /WebSocket/],
    ['location.href = "#a"', /location: El artefacto no puede navegar/],
    ['window.location.href = "x"', /window\.location/],
    ['document.location = "x"', /document\.location/],
    ['self["fe" + "tch"]("x")', /self\[…\] no está permitido/],
    ['const w = window; w.open("x")', /window solo se usa como window\.algo/],
    ['top.document.title', /top: El artefacto no puede tocar la app/],
    ['parent.postMessage("x", "*")', /parent|postMessage/],
    ['localStorage.setItem("a", "b")', /localStorage/],
    ['document.cookie', /\.cookie: Sin cookies/],
    ['eval("1")', /eval/],
    ['new Function("return 1")', /Function/],
    ['setTimeout("alert(1)", 10)', /setTimeout recibe una función/],
    ['import("x")', /Sin import/],
    ['document.createElement("iframe")', /<iframe> no está permitido/],
    ['document.createElement("script")', /<script> no está permitido/],
    ['el.ownerDocument.defaultView.fetch("x")', /\.defaultView/],
    ['[].constructor.constructor("x")', /constructor/],
    ['const u = "https://evil.example/x"', /Sin direcciones externas/],
    ['const u = `//cdn.example.com/x.js`', /Sin direcciones externas/],
    ['el.innerHTML = "<meta http-equiv=refresh>"', /<meta>/],
    ['window.__antoniaLoop = () => {}', /__antonia/],
    ['alert("hola")', /alert/],
  ];
  for (const [js, pattern] of cases) assert.ok(messages(js).some(message => pattern.test(message)), `${js} → ${messages(js).join(' | ')}`);
});

test('a common word the code declares itself is its own; the dangerous ones stay refused even when declared', () => {
  assert.deepEqual(ok('function draw(parent) { parent.appendChild(document.createElement("div")); } draw(document.body);'), []);
  assert.deepEqual(ok('const top = 10; const open = true; console.log(top, open);'), []);
  assert.ok(messages('const location = "Santiago"; console.log(location);').some(message => /location/.test(message)));
  assert.ok(messages('const fetch = () => 1; fetch();').some(message => /fetch/.test(message)));
});

test('syntax errors come with their line in the writer\'s code', () => {
  const [issue] = ok('const a = 1;\nconst b = ;\n');
  assert.equal(issue.part, 'js');
  assert.equal(issue.line, 2);
  assert.match(issue.message, /^Error de sintaxis/);
  assert.match(messages('with (Math) { max(1, 2); }')[0], /Error de sintaxis|with/);
  assert.match(messages('const s = "</script>";')[0], /<\/script/);
});

test('HTML: no scripts, frames, forms, handlers, links out or outside files', () => {
  const html = (markup: string) => messages('', markup);
  assert.match(html('<script>alert(1)</script>')[0], /el código va en js/);
  assert.match(html('<iframe src="x"></iframe>')[0], /<iframe>/);
  assert.match(html('<form><input></form>')[0], /<form>/);
  assert.match(html('<meta http-equiv="refresh" content="0">')[0], /<meta>/);
  assert.ok(html('<button onclick="go()">Ir</button>').some(message => /addEventListener/.test(message)));
  assert.ok(html('<a href="https://evil.example">x</a>').some(message => /href="#…"/.test(message)));
  assert.ok(html('<img src="/logo.png" alt="">').some(message => /Sin archivos externos/.test(message)));
  assert.ok(html('<div style="background:url(/x.png)"></div>').some(message => /url\(\)/.test(message)));
  assert.ok(html('<a href="javascript:void(0)">x</a>').some(message => /javascript:/.test(message)));
});

test('HTML that leaves a comment, a quote or a raw-text element open is refused: it would swallow the code', () => {
  assert.match(messages('', '<div id="app"></div><!-- nota')[0], /deja algo abierto/);
  assert.match(messages('', '<div class="a>texto</div>')[0], /deja algo abierto/);
  assert.match(messages('', '<textarea>sin cerrar')[0], /deja algo abierto/);
  assert.deepEqual(messages('', '<div><p>sin cerrar el div'), []);
  assert.deepEqual(messages('', '<select><option>uno</select>'), []);
});

test('CSS: no imports, outside urls or ways out of the style tag', () => {
  const css = (text: string) => messages('', '<div></div>', text);
  assert.ok(css('@import url(x.css);').some(message => /@import/.test(message)));
  assert.ok(css('.a{background:url(https://x/y.png)}').some(message => /url\(\)/.test(message)));
  assert.ok(css('</style><script>x</script>').some(message => /<style>/.test(message)));
  assert.deepEqual(css('.a{background:url(data:image/png;base64,AAAA)}'), []);
});

test('size: the code has a ceiling and the data does not count against it', () => {
  const big = `const a = "${'x'.repeat(COWORK_ARTIFACT_CODE_MAX_BYTES)}";`;
  assert.equal(ok(big)[0].part, 'size');
  assert.equal(checkCoworkArtifactCode({ html: '', css: '', js: '' })[0].message, 'El artefacto está vacío: falta el HTML o el código.');
});

test('every loop body gets the guard, with lines and labels intact', () => {
  assert.equal(guardCoworkArtifactLoops('for (let i = 0; i < 3; i++) x(i);'), 'for (let i = 0; i < 3; i++) {__antoniaLoop();x(i);}');
  assert.equal(guardCoworkArtifactLoops('while (true) { y(); }'), 'while (true) {__antoniaLoop(); y(); }');
  assert.equal(guardCoworkArtifactLoops('do z(); while (a)'), 'do {__antoniaLoop();z();} while (a)');
  assert.equal(guardCoworkArtifactLoops('outer: for (const a of b) for (const c of d) e();'),
    'outer: for (const a of b) {__antoniaLoop();for (const c of d) {__antoniaLoop();e();}}');
  assert.equal(guardCoworkArtifactLoops('for (const k in o) ;'), 'for (const k in o) {__antoniaLoop();;}');
  const code = 'const a = [1, 2];\nfor (const x of a) {\n  if (x) continue;\n}\nnotHere();';
  const guarded = guardCoworkArtifactLoops(code);
  assert.equal(guarded.split('\n').length, code.split('\n').length);
  assert.equal(guarded.split('\n')[4], 'notHere();');
  assert.doesNotThrow(() => parse(`(async function(){${guarded}\n})();`, { ecmaVersion: 'latest' }));
});

test('the document: CSP with a nonce, the runtime, escaped data, the code on the line it says', () => {
  const data = coworkExamplePipeline();
  data.tables.pipeline.rows[0].company = '</script><script>alert(1)</script>';
  const built = buildCoworkArtifactDocument({ title: 'Pipeline <b>', code: { html: '<div id="app"></div>', css: '.a{}', js: 'const a = 1;\nnotDefined();' }, data, nonce: 'abcdef0123456789abcd' });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const html = built.html;
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-abcdef0123456789abcd'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'">/);
  assert.match(html, /<title>Pipeline &lt;b&gt;<\/title>/);
  assert.equal((html.match(/<script nonce="abcdef0123456789abcd"/g) || []).length, 2);
  assert.ok(!html.includes('</script><script>alert(1)'), 'the data cannot close its tag');
  assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)'));
  assert.ok(html.includes('<main id="antonia-root">'));
  const lines = html.split('\n');
  const declared = Number(/data-line="(\d+)"/.exec(html)![1]);
  assert.match(lines[declared - 1], /id="antonia-code".*const a = 1;$/);
  assert.equal(lines[declared], 'notDefined();');
  // Each build gets its own nonce.
  const again = buildCoworkArtifactDocument({ title: 'x', code: { html: '<p></p>', css: '', js: '' }, data: empty });
  const other = buildCoworkArtifactDocument({ title: 'x', code: { html: '<p></p>', css: '', js: '' }, data: empty });
  assert.ok(again.ok && other.ok && /nonce-([a-f0-9]+)/.exec(again.html)![1] !== /nonce-([a-f0-9]+)/.exec(other.html)![1]);
  // An HTML with its own <main> is not wrapped again.
  const own = buildCoworkArtifactDocument({ title: 'x', code: { html: '<main><p>hola</p></main>', css: '', js: '' }, data: empty });
  assert.ok(own.ok && !own.html.includes('antonia-root'));
});

test('a document with problems is not built', () => {
  const built = buildCoworkArtifactDocument({ title: 'x', code: { html: '<script>x</script>', css: '', js: 'fetch("x")' }, data: empty });
  assert.equal(built.ok, false);
  if (!built.ok) assert.ok(built.issues.length >= 2);
});

test('the data goes in plain: known types, plain cells, 2,000 rows at most, truncation said', () => {
  const rows = Array.from({ length: 2100 }, (_, at) => ({ n: at, name: `Fila ${at}`, extra: { nested: true } as unknown as string, bad: Number.NaN }));
  const data = normalizeCoworkArtifactData({ currency: 'usd', tables: {
    big: { label: 'Grande', source: 'prueba', total: 2100, truncated: false, rows,
      columns: [{ key: 'n', label: 'N', type: 'number' }, { key: 'name', label: 'Nombre', type: 'weird' as 'text' }, { key: 'extra', label: 'Extra', type: 'text' }, { key: 'bad', label: 'Mal', type: 'number' }] },
    'no-valid key': { label: 'x', source: 'x', total: 0, truncated: false, rows: [], columns: [] },
  } });
  assert.deepEqual(Object.keys(data.tables), ['big']);
  const big = data.tables.big;
  assert.equal(big.rows.length, 2000);
  assert.equal(big.total, 2100);
  assert.equal(big.truncated, true);
  assert.equal(big.columns[1].type, 'text');
  assert.deepEqual(big.rows[0], { n: 0, name: 'Fila 0', extra: null, bad: null });
  assert.equal(data.currency, 'CLP');
});

test('the runtime is plain ES5-style JavaScript, so a downloaded artifact runs anywhere', () => {
  assert.doesNotThrow(() => parse(COWORK_ARTIFACT_RUNTIME_JS, { ecmaVersion: 5 }));
});

test('the Cowork page frames only itself: next.config.js and the constant agree', () => {
  const config = readFileSync(new URL('../../../../next.config.js', import.meta.url), 'utf8');
  assert.ok(config.includes(`value: "${COWORK_ARTIFACT_FRAME_SRC}"`));
  assert.match(config, /source: '\/cowork'/);
  assert.match(config, /source: '\/cowork\/:path\*'/);
});

test('frame messages: only from that frame and with the runtime\'s shape', () => {
  const frame = {};
  assert.equal(coworkArtifactFrameUrl('/api/x?view=1#old', 'dark', 'https://app.example'), '/api/x?view=1#theme=dark&origin=https%3A%2F%2Fapp.example');
  assert.deepEqual(coworkArtifactFrameMessage({ source: frame, data: { source: 'antonia-artifact', type: 'error', detail: { message: 'x is not defined', line: 3 } } }, frame),
    { type: 'error', message: 'x is not defined', line: 3 });
  assert.deepEqual(coworkArtifactFrameMessage({ source: frame, data: { source: 'antonia-artifact', type: 'ready', detail: { errors: 0 } } }, frame), { type: 'ready', errors: 0 });
  assert.equal(coworkArtifactFrameMessage({ source: {}, data: { source: 'antonia-artifact', type: 'ready' } }, frame), null);
  assert.equal(coworkArtifactFrameMessage({ source: frame, data: { source: 'other', type: 'ready' } }, frame), null);
  assert.equal(coworkArtifactFrameMessage({ source: frame, data: { source: 'antonia-artifact', type: 'error', detail: { message: 'x', line: -2 } } }, frame)?.type, 'error');
  assert.deepEqual(coworkArtifactThemeMessage('light'), { source: 'antonia-host', type: 'theme', mode: 'light' });
});
