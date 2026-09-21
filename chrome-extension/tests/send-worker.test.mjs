import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../prospecting-background.js', import.meta.url), 'utf8');
function fixture({ changed = false, unavailable = false, disconnect = false, syncFails = false } = {}) {
  const session = { organizationId: 'org', userId: 'user' };
  const local = {}, claims = new Map();
  let executions = 0, syncs = 0, handler;
  const chrome = {
    runtime: { id: 'ext', getURL: path => `chrome-extension://ext/${path}`, onMessage: { addListener: fn => { handler = fn; } } },
    storage: {
      session: { get: async () => ({ prospectConnection: { origin: 'https://app.antonia.ai', tabId: 1, session } }), remove: async () => {} },
      local: { get: async () => local, set: async value => Object.assign(local, value), remove: async key => { delete local[key]; } },
    },
    tabs: { onRemoved: { addListener() {} }, get: async id => ({ id, url: id === 1 ? 'https://app.antonia.ai/extension/connect' : 'https://www.linkedin.com/in/ana' }),
      sendMessage: async (_tabId, request) => {
        if (request.action === 'PROSPECT_PING') return { ready: true };
        if (request.action === 'PROSPECT_EXECUTE_SEND') {
          executions++;
          if (disconnect) throw new Error('Worker interrupted');
          return { status: 'confirmed', eventId: 'new-event' };
        }
        const body = request.body;
        if (body.action === 'session') return { ok: true, result: changed ? { ...session, userId: 'other' } : session };
        if (body.action === 'send-claim') {
          if (unavailable) return { ok: false, error: 'Backend unavailable' };
          if (claims.has(body.sendMessage)) return { ok: true, result: { id: 'op', claimed: false, status: 'pending' } };
          claims.set(body.sendMessage, true);
          return { ok: true, result: { id: 'op', claimed: true, claimToken: 'token' } };
        }
        if (body.action === 'send-result') { syncs++; return syncFails ? { ok: false, error: 'offline' } : { ok: true, result: {} }; }
        throw new Error('Unexpected request');
      },
    }, sidePanel: { setPanelBehavior: async () => {} },
  };
  const fetch = async (_url, options) => {
    const response = await chrome.tabs.sendMessage(1, { body: JSON.parse(options.body) });
    return { ok: response.ok, status: response.ok ? 200 : 503, json: async () => response.ok ? response.result : { error: response.error } };
  };
  const boot = () => vm.runInNewContext(source, { chrome, console, URL, fetch });
  boot();
  const send = (action = 'PROSPECT_SEND', extra = {}) => new Promise(resolve => handler({ action, confirmed: true, message: 'Hola', profileUrl: 'https://www.linkedin.com/in/ana', tabId: 2, ...session, ...extra },
    { id: 'ext', url: 'chrome-extension://ext/panel.html' }, resolve));
  return { send, boot, local, executions: () => executions, syncs: () => syncs };
}
test('worker requires current scope, explicit confirmation and durable backend claim before DOM access', async () => {
  for (const options of [{ changed: true }, { unavailable: true }, {}]) {
    const env = fixture(options);
    const result = await env.send('PROSPECT_SEND', options.changed || options.unavailable ? {} : { confirmed: false });
    assert.equal(result.ok, false); assert.equal(env.executions(), 0);
  }
});
test('worker replay after restart cannot send twice and successful sync removes local journal', async () => {
  const env = fixture();
  assert.equal((await env.send()).result.status, 'confirmed');
   assert.equal(Object.keys(env.local).filter(key => key.startsWith('prospect-send:')).length, 0);
  env.boot();
  assert.equal((await env.send()).result.duplicate, true);
  assert.equal(env.executions(), 1);
});
test('lost response is uncertain; failed synchronization preserves journal without retrying delivery', async () => {
  const env = fixture({ disconnect: true, syncFails: true });
  const result = await env.send();
  assert.equal(result.result.status, 'uncertain'); assert.equal(result.result.synced, false);
  assert.equal(Object.keys(env.local).filter(key => key.startsWith('prospect-send:')).length, 1);
  env.boot(); await env.send();
  assert.equal(env.executions(), 1);
});
