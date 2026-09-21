import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../prospecting-send.js', import.meta.url), 'utf8');
const target = 'https://www.linkedin.com/in/ana';
function setup({ wrong = false, draft = '', navigate = false, oldOnly = false, truncate = false, noId = false } = {}) {
  const dom = new JSDOM(`<main><section><h1>Ana</h1><button>Mensaje</button></section></main>
    <aside class="msg-overlay-conversation-bubble" id="other"><header class="msg-overlay-bubble-header"><a href="https://www.linkedin.com/in/other">Otra persona</a></header><div contenteditable="true" class="msg-form__contenteditable">Borrador ajeno</div><button class="msg-form__send-button">Enviar</button></aside>
    <aside class="msg-overlay-conversation-bubble" id="target"><header class="msg-overlay-bubble-header"><a href="${wrong ? 'https://www.linkedin.com/in/wrong' : target}">Ana</a></header><div contenteditable="true" class="msg-form__contenteditable">${draft}</div><button class="msg-form__send-button">Enviar</button><div class="msg-s-message-group--is-mine"><div class="msg-s-event-listitem" data-event-urn="old"><p class="msg-s-event-listitem__body">Hola Ana</p></div></div></aside>`, { url: target });
  let handler, clicks = 0;
  const doc = dom.window.document;
  doc.querySelectorAll('.msg-form__send-button').forEach(button => button.addEventListener('click', () => {
    clicks++;
    const node = doc.createElement('div'); node.className = 'msg-s-event-listitem';
    if (!noId) node.dataset.eventUrn = 'new';
    node.innerHTML = `<p class="msg-s-event-listitem__body">${oldOnly ? 'Otro mensaje' : 'Hola Ana'}</p>`;
    button.closest('aside').querySelector('.msg-s-message-group--is-mine')?.append(node);
  }));
  vm.runInNewContext(source, { URL, document: doc, location: dom.window.location,
    chrome: { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } } } },
    findMessageButton: root => root.querySelector('button'), isElementVisible: () => true,
    waitLinkedinProfileHeader: async () => ({ button: doc.querySelector('main button') }),
    linkedinMessagingGate: () => '', linkedinIsInMail: () => false,
    linkedinMessageEditor: bubble => bubble.querySelector('[contenteditable]'), linkedinEditorText: editor => editor.textContent,
    isElementDisabled: () => false, safeClick: button => button.click(),
    setElementText: (node, text) => { node.textContent = truncate ? text.slice(0, 3) : text; },
    delay: async () => { if (navigate) dom.reconfigure({ url: 'https://www.linkedin.com/in/changed' }); },
  });
  const send = (id = 'op') => new Promise(resolve => handler({ action: 'PROSPECT_EXECUTE_SEND', operationId: id, profileUrl: target, message: 'Hola Ana' }, { id: 'ext' }, resolve));
  return { dom, doc, send, clicks: () => clicks };
}
test('auto send scopes recipient, preserves other chats and confirms only new event; replay never clicks again', async () => {
  const env = setup();
  try {
    assert.equal((await env.send()).status, 'confirmed');
    assert.equal(env.clicks(), 1);
    assert.equal(env.doc.querySelector('#other [contenteditable]').textContent, 'Borrador ajeno');
    assert.equal((await env.send()).status, 'confirmed');
    assert.equal(env.clicks(), 1);
  } finally { env.dom.window.close(); }
});
test('wrong recipient, existing draft, navigation and truncated insertion never send', async () => {
  for (const options of [{ wrong: true }, { draft: 'Mi borrador' }, { navigate: true }, { truncate: true }]) {
    const env = setup(options);
    try {
      assert.equal((await env.send()).status, 'not_sent');
      assert.equal(env.clicks(), 0);
      if (options.draft) assert.equal(env.doc.querySelector('#target [contenteditable]').textContent, options.draft);
    } finally { env.dom.window.close(); }
  }
});
test('old matching text plus unrelated new event, or missing event identity, remains uncertain', async () => {
  for (const options of [{ oldOnly: true }, { noId: true }]) {
    const env = setup(options);
    try { assert.equal((await env.send()).status, 'uncertain'); assert.equal(env.clicks(), 1); }
    finally { env.dom.window.close(); }
  }
});
test('legacy requests are rejected even from the app', async () => {
  let handler;
  vm.runInNewContext(await readFile(new URL('../background.js', import.meta.url), 'utf8'), {
    URL, importScripts() {}, chrome: { runtime: { onMessage: { addListener: fn => { handler = fn; } } } },
  });
  let result;
  handler({ action: 'SEND_DM' }, { tab: { url: 'https://app.antonia.ai' } }, value => { result = value; });
  assert.equal(result.success, false);
});
