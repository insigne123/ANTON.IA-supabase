import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const contentSource = await readFile(new URL('prospecting-content.js', root), 'utf8');
const backgroundSource = await readFile(new URL('prospecting-background.js', root), 'utf8');
const target = 'https://www.linkedin.com/in/ana';

function content({ wrongRecipient = false, existingText = '', changeProfile = false } = {}) {
  const dom = new JSDOM(`<main><section><h1>Ana</h1><button id="message">Mensaje</button></section></main><aside class="msg-overlay-conversation-bubble"><a href="${wrongRecipient ? 'https://www.linkedin.com/in/other' : target}">Persona</a><div class="msg-form__contenteditable" contenteditable="true">${existingText}</div><button id="send">Enviar</button></aside>`, { url: target });
  let handler, clicks = 0, time = 0;
  dom.window.document.querySelector('#send').addEventListener('click', () => clicks++);
  const context = vm.createContext({ document: dom.window.document, location: dom.window.location, URL,
    chrome: { runtime: { id: 'extension', onMessage: { addListener: fn => { handler = fn; } } } },
    normalizeText: text => String(text || '').trim().toLowerCase(),
    isElementVisible: () => true, findMessageButton: card => card.querySelector('button'), safeClick: button => { button.click(); if (changeProfile) dom.reconfigure({ url: 'https://www.linkedin.com/in/other' }); },
    setElementText: (node, text) => { node.textContent = text; }, textLooksApplied: (node, text) => node.textContent === text,
    delay: async () => { time += 1000; }, Date: { now: () => time },
  });
  vm.runInContext(contentSource, context);
  const request = body => new Promise(resolve => handler(body, { id: 'extension' }, resolve));
  return { dom, request, clicks: () => clicks };
}

test('prepares only the requested recipient and never clicks Send', async () => {
  const env = content();
  const result = await env.request({ action: 'PROSPECT_PREPARE_MESSAGE', profileUrl: target, message: 'Hola Ana' });
  assert.equal(result.status, 'prepared');
  assert.equal(env.dom.window.document.querySelector('[contenteditable]').textContent, 'Hola Ana');
  assert.equal(env.clicks(), 0);
});
test('refuses wrong recipients, profile navigation and existing drafts', async () => {
  for (const options of [{ wrongRecipient: true }, { existingText: 'My unsent draft' }, { changeProfile: true }]) {
    const env = content(options);
    const result = await env.request({ action: 'PROSPECT_PREPARE_MESSAGE', profileUrl: target, message: 'Do not insert' });
    assert.equal(result.ok, false);
    assert.notEqual(env.dom.window.document.querySelector('[contenteditable]').textContent, 'Do not insert');
    assert.equal(env.clicks(), 0);
  }
});
test('worker rejects web callers and binds consent to tab, nonce, origin and main frame', async () => {
  let handler;
  const session = { prospectPending: { tabId: 4, origin: 'https://app.antonia.ai', nonce: 'expected', expires: Date.now() + 10000 } };
  const calls = [];
  const context = vm.createContext({ URL, crypto: { randomUUID: () => 'nonce' }, Date, console,
    isAllowedAppUrl: url => new URL(url).origin === 'https://app.antonia.ai',
    chrome: { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener: fn => { handler = fn; } } },
      storage: { session: { get: async key => ({ [key]: session[key] }), set: async data => Object.assign(session, data), remove: async key => { delete session[key]; } } },
      tabs: { onRemoved: { addListener() {} }, sendMessage: async (...args) => { calls.push(args); return { ok: true, result: { organizationId: 'org', userId: 'user' } }; } },
      sidePanel: { setPanelBehavior: async () => {} },
    },
  });
  vm.runInContext(backgroundSource, context);
  const request = (body, sender) => new Promise(resolve => handler(body, sender, resolve));
  const web = { id: 'extension', tab: { id: 4 }, frameId: 0, url: 'https://app.antonia.ai/extension/connect' };
  assert.equal((await request({ action: 'PROSPECT_API', body: { action: 'save' } }, web)).ok, false);
  assert.equal((await request({ action: 'PROSPECT_APPROVE', nonce: 'wrong' }, web)).ok, false);
  assert.equal((await request({ action: 'PROSPECT_APPROVE', nonce: 'expected' }, { ...web, frameId: 2 })).ok, false);
  assert.equal((await request({ action: 'PROSPECT_APPROVE', nonce: 'expected' }, { ...web, tab: { id: 8 } })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await request({ action: 'PROSPECT_APPROVE', nonce: 'expected' }, web)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(session.prospectConnection.session.organizationId, 'org');
});
