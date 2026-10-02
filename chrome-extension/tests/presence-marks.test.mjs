import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// PR-4b: next to the people on screen, what the organization knows of them. Read-only, in a closed shadow root.
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ANA = 'https://www.linkedin.com/in/ana-perez';
const BRUNO = 'https://www.linkedin.com/in/bruno';

function page(url, html, answer) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const asked = [];
  let handler;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } }, sendMessage: message => {
    if (message.action !== 'PROSPECT_PRESENCE') return Promise.resolve();
    asked.push([...message.urls]);
    return Promise.resolve({ ok: true, result: answer.value });
  } } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.eval(helpers); w.eval(content);
  const marks = () => [...w.document.querySelectorAll('[data-antonia-presence]')].map(node => node.getAttribute('data-antonia-presence'));
  return { w, asked, marks, refresh: () => handler({ action: 'ANTONIA_PRESENCE_REFRESH' }, { id: 'ext' }, () => {}) };
}

test('a profile shows its mark next to the name, updates it on refresh and removes it when nothing is known', async () => {
  const answer = { value: { [ANA]: { label: 'Guardado por Ana', tone: 'info', blocks: false } } };
  const p = page(ANA, '<main><section><h1>Ana Pérez</h1><button>Enviar mensaje</button></section></main>', answer);
  try {
    await wait(900);
    assert.deepEqual(p.marks(), [`${ANA}|Guardado por Ana`]);
    const heading = p.w.document.querySelector('h1');
    assert.equal(heading.nextElementSibling.getAttribute('data-antonia-presence'), `${ANA}|Guardado por Ana`);
    assert.equal(heading.textContent, 'Ana Pérez', 'the name is untouched');
    // Its own insertion does not make the page ask again.
    const asked = p.asked.length;
    await wait(900);
    assert.equal(p.asked.length, asked);
    answer.value = { [ANA]: { label: 'Contactado hoy por LinkedIn', tone: 'info', blocks: false } };
    p.refresh();
    await wait(900);
    assert.deepEqual(p.marks(), [`${ANA}|Contactado hoy por LinkedIn`]);
    answer.value = {};
    p.refresh();
    await wait(900);
    assert.deepEqual(p.marks(), []);
  } finally { p.w.close(); }
});

test('search results: one request for the visible people, without repeats, and a mark only where something is known', async () => {
  const answer = { value: { [BRUNO]: { label: 'En conversación con Ana', tone: 'warning', blocks: true } } };
  const html = `<main><ul>
    <li><a href="${ANA}"><span aria-hidden="true">Ana Pérez</span></a><p>Gerente de Personas</p></li>
    <li><a href="/in/bruno">Bruno Díaz</a></li>
    <li><a href="/in/ana-perez">Ana Pérez</a></li>
    <li><a href="/company/acme">Acme</a></li>
  </ul></main>`;
  const p = page('https://www.linkedin.com/search/results/people/?keywords=rrhh', html, answer);
  try {
    await wait(900);
    assert.deepEqual(p.asked[0], [ANA, BRUNO]);
    assert.deepEqual(p.marks(), [`${BRUNO}|En conversación con Ana`]);
    assert.equal(p.w.document.querySelector('a[href="/in/bruno"]').nextElementSibling.hasAttribute('data-antonia-presence'), true);
  } finally { p.w.close(); }
});

test('without a connected account nothing is shown', async () => {
  const p = page(ANA, '<main><section><h1>Ana Pérez</h1></section></main>', { value: {} });
  try { await wait(900); assert.deepEqual(p.marks(), []); } finally { p.w.close(); }
});
