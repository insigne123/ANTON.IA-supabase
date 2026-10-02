import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { activityNote, activityOpened } from '../ui/activity.ts';

// PR-4e: the person's latest posts, read from their profile as LinkedIn shows them, for the message to open from one.
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');

function read(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  let handler;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } }, sendMessage: () => Promise.resolve({ ok: true, result: {} }) } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.eval(helpers); w.eval(content);
  let answer;
  handler({ action: 'PROSPECT_READ_ACTIVITY' }, { id: 'ext' }, value => { answer = value; });
  w.close();
  return JSON.parse(JSON.stringify(answer));
}

const post = (text, when, header = '') => `<li><div class="feed-shared-update-v2" data-urn="urn:li:activity:${Math.random().toString().slice(2)}">
  ${header ? `<div class="update-components-header"><span>${header}</span></div>` : ''}
  <div class="update-components-actor__sub-description"><span aria-hidden="true">${when} • Editado • </span><span class="visually-hidden">hace ${when}</span></div>
  <div class="update-components-text"><span dir="ltr">${text}</span><button>…ver más</button></div></div></li>`;

test('the «Actividad» section of the profile: up to 3 posts with their words, LinkedIn’s date and whether shared or commented', () => {
  const html = `<main>
    <section><h2><span aria-hidden="true">Acerca de</span></h2><div class="update-components-text">No es una publicación.</div></section>
    <section><h2><span aria-hidden="true">Actividad</span><span class="visually-hidden">Actividad</span></h2><ul>
      ${post('Este año duplicamos el equipo de bodega en Antofagasta.', '2 sem')}
      ${post('Gran artículo sobre seguridad minera.', '3 sem', 'Ana Rojas ha compartido esto')}
      ${post('Felicitaciones al equipo por el récord.', '1 mes', 'Ana Rojas ha comentado esto')}
      ${post('Una cuarta publicación.', '2 meses')}
    </ul></section></main>`;
  assert.deepEqual(read(html, 'https://www.linkedin.com/in/ana-rojas/').posts, [
    { text: 'Este año duplicamos el equipo de bodega en Antofagasta.', when: '2 sem', kind: 'post' },
    { text: 'Gran artículo sobre seguridad minera.', when: '3 sem', kind: 'repost' },
    { text: 'Felicitaciones al equipo por el récord.', when: '1 mes', kind: 'comment' },
  ]);
});

test('the activity page reads its feed; a long post is cut at 600; elsewhere, or without posts, there is nothing', () => {
  const long = 'Palabra '.repeat(120).trim();
  const feed = `<main><ul>${post(long, '5 d')}</ul></main>`;
  const [only] = read(feed, 'https://www.linkedin.com/in/ana-rojas/recent-activity/all/').posts;
  assert.equal(only.text.length, 600);
  assert.equal(only.when, '5 d');
  assert.deepEqual(read(feed, 'https://www.linkedin.com/feed/').posts, []);
  assert.deepEqual(read('<main><section><h2>Actividad</h2><p>Ana aún no ha publicado nada.</p></section></main>', 'https://www.linkedin.com/in/ana-rojas/').posts, []);
});

test('the panel says where the message opens from, or why it does not', () => {
  const sources = [{ kind: 'activity', activityKind: 'repost', when: '3 sem', text: 'Gran artículo sobre seguridad minera.', statement: 'x', url: '' }, { statement: 'Hecho', url: '' }];
  assert.deepEqual(activityOpened(sources), { label: 'Abre desde lo que compartió · 3 sem', quote: 'Gran artículo sobre seguridad minera.' });
  assert.equal(activityOpened([{ statement: 'Hecho', url: '' }]), null);
  assert.equal(activityNote({ posts: [], onProfile: false }, false), 'Abre su perfil en LinkedIn para usar sus publicaciones recientes.');
  assert.equal(activityNote({ posts: [], onProfile: true }, false), 'No vimos publicaciones recientes en su perfil.');
  assert.equal(activityNote({ posts: [{ text: 'x', when: '', kind: 'post' }], onProfile: true }, false), 'Sus publicaciones recientes no calzaban con tu objetivo.');
  assert.equal(activityNote({ posts: [{ text: 'x', when: '', kind: 'post' }], onProfile: true }, true), 'Abre desde su actividad reciente: revisa que la cita sea fiel.');
});
