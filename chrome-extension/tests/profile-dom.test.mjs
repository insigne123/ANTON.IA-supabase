import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const prepare = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');
const automatic = await readFile(new URL('../prospecting-send.js', import.meta.url), 'utf8');
const target = 'https://www.linkedin.com/in/bianca-salazar-j%C3%A1uregui-259235177';
function fixture(layout, editor = '<div contenteditable="true" role="textbox"></div>') {
  const dom = new JSDOM(`${layout}<aside class="msg-overlay-conversation-bubble"><header class="msg-overlay-bubble-header"><a href="${target}">Bianca Salazar Jáuregui</a></header>${editor}<button id="send">Enviar</button></aside>`, { url: target, runScripts: 'outside-only' });
  const w = dom.window;
  let handler, sends = 0;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } } } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom's default opacity is empty unlike the computed value in Chrome.
  w.document.querySelectorAll('*').forEach(node => { node.style.opacity = '1'; });
  w.document.querySelector('#send').onclick = () => sends++;
  w.eval(helpers); w.eval('delay = async () => {};'); w.eval(prepare);
  return { w, close: () => w.close(), sends: () => sends,
    auto: () => { w.eval(automatic); return new Promise(resolve => handler({ action: 'PROSPECT_EXECUTE_SEND', operationId: 'op', profileUrl: target, fullName: 'Bianca Salazar Jáuregui', message: 'Hola Bianca, ¿trabajas en selección?' }, { id: 'ext' }, resolve)); },
    request: () => new Promise(resolve => handler({ action: 'PROSPECT_PREPARE_MESSAGE', profileUrl: target, fullName: 'Bianca Salazar Jáuregui', message: 'Hola Bianca, ¿trabajas en selección?' }, { id: 'ext' }, resolve)) };
}
test('modern div layout with role heading and main, without section/artdeco/h1, prepares verified chat', async () => {
  const env = fixture('<div role="main"><div class="random"><div><span role="heading" aria-level="1">Bianca Salazar Jáuregui</span></div><div><button aria-label="Enviar mensaje"><svg></svg></button></div></div><section><h2>Acerca de</h2></section></div>');
  try { assert.equal((await env.request()).status, 'prepared'); assert.equal(env.sends(), 0); assert.equal(env.w.document.querySelector('[contenteditable]').textContent, 'Hola Bianca, ¿trabajas en selección?'); }
  finally { env.close(); }
});
test('same modern header helpers support explicit auto send and confirm new scoped event', async () => {
  const env = fixture('<main><div><h2 aria-level="1" role="heading">Bianca Salazar Jáuregui</h2><button>Enviar mensaje</button></div></main>');
  const doc = env.w.document;
  doc.querySelector('#send').className = 'msg-form__send-button';
  doc.querySelector('#send').addEventListener('click', () => {
    const group = doc.createElement('div'); group.className = 'msg-s-message-group--is-mine';
    group.innerHTML = '<div class="msg-s-event-listitem" data-event-urn="urn:new"><p class="msg-s-event-listitem__body">Hola Bianca, ¿trabajas en selección?</p></div>';
    doc.querySelector('aside').append(group);
  });
  try { assert.equal((await env.auto()).status, 'confirmed'); assert.equal(env.sends(), 1); }
  finally { env.close(); }
});
test('traditional h1 profile and textarea editor insert exact text without sending', async () => {
  const env = fixture('<main><section><h1>Bianca Salazar Jáuregui</h1><button>Enviar mensaje</button></section></main>', '<textarea name="message"></textarea>');
  try { assert.equal((await env.request()).status, 'prepared'); assert.equal(env.w.document.querySelector('textarea').value, 'Hola Bianca, ¿trabajas en selección?'); assert.equal(env.sends(), 0); }
  finally { env.close(); }
});
test('unrelated recommendation CTA is never selected as profile action', async () => {
  const env = fixture('<main><div><h1>Bianca Salazar Jáuregui</h1></div><section><h2>Más perfiles</h2><button>Enviar mensaje</button></section></main>');
  env.w.document.querySelector('.msg-overlay-bubble-header a').href = 'https://www.linkedin.com/in/other';
  try { assert.equal((await env.request()).ok, false); assert.equal(env.sends(), 0); assert.equal(env.w.document.querySelector('[contenteditable]').textContent, ''); }
  finally { env.close(); }
});
test('plain anchor with duplicate accessible label is detected without following the profile', async () => {
  const env = fixture('<main><section><h1>Bianca Salazar Jáuregui</h1><button id="follow">Seguir</button><a id="message" href="#"><span aria-hidden="true">Enviar mensaje</span><span>Enviar mensaje a Bianca</span></a></section></main>');
  try {
    assert.equal(env.w.linkedinProfileHeader().button.id, 'message');
    let follows = 0;
    env.w.document.querySelector('#follow').onclick = () => follows++;
    assert.equal((await env.request()).status, 'prepared');
    assert.equal(follows, 0);
  } finally { env.close(); }
});
test('free profile without messaging explains follow versus connection', async () => {
  const env = fixture('<main><section><h1>Bianca Salazar Jáuregui</h1><button>Seguir</button></section></main>');
  env.w.document.querySelector('aside').remove();
  try {
    const result = await env.request();
    assert.equal(result.ok, false);
    assert.match(result.error, /seguirlo no garantiza/i);
    assert.match(result.error, /Conectar/);
  } finally { env.close(); }
});
test('profile name rendered as a paragraph still scopes its message button', () => {
  const env = fixture('<main><section><p>Bianca Salazar Jáuregui</p><a href="#" id="message">Enviar mensaje</a></section><section><h2>Acerca de</h2></section></main>');
  try { assert.equal(env.w.linkedinProfileHeader('Bianca Salazar Jáuregui').button.id, 'message'); }
  finally { env.close(); }
});
test('verified InMail prepares body and requests manual subject/credit review, never auto-sends', async () => {
  const env = fixture('<main><section><h1>Bianca Salazar Jáuregui</h1><button>InMail</button></section></main>', '<input name="subject"><div contenteditable="true" role="textbox"></div>');
  try {
    const result = await env.request();
    assert.equal(result.status, 'prepared');
    assert.match(result.message, /créditos/);
    assert.equal((await env.auto()).status, 'not_sent');
    assert.equal(env.sends(), 0);
  } finally { env.close(); }
});
test('Premium gate explains access instead of reporting a missing button', async () => {
  const env = fixture('<main><section><h1>Bianca Salazar Jáuregui</h1><button>Enviar mensaje</button></section></main><div role="dialog">Prueba Premium para enviar InMail</div>');
  try {
    const result = await env.request();
    assert.equal(result.ok, false);
    assert.match(result.error, /Premium o créditos/);
    assert.equal(env.sends(), 0);
  } finally { env.close(); }
});
