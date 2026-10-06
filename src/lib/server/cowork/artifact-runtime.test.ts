import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildCoworkArtifactDocument, type CoworkArtifactData } from './code-artifact';
import { coworkExampleContacts, coworkExamplePipeline } from './code-artifact-examples';

// The runtime in JSDOM: what it exposes as `antonia`, the formats, the aggregates, the helpers
// and the hardening. Drawing, theme, loops and the walls are checked in a real browser by
// scripts/test-cowork-artifact-sandbox.ts.

type Antonia = {
  data: Record<string, { rows: Array<Record<string, unknown>>; columns: Array<{ key: string }> }>;
  meta: { currency: string };
  format: Record<string, (...args: unknown[]) => string>;
  agg: Record<string, (...args: unknown[]) => unknown>;
  h: (...args: unknown[]) => HTMLElement;
  mount: (...args: unknown[]) => HTMLElement;
  esc: (value: unknown) => string;
  chart: (target: unknown, spec: unknown) => HTMLElement;
  table: (target: unknown, input: unknown, options?: unknown) => HTMLElement;
  kpi: (target: unknown, items: unknown) => HTMLElement;
};

function load(js = '', data: CoworkArtifactData = coworkExamplePipeline(), html = '<div id="app"></div>') {
  const built = buildCoworkArtifactDocument({ title: 'Prueba', code: { html, css: '', js }, data });
  if (!built.ok) throw new Error(built.issues.map(issue => issue.message).join(' | '));
  const errors: string[] = [];
  const dom = new JSDOM(built.html, {
    runScripts: 'dangerously', url: 'https://artifact.test/a#theme=dark',
    beforeParse(window) {
      // JSDOM has no MessageChannel: a timer that does not keep the test alive does its job here.
      function TestChannel() {
        const port1: { onmessage: (() => void) | null } = { onmessage: null };
        return { port1, port2: { postMessage: () => { setTimeout(() => port1.onmessage?.(), 0).unref(); } } };
      }
      Object.assign(window, { MessageChannel: TestChannel });
      window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number;
    },
  });
  dom.window.addEventListener('error', event => errors.push(event.message));
  return { dom, window: dom.window, document: dom.window.document, antonia: (dom.window as unknown as { antonia: Antonia }).antonia, errors };
}

test('antonia is there, frozen, with the data the server put in and the theme from the address', () => {
  const { antonia, document, dom } = load();
  assert.ok(Object.isFrozen(antonia));
  assert.equal(antonia.data.pipeline.rows.length, 36);
  assert.equal(antonia.meta.currency, 'CLP');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.throws(() => { (dom.window as unknown as { antonia: unknown }).antonia = {}; });
  dom.window.close();
});

test('es-CL formats: money, numbers, percent, compact and dates without a day shift', () => {
  const { antonia, dom } = load();
  const { format } = antonia;
  assert.equal(format.money(1234567), '$1.234.567');
  assert.equal(format.number(1234.5), '1.235');
  assert.equal(format.number(12.34), '12,3');
  assert.equal(format.percent(0.123), '12,3%');
  assert.equal(format.compact(568000000, 'money').replace(/\s/g, ' '), '$568 M');
  assert.equal(format.compact(9999), '9.999');
  assert.equal(format.date('2026-10-01'), '1 oct 2026');
  assert.equal(format.value(null, 'money'), '—');
  assert.equal(format.value(true, 'text'), 'Sí');
  dom.window.close();
});

