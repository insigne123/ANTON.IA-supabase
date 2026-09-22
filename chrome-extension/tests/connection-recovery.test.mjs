import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../prospecting-background.js', import.meta.url), 'utf8');

function fixture({ lostPrepare = false, unauthorized = false } = {}) {
  const session = { userId: 'user', organizationId: 'org' };
  const local = { prospectConnection: { origin: 'https://app.antonia.ai', session } };
  let handler, ready = false, injections = 0, preparations = 0, fetches = 0;
  const chrome = {
    runtime: { id: 'ext', getURL: path => `chrome-extension://ext/${path}`, onMessage: { addListener: fn => { handler = fn; } } },
    storage: {
      local: { get: async () => local, set: async value => Object.assign(local, value), remove: async key => { delete local[key]; } },
      session: { get: async () => ({}), remove: async () => {}, clear: async () => {} },
    },
    tabs: { get: async id => { assert.equal(id, 2); return { id, url: 'https://www.linkedin.com/in/ana' }; },
      sendMessage: async (_id, request) => {
        if (!ready) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (request.action === 'PROSPECT_PING') return { ready: true };
        if (request.action === 'PROSPECT_PREPARE_MESSAGE') {
          preparations++;
          if (lostPrepare) throw new Error('Response lost');
          return { status: 'prepared' };
        }
        throw new Error('Unexpected tab request');
      } },
    scripting: { executeScript: async ({ target, files }) => { assert.equal(target.tabId, 2); assert.equal(files.length, 4); for (const name of ['content.js', 'prospecting-content.js', 'prospecting-send.js', 'prospecting-invite.js']) assert.ok(files.includes(name)); injections++; ready = true; } },
    sidePanel: { setPanelBehavior: async () => {} },
  };
  const fetch = async (url, options) => {
    assert.equal(url, 'https://app.antonia.ai/api/extension/workspace');
    assert.equal(options.credentials, 'include');
    fetches++;
    return { ok: !unauthorized, status: unauthorized ? 401 : 200, json: async () => unauthorized ? { error: 'Sesión vencida' } : session };
  };
  const boot = () => vm.runInNewContext(source, { chrome, fetch, console, URL });
  boot();
  const send = action => new Promise(resolve => handler({ action, tabId: 2, profileUrl: 'https://www.linkedin.com/in/ana', message: 'Hola', ...session, body: { action: 'session' } }, { id: 'ext', url: 'chrome-extension://ext/panel.html' }, resolve));
  return { send, boot, local, counts: () => ({ injections, preparations, fetches }) };
}
test('pairing survives worker restart with no app tab; API uses browser session directly', async () => {
  const env = fixture();
  env.boot();
  assert.equal((await env.send('PROSPECT_SESSION')).result.session.userId, 'user');
  assert.equal((await env.send('PROSPECT_API')).ok, true);
  assert.equal(env.counts().fetches, 1);
});
test('missing LinkedIn receiver is restored before preparing, without replaying mutations', async () => {
  for (const lostPrepare of [false, true]) {
    const env = fixture({ lostPrepare });
    assert.equal((await env.send('PROSPECT_PREPARE')).ok, !lostPrepare);
    assert.deepEqual(env.counts(), { injections: 1, preparations: 1, fetches: 0 });
  }
});
test('expired session and explicit disconnect clear persistent pairing', async () => {
  for (const action of ['PROSPECT_API', 'PROSPECT_DISCONNECT']) {
    const env = fixture({ unauthorized: true });
    await env.send(action);
    assert.equal(env.local.prospectConnection, undefined);
  }
});
