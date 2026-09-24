import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sweep = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');

function env(html, url = 'https://www.linkedin.com/mynetwork/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const handlers = [];
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handlers.push(fn); } } } };
  w.eval(sweep);
  const request = (action) => new Promise(resolve => {
    for (const handler of handlers) {
      let answered = false;
      const done = (response) => { if (!answered) { answered = true; resolve(response); } };
      handler({ action }, { id: 'ext' }, done);
    }
    setTimeout(() => resolve(undefined), 50);
  });
  return { w, close: () => w.close(), request };
}

test('network sweep collects visible profile links once and caps the page', async () => {
  const links = Array.from({ length: 5 }, (_, i) => `<a href="/in/persona-${i}">Persona ${i}</a>`).join('');
  const t = env(`<main>${links}<a href="/in/persona-1">Persona 1</a><a href="/jobs/">Empleos</a></main>`);
  try {
    const result = await t.request('PROSPECT_SWEEP_NETWORK');
    assert.equal(result.ok, true);
    assert.equal(result.entries.length, 5);
    assert.ok(result.entries.every(item => item.url.startsWith('https://www.linkedin.com/in/persona-')));
    assert.ok(result.entries.every(item => item.name.length > 0));
  } finally { t.close(); }
});

test('network sweep ignores pages without profiles', async () => {
  const t = env('<main><a href="/jobs/">Empleos</a></main>');
  try {
    const result = await t.request('PROSPECT_SWEEP_NETWORK');
    assert.equal(result.ok, true);
    assert.deepEqual([...result.entries], []);
  } finally { t.close(); }
});

test('inbox sweep reads threads with direction and unread state', async () => {
  const t = env(`<ul>
    <li class="msg-conversation-listitem"><a href="/messaging/thread/1/">x</a>
      <span class="msg-conversation-card__participant-names">Ana López</span>
      <span class="msg-conversation-card__message-snippet-body">Hola, ¿sigues con la búsqueda?</span>
      <span class="msg-conversation-card__unread-count-notification-badge">1</span></li>
    <li class="msg-conversation-listitem"><a href="/messaging/thread/2/">x</a>
      <span class="msg-conversation-card__participant-names">Luis Pérez</span>
      <span class="msg-conversation-card__message-snippet-body">You: Gracias por responder</span></li>
  </ul>`, 'https://www.linkedin.com/messaging/');
  try {
    const result = await t.request('PROSPECT_SWEEP_INBOX');
    assert.equal(result.ok, true);
    assert.equal(result.threads.length, 2);
    assert.equal(result.threads[0].direction, 'in');
    assert.equal(result.threads[0].replyNeeded, true);
    assert.equal(result.threads[0].key, '/messaging/thread/1/');
    assert.equal(result.threads[1].direction, 'out');
    assert.equal(result.threads[1].replyNeeded, false);
  } finally { t.close(); }
});

test('sweep refuses non-linkedin pages', async () => {
  const t = env('<main><a href="/in/ana">Ana</a></main>', 'https://example.com/');
  try {
    const result = await t.request('PROSPECT_SWEEP_NETWORK');
    assert.equal(result.ok, false);
    assert.match(result.error, /LinkedIn/);
  } finally { t.close(); }
});