test('aggregates read the rows: sum, average, groups in a given order, months, top', () => {
  const { antonia, dom } = load();
  const rows = antonia.data.pipeline.rows;
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
  assert.equal(antonia.agg.sum(rows, 'value'), total);
  assert.equal(antonia.agg.count(rows, (row: Record<string, unknown>) => row.stage === 'Ganado'), rows.filter(row => row.stage === 'Ganado').length);
  const series = antonia.agg.series(rows, 'stage', { order: ['Nuevo', 'Contactado'] }) as { labels: string[]; values: number[] };
  assert.deepEqual(Array.from(series.labels.slice(0, 2)), ['Nuevo', 'Contactado']);
  assert.equal(series.values.reduce((a, b) => a + b, 0), rows.length);
  const months = antonia.agg.byMonth(rows, 'created_at') as { keys: string[]; values: number[] };
  assert.deepEqual(Array.from(months.keys), [...months.keys].sort());
  assert.equal(months.values.reduce((a, b) => a + b, 0), rows.length);
  const [best] = antonia.agg.top(rows, 'value', 1) as Array<Record<string, number>>;
  assert.equal(best.value, Math.max(...rows.map(row => Number(row.value))));
  assert.equal(antonia.agg.avg([], 'value'), null);
  dom.window.close();
});

test('h builds elements with text, never HTML; esc escapes for templates', () => {
  const { antonia, document, dom } = load();
  const node = antonia.h('p', { class: 'muted', 'data-id': '7', onClick: () => {} }, '<b>hola</b>', null, ['a', 1]);
  assert.equal(node.className, 'muted');
  assert.equal(node.getAttribute('data-id'), '7');
  assert.equal(node.textContent, '<b>hola</b>a1');
  assert.equal(node.querySelector('b'), null);
  assert.equal(antonia.esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
  antonia.mount('#app', node);
  assert.equal(document.getElementById('app')!.firstChild, node);
  dom.window.close();
});

test('HTML written at run time is cleaned: no scripts, frames, meta, handlers or links out', () => {
  const { document, dom } = load();
  const app = document.getElementById('app')!;
  app.innerHTML = '<p id="ok">bien</p><script>window.bad = 1</script><iframe src="x"></iframe><meta http-equiv="refresh" content="0;url=x">'
    + '<img id="img" src="x" onerror="window.bad = 2"><a id="out" href="https://evil.example">x</a><a id="in" href="#ok">y</a><form action="x"></form>';
  assert.ok(document.getElementById('ok'));
  assert.equal(app.querySelector('script, iframe, meta, form'), null);
  assert.equal(document.getElementById('img')!.getAttribute('onerror'), null);
  assert.equal(document.getElementById('img')!.getAttribute('src'), null);
  assert.equal(document.getElementById('out')!.getAttribute('href'), null);
  assert.equal(document.getElementById('in')!.getAttribute('href'), '#ok');
  app.insertAdjacentHTML('beforeend', '<object data="x"></object><b id="b">b</b>');
  assert.equal(app.querySelector('object'), null);
  assert.ok(document.getElementById('b'));
  dom.window.close();
});

test('the page cannot grow a frame, a script or a refresh by other doors', () => {
  const { document, window, dom } = load();
  assert.throws(() => document.createElement('iframe'), /no está permitido/);
  assert.throws(() => document.createElement('SCRIPT'), /no está permitido/);
  assert.throws(() => document.createElementNS('http://www.w3.org/1999/xhtml', 'meta'), /no está permitido/);
  assert.throws(() => document.write('<p>x</p>'), /no está disponible/);
  const viewport = document.querySelector('meta[name=viewport]')!;
  assert.throws(() => viewport.setAttribute('http-equiv', 'refresh'), /<meta>/);
  assert.throws(() => (viewport as HTMLMetaElement).httpEquiv = 'refresh', /no está disponible/);
  assert.throws(() => document.body.setAttribute('onload', 'x()'), /addEventListener/);
  assert.equal(window.open('https://evil.example'), null);
  const link = document.createElement('a');
  link.href = 'https://evil.example';
  document.body.appendChild(link);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  dom.window.close();
});

test('a table sorts and filters; a chart keeps its numbers in a table beside it', () => {
  const { antonia, document, window, dom } = load('', coworkExampleContacts());
  const table = antonia.table('#app', antonia.data.contacts, { sortBy: 'fit', pageSize: 5 });
  const body = () => [...table.querySelectorAll('tbody tr')].map(row => row.textContent || '');
  assert.equal(body().length, 5);
  const fits = [...table.querySelectorAll('tbody tr td:nth-child(5)')].map(cell => Number(cell.textContent));
  assert.deepEqual(fits, [...fits].sort((a, b) => b - a));
  const more = table.querySelector('.antonia-more') as HTMLButtonElement;
  assert.match(more.textContent || '', /^Mostrar 5 más \(quedan 19\)$/);
  more.click();
  assert.equal(body().length, 10);
  const search = table.querySelector('input[type=search]') as HTMLInputElement;
  search.value = 'Minera';
  search.dispatchEvent(new window.Event('input'));
  assert.ok(body().every(text => text.includes('Minera')));
  const nameHeader = [...table.querySelectorAll('th')].find(th => th.textContent?.startsWith('Nombre'))!;
  (nameHeader.querySelector('button') as HTMLButtonElement).click();
  assert.equal(nameHeader.getAttribute('aria-sort'), 'ascending');

  const chart = antonia.chart(null, { type: 'bar', title: 'Por rubro', labels: ['Minería', 'Retail'], series: [{ name: 'Contactos', values: [6, 4] }] });
  document.body.appendChild(chart);
  assert.equal(chart.querySelector('.antonia-chart-title')!.textContent, 'Por rubro');
  assert.match(chart.querySelector('.sr-only')!.textContent || '', /Mayor: Minería, 6/);
  assert.deepEqual([...chart.querySelectorAll('details tbody tr')].map(row => row.textContent), ['Minería6', 'Retail4']);
  assert.ok(chart.querySelector('svg'));
  dom.window.close();
});

test('charts fold extra slices and series into «Otros» instead of inventing colors', () => {
  const { antonia, dom } = load();
  const donut = antonia.chart(null, { type: 'donut', labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], series: [{ name: 'n', values: [8, 7, 6, 5, 4, 3, 2, 1] }] });
  assert.deepEqual([...donut.querySelectorAll('details tbody th')].map(cell => cell.textContent), ['a', 'b', 'c', 'd', 'e', 'Otros']);
  assert.equal([...donut.querySelectorAll('details tbody td')].pop()!.textContent, '6');
  const bars = antonia.chart(null, { type: 'bar', labels: ['x'], series: [1, 2, 3, 4, 5, 6, 7].map(n => ({ name: `s${n}`, values: [n] })) });
  assert.deepEqual([...bars.querySelectorAll('.antonia-legend li')].map(item => item.textContent), ['s1', 's2', 's3', 's4', 'Otros']);
  dom.window.close();
});

