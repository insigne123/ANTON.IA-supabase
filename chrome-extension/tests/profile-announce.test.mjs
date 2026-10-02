import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// The panel follows the profile on screen by what LinkedIn's page announces (prospecting-content.js), not by asking on a timer.
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a new profile and its name rendering later are announced once each; repeated renders are not', async () => {
  const dom = new JSDOM('<main><section><div id="name"></div></section></main>', { url: 'https://www.linkedin.com/in/ana-perez', runScripts: 'outside-only' });
  const w = dom.window;
  const sent = [];
  // Messages are built inside the page's realm: keep their action only.
  // Only the announcements count here; the marks of PR-4b ask for presence through the same channel.
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener() {} }, sendMessage: message => {
    if (message.action === 'ANTONIA_PROFILE_CHANGED') sent.push(message.action);
    return Promise.resolve({ ok: true, result: {} });
  } } };
  // jsdom lays nothing out: the visibility the header helpers check, as in the other DOM tests.
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.eval(helpers); w.eval(content);
  try {
    await wait(400);
    assert.deepEqual(sent, ['ANTONIA_PROFILE_CHANGED'], 'the open profile is announced');
    // LinkedIn renders the name after the URL: that is a change too.
    w.document.querySelector('#name').innerHTML = '<h1>Ana Pérez</h1>';
    await wait(400);
    assert.equal(sent.length, 2);
    // A render that changes nothing the panel reads is not announced.
    w.document.querySelector('section').append(w.document.createElement('span'));
    await wait(400);
    assert.equal(sent.length, 2);
    // Navigating to another profile without reloading.
    w.history.pushState({}, '', '/in/bruno-diaz');
    w.document.querySelector('#name').innerHTML = '<h1>Bruno Díaz</h1>';
    await wait(400);
    assert.equal(sent.length, 3);
  } finally { w.close(); }
});

test('a page without the extension runtime does not break', async () => {
  const dom = new JSDOM('<main><h1>Ana</h1></main>', { url: 'https://www.linkedin.com/in/ana', runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener() {} }, sendMessage: () => { throw new Error('Extension context invalidated.'); } } };
  w.eval(helpers); w.eval(content);
  try { await wait(400); } finally { w.close(); }
});