test('KPI tiles format by unit and say the change with a sign and an arrow, not only a color', () => {
  const { antonia, dom } = load();
  const tiles = antonia.kpi(null, [{ label: 'Monto', value: 568000000, unit: 'money', delta: 0.12, hint: 'vs septiembre' }, { label: 'Tasa', value: 0.5, unit: 'percent', delta: -0.05 }]);
  const values = [...tiles.querySelectorAll('.antonia-kpi-value')].map(node => node.textContent);
  assert.equal(values[0], '$568.000.000');
  assert.equal(values[1], '50%');
  const deltas = [...tiles.querySelectorAll('.antonia-delta')].map(node => node.textContent!.replace(/\s/g, ' '));
  assert.deepEqual(deltas, ['▲ +12%', '▼ -5%']);
  dom.window.close();
});

test('an error in the artifact\'s code says which line of that code failed', async () => {
  const { window, dom } = load('const a = 1;\nconst b = 2;\nmissingFunction(a + b);');
  const banner = await new Promise<string | null>(done => setTimeout(() => done(window.document.getElementById('antonia-error')?.textContent ?? null), 50));
  assert.equal(banner, 'Una parte de este artefacto no se pudo mostrar.');
  dom.window.close();
});

test('the loop guard stops a loop that never gives the page a turn', () => {
  const { window, dom } = load();
  const guard = (window as unknown as { __antoniaLoop: () => void }).__antoniaLoop;
  const started = Date.now();
  assert.throws(() => { for (;;) guard(); }, /Un bucle no terminó en 2 segundos/);
  assert.ok(Date.now() - started >= 2000 && Date.now() - started < 4000);
  dom.window.close();
});
